import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultImageDraft, forgetImageJob, getImageJobs, saveImageGeneration, startImageGeneration, subscribeImageJobs } from './imageGeneration.js';

async function settled(id: string) {
  const complete = () => getImageJobs().find(job => job.id === id && ['done', 'failed'].includes(job.phase));
  if (complete()) return complete()!;
  return new Promise<NonNullable<ReturnType<typeof complete>>>((resolve, reject) => {
    const timeout = setTimeout(() => { stop(); reject(new Error('image job did not settle')); }, 2000);
    const stop = subscribeImageJobs(() => { const job = complete(); if (job) { clearTimeout(timeout); stop(); resolve(job); } });
  });
}

test('image generation survives view unsubscription, deduplicates submissions and retries saving without regenerating', async t => {
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const channelDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'BroadcastChannel');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() });
  Object.defineProperty(globalThis, 'BroadcastChannel', { configurable: true, value: undefined });
  let saveFailure = false;
  let generationCount = 0;
  let saveCount = 0;
  let generationFields: any;
  let generationHeaders: any;
  let saveFields: any;
  let release: () => void = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
  t.mock.method(globalThis, 'fetch', async (input: any, init: any) => {
    const url = String(input);
    // 服务端通过 config 下发代理令牌，前端不再自带硬编码凭据。
    if (url === '/api/canvas/config') return json({ proxyToken: 'test-proxy-token', channels: [{ id: 'celano-image', apiKey: 'test-proxy-token', models: [{ name: 'public-model-name' }] }] });
    if (url.includes('/images/generations')) {
      generationCount++; generationFields = JSON.parse(init.body); generationHeaders = init.headers;
      await gate;
      return json({ data: [{ url: 'data:image/png;base64,test-image', width: 1672, height: 941 }] });
    }
    if (url.startsWith('/api/canvas/assets/') && init.method === 'PUT') {
      saveCount++; saveFields = JSON.parse(init.body);
      if (saveFailure) return json({ error: 'temporary save error' }, 503);
      return json({ asset: { id: saveFields.id, data: { dataUrl: url + '/image' } } });
    }
    throw new Error('Unexpected request ' + url);
  });
  try {
    const draft = { ...defaultImageDraft(), prompt: '中文海报', ratio: '16:9' };
    const stopView = subscribeImageJobs(() => {});
    const id = startImageGeneration('owner-A', draft);
    assert.equal(startImageGeneration('owner-A', draft), id);
    stopView(); // The composer unmounts immediately when navigating to the results page.
    release();
    const result = await settled(id);
    assert.equal(result.phase, 'done');
    assert.equal(generationCount, 1);
    // 代理令牌必须来自服务端下发的 payload，而不是写死在前端代码里。
    assert.equal(generationHeaders.Authorization, 'Bearer test-proxy-token');
    assert.equal(saveCount, 1);
    assert.equal(generationFields.expectedOwnerId, 'owner-A');
    assert.equal(generationFields.resolution, '2K');
    assert.equal(generationFields.size, '2048x1152');
    assert.equal(saveFields.expectedOwnerId, 'owner-A');
    assert.deepEqual(saveFields.tags, ['文生图', '2K', '16:9']);
    assert.equal(result.image?.width, 1672);
    assert.equal(result.image?.url, '/api/canvas/assets/' + id + '/image');
    forgetImageJob(id);

    saveFailure = true;
    const retryId = startImageGeneration('owner-A', draft);
    const failed = await settled(retryId);
    assert.equal(failed.phase, 'failed');
    assert.match(failed.error!, /图片已生成，保存失败/);
    assert.equal(failed.image?.url, 'data:image/png;base64,test-image');
    saveFailure = false;
    await saveImageGeneration(retryId);
    assert.equal(getImageJobs().find(job => job.id === retryId)?.phase, 'done');
    assert.equal(generationCount, 2, 'saving retry must never send another paid generation request');
    assert.equal(saveCount, 3);
    forgetImageJob(retryId);
  } finally {
    if (windowDescriptor) Object.defineProperty(globalThis, 'window', windowDescriptor); else delete (globalThis as any).window;
    if (channelDescriptor) Object.defineProperty(globalThis, 'BroadcastChannel', channelDescriptor); else delete (globalThis as any).BroadcastChannel;
  }
});
