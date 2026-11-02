import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { db } from './db.js';
import { createCanvasRouter, CANVAS_PROXY_TOKEN } from './canvasRoutes.js';
import { imageSizePresets } from '../integrations/infinite-canvas/web/src/lib/media-size.js';
import type { User } from '../src/types.js';

test('canvas image jobs survive client disconnect, charge once, and refund only on real failure or cancel', async t => {
  let credits = 100;
  const activeMember = { planId: 'test-vip', status: 'active' as const, expiresAt: Date.now() + 86400_000 };
  let fail = false;
  const hold = true;
  let upstreamClosed = false;
  let seen: any;
  let release: (() => void) | undefined;
  const png = (width: number, height: number) => {
    const bytes = Buffer.alloc(24);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
    bytes.writeUInt32BE(width, 16);
    bytes.writeUInt32BE(height, 20);
    return bytes.toString('base64');
  };
  const upstream = express();
  upstream.use(express.json({ limit: '2mb' }));
  upstream.post('/v1/images/generations', (req, res) => {
    seen = req.body;
    res.on('close', () => { if (!res.writableEnded) upstreamClosed = true; });
    const finish = () => {
      if (res.writableEnded) return;
      if (fail) { res.sendStatus(500); return; }
      res.json({ data: [{ b64_json: png(1672, 941) }] });
    };
    if (hold) { release = finish; return; }
    finish();
  });
  const upstreamServer = upstream.listen(0, '127.0.0.1');
  await once(upstreamServer, 'listening');
  const address = upstreamServer.address() as import('node:net').AddressInfo;
  const config = { baseUrl: `http://127.0.0.1:${address.port}`, apiKey: 'test-server-secret', modelName: 'gpt-image-test' };
  t.mock.method(db, 'resolveImageConfig', () => config);
  t.mock.method(db, 'getPlanningConfig', () => config);
  t.mock.method(db, 'getUserById', () => ({ id: 'test', username: 'test', credits, membership: activeMember }));
  t.mock.method(db, 'updateUser', (_id: string, updates: any) => {
    if (typeof updates.credits === 'number') credits = updates.credits;
    return { id: 'test', username: 'test', credits, membership: activeMember };
  });
  t.mock.method(db, 'addUsageRecord', () => undefined);
  t.mock.method(db, 'getMembershipPlans', () => []);
  const host = express();
  host.use(express.json({ limit: '2mb' }));
  host.use('/api/canvas', createCanvasRouter((req, res) => {
    if (req.headers.cookie !== 'test-session') { res.status(401).json({ error: 'login required' }); return null; }
    return { id: 'test', username: 'test', credits, membership: activeMember } as User;
  }));
  const server = host.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const hostAddress = server.address() as import('node:net').AddressInfo;
  const base = `http://127.0.0.1:${hostAddress.port}/api/canvas`;
  const headers = { Cookie: 'test-session', Authorization: `Bearer ${CANVAS_PROXY_TOKEN}`, 'Content-Type': 'application/json' };
  const size = imageSizePresets['2k']['16:9'];
  const waitUntil = async (predicate: () => boolean | Promise<boolean>, label: string) => {
    const start = Date.now();
    while (!await predicate()) {
      if (Date.now() - start > 4000) throw new Error(label);
      await new Promise(resolve => setTimeout(resolve, 15));
    }
  };
  const postJob = (id: string, signal?: AbortSignal) => fetch(base + '/image/v1/images/generations', {
    method: 'POST', headers, signal, body: JSON.stringify({ celanoJobId: id, size, resolution: '2K', n: 1 }),
  });
  try {
    assert.equal((await fetch(base + '/image/jobs/jobdisconnect01')).status, 401);
    const invalid = await fetch(base + '/image/v1/images/generations', { method: 'POST', headers, body: JSON.stringify({ celanoJobId: 'bad id', size, resolution: '2K' }) });
    assert.equal(invalid.status, 400);
    assert.match((await invalid.json()).error.message, /编号无效/);
    assert.equal(credits, 100);

    release = undefined;
    upstreamClosed = false;
    const disconnected = new AbortController();
    const first = postJob('jobdisconnect01', disconnected.signal);
    await waitUntil(() => typeof release === 'function', 'upstream did not receive the generation');
    disconnected.abort();
    await first.catch(() => undefined);
    await new Promise(resolve => setTimeout(resolve, 80));
    assert.equal(upstreamClosed, false, 'client disconnect must not abort the upstream generation');
    assert.equal(seen.celanoJobId, undefined);
    assert.equal(credits, 95);
    const finishDisconnect = release!;
    release = undefined;
    finishDisconnect();
    await waitUntil(async () => (await (await fetch(base + '/image/jobs/jobdisconnect01', { headers: { Cookie: 'test-session' } })).json()).status === 'succeeded', 'disconnected job did not succeed');
    const claimed = await (await fetch(base + '/image/jobs/jobdisconnect01', { headers: { Cookie: 'test-session' } })).json();
    assert.match(claimed.result.data[0].url, /^\/api\/canvas\/generated\/[a-f0-9]{32}$/);
    assert.equal(credits, 95);
    const replay = await postJob('jobdisconnect01');
    assert.equal(replay.status, 200);
    assert.equal((await replay.json()).data[0].url, claimed.result.data[0].url);
    assert.equal(credits, 95, 'replaying the same job must not charge again');

    release = undefined;
    upstreamClosed = false;
    const cancelRequest = postJob('jobcancel000001');
    await waitUntil(() => typeof release === 'function', 'upstream did not receive the cancellable generation');
    const cancelled = await fetch(base + '/image/jobs/jobcancel000001/cancel', { method: 'POST', headers: { Cookie: 'test-session' } });
    assert.equal(cancelled.status, 200);
    await waitUntil(() => upstreamClosed, 'user cancel did not abort the upstream generation');
    const cancelResponse = await cancelRequest;
    assert.equal(cancelResponse.status, 499);
    await waitUntil(async () => (await (await fetch(base + '/image/jobs/jobcancel000001', { headers: { Cookie: 'test-session' } })).json()).status === 'cancelled', 'cancel did not settle');
    assert.equal(credits, 95, 'explicit cancel refunds the charge');

    release = undefined;
    upstreamClosed = false;
    fail = true;
    const failedDisconnect = new AbortController();
    const failed = postJob('jobfail000000001', failedDisconnect.signal);
    await waitUntil(() => typeof release === 'function', 'upstream did not receive the failing generation');
    failedDisconnect.abort();
    await failed.catch(() => undefined);
    const finishFailure = release!;
    release = undefined;
    finishFailure();
    await waitUntil(async () => (await (await fetch(base + '/image/jobs/jobfail000000001', { headers: { Cookie: 'test-session' } })).json()).status === 'failed', 'failed job did not settle');
    assert.equal(upstreamClosed, false);
    assert.equal(credits, 95, 'a real upstream failure still refunds, even if the browser already left');
  } finally {
    if (release) release();
    server.closeAllConnections();
    upstreamServer.closeAllConnections();
    await Promise.all([
      new Promise<void>(resolve => server.close(() => resolve())),
      new Promise<void>(resolve => upstreamServer.close(() => resolve())),
    ]);
  }
});
