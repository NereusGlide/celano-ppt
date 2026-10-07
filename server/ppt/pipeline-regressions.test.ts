import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { db } from '../db.js';
import { appendSlide, deleteDeck, deleteSlide } from './engine.js';
import type { PptDeck, PptSlidePlan, User } from '../../src/types.js';

const plan: PptSlidePlan = { title: '回归页', bullets: [], pageType: 'core-insight' };
let sequence = 0;

function user(): User {
  const id = 'ppt-regression-user-' + (++sequence);
  const value: User = {
    id,
    username: id,
    name: 'PPT 回归用户',
    phone: '1390000' + String(sequence).padStart(4, '0'),
    avatar: '',
    role: 'creator',
    createdAt: Date.now(),
    credits: 100,
  };
  db.createUser(value);
  return value;
}

function deck(value: User, id: string, slides: PptDeck['slides'], chargedCredits: number, pageCount = slides.length): PptDeck {
  const item: PptDeck = {
    id,
    userId: value.id,
    title: '计费回归',
    prompt: '计费回归',
    resolution: '2K',
    referencesText: '',
    referenceImages: [],
    subtitle: '',
    visualDirection: '',
    palette: { accent: '#fff', deep: '#000', ink: '#000', muted: '#ccc' },
    slides,
    pageCount,
    concurrency: 6,
    stage: 'paused',
    running: false,
    finished: false,
    startedAt: Date.now(),
    updatedAt: Date.now(),
    chargedCredits,
    refundedCredits: 0,
    refundedSlideIds: [],
  };
  db.createPptDeck(item);
  return item;
}

function cleanup(value: User, deckId: string) {
  db.deletePptDeck(deckId);
  db.deleteUser(value.id);
}

test('旧任务删除页面前固定原始页单价，不受 pageCount 变化或会员变更影响', t => {
  const value = user();
  const item = deck(value, 'ppt-legacy-' + sequence, [
    { id: 'done', plan, status: 'done' },
    { id: 'idle', plan, status: 'idle' },
    { id: 'failed', plan, status: 'failed', chargedCredits: 10, billingCost: 10, refundedCredits: 10 },
  ], 30, 3);
  item.refundedCredits = 10;
  item.refundedSlideIds = ['failed'];
  db.updatePptDeck(item.id, { refundedCredits: 10, refundedSlideIds: ['failed'] });
  db.updateUser(value.id, { credits: 70 });
  t.after(() => cleanup(value, item.id));

  const first = deleteSlide(value.id, item.id, 'done');
  assert.ok('id' in first);
  assert.equal(first.pageCount, 2);
  const current = db.getPptDeck(item.id)!;
  assert.equal(current.slides.find(slide => slide.id === 'idle')?.chargedCredits, 10);
  db.updateUser(value.id, { membership: { planId: 'celano-basic', status: 'active', expiresAt: Date.now() + 60_000 } });

  const second = deleteSlide(value.id, item.id, 'idle');
  assert.ok('id' in second);
  assert.equal(db.getUserById(value.id)?.credits, 80);
  assert.equal(db.getPptDeck(item.id)?.refundedCredits, 20);
});

test('失败重试多轮保持累计退款只增不减并净守恒', t => {
  const value = user();
  const item = deck(value, 'ppt-retry-' + sequence, [{ id: 'one', plan, status: 'failed', billingCost: 5, chargedCredits: 5, refundedCredits: 0 }], 5, 1);
  db.updateUser(value.id, { credits: 95 });
  t.after(() => cleanup(value, item.id));

  const first = db.refundPptFailedSlides(value.id, item.id, ['one'], 5, '首次失败', new Map([['one', 5]]));
  assert.equal(first.refunded, 5);
  assert.equal(db.getUserById(value.id)?.credits, 100);
  const retried = db.chargePptRetry(value.id, item.id, ['one'], 5, '第一次重试', new Map([['one', 5]]));
  assert.equal(retried.ok, true);
  assert.equal(db.getUserById(value.id)?.credits, 95);
  db.updatePptDeck(item.id, { slides: [{ ...db.getPptDeck(item.id)!.slides[0], status: 'failed' }] });
  const second = db.refundPptFailedSlides(value.id, item.id, ['one'], 5, '第二次失败', new Map([['one', 5]]));
  assert.equal(second.refunded, 5);
  const final = db.getPptDeck(item.id)!;
  assert.equal(final.chargedCredits, 10);
  assert.equal(final.refundedCredits, 10);
  assert.equal(final.slides[0].chargedCredits, 10);
  assert.equal(final.slides[0].refundedCredits, 10);
  assert.equal(db.getUserById(value.id)?.credits, 100);
});

test('PPT 失败退款事务在落盘失败时完整回滚', t => {
  const value = user();
  const item = deck(value, 'ppt-rollback-' + sequence, [{ id: 'one', plan, status: 'failed', billingCost: 5, chargedCredits: 5 }], 5, 1);
  db.updateUser(value.id, { credits: 95 });
  t.after(() => {
    t.mock.restoreAll();
    cleanup(value, item.id);
  });
  t.mock.method(fs, 'renameSync', (() => { throw new Error('disk failure'); }) as never);

  assert.throws(() => db.refundPptFailedSlides(value.id, item.id, ['one'], 5, '失败', new Map([['one', 5]])), /disk failure/);
  assert.equal(db.getUserById(value.id)?.credits, 95);
  assert.equal(db.getPptDeck(item.id)?.refundedCredits, 0);
  assert.deepEqual(db.getPptDeck(item.id)?.refundedSlideIds, []);
});

test('追加页失败只退款自身页面并标记自身 slideId', async t => {
  const value = user();
  const item = deck(value, 'ppt-append-' + sequence, [{ id: 'existing', plan, status: 'done' }], 10, 1);
  db.updateUser(value.id, { credits: 90 });
  t.after(() => cleanup(value, item.id));
  t.mock.method(db, 'resolveImageConfig', () => ({ baseUrl: 'https://mock.invalid/v1', apiKey: 'mock', modelName: 'mock-image' }));
  t.mock.method(globalThis, 'fetch', async () => {
    const bytes = Buffer.alloc(24);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
    bytes.writeUInt32BE(1536, 16); bytes.writeUInt32BE(1024, 20);
    return Response.json({ data: [{ b64_json: bytes.toString('base64') }] });
  });

  const result = await appendSlide(value.id, item.id, { ...plan, title: '追加失败页' });
  assert.ok('id' in result);
  assert.ok(result.appendedSlideId);
  const created = result.slides.find(slide => slide.id === result.appendedSlideId)!;
  assert.equal(created.status, 'failed');
  assert.equal(result.slides.filter(slide => slide.status === 'failed').length, 1);
  assert.equal(created.refundedCredits, created.chargedCredits);
  assert.equal(result.refundedCredits, created.chargedCredits);
  assert.equal(db.getUserById(value.id)?.credits, 90);
});

test('空规划任务删除退回全部未使用预扣', t => {
  const value = user();
  const item = deck(value, 'ppt-empty-' + sequence, [], 30, 3);
  db.updateUser(value.id, { credits: 70 });
  t.after(() => db.deleteUser(value.id));

  assert.deepEqual(deleteDeck(value.id, item.id), { ok: true });
  assert.equal(db.getUserById(value.id)?.credits, 100);
});
