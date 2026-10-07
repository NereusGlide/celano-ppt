import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import express from 'express';
import { adminRouter } from './adminRoutes.js';
import { db } from './db.js';
import { hashPassword } from './auth.js';
import { signAdminToken } from './adminAuth.js';

async function host(t: any) {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminRouter);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const base = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}/api/admin`;
  const credentials = new Map<string, ReturnType<typeof db.getCredentials>>();
  return (url: string, method = 'GET', body?: unknown, id = 'super', tokenOverride?: string, cookieOverride?: string) => {
    if (!credentials.has(id)) credentials.set(id, db.getCredentials(id));
    const token = tokenOverride || signAdminToken(id, credentials.get(id));
    return fetch(base + url, {
    method, headers: { ...(cookieOverride ? { Cookie: cookieOverride } : { Authorization: `Bearer ${token}` }), 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    });
  };
}

const account = (id: string, role = id) => ({ id, username: id, name: id, role, status: 'active', createdAt: 1 });

test('后台不存在账号与错密返回相同401，不提前泄露禁用状态', async t => {
  t.mock.method(db, 'getAdminByUsername', (name: string) => name === 'missing' ? undefined : { ...account(name), status: name === 'disabled' ? 'disabled' : 'active' });
  t.mock.method(db, 'getCredentials', () => hashPassword('correct-password'));
  const request = await host(t);
  const responses = await Promise.all(['missing', 'existing', 'disabled'].map(async username => {
    const res = await request('/auth/login', 'POST', { username, password: 'wrong-password' });
    return { status: res.status, body: await res.json() };
  }));
  assert.equal(responses[0].status, 401);
  assert.deepEqual(responses[0], responses[1]);
  assert.deepEqual(responses[1], responses[2]);
});

test('operator只读列表允许，管理写和付费测试拒绝，数据库当前role生效', async t => {
  t.mock.method(db, 'getAdminById', (id: string) => account(id) as any);
  t.mock.method(db, 'getUsers', () => []);
  const credential = hashPassword('current-password');
  t.mock.method(db, 'getCredentials', () => credential);
  let ownPasswordWrites = 0;
  t.mock.method(db, 'setCredentials', (id: string) => { assert.equal(id, 'operator'); ownPasswordWrites++; });
  let writes = 0;
  t.mock.method(db, 'deleteUser', () => { writes++; return true; });
  const request = await host(t);
  assert.equal((await request('/users', 'GET', undefined, 'operator')).status, 200);
  assert.equal((await request('/auth/profile', 'GET', undefined, 'operator')).status, 200);
  assert.equal((await request('/auth/logout', 'POST', {}, 'operator')).status, 200);
  assert.equal((await request('/auth/password', 'POST', { oldPassword: 'current-password', newPassword: 'next-password' }, 'operator')).status, 200);
  assert.equal(ownPasswordWrites, 1);
  for (const [url, method, body] of [
    ['/users/user', 'DELETE', undefined], ['/users/user/password', 'POST', { newPassword: 'replacement' }],
    ['/planning-config', 'PUT', { modelName: 'other' }], ['/planning-config/test', 'POST', {}],
    ['/membership-plans', 'PUT', []], ['/invite-codes', 'POST', {}],
  ] as const) assert.equal((await request(url, method, body, 'operator')).status, 403, url);
  assert.equal(writes, 0);
  assert.equal((await request('/users/user', 'DELETE')).status, 200);
  assert.equal(writes, 1);
  assert.equal((await request('/users', 'GET', undefined, 'unknown-role')).status, 403);
});

test('改密后旧管理员Bearer失效并返回可用新token，当前Cookie同步轮换', async t => {
  const accountState = account('super');
  let credential = hashPassword('current-password');
  t.mock.method(db, 'getAdminById', () => accountState as any);
  t.mock.method(db, 'getCredentials', () => credential);
  t.mock.method(db, 'setCredentials', (_id: string, next: any) => { credential = next; });
  const request = await host(t);
  const oldToken = signAdminToken('super', credential);
  const oldCookie = `celano_admin_session=${encodeURIComponent(oldToken)}`;
  const changed = await request('/auth/password', 'POST', { oldPassword: 'current-password', newPassword: 'next-password' }, 'super', oldToken);
  assert.equal(changed.status, 200);
  const changedBody = await changed.json();
  assert.equal(typeof changedBody.token, 'string');
  assert.notEqual(changedBody.token, oldToken);
  assert.equal((await request('/auth/profile', 'GET', undefined, 'super', oldToken)).status, 401);
  assert.equal((await request('/auth/profile', 'GET', undefined, 'super', undefined, oldCookie)).status, 401);
  assert.equal((await request('/auth/profile', 'GET', undefined, 'super', changedBody.token)).status, 200);
  const newCookie = changed.headers.get('set-cookie') || '';
  assert.match(newCookie, /celano_admin_session=/);
  assert.equal((await request('/auth/profile', 'GET', undefined, 'super', undefined, newCookie.split(';')[0])).status, 200);
});

test('生产环境拒绝缺失、公开默认和弱初始管理员口令', async t => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousPassword = process.env.ADMIN_INITIAL_PASSWORD;
  t.after(() => {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousNodeEnv;
    if (previousPassword === undefined) delete process.env.ADMIN_INITIAL_PASSWORD; else process.env.ADMIN_INITIAL_PASSWORD = previousPassword;
  });
  process.env.NODE_ENV = 'production';
  for (const value of ['', 'admin123', 'short-pass']) {
    process.env.ADMIN_INITIAL_PASSWORD = value;
    const { resolveInitialAdminPassword } = await import('./adminAuth.js');
    assert.throws(() => resolveInitialAdminPassword(), /生产环境必须/);
  }
  process.env.ADMIN_INITIAL_PASSWORD = 'a-strong-production-password';
  const { resolveInitialAdminPassword } = await import('./adminAuth.js');
  assert.equal(resolveInitialAdminPassword(), 'a-strong-production-password');
});

test('所有配置响应隐藏通用与分档密钥，空白编辑保留已有密钥', async t => {
  t.mock.method(db, 'getAdminById', (id: string) => account(id) as any);
  const credential = hashPassword('config-test-password');
  t.mock.method(db, 'getCredentials', () => credential);
  let planning: any = { baseUrl: 'http://example.invalid', apiKey: 'planning-secret', modelName: 'model' };
  let optimize: any = { ...planning, apiKey: 'optimize-secret', enabled: true };
  let image: any = { id: 'image', ...planning, apiKey: 'image-secret', updatedAt: 1, resolutionConfigs: { '2K': { ...planning, apiKey: 'tier-secret' } } };
  t.mock.method(db, 'getPlanningConfig', () => planning);
  t.mock.method(db, 'updatePlanningConfig', (updates: any) => planning = { ...planning, ...updates });
  t.mock.method(db, 'getPromptOptimizeConfig', () => optimize);
  t.mock.method(db, 'updatePromptOptimizeConfig', (updates: any) => optimize = { ...optimize, ...updates });
  t.mock.method(db, 'getAiConfigs', () => [image]);
  t.mock.method(db, 'updateAiConfig', (_id: string, updates: any) => image = { ...image, ...updates });
  t.mock.method(db, 'createAiConfig', () => undefined);
  const request = await host(t);
  for (const [url, method, body, property] of [
    ['/planning-config', 'GET', undefined, 'planningConfig'],
    ['/planning-config', 'PUT', { apiKey: '', modelName: 'updated' }, 'planningConfig'],
    ['/prompt-optimize-config', 'GET', undefined, 'promptOptimizeConfig'],
    ['/prompt-optimize-config', 'PUT', { apiKey: '', modelName: 'updated' }, 'promptOptimizeConfig'],
    ['/ai-configs/image', 'PATCH', { apiKey: '', resolutionConfigs: { '2K': { apiKey: '', modelName: 'updated' } } }, 'aiConfig'],
  ] as const) {
    const res = await request(url, method, body);
    const text = await res.text();
    assert.equal(res.status, 200, url + ' ' + text);
    assert.doesNotMatch(text, /planning-secret|optimize-secret|image-secret|tier-secret/);
    const value = JSON.parse(text)[property];
    assert.equal(value.apiKey, '');
    assert.equal(value.hasApiKey, true);
  }
  assert.equal(planning.apiKey, 'planning-secret');
  assert.equal(optimize.apiKey, 'optimize-secret');
  assert.equal(image.apiKey, 'image-secret');
  assert.equal(image.resolutionConfigs['2K'].apiKey, 'tier-secret');
  assert.equal(image.resolutionConfigs['2K'].modelName, 'updated');
  for (const url of ['/planning-config', '/prompt-optimize-config', '/ai-configs', '/image-configs']) {
    const response = await request(url, 'GET', undefined, 'operator');
    assert.equal(response.status, 200);
    assert.doesNotMatch(await response.text(), /planning-secret|optimize-secret|image-secret|tier-secret/);
  }
  const list = await (await request('/ai-configs')).json();
  assert.equal(list.aiConfigs[0].resolutionConfigs['2K'].apiKey, '');
  assert.equal(list.aiConfigs[0].resolutionConfigs['2K'].hasApiKey, true);
  const created = await (await request('/ai-configs', 'POST', { name: 'test', baseUrl: 'http://example.invalid', apiKey: 'new-secret' })).json();
  assert.equal(created.aiConfig.apiKey, '');
  assert.equal(created.aiConfig.hasApiKey, true);
});
