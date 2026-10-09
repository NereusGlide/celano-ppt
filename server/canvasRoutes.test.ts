import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { db } from './db.js';
import { createCanvasRouter, CANVAS_PROXY_TOKEN } from './canvasRoutes.js';
import { imageSizePresets } from '../integrations/infinite-canvas/web/src/lib/media-size.js';
import type { User } from '../src/types.js';

test('canvas proxy keeps credentials server-side, quotes preset prices and refunds failed images', async t => {
  let credits = 100;
  // 加一个活跃会员身份，隔离「免费用户每日 3 张 2K」的免费额度逻辑，
  // 让本测试聚焦代理转发 / 报价 / 退款的正确性（折扣回落零售价 2K=5、4K=10）。
  const activeMember = { planId: 'test-vip', status: 'active', expiresAt: Date.now() + 86400_000 };
  let fail = false;
  let empty = false;
  let wrongSize = false;
  let nativeSize: string | undefined;
  let seen: any;
  const upstream = express();
  upstream.use(express.raw({ type: 'multipart/form-data' }));
  upstream.use(express.json());
  upstream.post('/v1/*', async (req, res) => {
    assert.equal(req.headers.authorization, 'Bearer test-server-secret');
    seen = Buffer.isBuffer(req.body) ? Object.fromEntries((await new Response(new Uint8Array(req.body), { headers: { 'Content-Type': String(req.headers['content-type']) } }).formData()).entries()) : req.body;
    if (fail) { res.sendStatus(500); return; }
    if (req.path.endsWith('/responses')) { res.type('text/event-stream').send('data: {"type":"response.completed"}\n\n'); return; }
    res.json({ data: empty ? [] : Array.from({ length: Number(seen.n || 1) }, () => ({ b64_json: (() => { const b = Buffer.alloc(24); Buffer.from([137,80,78,71,13,10,26,10]).copy(b); const [w,h] = String(nativeSize || (wrongSize ? '2048x1152' : seen.size || '1024x1024')).split('x').map(Number); b.writeUInt32BE(w,16); b.writeUInt32BE(h,20); return b.toString('base64'); })() })) });
  });
  const upstreamServer = upstream.listen(0, '127.0.0.1');
  await once(upstreamServer, 'listening');
  const address = upstreamServer.address() as import('node:net').AddressInfo;
  const config = { baseUrl: `http://127.0.0.1:${address.port}`, apiKey: 'test-server-secret', modelName: 'gpt-image-test' };
  const usage: any[] = [];
  t.mock.method(db, 'resolveImageConfig', () => config);
  t.mock.method(db, 'getPlanningConfig', () => config);
  t.mock.method(db, 'getUserById', () => ({ id: 'test', username: 'test', credits, membership: activeMember }));
  t.mock.method(db, 'updateUser', (_id: string, updates: any) => { credits = updates.credits; return { id: 'test', username: 'test', credits, membership: activeMember }; });
  t.mock.method(db, 'addUsageRecord', (record: any) => usage.push(record));
  t.mock.method(db, 'getMembershipPlans', () => []);
  const host = express();
  host.use(express.raw({ type: 'multipart/form-data' }));
  host.use(express.json());
  host.use('/api/canvas', createCanvasRouter((req, res) => {
    if (req.headers.cookie !== 'test-session') { res.status(401).json({ error: 'login required' }); return null; }
    return { id: 'test', username: 'test', credits, membership: activeMember } as User;
  }));
  const server = host.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const hostAddress = server.address() as import('node:net').AddressInfo;
  const base = `http://127.0.0.1:${hostAddress.port}/api/canvas`;
  const headers = { Cookie: 'test-session', Authorization: `Bearer ${CANVAS_PROXY_TOKEN}`, 'Content-Type': 'application/json' };
  try {
    const configResponse = await (await fetch(base + '/config')).text();
    assert.ok(!configResponse.includes('test-server-secret'));
    assert.equal((await fetch(base + '/image/v1/images/generations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
    assert.equal((await fetch(base + '/image/v1/unsupported', { method: 'POST', headers, body: '{}' })).status, 404);
    assert.equal((await fetch(base + '/image/v1/images/generations', { method: 'POST', headers, body: JSON.stringify({ expectedOwnerId: 'another-account' }) })).status, 409);
    assert.equal(credits, 100);
    for (const [scale, cost] of [['2k', 5], ['4k', 10]] as const) {
      for (const size of Object.values(imageSizePresets[scale])) {
        const quote = await (await fetch(base + '/quote', { method: 'POST', headers, body: JSON.stringify({ size, resolution: scale.toUpperCase(), n: 2 }) })).json();
        assert.equal(quote.cost, cost * 2);
        assert.equal(quote.size, size);
        assert.equal(quote.resolution, scale.toUpperCase());
      }
    }
    const generated = await fetch(base + '/image/v1/images/generations', { method: 'POST', headers, body: JSON.stringify({ expectedOwnerId: 'test', model: 'attacker-model', response_format: 'b64_json', n: 2, size: imageSizePresets['2k']['16:9'] }) });
    assert.equal(generated.status, 200);
    assert.equal(credits, 90);
    assert.equal(seen.model, 'gpt-image-test');
    assert.equal(seen.response_format, undefined);
    assert.equal(seen.expectedOwnerId, undefined);
    assert.match(seen.prompt, /中文文字准确性要求/);
    const png = (width: number, height: number) => { const bytes = Buffer.alloc(24); Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes); bytes.writeUInt32BE(width,16); bytes.writeUInt32BE(height,20); return new Blob([bytes], { type: 'image/png' }); };
    const maskedRequest = (maskWidth = 1672) => {
      const body = new FormData();
      body.set('image[]', png(1672, 941), 'original.png'); body.set('mask', png(maskWidth, 941), 'mask.png');
      body.set('prompt', '仅删除选中区域'); body.set('size', '2048x1152'); body.set('resolution', '2K'); body.set('local_edit', 'true'); body.set('original_size', '1672x941');
      return body;
    };
    assert.equal((await fetch(base + '/image/v1/images/edits', { method: 'POST', headers: { Cookie: 'test-session', Authorization: `Bearer ${CANVAS_PROXY_TOKEN}` }, body: maskedRequest(1600) })).status, 502);
    assert.equal(credits, 90, 'invalid masks must not charge credits');
    nativeSize = '1672x941';
    const masked = await fetch(base + '/image/v1/images/edits', { method: 'POST', headers: { Cookie: 'test-session', Authorization: `Bearer ${CANVAS_PROXY_TOKEN}` }, body: maskedRequest() });
    assert.equal(masked.status, 200);
    assert.equal(credits, 85);
    assert.ok(seen.mask instanceof Blob);
    assert.equal(seen.local_edit, undefined);
    assert.equal(seen.original_size, undefined);
    assert.match(seen.prompt, /透明蒙版区域是唯一可编辑区域/);
    nativeSize = '2048x1152';
    const changedOriginal = await fetch(base + '/image/v1/images/edits', { method: 'POST', headers: { Cookie: 'test-session', Authorization: `Bearer ${CANVAS_PROXY_TOKEN}` }, body: maskedRequest() });
    assert.equal(changedOriginal.status, 502);
    assert.equal(credits, 85, 'a resized local edit must be refunded');
    nativeSize = undefined;
    // Restore the baseline for the existing general generation/refund scenarios.
    credits = 90;
    const form = new FormData();
    form.set('prompt', 'change only the mask'); form.set('image', new Blob(['original']), 'original.png'); form.set('mask', new Blob(['mask']), 'mask.png');
    const edited = await fetch(base + '/image/v1/images/edits', { method: 'POST', headers: { Cookie: 'test-session', Authorization: `Bearer ${CANVAS_PROXY_TOKEN}` }, body: form });
    assert.equal(edited.status, 200);
    assert.equal(credits, 85);
    assert.equal(await seen.mask.text(), 'mask');
    assert.match(seen.prompt, /^change only the mask/);
    assert.match(seen.prompt, /中文文字准确性要求/);
    fail = true;
    const failed = await fetch(base + '/image/v1/images/generations', { method: 'POST', headers, body: '{}' });
    assert.equal(failed.status, 502);
    assert.equal(credits, 85);
    assert.deepEqual(usage.slice(-2).map(x => x.credits), [-5, 5]);
    fail = false; wrongSize = true;
    const mismatched = await fetch(base + '/image/v1/images/generations', { method: 'POST', headers, body: JSON.stringify({ size: imageSizePresets['4k']['16:9'] }) });
    assert.equal(mismatched.status, 502);
    assert.doesNotMatch(seen.prompt, /中文文字准确性要求/);
    assert.equal(credits, 85);
    assert.deepEqual(usage.slice(-2).map(x => x.credits), [-10, 10]);
    wrongSize = false; empty = true;
    assert.equal((await fetch(base + '/image/v1/images/generations', { method: 'POST', headers, body: '{}' })).status, 502);
    assert.equal(credits, 85);
    const streamed = await fetch(base + '/text/v1/responses', { method: 'POST', headers, body: '{}' });
    assert.match(await streamed.text(), /response.completed/);
    assert.equal(credits, 85);
    empty = false; nativeSize = '1536x1024';
    const native = await fetch(base + '/image/v1/images/generations', { method: 'POST', headers, body: JSON.stringify({ size: '2048x1152', resolution: '2K' }) });
    assert.equal(native.status, 502);
    assert.match((await native.json()).error.message, /请求 2048×1152，接口返回 1536×1024/);
    assert.equal(credits, 85);
    assert.equal(seen.size, '2048x1152');
    assert.equal(seen.quality, 'medium');
    assert.match(seen.prompt, /2048:1152 宽高比原生构建/);
    assert.deepEqual(usage.slice(-2).map(x => x.credits), [-5, 5]);
    nativeSize = '1672x941';
    const compatible = await fetch(base + '/image/v1/images/generations', { method: 'POST', headers, body: JSON.stringify({ size: '2048x1152', resolution: '2K', n: 1, output_format: 'png' }) });
    assert.equal(compatible.status, 200);
    const output = (await compatible.json()).data[0];
    assert.equal(output.size, '1672x941');
    assert.equal(output.width, 1672);
    assert.equal(output.height, 941);
    assert.equal(output.requested_size, '2048x1152');
    assert.equal(seen.n, undefined);
    assert.equal(seen.output_format, undefined);
    assert.equal(credits, 80);
    nativeSize = '512x512';
    const tooSmall = await fetch(base + '/image/v1/images/generations', { method: 'POST', headers, body: JSON.stringify({ size: '2048x1152', resolution: '2K' }) });
    assert.equal(tooSmall.status, 502);
    assert.equal(credits, 80);
  } finally {
    server.closeAllConnections(); upstreamServer.closeAllConnections();
    await Promise.all([new Promise<void>(resolve => server.close(() => resolve())), new Promise<void>(resolve => upstreamServer.close(() => resolve()))]);
  }
});
