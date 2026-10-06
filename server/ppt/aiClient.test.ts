import test from 'node:test';
import assert from 'node:assert/strict';
import { generateImage, editImage, chatText } from './aiClient.js';
import { resolutionImageSize } from '../billing.js';
import type { ThirdPartyApiConfig } from '../../src/types.js';
import { generateImageEdit } from '../imageProviders.js';

function pngHeader(size: string) {
  const [width, height] = size.split('x').map(Number);
  const bytes = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20);
  return bytes.toString('base64');
}
const config = { apiKey: 'mock-key', baseUrl: 'https://mock.invalid', modelName: 'mock-image' } as ThirdPartyApiConfig;

test('planning uses the official DeepSeek API model id rather than the displayed version', async t => {
  let seen: any;
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    seen = JSON.parse(String(init.body));
    return Response.json({ choices: [{ message: { content: '优化后的主题' } }] });
  });
  assert.equal(await chatText({ baseUrl: 'https://api.deepseek.com', apiKey: 'mock', modelName: 'DeepSeek-V4.1-Flash', reasoningEffort: 'auto' }, [{ role: 'user', content: 'test' }]), '优化后的主题');
  assert.equal(seen.model, 'deepseek-flash');
  await chatText({ baseUrl: 'https://custom.example/v1', apiKey: 'mock', modelName: 'DeepSeek-V4.1-Flash', reasoningEffort: 'auto' }, [{ role: 'user', content: 'test' }]);
  assert.equal(seen.model, 'DeepSeek-V4.1-Flash');
});

test('local PPT edits use reference 2K request parameters and preserve original pixel dimensions', async t => {
  const original = 'data:image/png;base64,' + pngHeader('1672x941');
  let returnedSize = '1672x941';
  let seen: Record<string, unknown>;
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    seen = Object.fromEntries((init.body as FormData).entries());
    return Response.json({ data: [{ b64_json: pngHeader(returnedSize) }] });
  });
  assert.equal(await generateImageEdit(config, original, '只修改标记区域', '1672x941', original), original);
  assert.equal(seen!.size, '2048x1152');
  assert.equal(seen!.quality, 'medium');
  assert.equal(seen!.n, undefined);
  assert.equal(seen!.output_format, undefined);
  assert.match(String(seen!.prompt), /^只修改标记区域/);
  assert.match(String(seen!.prompt), /中文文字准确性要求/);
  assert.match(String(seen!.prompt), /逐字核对/);
  assert.ok(seen!.mask instanceof Blob);
  returnedSize = '1536x864';
  await assert.rejects(generateImageEdit(config, original, '只修改标记区域', '1672x941', original), /请求 1672×941，接口返回 1536×864/);
});

test('PPT uses reference 2K parameters and native output while keeping 4K pixel validation', async t => {
  let seen: Record<string, unknown> = {};
  let returnedSize: string | undefined;
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    seen = init.body instanceof FormData ? Object.fromEntries(init.body.entries()) : JSON.parse(String(init.body));
    return Response.json({ data: [{ b64_json: pngHeader(returnedSize || String(seen.size)) }] });
  });
  const reference = 'data:image/png;base64,' + pngHeader('2048x1152');
  for (const resolution of ['2K', '4K']) {
    const size = resolutionImageSize(resolution);
    await generateImage(config, 'test', size);
    assert.equal(seen.size, size);
    assert.equal(seen.quality, resolution === '4K' ? 'high' : resolution === '2K' ? 'medium' : 'low');
    if (resolution === '2K') assert.match(String(seen.prompt), /中文文字准确性要求/);
    else assert.equal(seen.prompt, 'test');
    await editImage(config, [reference], 'test', size);
    assert.equal(seen.size, size);
    assert.equal(seen.quality, resolution === '4K' ? 'high' : resolution === '2K' ? 'medium' : 'low');
    assert.ok(seen.image instanceof Blob);
    if (resolution === '2K') assert.match(String(seen.prompt), /中文文字准确性要求/);
    else assert.equal(seen.prompt, 'test');
  }
  returnedSize = '1672x941';
  const native = await generateImage(config, 'test', resolutionImageSize('2K'));
  assert.equal(native, 'data:image/png;base64,' + pngHeader(returnedSize));
  assert.deepEqual({ ...seen, prompt: undefined }, { model: 'mock-image', prompt: undefined, size: '2048x1152', quality: 'medium' });
  assert.match(String(seen.prompt), /^test\n/);
  assert.match(String(seen.prompt), /不得为了规避文字错误删掉/);
  const edited = await editImage(config, [reference], 'test', resolutionImageSize('2K'));
  assert.equal(edited, native);
  assert.equal(Object.hasOwn(seen, 'output_format'), false);
  assert.equal(Object.hasOwn(seen, 'n'), false);
  returnedSize = '1536x1024';
  await assert.rejects(generateImage(config, 'test', resolutionImageSize('2K')), /必须是原生 16:9/);
  returnedSize = '2048x1152';
  await assert.rejects(editImage(config, [reference], 'test', resolutionImageSize('4K')), /请求 3840×2160，接口返回 2048×1152/);
});
