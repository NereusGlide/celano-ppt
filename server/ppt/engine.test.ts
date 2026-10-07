import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../db.js';
import { deckView, deleteDeck, deleteSlide, startDeck } from './engine.js';
import type { PptDeck } from '../../src/types.js';

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
  assert.equal(deckView(created).chargedCredits, 200);
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
  assert.equal(refund, 200);
  assert.equal(credits, 200);
  assert.equal(deckView(deck!).refundedCredits, 200);
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
  assert.equal(deck?.refundedCredits, 30);
  assert.equal(credits, 30);
  assert.equal(deckView(deck!).chargedCredits, 30);
  assert.equal(deckView(deck!).refundedCredits, 30);
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
