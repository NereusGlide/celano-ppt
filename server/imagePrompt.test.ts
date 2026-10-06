import test from 'node:test';
import assert from 'node:assert/strict';
import { withChineseTextAccuracy } from './imagePrompt.js';
import { generateImage, chatText } from './ppt/aiClient.js';
import type { ThirdPartyApiConfig } from '../src/types.js';

function pngHeader(size: string) {
  const [width, height] = size.split('x').map(Number);
  const bytes = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20);
  return bytes.toString('base64');
}

const config = { apiKey: 'mock-key', baseUrl: 'https://mock.invalid', modelName: 'mock-image' } as ThirdPartyApiConfig;

test('withChineseTextAccuracy 仅对 2K 追加中文规则，4K 保持不变', () => {
  const p = '生成一张演示页';
  assert.equal(withChineseTextAccuracy(p, '4K'), p);
  assert.notEqual(withChineseTextAccuracy(p, '2K'), p);
});

test('网络抖动（fetch failed）自动重试后成功', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls += 1;
    if (calls === 1) throw new TypeError('fetch failed');
    return Response.json({ data: [{ b64_json: pngHeader('2048x1152') }] });
  });
  const result = await generateImage(config, 'test', '2048x1152');
  assert.ok(result.startsWith('data:image/png;base64,'));
  assert.equal(calls, 2, '网络错误应重试一次');
});

test('chatText 遇到连接超时自动重试', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls += 1;
    if (calls < 3) {
      const err: any = new Error('fetch failed');
      err.cause = { message: 'Connect Timeout Error (timeout: 10000ms)' };
      throw err;
    }
    return Response.json({ choices: [{ message: { content: '规划完成' } }] });
  });
  const text = await chatText({ baseUrl: 'https://piao.world/v1', apiKey: 'mock', modelName: 'gpt-5.6-luna', reasoningEffort: 'xhigh' }, [{ role: 'user', content: 'test' }]);
  assert.equal(text, '规划完成');
  assert.equal(calls, 3, '网络错误应重试到成功');
});
