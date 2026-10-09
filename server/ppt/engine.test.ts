import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../db.js';
import { appendSlide, deckView, deleteDeck, deleteSlide, regenerateSlide, replaceSlideImage, resumeDeck, startDeck, stopDeck } from './engine.js';
import type { PptDeck, PptSlidePlan, User } from '../../src/types.js';

let sequence = 0;

function fixtureUser(credits = 100): User {
  const id = 'ppt-engine-fixture-' + (++sequence);
  const value: User = { id, username: id, name: 'PPT 测试用户', phone: '1391000' + String(sequence).padStart(4, '0'), avatar: '', role: 'creator', createdAt: Date.now(), credits };
  db.createUser(value);
  return value;
}

function pngDataUrl(width = 2048, height = 1152): string {
  const bytes = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20);
  return 'data:image/png;base64,' + bytes.toString('base64');
}

function fixtureDeck(user: User, id: string, slides: PptDeck['slides'], referenceImages: PptDeck['referenceImages'] = []): PptDeck {
  const value: PptDeck = {
    id, userId: user.id, title: '引擎测试', prompt: '引擎测试主题', resolution: '2K', pageCount: slides.length,
    referencesText: '', referenceImages, subtitle: '', visualDirection: '', palette: { accent: '#fff', deep: '#000', ink: '#000', muted: '#ccc' },
    slides, concurrency: 6, stage: 'paused', running: false, finished: false, startedAt: Date.now(), updatedAt: Date.now(), chargedCredits: slides.reduce((sum, slide) => sum + (slide.chargedCredits || 0), 0), refundedCredits: 0, refundedSlideIds: [],
  };
  db.createPptDeck(value);
  return value;
}

function writeFixtureImage(storageKey: string, width = 2048, height = 1152, marker = 0) {
  const full = path.resolve(process.cwd(), 'data', 'images', storageKey);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  const bytes = Buffer.from(pngDataUrl(width, height).split(',')[1], 'base64');
  bytes[15] = marker;
  fs.writeFileSync(full, bytes);
  return full;
}

function cleanupFixture(user: User, deckId: string) {
  db.deletePptDeck(deckId);
  db.deleteUser(user.id);
}

const basePlan: PptSlidePlan = { title: '测试页', bullets: [], pageType: 'core-insight' };

