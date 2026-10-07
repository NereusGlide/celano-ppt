import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import dns from 'node:dns';
import dnsPromises from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { EventEmitter, getEventListeners } from 'node:events';
import { PassThrough } from 'node:stream';
import { syncBuiltinESMExports } from 'node:module';
import { isPublicAddress, fetchPublicImage, readLimitedBody } from './remoteImages.js';

function mockTransport(t: TestContext, respond: (url: URL, options: any) => { status?: number; headers?: Record<string, string>; bytes?: string }) {
  const calls: { url: URL; options: any; stream?: PassThrough; request?: EventEmitter }[] = [];
  const transport = (raw: URL, options: any, callback: (response: any) => void) => {
    const url = new URL(raw);
    const call = { url, options, stream: undefined as PassThrough | undefined, request: undefined as EventEmitter | undefined };
    calls.push(call);
    const request = new EventEmitter() as any;
    call.request = request;
    request.destroy = (error?: Error) => { call.stream?.destroy(error); if (error) request.emit('error', error); return request; };
    request.end = () => {
      queueMicrotask(() => {
        const reply = () => {
          const result = respond(url, options);
          const stream = new PassThrough() as any;
          call.stream = stream;
          stream.statusCode = result.status || 200;
          stream.headers = result.headers || { 'content-type': 'image/png' };
          callback(stream);
          if (result.bytes !== undefined) stream.end(result.bytes);
        };
        if (isIpHost(url.hostname)) reply();
        else options.lookup(url.hostname, {}, (error: Error | null, address: string, family: number) => {
          if (error) request.emit('error', error);
          else { options.connectedAddress = address; options.connectedFamily = family; reply(); }
        });
      });
      return request;
    };
    return request;
  };
  t.mock.method(http, 'request', transport as any);
  t.mock.method(https, 'request', transport as any);
  return calls;
}
function isIpHost(host: string) { return /^[\d.]+$/.test(host) || host.startsWith('['); }

test('远程图片拒绝私网、loopback、保留及各种映射地址', async () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.1.2', '192.168.1.1', '169.254.169.254', '192.0.2.1', '198.51.100.1', '203.0.113.1', '::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '0:0:0:0:0:ffff:7f00:1', '::ffff:a00:1', 'fc00::1', 'fe80::1', '2001:db8::1', '2002:7f00:1::']) {
    assert.equal(isPublicAddress(ip), false, ip);
    await assert.rejects(fetchPublicImage('http://' + (ip.includes(':') ? '[' + ip + ']' : ip) + '/image'), /内网/);
  }
  for (const ip of ['8.8.8.8', '2606:4700::1111', '::ffff:8.8.8.8', '::ffff:808:808']) assert.equal(isPublicAddress(ip), true, ip);
});

