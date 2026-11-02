import assert from 'node:assert/strict';
import dns from 'node:dns';
import { once } from 'node:events';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test, { type TestContext } from 'node:test';
import { app } from '../server.js';
import { hashPassword } from './auth.js';
import { db } from './db.js';
import { createUserSessionToken, USER_SESSION_COOKIE } from './userSession.js';

const PNG_TAIL = Buffer.from('CELANO-PNG-ORIGINAL-TAIL');
const JPEG_TAIL = Buffer.from('CELANO-JPEG-ORIGINAL-TAIL');
const png = Buffer.concat([
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'),
  PNG_TAIL,
]);
const jpeg = Buffer.concat([
  Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64'),
  JPEG_TAIL,
]);

function writeImage(storageKey: string, bytes: Buffer) {
  const full = path.resolve(process.cwd(), 'data', 'images', storageKey);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, bytes);
  return full;
}

async function host(t: TestContext) {
  const credential = hashPassword('test-password');
  const user = { id: 'pptx-export-user', username: 'pptx-export-user', status: 'active', name: '导出测试', avatar: '', role: 'creator', createdAt: 1, credits: 80 };
  const updates: Array<Record<string, unknown>> = [];
  const usage: Array<Record<string, unknown>> = [];
  t.mock.method(db, 'getUserById', () => user as any);
  t.mock.method(db, 'getCredentials', () => credential);
  t.mock.method(db, 'updateUser', (_id: string, patch: Record<string, unknown>) => { updates.push(patch); return user; });
  t.mock.method(db, 'addUsageRecord', (record: Record<string, unknown>) => { usage.push(record); });
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    logs.push(args.map(item => String(item)).join(' '));
  };
  t.after(() => { console.log = originalLog; });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const base = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
  const cookie = `${USER_SESSION_COOKIE}=${createUserSessionToken(user.id, credential)}`;
  const request = (url: string) => fetch(base + url, { headers: { Cookie: cookie } });
  return { request, logs, updates, usage, user };
}

function exportLog(logs: string[]) {
  const line = logs.find(item => item.startsWith('[pptx-export] '));
  assert.ok(line, '缺少导出耗时日志');
  return JSON.parse(line.slice('[pptx-export] '.length)) as {
    id: string; pageCount: number; readMs: number; writeMs: number; bufferBytes: number; totalMs: number;
  };
}

function mockRemoteImages(t: TestContext, files: Record<string, { mime: string; bytes: Buffer; delay?: number }>) {
  t.mock.method(dns, 'lookup', (_host: string, _options: unknown, callback: (error: Error | null, addresses: Array<{ address: string; family: number }>) => void) => {
    callback(null, [{ address: '8.8.8.8', family: 4 }]);
  });
  const transport = (raw: URL, options: { lookup?: (hostname: string, opts: unknown, callback: (error: Error | null) => void) => void }, callback: (response: PassThrough) => void) => {
    const url = new URL(raw);
    const request = new EventEmitter() as EventEmitter & { destroy: () => EventEmitter; end: () => EventEmitter };
    request.destroy = () => request;
    request.end = () => {
      const file = files[url.pathname];
      const send = () => {
        const stream = new PassThrough() as PassThrough & { statusCode?: number; headers?: Record<string, string> };
        stream.statusCode = file ? 200 : 404;
        stream.headers = { 'content-type': file?.mime || 'text/plain' };
        callback(stream);
        stream.end(file ? file.bytes : Buffer.from('missing'));
      };
      const kick = () => {
        if (options.lookup) options.lookup(url.hostname, {}, error => { if (error) request.emit('error', error); else send(); });
        else send();
      };
      setTimeout(kick, file?.delay || 0);
      return request;
    };
    return request;
  };
  t.mock.method(http, 'request', transport as any);
  t.mock.method(https, 'request', transport as any);
}

