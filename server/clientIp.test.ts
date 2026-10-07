/**
 * 客户端 IP 解析的单元测试。
 *
 * 这些分支在本机直连时无法真实触发（没有反向代理），但恰恰是
 * 「部署到反代/Cloudflare 之后还能不能记录到真实 IP」的关键，
 * 因此用构造请求对象的方式逐一覆盖。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeIp, resolveClientIp } from './clientIp.js';

test('normalizeIp 剥离 IPv6 映射前缀、方括号与端口', () => {
  assert.equal(normalizeIp('::ffff:127.0.0.1'), '127.0.0.1');
  assert.equal(normalizeIp('[::1]:52341'), '::1');
  assert.equal(normalizeIp('10.0.0.7:443'), '10.0.0.7');
  assert.equal(normalizeIp('  203.0.113.9  '), '203.0.113.9');
  assert.equal(normalizeIp(''), '');
  assert.equal(normalizeIp(undefined), '');
  assert.equal(normalizeIp(['1.2.3.4', '5.6.7.8']), '1.2.3.4');
});

test('未声明信任代理时不采信任何转发头（防止伪造）', () => {
  const req = {
    headers: { 'x-forwarded-for': '1.2.3.4', 'x-real-ip': '5.6.7.8', 'cf-connecting-ip': '9.9.9.9' },
    socket: { remoteAddress: '::ffff:192.168.1.20' },
  };
  assert.equal(resolveClientIp(req, 0), '192.168.1.20');
});

test('单跳代理：取 XFF 最右值（受信任代理追加的那一跳）', () => {
  assert.equal(resolveClientIp({ headers: { 'x-forwarded-for': '1.2.3.4' }, socket: {} }, 1), '1.2.3.4');
});

test('单跳代理：客户端伪造最左值时，记录的是真实客户端而不是伪造值', () => {
  // 客户端自带「9.9.9.9」，nginx 把真实来源追加在右侧
  const req = { headers: { 'x-forwarded-for': '9.9.9.9, 1.2.3.4' }, socket: { remoteAddress: '127.0.0.1' } };
  assert.equal(resolveClientIp(req, 1), '1.2.3.4');
});

test('两跳代理：从右往左数第 2 跳', () => {
  const req = { headers: { 'x-forwarded-for': '1.2.3.4, 10.0.0.1, 10.0.0.2' }, socket: {} };
  assert.equal(resolveClientIp(req, 2), '10.0.0.1');
});

test('信任跳数大于链长度时回落到最左值，不越界', () => {
  const req = { headers: { 'x-forwarded-for': '1.2.3.4' }, socket: {} };
  assert.equal(resolveClientIp(req, 5), '1.2.3.4');
});

test('未声明可信单值头来源时只采信受信XFF，不受cf/x-real-ip伪造影响', () => {
  const withCf = { headers: { 'cf-connecting-ip': '203.0.113.7', 'x-real-ip': '5.6.7.8', 'x-forwarded-for': '1.2.3.4' }, socket: {} };
  assert.equal(resolveClientIp(withCf, 1), '1.2.3.4');
  const withReal = { headers: { 'x-real-ip': '5.6.7.8', 'x-forwarded-for': '1.2.3.4' }, socket: {} };
  assert.equal(resolveClientIp(withReal, 1), '1.2.3.4');
});

test('没有转发头优先socket，缺少socket才使用req.ip', () => {
  assert.equal(resolveClientIp({ headers: {}, ip: '::ffff:172.16.0.9', socket: { remoteAddress: '127.0.0.1' } }, 1), '127.0.0.1');
  assert.equal(resolveClientIp({ headers: {}, ip: '::ffff:172.16.0.9' }, 1), '172.16.0.9');
  assert.equal(resolveClientIp({ headers: {}, socket: { remoteAddress: '::ffff:10.1.2.3' } }, 1), '10.1.2.3');
});

test('完全取不到时返回「未知」，避免写入空值', () => {
  assert.equal(resolveClientIp({ headers: {}, socket: {} }, 0), '未知');
  assert.equal(resolveClientIp({}, 0), '未知');
});

test('normalizeIp拒绝非IP文本、非法IPv4及畸形IPv6', () => {
  for (const value of ['attacker-bucket', '999.1.2.3', '1.2.3', '::ffff:evil', '[invalid]:123', '1.2.3.4/script']) assert.equal(normalizeIp(value), '');
  assert.equal(normalizeIp('2001:DB8::1'), '2001:db8::1');
});

test('非法受信XFF值不删除后向左采信伪造值，缺少XFF也不采单值头', () => {
  const socket = { remoteAddress: '127.0.0.1' };
  assert.equal(resolveClientIp({ headers: { 'x-forwarded-for': '9.9.9.9, invalid' }, socket }, 1), '127.0.0.1');
  assert.equal(resolveClientIp({ headers: { 'x-real-ip': '9.9.9.9', 'cf-connecting-ip': '8.8.8.8' }, socket }, 1), '127.0.0.1');
  assert.equal(resolveClientIp({ headers: { 'x-forwarded-for': '9.9.9.9' }, socket }, 1.5), '127.0.0.1');
});

test('XFF 中的空段与多余空格被忽略', () => {
  const req = { headers: { 'x-forwarded-for': '  , 1.2.3.4 , ' }, socket: {} };
  assert.equal(resolveClientIp(req, 1), '1.2.3.4');
});