test('本次连接解析到私网被拒绝，公网预解析不能授权另一个地址', async t => {
  let resolutions = 0;
  t.mock.method(dnsPromises, 'lookup', async () => [{ address: '8.8.8.8', family: 4 }]);
  t.mock.method(dns, 'lookup', (_host: string, _options: unknown, callback: any) => { resolutions++; callback(null, [{ address: '127.0.0.1', family: 4 }]); });
  const calls = mockTransport(t, () => ({ bytes: 'secret' }));
  // 旧 fetch 的 socket 再解析到私网仍成功，用替身复现而不访问真实网络。
  t.mock.method(globalThis, 'fetch', async () => {
    resolutions++;
    return new Response('secret');
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  await assert.rejects(fetchPublicImage('https://rebind.invalid/image'), /内网/);
  assert.equal(resolutions, 1);
  assert.equal(calls.length, 1);
});

test('自定义lookup仅解析一次并把已验证IP交给连接，保留Host与TLS主机名', async t => {
  let resolutions = 0;
  t.mock.method(dns, 'lookup', (host: string, options: any, callback: any) => {
    assert.equal(host, 'public.invalid'); assert.equal(options.all, true);
    resolutions++; callback(null, [{ address: '8.8.8.8', family: 4 }]);
  });
  const calls = mockTransport(t, () => ({ bytes: 'image' }));
  t.mock.method(dnsPromises, 'lookup', async () => [{ address: '8.8.8.8', family: 4 }]);
  t.mock.method(globalThis, 'fetch', async () => new Response('image'));
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  assert.equal((await readLimitedBody(await fetchPublicImage('https://public.invalid/image'))).toString(), 'image');
  assert.equal(resolutions, 1);
  assert.equal(calls[0].options.connectedAddress, '8.8.8.8');
  assert.equal(calls[0].options.servername, 'public.invalid');
  assert.equal(calls[0].url.hostname, 'public.invalid');
  assert.equal(calls[0].options.headers['Accept-Encoding'], 'identity');
  assert.equal(calls[0].options.agent, false);
});

test('重定向到内网不会发出第二次请求', async t => {
  const calls = mockTransport(t, () => ({ status: 302, headers: { location: 'http://127.0.0.1/secret' }, bytes: '' }));
  t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/secret' } }));
  await assert.rejects(fetchPublicImage('https://8.8.8.8/image'), /内网/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].stream?.destroyed, true);
});

test('DNS结果混合公网私网时整次连接拒绝，all模式只交给socket一个已验证IP', async t => {
  let addresses = [{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.1', family: 4 }];
  t.mock.method(dns, 'lookup', (_host: string, _options: any, callback: any) => callback(null, addresses));
  const calls = mockTransport(t, () => ({ bytes: 'image' }));
  await assert.rejects(fetchPublicImage('https://mixed.invalid/image'), /内网/);
  addresses = [{ address: '8.8.8.8', family: 4 }, { address: '1.1.1.1', family: 4 }];
  await readLimitedBody(await fetchPublicImage('https://public.invalid/image'));
  const lookup = calls[1].options.lookup;
  await new Promise<void>((resolve, reject) => lookup('public.invalid', { all: true }, (error: Error | null, selected: unknown) => {
    if (error) { reject(error); return; }
    assert.deepEqual(selected, [addresses[0]]); resolve();
  }));
});

test('相对重定向最多跟随4跳，每一跳独立请求并取消旧响应', async t => {
  let redirect = true;
  const calls = mockTransport(t, () => redirect ? { status: 302, headers: { location: '/next' }, bytes: '' } : { bytes: 'image' });
  await assert.rejects(fetchPublicImage('https://8.8.8.8/image'), /次数过多/);
  assert.equal(calls.length, 5);
  assert.ok(calls.every(call => call.stream?.destroyed));
  assert.equal(calls[1].url.href, 'https://8.8.8.8/next');
  redirect = false;
  assert.equal((await readLimitedBody(await fetchPublicImage('https://8.8.8.8/image'))).toString(), 'image');
});

test('中止的请求与含凭证或非HTTP的URL不创建连接', async t => {
  const calls = mockTransport(t, () => ({ bytes: 'image' }));
  const controller = new AbortController(); controller.abort(new Error('已经停止'));
  await assert.rejects(fetchPublicImage('https://8.8.8.8/image', controller.signal), /已经停止/);
  for (const url of ['file:///tmp/image', 'ftp://8.8.8.8/image', 'https://user:pass@8.8.8.8/image']) {
    await assert.rejects(fetchPublicImage(url), /地址无效/);
  }
  assert.equal(calls.length, 0);
});

test('读取时限制响应字节数并取消流，正常小图保留原内容', async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(8)); }, cancel() { cancelled = true; } }));
  await assert.rejects(readLimitedBody(response, 10), /过大/);
  assert.equal(cancelled, true);
  assert.equal((await readLimitedBody(new Response('image'), 10)).toString(), 'image');
});

test('真实Node响应流超过限额时被销毁，预先声明超大时无需读取', async t => {
  const calls = mockTransport(t, () => ({ bytes: '12345678901' }));
  t.mock.method(globalThis, 'fetch', async () => new Response('12345678901'));
  await assert.rejects(readLimitedBody(await fetchPublicImage('https://8.8.8.8/image'), 10), /过大/);
  assert.equal(calls[0].stream?.destroyed, true);
  let cancelled = false;
  const oversized = new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { 'content-length': '11' } });
  await assert.rejects(readLimitedBody(oversized, 10), /过大/);
  assert.equal(cancelled, true);
});

test('读取期间中止会销毁连接并清理信号监听', async t => {
  const controller = new AbortController();
  t.mock.method(AbortSignal, 'any', () => controller.signal);
  const calls = mockTransport(t, () => ({}));
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({ start(stream) { controller.signal.addEventListener('abort', () => stream.error(controller.signal.reason)); } })));
  const response = await fetchPublicImage('https://8.8.8.8/image', controller.signal);
  const reading = readLimitedBody(response);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 1);
  controller.abort(new Error('停止下载'));
  await assert.rejects(reading, /停止下载/);
  assert.equal(calls[0].stream?.destroyed, true);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

test('正常流读取结束后清理中止监听', async t => {
  const controller = new AbortController();
  t.mock.method(AbortSignal, 'any', () => controller.signal);
  const calls = mockTransport(t, () => ({ bytes: 'image' }));
  const response = await fetchPublicImage('https://8.8.8.8/image', controller.signal);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 1);
  assert.equal((await readLimitedBody(response)).toString(), 'image');
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(calls[0].stream?.destroyed, true);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});