test('本地页面图按原文件嵌入 PPTX，并记录不含敏感信息的耗时', async t => {
  const pngKey = 'deck-local-1/page.png';
  const jpegKey = 'deck-local-1/page.jpg';
  writeImage(pngKey, png);
  writeImage(jpegKey, jpeg);
  const deck = {
    id: 'deck-local-1', userId: 'pptx-export-user', title: '原图画质', finished: true,
    slides: [
      { id: 'png', status: 'done', storageKey: pngKey },
      { id: 'jpeg', status: 'done', storageKey: jpegKey },
    ],
  };
  t.mock.method(db, 'getPptDeck', (id: string) => id === deck.id ? deck : undefined);
  t.mock.method(db, 'getPresentationById', () => undefined);
  const { request, logs, updates, usage } = await host(t);
  const response = await request('/api/presentations/deck-local-1/download');
  assert.equal(response.status, 200);
  const body = Buffer.from(await response.arrayBuffer());
  assert.ok(body.includes(png), 'PNG 原文字节应原样进入 pptx');
  assert.ok(body.includes(jpeg), 'JPEG 原文字节应原样进入 pptx');
  assert.ok(body.indexOf(png) < body.indexOf(jpeg));
  const timing = exportLog(logs);
  assert.equal(timing.id, 'deck-local-1');
  assert.equal(timing.pageCount, 2);
  assert.equal(timing.bufferBytes, body.length);
  assert.equal(typeof timing.readMs, 'number');
  assert.equal(typeof timing.writeMs, 'number');
  assert.ok(timing.totalMs >= timing.readMs);
  assert.ok(timing.totalMs >= timing.writeMs);
  assert.deepEqual(Object.keys(timing).sort(), ['bufferBytes', 'id', 'pageCount', 'readMs', 'totalMs', 'writeMs']);
  assert.equal(logs.filter(line => line.startsWith('[pptx-export] ')).join('\n').includes('pptx-export-user'), false);
  assert.equal(logs.filter(line => line.startsWith('[pptx-export] ')).join('\n').includes(pngKey), false);
  assert.equal(usage.length, 1);
  assert.equal(usage[0].type, 'export_pptx');
  assert.equal(usage[0].credits, 0);
  assert.ok(updates.every(patch => !Object.prototype.hasOwnProperty.call(patch, 'credits')));
});

test('旧作品的远程图和 data URL 保持原始字节，且准备顺序不打乱页面', async t => {
  const presentation = {
    id: 'legacy-remote-1', userId: 'pptx-export-user', title: '旧作品',
    slides: [
      { imageUrl: 'https://public.invalid/slow.jpg' },
      { imageUrl: 'data:image/png;base64,' + png.toString('base64') },
    ],
  };
  t.mock.method(db, 'getPptDeck', () => undefined);
  t.mock.method(db, 'getPresentationById', (id: string) => id === presentation.id ? presentation : undefined);
  const { request, logs, updates, usage } = await host(t);
  // 监听完成后再替换 DNS，避免把本机测试端口解析成公网地址。
  mockRemoteImages(t, { '/slow.jpg': { mime: 'image/jpeg', bytes: jpeg, delay: 40 } });
  const started = Date.now();
  const response = await request('/api/presentations/legacy-remote-1/download');
  assert.equal(response.status, 200);
  const body = Buffer.from(await response.arrayBuffer());
  assert.ok(body.includes(jpeg), '远程 JPEG 原文字节应原样进入 pptx');
  assert.ok(body.includes(png), 'data URL 原文字节应原样进入 pptx');
  assert.ok(body.indexOf(jpeg) < body.indexOf(png));
  const timing = exportLog(logs);
  assert.equal(timing.id, 'legacy-remote-1');
  assert.equal(timing.pageCount, 2);
  assert.equal(timing.bufferBytes, body.length);
  assert.ok(timing.readMs >= 20);
  assert.ok(Date.now() - started < 5000);
  assert.equal(usage[0].credits, 0);
  assert.ok(updates.every(patch => !Object.prototype.hasOwnProperty.call(patch, 'credits')));
});