test('native dimension mismatch stops the PPT batch and refunds all unfinished pages', async t => {
  let deck: PptDeck | undefined;
  let images = 0;
  let textRequests = 0;
  let refund = 0;
  let credits = 200;
  t.mock.method(db, 'getPptDecks', () => []);
  t.mock.method(db, 'getPptDeck', () => deck);
  t.mock.method(db, 'createPptDeck', (value: PptDeck) => { deck = value; return value; });
  t.mock.method(db, 'updatePptDeck', (_id: string, patch: Partial<PptDeck>) => { Object.assign(deck!, patch); return deck; });
  t.mock.method(db, 'resolveImageConfig', () => ({ baseUrl: 'https://mock.invalid/v1', apiKey: 'mock', modelName: 'mock-image' }));
  t.mock.method(db, 'getPlanningConfig', () => ({ baseUrl: 'https://mock.invalid/v1', apiKey: 'mock', modelName: 'mock-text', reasoningEffort: 'auto' }));
  t.mock.method(db, 'getUserById', () => ({ id: 'mock-user', username: 'test', credits }));
  t.mock.method(db, 'updateUser', (_id: string, patch: any) => { credits = patch.credits; return { id: 'mock-user', credits }; });
  t.mock.method(db, 'addUsageRecord', () => undefined);
  t.mock.method(db, 'refundPptFailedSlides', (_userId: string, _deckId: string, ids: string[], amount: number) => {
    refund += amount; credits += amount;
    deck!.refundedSlideIds = ids; deck!.refundedCredits = amount;
    return { refunded: amount, credits };
  });
  t.mock.method(globalThis, 'fetch', async (url: unknown, init: RequestInit) => {
    if (String(url).includes('/chat/completions')) {
      textRequests++;
      const body = JSON.parse(String(init.body));
      if (textRequests === 1) {
        assert.equal(JSON.parse(body.messages[1].content).referenceText, '参考资料正文'.repeat(3500));
        return Response.json({ choices: [{ message: { content: '已分析的资料依据' } }] });
      }
      assert.match(body.messages[1].content, /已分析的资料依据/);
      return Response.json({ choices: [{ message: { content: JSON.stringify({ deck_title: '主题', slides: Array.from({ length: 20 }, (_, i) => ({ title: `第 ${i + 1} 页`, image_prompt: '符合资料分析的内容' })) }) } }] });
    }
    images++;
    const bytes = Buffer.alloc(24);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
    bytes.writeUInt32BE(1536, 16); bytes.writeUInt32BE(1024, 20);
    return Response.json({ data: [{ b64_json: bytes.toString('base64') }] });
  });
  const created = startDeck('mock-user', { prompt: '测试主题', pageCount: 20, concurrency: 6, resolution: '2K', referencesText: '参考资料正文'.repeat(3500) });
  assert.ok('id' in created);
  assert.equal(deckView(created).chargedCredits, 100);
  assert.equal(deckView(created).refundedCredits, 0);
  for (let i = 0; i < 200 && deck?.running; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(deck?.running, false);
  assert.equal(deck?.stage, 'paused');
  assert.equal(deck?.referencesText.length, 21000);
  assert.equal(deck?.referenceAnalysisStatus, 'done');
  assert.equal(deck?.planningSource, 'ai');
  assert.equal(textRequests, 2);
  assert.ok(images <= 6, 'remaining pages must not be sent after a size mismatch');
  assert.equal(deck?.slides.filter(slide => slide.status === 'failed').length, 20);
  assert.match(deck?.error || '', /原生尺寸要求/);
  assert.equal(refund, 100);
  assert.equal(credits, 200);
  assert.equal(deckView(deck!).refundedCredits, 100);
});

test('failed reference analysis pauses before any image requests and refunds the task', async t => {
  let deck: PptDeck | undefined;
  let credits = 30;
  let images = 0;
  t.mock.method(db, 'getPptDecks', () => []);
  t.mock.method(db, 'getPptDeck', () => deck);
  t.mock.method(db, 'createPptDeck', (value: PptDeck) => { deck = value; return value; });
  t.mock.method(db, 'updatePptDeck', (_id: string, patch: Partial<PptDeck>) => { Object.assign(deck!, patch); return deck; });
  t.mock.method(db, 'resolveImageConfig', () => ({ baseUrl: 'https://mock.invalid/v1', apiKey: 'mock', modelName: 'mock-image' }));
  t.mock.method(db, 'getPlanningConfig', () => ({ baseUrl: 'https://mock.invalid/v1', apiKey: 'mock', modelName: 'mock-text' }));
  t.mock.method(db, 'getUserById', () => ({ id: 'mock-user', username: 'test', credits }));
  t.mock.method(db, 'updateUser', (_id: string, patch: any) => { credits = patch.credits; return { id: 'mock-user', credits }; });
  t.mock.method(db, 'addUsageRecord', () => undefined);
  t.mock.method(db, 'refundPptFailedSlides', (_userId: string, _deckId: string, ids: string[], amount: number) => {
    credits += amount; deck!.refundedSlideIds = ids; deck!.refundedCredits = amount;
    return { refunded: amount, credits };
  });
  t.mock.method(globalThis, 'fetch', async (url: unknown) => {
    if (!String(url).includes('/chat/completions')) images++;
    return Response.json({ error: { message: '模型未配置正确' } }, { status: 400 });
  });
  const created = startDeck('mock-user', { prompt: '分析附件', pageCount: 3, concurrency: 6, resolution: '2K', referencesText: '有事实和数据的文件正文' });
  assert.ok('id' in created);
  for (let i = 0; i < 200 && deck?.running; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(deck?.running, false);
  assert.equal(deck?.stage, 'paused');
  assert.equal(deck?.referenceAnalysisStatus, 'failed');
  assert.match(deck?.error || '', /AI 内容规划失败/);
  assert.equal(images, 0);
  assert.equal(deck?.refundedCredits, 15);
  assert.equal(credits, 30);
  assert.equal(deckView(deck!).chargedCredits, 15);
  assert.equal(deckView(deck!).refundedCredits, 15);
});

test('商品页包含商品参考，非商品页不发送商品封面或商品参考', async t => {
  const user = fixtureUser(100);
  const deckId = 'ppt-product-' + sequence;
  const productKey = 'user-' + user.id + '/deck-' + deckId + '/product.png';
  const coverKey = 'user-' + user.id + '/deck-' + deckId + '/cover.png';
  writeFixtureImage(productKey, 2048, 1152, 7);
  writeFixtureImage(coverKey, 2048, 1152, 0);
  const deck = fixtureDeck(user, deckId, [{ id: 'existing', plan: { ...basePlan, title: '已完成封面', pageType: 'cover' }, status: 'done', storageKey: coverKey, width: 2048, height: 1152, chargedCredits: 5, billingCost: 5, refundedCredits: 0, deliveredCredits: 5 }], [{ id: 'product', name: '商品参考：原型', storageKey: productKey }]);
  t.after(() => cleanupFixture(user, deckId));
  t.mock.method(db, 'resolveImageConfig', () => ({ baseUrl: 'https://mock.invalid/v1', apiKey: 'mock', modelName: 'mock-image' }));
  const requests: Array<{ path: string; productImage: boolean; prompt: string }> = [];
  t.mock.method(globalThis, 'fetch', async (url: unknown, init: RequestInit) => {
    const endpoint = String(url);
    if (endpoint.includes('/images/edits')) {
      const form = init.body as FormData;
      const images = [...form.getAll('image'), ...form.getAll('image[]')] as Blob[];
      const contents = await Promise.all(images.map(async image => Buffer.from(await image.arrayBuffer())));
      requests.push({ path: 'edits', productImage: contents.some(bytes => bytes[15] === 7), prompt: String(form.get('prompt') || '') });
    } else {
      requests.push({ path: 'generations', productImage: false, prompt: String(JSON.parse(String(init.body)).prompt || '') });
    }
    return Response.json({ data: [{ b64_json: pngDataUrl().split(',')[1] }] });
  });
  const product = await appendSlide(user.id, deckId, { ...basePlan, title: '商品展示', productReference: true });
  assert.ok('id' in product);
  const nonProduct = await appendSlide(user.id, deckId, { ...basePlan, title: '趋势分析', productReference: false });
  assert.ok('id' in nonProduct);
  assert.deepEqual(requests.map(item => item.path), ['edits', 'generations']);
  assert.equal(requests[0].productImage, true);
  assert.match(requests[0].prompt, /商品一致性模式/);
  assert.equal(requests[1].productImage, false);
  assert.match(requests[1].prompt, /不要额外加入上传商品/);
});

test('暂停初始占位规划后继续会重新发起真实规划并生成图片', async t => {
  const user = fixtureUser(100);
  const deckId = 'ppt-resume-planning-' + sequence;
  t.after(() => cleanupFixture(user, deckId));
  t.mock.method(db, 'resolveImageConfig', () => ({ baseUrl: 'https://mock.invalid/v1', apiKey: 'mock', modelName: 'mock-image' }));
  t.mock.method(db, 'getPlanningConfig', () => ({ baseUrl: 'https://mock.invalid/v1', apiKey: 'mock', modelName: 'mock-text', reasoningEffort: 'auto' }));
  let planningRequests = 0;
  let imageRequests = 0;
  let firstPlanningStarted!: () => void;
  const planningStarted = new Promise<void>(resolve => { firstPlanningStarted = resolve; });
  t.mock.method(globalThis, 'fetch', async (url: unknown, init: RequestInit) => {
    if (String(url).includes('/chat/completions')) {
      planningRequests++;
      if (planningRequests === 1) {
        firstPlanningStarted();
        await new Promise<never>((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new Error('任务已停止')), { once: true }));
      }
      return Response.json({ choices: [{ message: { content: JSON.stringify({ deck_title: '真实规划', slides: [{ title: '真实页面', page_type: 'core-insight', image_prompt: '真实内容' }] }) } }] });
    }
    imageRequests++;
    return Response.json({ data: [{ b64_json: pngDataUrl().split(',')[1] }] });
  });
  const started = startDeck(user.id, { prompt: '暂停后继续测试', pageCount: 1, concurrency: 1, resolution: '2K' });
  assert.ok('id' in started);
  await planningStarted;
  const stopped = stopDeck(user.id, started.id);
  assert.ok('id' in stopped);
  assert.equal(stopped.stage, 'paused');
  const resumed = resumeDeck(user.id, started.id);
  assert.ok('id' in resumed);
  for (let i = 0; i < 300 && db.getPptDeck(started.id)?.running; i++) await new Promise(resolve => setTimeout(resolve, 10));
  const final = db.getPptDeck(started.id)!;
  assert.equal(planningRequests, 2);
  assert.equal(imageRequests, 1);
  assert.equal(final.slides[0].status, 'done');
  assert.equal(final.slides[0].plan.title, '真实页面');
  assert.equal(final.stage, 'finished');
});

test('单页重生成失败保留旧图并只退回本次点数', async t => {
  const user = fixtureUser(100);
  const deckId = 'ppt-regenerate-failure-' + sequence;
  const storageKey = 'user-' + user.id + '/deck-' + deckId + '/slide-old.png';
  writeFixtureImage(storageKey);
  const originalUpdatedAt = 123456;
  const deck = fixtureDeck(user, deckId, [{ id: 'one', plan: { ...basePlan, title: '旧图页面' }, status: 'done', storageKey, width: 2048, height: 1152, updatedAt: originalUpdatedAt, billingCost: 5, chargedCredits: 5, refundedCredits: 0, deliveredCredits: 5 }]);
  t.after(() => cleanupFixture(user, deckId));
  t.mock.method(db, 'resolveImageConfig', () => ({ baseUrl: 'https://mock.invalid/v1', apiKey: 'mock', modelName: 'mock-image' }));
  let imageRequests = 0;
  t.mock.method(globalThis, 'fetch', async () => { imageRequests++; return Response.json({ error: { message: 'mock failure' } }, { status: 500 }); });
  const result = await regenerateSlide(user.id, deckId, 'one', '改成另一种表达');
  assert.ok('error' in result);
  assert.equal(imageRequests, 1);
  const final = db.getPptDeck(deckId)!;
  const slide = final.slides[0];
  assert.equal(slide.status, 'done');
  assert.equal(slide.storageKey, storageKey);
  assert.equal(slide.updatedAt, originalUpdatedAt);
  assert.equal(slide.width, 2048);
  assert.equal(slide.height, 1152);
  assert.equal(slide.error, '生图接口 HTTP 500：mock failure');
  assert.equal(final.refundedCredits, 5);
  assert.equal(db.getUserById(user.id)?.credits, 100);
});

test('活动任务禁止替换页面图片', t => {
  const user = fixtureUser(100);
  const deckId = 'ppt-replace-active-' + sequence;
  const deck = fixtureDeck(user, deckId, [{ id: 'one', plan: basePlan, status: 'done', chargedCredits: 5, billingCost: 5, refundedCredits: 0, deliveredCredits: 5 }]);
  db.updatePptDeck(deckId, { running: true, stage: 'rendering' });
  t.after(() => cleanupFixture(user, deckId));
  const result = replaceSlideImage(user.id, deckId, 'one', pngDataUrl());
  assert.ok('error' in result);
  assert.match(result.error || '', /正在生成或修改/);
  assert.equal(db.getPptDeck(deckId)?.slides[0].status, 'done');
});

test('单页替换图片写入失败不改变旧图或作品记录', t => {
  const user = fixtureUser(100);
  const deckId = 'ppt-replace-image-write-' + sequence;
  const key = 'user-' + user.id + '/deck-' + deckId + '/original.png';
  const full = writeFixtureImage(key);
  const previous = fs.readFileSync(full);
  fixtureDeck(user, deckId, [{ id: 'one', plan: basePlan, status: 'done', storageKey: key, width: 2048, height: 1152, billingCost: 5, chargedCredits: 5, refundedCredits: 0, deliveredCredits: 5 }]);
  t.after(() => { t.mock.restoreAll(); cleanupFixture(user, deckId); });
  const write = fs.writeFileSync;
  let imageWrites = 0;
  t.mock.method(fs, 'writeFileSync', (filename: Parameters<typeof fs.writeFileSync>[0], data: Parameters<typeof fs.writeFileSync>[1], options?: Parameters<typeof fs.writeFileSync>[2]) => {
    if (String(filename).endsWith('.png')) { imageWrites++; throw new Error('image write failure'); }
    return write(filename, data, options);
  });
  const result = replaceSlideImage(user.id, deckId, 'one', pngDataUrl());
  assert.ok(!('id' in result));
  assert.match(result.error, /image write failure/);
  assert.equal(imageWrites, 1);
  assert.equal(db.getPptDeck(deckId)?.slides[0].storageKey, key);
  assert.deepEqual(fs.readFileSync(full), previous);
  assert.equal(db.getUserById(user.id)?.credits, 100);
});

test('单页替换数据库提交失败保留旧图片和记录，重试成功才清理旧图', t => {
  const user = fixtureUser(100);
  const deckId = 'ppt-replace-disk-' + sequence;
  const key = 'user-' + user.id + '/deck-' + deckId + '/original.png';
  const full = writeFixtureImage(key);
  const previous = fs.readFileSync(full);
  fixtureDeck(user, deckId, [{ id: 'one', plan: basePlan, status: 'done', storageKey: key, width: 2048, height: 1152, billingCost: 5, chargedCredits: 5, refundedCredits: 0, deliveredCredits: 5 }]);
  t.after(() => { t.mock.restoreAll(); cleanupFixture(user, deckId); });
  t.mock.method(fs, 'renameSync', (() => { throw new Error('disk failure'); }) as never);
  const failed = replaceSlideImage(user.id, deckId, 'one', pngDataUrl());
  assert.ok('error' in failed);
  assert.equal(db.getPptDeck(deckId)?.slides[0].storageKey, key);
  assert.deepEqual(fs.readFileSync(full), previous);
  t.mock.restoreAll();
  const saved = replaceSlideImage(user.id, deckId, 'one', pngDataUrl());
  assert.ok('id' in saved);
  assert.notEqual(saved.slides[0].storageKey, key);
  assert.equal(fs.existsSync(full), false);
});

test('deleting pages and decks respects ownership, synchronizes page counts and refunds only unfinished prepaid pages', t => {
  let deck: PptDeck | undefined = {
    id: 'delete-test', userId: 'delete-test-user', title: '测试', prompt: '主题', resolution: '2K', pageCount: 3,
    running: false, finished: false, stage: 'paused', concurrency: 6, referenceImages: [], referencesText: '', startedAt: 1, updatedAt: 1,
    subtitle: '', visualDirection: '', palette: { accent: '#fff', deep: '#000', ink: '#000', muted: '#ccc' },
    chargedCredits: 30, refundedCredits: 10, refundedSlideIds: ['failed'],
    slides: (['done', 'idle', 'failed'] as const).map(status => ({ id: status, status, plan: { title: status, bullets: [], pageType: 'core-insight' } })),
  } as PptDeck;
  let refunded = 0;
  t.mock.method(db, 'getPptDeck', () => deck);
  t.mock.method(db, 'getUserById', () => undefined);
  t.mock.method(db, 'updatePptDeck', (_id: string, patch: Partial<PptDeck>) => { Object.assign(deck!, patch); return deck; });
  t.mock.method(db, 'deletePptDeck', () => { deck = undefined; });
  t.mock.method(db, 'refundPptFailedSlides', (_userId: string, _deckId: string, ids: string[], amount: number) => {
    refunded += amount; deck!.refundedSlideIds!.push(...ids); deck!.refundedCredits! += amount;
    return { refunded: amount, credits: 100 };
  });
  assert.ok('error' in deleteDeck('other-user', 'delete-test'));
  assert.ok('error' in deleteSlide('other-user', 'delete-test', 'done'));
  deck!.running = true;
  assert.ok('error' in deleteSlide('delete-test-user', 'delete-test', 'done'));
  deck!.running = false;
  const reduced = deleteSlide('delete-test-user', 'delete-test', 'done');
  assert.ok('id' in reduced);
  assert.equal(reduced.pageCount, 2);
  assert.equal(refunded, 0, 'completed image charges are retained');
  const partial = deleteSlide('delete-test-user', 'delete-test', 'idle');
  assert.ok('id' in partial);
  assert.equal(partial.pageCount, 1);
  assert.equal(refunded, 10);
  assert.deepEqual(deleteSlide('delete-test-user', 'delete-test', 'failed'), { deleted: true });
  assert.equal(deck, undefined, 'removing the last page removes its work from the library');
  assert.equal(refunded, 10, 'already refunded pages must not be refunded twice');
});
