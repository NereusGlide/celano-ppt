import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultImageDraft, forgetImageJob, getImageJobs, resumePersistedImageJobs, saveImageGeneration, startImageGeneration, subscribeImageJobs } from './imageGeneration.js';

test('参考图生成发送multipart编辑参数，保留所有画质比例和账号边界', async t => {
  let fields: FormData | undefined;
  t.mock.method(globalThis, 'fetch', async (input: any, init: any) => {
    const url = String(input);
    if (url === '/api/canvas/config') return Response.json({ proxyToken: 'token', channels: [{ id: 'celano-image', models: [{ name: 'image-model' }] }] });
    if (url.endsWith('/images/edits')) { fields = init.body; return Response.json({ error: { message: 'mock request stopped' } }, { status: 400 }); }
    throw new Error('Unexpected request');
  });
  const draft = { ...defaultImageDraft(), prompt: '商品摄影', ratio: '9:16', resolution: '4K' as const, reference: { name: 'reference.png', file: new File(['image'], 'reference.png', { type: 'image/png' }) } };
  const id = startImageGeneration('reference-owner', draft);
  try {
    await settled(id);
    assert.ok(fields instanceof FormData);
    assert.equal(fields.get('resolution'), '4K');
    assert.equal(fields.get('size'), '2160x3840');
    assert.equal(fields.get('quality'), 'high');
    assert.equal(fields.get('expectedOwnerId'), 'reference-owner');
    assert.equal(fields.get('celanoJobId'), id);
    assert.ok(fields.get('image') instanceof File);
  } finally { forgetImageJob(id); }
});

test('non-JSON image gateway failures show a readable error rather than a JSON parser exception', async t => {
  t.mock.method(globalThis, 'fetch', async (input: any) => String(input) === '/api/canvas/config'
    ? new Response(JSON.stringify({ proxyToken: 'token', channels: [{ id: 'celano-image', models: [{ name: 'image-model' }] }] }), { status: 200 })
    : new Response('<html>gateway unavailable</html>', { status: 502 }));
  const id = startImageGeneration('gateway-owner', { ...defaultImageDraft(), prompt: '海报' });
  try {
    const job = await settled(id);
    assert.equal(job.phase, 'failed');
    assert.match(job.error!, /生成服务暂不可用/);
    assert.doesNotMatch(job.error!, /JSON|Unexpected token/);
  } finally { forgetImageJob(id); }
});

async function settled(id: string) {
  const complete = () => getImageJobs().find(job => job.id === id && ['done', 'failed'].includes(job.phase));
  if (complete()) return complete()!;
  return new Promise<NonNullable<ReturnType<typeof complete>>>((resolve, reject) => {
    const timeout = setTimeout(() => { stop(); reject(new Error('image job did not settle')); }, 6000);
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
    assert.equal(generationFields.celanoJobId, id);
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

test('文生图保存引用服务端短地址，而不是把 data URL 再传回去', async t => {
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() });
  t.after(() => { if (windowDescriptor) Object.defineProperty(globalThis, 'window', windowDescriptor); else delete (globalThis as { window?: unknown }).window; });
  let saveFields: any;
  t.mock.method(globalThis, 'fetch', async (input: any, init: any) => {
    const url = String(input);
    if (url === '/api/canvas/config') return Response.json({ proxyToken: 'token', channels: [{ id: 'celano-image', models: [{ name: 'image-model' }] }] });
    if (url.includes('/images/generations')) return Response.json({ data: [{ url: '/api/canvas/generated/abc123', width: 1672, height: 941, mimeType: 'image/png' }] });
    if (url.startsWith('/api/canvas/assets/') && init?.method === 'PUT') {
      saveFields = JSON.parse(init.body);
      return Response.json({ asset: { id: saveFields.id, data: { dataUrl: url + '/image', mimeType: 'image/png' } } });
    }
    throw new Error('Unexpected request ' + url);
  });
  const id = startImageGeneration('short-url-owner', { ...defaultImageDraft(), prompt: '海报' });
  try {
    const job = await settled(id);
    assert.equal(job.phase, 'done');
    assert.equal(saveFields.imageData, '/api/canvas/generated/abc123');
    assert.equal(job.image?.url, '/api/canvas/assets/' + id + '/image');
  } finally { forgetImageJob(id); }
});

test('a dropped generation keeps the same server job and a reopened page claims it without posting again', async t => {
  const storage = new Map<string, string>();
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousChannel = Object.getOwnPropertyDescriptor(globalThis, 'BroadcastChannel');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() });
  Object.defineProperty(globalThis, 'BroadcastChannel', { configurable: true, value: undefined });
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => { storage.set(key, value); }, removeItem: (key: string) => { storage.delete(key); } } });
  t.after(() => {
    if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage); else delete (globalThis as { localStorage?: unknown }).localStorage;
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow); else delete (globalThis as { window?: unknown }).window;
    if (previousChannel) Object.defineProperty(globalThis, 'BroadcastChannel', previousChannel); else delete (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel;
  });
  let posts = 0;
  let polls = 0;
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
  t.mock.method(globalThis, 'fetch', async (input: any, init: any) => {
    const url = String(input);
    if (url === '/api/canvas/config') return json({ proxyToken: 'token', channels: [{ id: 'celano-image', models: [{ name: 'image-model' }] }] });
    if (url.includes('/images/generations')) {
      posts++;
      assert.equal(JSON.parse(init.body).celanoJobId.length > 8, true);
      throw new TypeError('Failed to fetch');
    }
    if (url.includes('/api/canvas/image/jobs/')) {
      polls++;
      if (polls === 1) return json({ id: 'pending', status: 'running' });
      return json({ id: 'pending', status: 'succeeded', result: { data: [{ url: '/api/canvas/generated/kept', width: 1672, height: 941, mimeType: 'image/png' }] } });
    }
    if (url.startsWith('/api/canvas/assets/') && init?.method === 'PUT') return json({ asset: { id: JSON.parse(init.body).id, data: { dataUrl: url + '/image', mimeType: 'image/png' } } });
    throw new Error('Unexpected request ' + url);
  });
  const id = startImageGeneration('disconnect-owner', { ...defaultImageDraft(), prompt: '断线后继续' });
  try {
    const job = await settled(id);
    assert.equal(job.phase, 'done');
    assert.equal(posts, 1);
    assert.equal(polls, 2);
    assert.equal(job.image?.url, '/api/canvas/assets/' + id + '/image');
  } finally { forgetImageJob(id); }

  posts = 0;
  polls = 0;
  storage.set('celano.image.pendingJobs', JSON.stringify([{ id: 'resume-job-1', userId: 'disconnect-owner', startedAt: 1, prompt: '回来领取', resolution: '4K', ratio: '16:9' }]));
  resumePersistedImageJobs();
  const resumed = await settled('resume-job-1');
  assert.equal(resumed.phase, 'done');
  assert.equal(posts, 0, 'resuming a disconnected job must not start another paid generation');
  assert.ok(polls >= 1);
  forgetImageJob('resume-job-1');
});
