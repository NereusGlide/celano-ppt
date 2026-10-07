import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';
import { Readable } from 'node:stream';
import { MAX_IMAGE_BYTES } from '../src/shared/imageSpecs.js';

/** 读取时执行大小限制，避免 arrayBuffer 在校验前分配整个远程响应。 */
export async function readLimitedBody(response: Response, limit = MAX_IMAGE_BYTES): Promise<Buffer> {
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > limit) {
    await response.body?.cancel();
    throw new Error('远程图片文件过大');
  }
  if (!response.body) throw new Error('远程图片内容为空');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error('远程图片文件过大');
      chunks.push(value);
    }
    if (!size) throw new Error('远程图片内容为空');
    return Buffer.concat(chunks, size);
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}

export function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99)))
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
      || (a === 203 && b === 0 && c === 113));
  }
  if (isIP(address) !== 6 || address.includes('%')) return false;
  // URL 将点分映射地址规范化为十六进制，再展开压缩以统一判断。
  const canonical = new URL('http://[' + address + ']').hostname.slice(1, -1);
  const [left, right] = canonical.split('::');
  const head = left ? left.split(':').map(value => parseInt(value, 16)) : [];
  const tail = right ? right.split(':').map(value => parseInt(value, 16)) : [];
  const words = right === undefined ? head : [...head, ...Array(8 - head.length - tail.length).fill(0), ...tail];
  if (words.slice(0, 5).every(value => value === 0) && words[5] === 0xffff) {
    return isPublicAddress([words[6] >> 8, words[6] & 255, words[7] >> 8, words[7] & 255].join('.'));
  }
  // 仅全球单播；排除特殊用途、文档与可嵌入IPv4的转换段。
  return (words[0] & 0xe000) === 0x2000
    && !(words[0] === 0x2001 && (words[1] < 0x0200 || words[1] === 0x0db8))
    && words[0] !== 0x2002 && !(words[0] === 0x3fff && words[1] < 0x1000);
}

function validateRemoteUrl(raw: string): URL {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('远程图片地址无效');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) && !isPublicAddress(host)) throw new Error('不允许访问内网图片地址');
  return url;
}

function requestPublicImage(url: URL, signal: AbortSignal): Promise<Response> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const transport = url.protocol === 'https:' ? https : http;
    // 关闭socket复用：本次连接只能使用本次lookup实际验证过的地址。
    const request = transport.request(url, {
      method: 'GET', agent: false,
      servername: isIP(host) ? undefined : host,
      headers: { 'Accept-Encoding': 'identity' },
      lookup(hostname, options, callback) {
        dns.lookup(hostname, { all: true }, (error, addresses) => {
          if (error) { callback(error, '', 0); return; }
          if (!addresses.length || addresses.some(item => !isPublicAddress(item.address))) {
            callback(new Error('不允许访问内网图片地址'), '', 0); return;
          }
          if (options.all) callback(null, [addresses[0]]);
          else callback(null, addresses[0].address, addresses[0].family);
        });
      },
    }, incoming => {
      incoming.once('close', cleanup);
      try {
        const headers = new Headers();
        for (const [name, value] of Object.entries(incoming.headers)) {
          if (Array.isArray(value)) for (const item of value) headers.append(name, item);
          else if (value !== undefined) headers.set(name, value);
        }
        const status = incoming.statusCode || 502;
        const empty = [204, 205, 304].includes(status);
        const response = new Response(empty ? null : Readable.toWeb(incoming) as ReadableStream<Uint8Array>, { status, headers });
        if (empty) incoming.destroy();
        resolve(response);
      } catch (error) { incoming.destroy(); reject(error); }
    });
    const abort = () => request.destroy(signal.reason instanceof Error ? signal.reason : new Error('远程图片下载已中止'));
    const cleanup = () => signal.removeEventListener('abort', abort);
    request.on('error', error => { cleanup(); reject(error); });
    request.once('close', cleanup);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort(); else request.end();
  });
}

/** 用户提交的远程图不能访问本机/内网；每次重定向都重新验证目标。 */
export async function fetchPublicImage(raw: string, signal?: AbortSignal, timeoutMs = 120_000): Promise<Response> {
  let current = raw;
  const timeout = AbortSignal.timeout(timeoutMs);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  for (let hop = 0; hop <= 4; hop++) {
    requestSignal.throwIfAborted();
    const url = validateRemoteUrl(current);
    const response = await requestPublicImage(url, requestSignal);
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get('location');
    await response.body?.cancel();
    if (!location) throw new Error('远程图片重定向缺少目标地址');
    if (hop === 4) throw new Error('远程图片重定向次数过多');
    current = new URL(location, url).href;
  }
  throw new Error('远程图片重定向次数过多');
}
