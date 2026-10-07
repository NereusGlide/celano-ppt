import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import express from 'express';
import { app } from '../server.js';
import { db } from './db.js';
import { hashPassword } from './auth.js';
import { resolveInitialAdminPassword, signAdminToken, verifyAdminToken } from './adminAuth.js';
import { createUserSessionToken, USER_SESSION_COOKIE } from './userSession.js';
import { adminRouter } from './adminRoutes.js';

async function listen(t: any, target: express.Express) {
  const server = target.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  return `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
}

test('生产环境缺少或使用弱初始管理员口令时拒绝启动口令解析', t => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalPassword = process.env.ADMIN_INITIAL_PASSWORD;
  t.after(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = originalNodeEnv;
    if (originalPassword === undefined) delete process.env.ADMIN_INITIAL_PASSWORD; else process.env.ADMIN_INITIAL_PASSWORD = originalPassword;
  });
  process.env.NODE_ENV = 'production';
  delete process.env.ADMIN_INITIAL_PASSWORD;
  assert.throws(() => resolveInitialAdminPassword(), /ADMIN_INITIAL_PASSWORD/);
  process.env.ADMIN_INITIAL_PASSWORD = 'admin123';
  assert.throws(() => resolveInitialAdminPassword(), /ADMIN_INITIAL_PASSWORD/);
  process.env.ADMIN_INITIAL_PASSWORD = 'short';
  assert.throws(() => resolveInitialAdminPassword(), /ADMIN_INITIAL_PASSWORD/);
  process.env.ADMIN_INITIAL_PASSWORD = 'Long-enough-admin-password-2026';
  assert.equal(resolveInitialAdminPassword(), 'Long-enough-admin-password-2026');
});

test('生产空数据库初始化缺少初始口令时真正中止，不继续可用进程', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'celano-prod-bootstrap-'));
  const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const environment: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: 'production', ADMIN_INITIAL_PASSWORD: '' };
  // 只在隔离临时cwd初始化模拟数据库，密钥路径也限定于该目录。
  delete environment.ADMIN_TOKEN_KEY_FILE;
  delete environment.USER_SESSION_KEY_FILE;
  try {
    const child = spawn(process.execPath, [
      '--import', pathToFileURL(path.join(project, 'node_modules/tsx/dist/loader.mjs')).href,
      '--input-type=module', '--eval', `await import(${JSON.stringify(pathToFileURL(path.join(project, 'server/db.ts')).href)});`,
    ], { cwd: directory, env: environment, stdio: 'ignore' });
    const [status] = await once(child, 'exit');
    assert.notEqual(status, 0, '生产初始化口令拒绝必须向外抛，不能被数据库init吞掉后继续运行');
    assert.equal(fs.existsSync(path.join(directory, 'data/store.json')), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('管理员令牌携带凭据指纹，缺少指纹的旧格式令牌拒绝验证', () => {
  const before = hashPassword('before-password');
  const after = hashPassword('after-password');
  const original = verifyAdminToken(signAdminToken('admin_root', before));
  const current = verifyAdminToken(signAdminToken('admin_root', after));
  assert.ok(original?.credentialTag);
  assert.ok(current?.credentialTag);
  assert.notEqual(original.credentialTag, current.credentialTag);
  assert.equal(verifyAdminToken(signAdminToken('admin_root')), null);
});

test('管理员路由拒绝改密前签发的Bearer令牌', async t => {
  const before = hashPassword('before-password');
  const after = hashPassword('after-password');
  t.mock.method(db, 'getAdminById', (id: string) => ({ id, username: 'admin', name: 'admin', role: 'super', status: 'active', createdAt: 1 }) as any);
  t.mock.method(db, 'getCredentials', () => after);
  const host = express();
  host.use(express.json());
  host.use('/api/admin', adminRouter);
  const base = await listen(t, host);
  const response = await fetch(base + '/api/admin/auth/profile', { headers: { Authorization: `Bearer ${signAdminToken('admin_root', before)}` } });
  assert.equal(response.status, 401);
  const oldCookie = await fetch(base + '/api/admin/auth/profile', { headers: { Cookie: `celano_admin_session=${signAdminToken('admin_root', before)}` } });
  assert.equal(oldCookie.status, 401);
  const newBearer = await fetch(base + '/api/admin/auth/profile', { headers: { Authorization: `Bearer ${signAdminToken('admin_root', after)}` } });
  assert.equal(newBearer.status, 200);
  const newCookie = await fetch(base + '/api/admin/auth/profile', { headers: { Cookie: `celano_admin_session=${signAdminToken('admin_root', after)}` } });
  assert.equal(newCookie.status, 200);
});

test('管理员实际改密返回新Cookie和令牌，所有旧Cookie与Bearer立即失效', async t => {
  let credential = hashPassword('before-password');
  t.mock.method(db, 'getAdminById', (id: string) => ({ id, username: 'admin', name: 'admin', role: 'super', status: 'active', createdAt: 1 }) as any);
  t.mock.method(db, 'getCredentials', () => credential);
  t.mock.method(db, 'setCredentials', (_id: string, saved: typeof credential) => { credential = saved; });
  const host = express();
  host.use(express.json());
  host.use('/api/admin', adminRouter);
  const base = await listen(t, host);
  const oldToken = signAdminToken('admin_root', credential);
  const changed = await fetch(base + '/api/admin/auth/password', {
    method: 'POST', headers: { Authorization: `Bearer ${oldToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ oldPassword: 'before-password', newPassword: 'after-password' }),
  });
  assert.equal(changed.status, 200);
  const result = await changed.json();
  assert.ok(result.token);
  const cookie = (changed.headers.get('set-cookie') || '').split(';')[0];
  assert.ok(cookie.startsWith('celano_admin_session='));
  for (const headers of [new Headers({ Authorization: `Bearer ${oldToken}` }), new Headers({ Cookie: `celano_admin_session=${oldToken}` })]) {
    assert.equal((await fetch(base + '/api/admin/auth/profile', { headers })).status, 401);
  }
  for (const headers of [new Headers({ Authorization: `Bearer ${result.token}` }), new Headers({ Cookie: cookie })]) {
    assert.equal((await fetch(base + '/api/admin/auth/profile', { headers })).status, 200);
  }
});

test('旧作品列表会校验credential fingerprint，改密后的旧Cookie不再读取作品', async t => {
  const before = hashPassword('before-password');
  const after = hashPassword('after-password');
  const user = { id: 'session-user', username: 'session-user', name: '测试', avatar: '', role: 'creator', status: 'active', createdAt: 1 };
  t.mock.method(db, 'getUserById', () => user as any);
  t.mock.method(db, 'getCredentials', () => after);
  t.mock.method(db, 'getPresentations', () => [{ id: 'owned', userId: user.id, title: '不应返回', slides: [], createdAt: 1, updatedAt: 1 }] as any);
  const base = await listen(t, app);
  const cookie = `${USER_SESSION_COOKIE}=${createUserSessionToken(user.id, before)}`;
  for (const url of ['/api/presentations', '/api/presentations/owned']) {
    const response = await fetch(base + url, { headers: { Cookie: cookie } });
    assert.equal(response.status, 401);
    const text = await response.text();
    assert.doesNotMatch(text, /不应返回/);
    assert.match(response.headers.get('set-cookie') || '', new RegExp(USER_SESSION_COOKIE));
  }
});
