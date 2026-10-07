import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { app } from '../server.js';
import { db } from './db.js';
import { hashPassword } from './auth.js';
import { createUserSessionToken, USER_SESSION_COOKIE } from './userSession.js';

async function host(t: any) {
  const credential = hashPassword('test-password');
  const user = { id: 'security-test', username: 'security-test', status: 'active', name: '测试', avatar: '', role: 'creator', createdAt: 1 };
  t.mock.method(db, 'getUserById', () => user as any);
  t.mock.method(db, 'getCredentials', () => credential);
  t.mock.method(db, 'updateUser', () => user as any);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const base = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
  const cookie = `${USER_SESSION_COOKIE}=${createUserSessionToken(user.id, credential)}`;
  return (url: string, method = 'GET', body?: unknown, withCookie = true) => fetch(base + url, {
    method, headers: { ...(withCookie ? { Cookie: cookie } : {}), ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
  });
}

function upload(filename: string, bytes: string | Buffer, type: string) {
  const body = new FormData();
  body.set('file', new Blob([typeof bytes === 'string' ? bytes : new Uint8Array(bytes)], { type }), filename);
  return body;
}
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');

test('旧作品列表与详情接口统一要求用户会话', async t => {
  const request = await host(t);
  t.mock.method(db, 'getPresentations', () => []);
  t.mock.method(db, 'getPresentationById', () => undefined);
  assert.equal((await request('/api/presentations', 'GET', undefined, false)).status, 401);
  assert.equal((await request('/api/presentations/original', 'GET', undefined, false)).status, 401);
});

test('旧作品PUT允许标题与页面编辑但不允许修改归属ID和服务端时间', async t => {
  const request = await host(t);
  const existing = { id: 'original', userId: 'security-test', title: '原题', slides: [], createdAt: 10, updatedAt: 20, finishedAt: 30 };
  let received: any;
  t.mock.method(db, 'getPresentationById', () => existing as any);
  t.mock.method(db, 'updatePresentation', (_id: string, updates: any) => { received = updates; return { ...existing, ...updates } as any; });
  const slides = [{ id: 'slide', imageUrl: 'data:image/png;base64,' + png.toString('base64'), title: '编辑页' }];
  const res = await request('/api/presentations/original', 'PUT', {
    id: 'other', userId: 'victim', createdAt: 999, updatedAt: 999, finishedAt: 999, credits: 999,
    title: '编辑标题', slides,
  });
  assert.equal(res.status, 200);
  const result = (await res.json()).presentation;
  assert.equal(result.id, 'original');
  assert.equal(result.userId, 'security-test');
  assert.equal(result.createdAt, 10);
  assert.equal(result.finishedAt, 30);
  assert.equal(received.updatedAt, undefined);
  assert.equal(received.credits, undefined);
  assert.equal(result.title, '编辑标题');
  assert.deepEqual(result.slides, slides);
});

test('参考与Logo上传按扩展和真实图片格式校验，HTML及SVG参考拒绝', async t => {
  const request = await host(t);
  for (const [route, filename, bytes, type] of [
    ['/api/upload-reference', 'payload.html', '<script>alert(1)</script>', 'text/html'],
    ['/api/upload-reference', 'payload.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>', 'image/svg+xml'],
    ['/api/upload-reference', 'payload.png', '<script>alert(1)</script>', 'image/png'],
    ['/api/upload-logo', 'payload.html', '<script>alert(1)</script>', 'image/png'],
    ['/api/upload-logo', 'payload.png', '<script>alert(1)</script>', 'image/png'],
    ['/api/upload-logo', 'payload.svg', '<html>fake svg</html>', 'image/svg+xml'],
  ] as const) assert.equal((await request(route, 'POST', upload(filename, bytes, type))).status, 400, filename + ' ' + route);
  const zeroSize = Buffer.from(png); zeroSize.writeUInt32BE(0, 16);
  assert.equal((await request('/api/upload-logo', 'POST', upload('zero.png', zeroSize, 'image/png'))).status, 400);
  const hugeSize = Buffer.from(png); hugeSize.writeUInt32BE(100000, 16);
  assert.equal((await request('/api/upload-logo', 'POST', upload('huge.png', hugeSize, 'image/png'))).status, 400);
  for (const route of ['/api/upload-reference', '/api/upload-logo']) {
    const res = await request(route, 'POST', upload('normal.png', png, 'image/png'));
    assert.equal(res.status, 200);
    const data = await res.json();
    const file = await request(data.url || data.file.url);
    assert.equal(file.status, 200);
    assert.match(file.headers.get('content-type') || '', /^image\/png/);
    assert.equal(file.headers.get('x-content-type-options'), 'nosniff');
  }
});

test('SVG Logo保留显示且独立sandbox禁脚本，文档和历史HTML仅附件下载', async t => {
  const request = await host(t);
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><script>alert(1)</script><rect width="20" height="20" fill="red"/></svg>';
  const logo = await request('/api/upload-logo', 'POST', upload('logo.svg', svg, 'image/svg+xml'));
  assert.equal(logo.status, 200);
  const rendered = await request((await logo.json()).url);
  assert.match(rendered.headers.get('content-type') || '', /^image\/svg\+xml/);
  assert.match(rendered.headers.get('content-security-policy') || '', /sandbox(?:;|$)/);
  assert.match(rendered.headers.get('content-security-policy') || '', /script-src 'none'/);
  const text = await request('/api/upload-reference', 'POST', upload('notes.txt', '参考正文', 'text/plain'));
  assert.equal(text.status, 200);
  const textFile = await request((await text.json()).file.url);
  assert.match(textFile.headers.get('content-disposition') || '', /^attachment/);
  const directory = path.resolve('data/legacy-uploads/user-security-test');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'old.html'), '<script>alert(1)</script>');
  const historic = await request('/api/legacy-uploads/security-test/old.html');
  assert.equal(historic.status, 200);
  assert.match(historic.headers.get('content-disposition') || '', /^attachment/);
  assert.match(historic.headers.get('content-type') || '', /^application\/octet-stream/);
  assert.match(historic.headers.get('content-security-policy') || '', /script-src 'none'/);
});
