import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from './db.js';
import { appendSlide, deleteDeck, deleteSlide, regenerateSlide, resumeDeck, startDeck, stopDeck } from './ppt/engine.js';
import type { PptDeck, User } from '../src/types.js';
import fs from 'node:fs';
import { once } from 'node:events';
import express from 'express';
import { pptRouter } from './ppt/routes.js';
import { createUserSessionToken, USER_SESSION_COOKIE } from './userSession.js';

const plan = { title: '回归页', bullets: [], pageType: 'core-insight' as const };
const nativeImage = () => {
  const bytes = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  bytes.writeUInt32BE(2048, 16); bytes.writeUInt32BE(1152, 20);
  return Response.json({ data: [{ b64_json: bytes.toString('base64') }] });
};

async function hostPpt(t: import('node:test').TestContext, user: User) {
  const app = express();
  app.use(express.json());
  app.use('/api/ppt', pptRouter);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const base = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}/api/ppt`;
  const cookie = `${USER_SESSION_COOKIE}=${createUserSessionToken(user.id, db.getCredentials(user.id))}`;
  return (endpoint: string) => fetch(base + endpoint, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: '{}' });
}

const baseUser = (id: string, credits = 100): User => ({
  id,
  username: id,
  name: id,
  avatar: '',
  role: 'creator',
  createdAt: 1,
  credits,
  status: 'active',
});

const makeDeck = (overrides: Partial<PptDeck> = {}): PptDeck => ({
  id: 'pipeline-regression',
  userId: 'pipeline-user',
  title: 'Regression',
  prompt: 'Regression',
  resolution: '2K',
  referencesText: '',
  referenceImages: [],
  subtitle: '',
  visualDirection: '',
  palette: { accent: '#fff', deep: '#000', ink: '#000', muted: '#ccc' },
  slides: [],
  pageCount: 0,
  concurrency: 6,
  stage: 'paused',
  running: false,
  finished: false,
  startedAt: 1,
  updatedAt: 1,
  ...overrides,
});

const addRecords = (user: User, deck: PptDeck) => {
  db.createUser(user);
  db.createPptDeck(deck);
};

test('historical per-slide snapshots refund the originally charged amount after membership changes', () => {
  const user = baseUser('membership-snapshot', 0);
  user.membership = { planId: 'celano-basic', status: 'cancelled', expiresAt: 1 };
  const deck = makeDeck({
    id: 'membership-snapshot-deck',
    userId: user.id,
    chargedCredits: 27,
    refundedCredits: 0,
    slides: [{ id: 'failed', status: 'failed', billingCost: 9, chargedCredits: 9, refundedCredits: 0, plan: { title: 'Page', bullets: [], pageType: 'core-insight' } }],
    pageCount: 1,
  });
  addRecords(user, deck);

  const result = deleteSlide(user.id, deck.id, 'failed');

  assert.deepEqual(result, { deleted: true });
  assert.equal(db.getUserById(user.id)?.credits, 9);
  assert.equal(db.getUsageRecords().filter(item => item.userId === user.id).reduce((sum, item) => sum + item.credits, 0), 9);
});

test('legacy page deletion preserves original unit cost across done and failed pages', () => {
  const user = baseUser('legacy-page-delete', 0);
  const deck = makeDeck({
    id: 'legacy-page-delete-deck',
    userId: user.id,
    chargedCredits: 30,
    refundedCredits: 10,
    refundedSlideIds: ['previously-refunded'],
    pageCount: 3,
    slides: [
      { id: 'done', status: 'done', plan: { title: 'Done', bullets: [], pageType: 'core-insight' } },
      { id: 'pending', status: 'idle', plan: { title: 'Pending', bullets: [], pageType: 'core-insight' } },
      { id: 'previously-refunded', status: 'failed', plan: { title: 'Refunded', bullets: [], pageType: 'core-insight' } },
    ],
  });
  addRecords(user, deck);

  const afterPending = deleteSlide(user.id, deck.id, 'pending');
  assert.ok('id' in afterPending);
  assert.equal(db.getUserById(user.id)?.credits, 10, 'the page must refund its original 10-point unit cost');
  assert.equal(afterPending.refundedCredits, 20);
  assert.equal(afterPending.chargedCredits, 30, 'total charge is historical and must not be recomputed from remaining pages');

  const afterDone = deleteSlide(user.id, deck.id, 'done');
  assert.ok('id' in afterDone);
  assert.equal(db.getUserById(user.id)?.credits, 10, 'deleting a completed page does not refund it');
});

test('repeated failure refund is idempotent and retry charges the refunded snapshot once', () => {
  const user = baseUser('retry-accounting', 0);
  const deck = makeDeck({
    id: 'retry-accounting-deck',
    userId: user.id,
    chargedCredits: 10,
    refundedCredits: 0,
    slides: [{ id: 'retry', status: 'failed', billingCost: 10, chargedCredits: 10, refundedCredits: 0, plan: { title: 'Retry', bullets: [], pageType: 'core-insight' } }],
    pageCount: 1,
  });
  addRecords(user, deck);

  const amounts = new Map([['retry', 10]]);
  assert.equal(db.refundPptFailedSlides(user.id, deck.id, ['retry'], 10, 'first refund', amounts).refunded, 10);
  assert.equal(db.refundPptFailedSlides(user.id, deck.id, ['retry'], 10, 'duplicate refund', amounts).refunded, 0);
  const charged = db.chargePptRetry(user.id, deck.id, ['retry'], 10, 'retry charge', amounts);
  assert.ok(charged.ok);
  assert.equal(db.getUserById(user.id)?.credits, 0);
  assert.equal(db.getPptDeck(deck.id)?.chargedCredits, 20);
  assert.equal(db.getPptDeck(deck.id)?.refundedCredits, 10);
  assert.deepEqual(db.getPptDeck(deck.id)?.refundedSlideIds, []);
});

test('deleting an empty planning deck refunds outstanding prepaid credits', () => {
  const user = baseUser('empty-planning-delete', 0);
  const deck = makeDeck({
    id: 'empty-planning-delete-deck',
    userId: user.id,
    chargedCredits: 30,
    refundedCredits: 10,
    pageCount: 3,
    stage: 'planning',
    running: false,
  });
  addRecords(user, deck);

  assert.deepEqual(deleteDeck(user.id, deck.id), { ok: true });
  assert.equal(db.getUserById(user.id)?.credits, 20);
});

test('append charge failure does not create a page or a usage record', async () => {
  const user = baseUser('append-failure', 0);
  const deck = makeDeck({ id: 'append-failure-deck', userId: user.id, title: 'Append failure' });
  addRecords(user, deck);
  const result = await appendSlide(user.id, deck.id, { title: 'New', bullets: [], pageType: 'core-insight' });
  assert.ok('error' in result);
  assert.match(result.error || '', /点数不足/);
  assert.equal(db.getPptDeck(deck.id)?.slides.length, 0);
  assert.equal(db.getUsageRecords().filter(item => item.userId === user.id).length, 0);
});

test('concurrent append is rejected before charging a second page', async () => {
  const user = baseUser('append-concurrent', 100);
  const deck = makeDeck({ id: 'append-concurrent-deck', userId: user.id, title: 'Append concurrent', running: true });
  addRecords(user, deck);
  const result = await appendSlide(user.id, deck.id, { title: 'New', bullets: [], pageType: 'core-insight' });
  assert.ok('error' in result);
  assert.match(result.error || '', /正在生成中/);
  assert.equal(db.getUserById(user.id)?.credits, 100);
  assert.equal(db.getPptDeck(deck.id)?.slides.length, 0);
});

test('running deck rejects single-slide regeneration without precharging', async () => {
  const user = baseUser('regen-running', 100);
  const slide = { id: 'running-slide', status: 'done' as const, plan: { title: 'Done', bullets: [], pageType: 'core-insight' as const } };
  const deck = makeDeck({ id: 'regen-running-deck', userId: user.id, running: true, slides: [slide], pageCount: 1 });
  addRecords(user, deck);
  const result = await regenerateSlide(user.id, deck.id, slide.id);
  assert.ok('error' in result);
  assert.match(result.error || '', /生成中/);
  assert.equal(db.getUserById(user.id)?.credits, 100);
  assert.equal(db.getUsageRecords().filter(item => item.userId === user.id).length, 0);
});

test('retry charge failure leaves balance and deck refund markers unchanged', () => {
  const user = baseUser('retry-insufficient', 0);
  const deck = makeDeck({
    id: 'retry-insufficient-deck',
    userId: user.id,
    chargedCredits: 10,
    refundedCredits: 10,
    refundedSlideIds: ['retry'],
    slides: [{ id: 'retry', status: 'failed', billingCost: 10, chargedCredits: 10, refundedCredits: 10, plan: { title: 'Retry', bullets: [], pageType: 'core-insight' } }],
    pageCount: 1,
  });
  addRecords(user, deck);

  const result = db.chargePptRetry(user.id, deck.id, ['retry'], 10, 'retry charge', new Map([['retry', 10]]));

  assert.ok(!result.ok);
  assert.equal(db.getUserById(user.id)?.credits, 0);
  assert.deepEqual(db.getPptDeck(deck.id)?.refundedSlideIds, ['retry']);
  assert.equal(db.getPptDeck(deck.id)?.chargedCredits, 10);
});

test('legacy refunded pages initialize both charge and refund snapshots before retry', t => {
  const user = baseUser('legacy-refunded-retry', 100);
  const deck = makeDeck({
    id: 'legacy-refunded-retry-deck', userId: user.id, pageCount: 2,
    chargedCredits: 20, refundedCredits: 10, refundedSlideIds: ['refunded'],
    slides: [{ id: 'done', status: 'done', plan }, { id: 'refunded', status: 'failed', plan }],
  });
  addRecords(user, deck);
  t.after(() => db.deleteUser(user.id));
  const reduced = deleteSlide(user.id, deck.id, 'done');
  assert.ok('id' in reduced);
  assert.equal(reduced.slides[0].refundedCredits, 10, 'old refund markers must become historical amounts');
  const amounts = new Map([['refunded', 10]]);
  assert.ok(db.chargePptRetry(user.id, deck.id, ['refunded'], 10, 'retry', amounts).ok);
  assert.equal(db.refundPptFailedSlides(user.id, deck.id, ['refunded'], 10, 'retry failure', amounts).refunded, 10);
  assert.equal(db.getUserById(user.id)?.credits, 100);
  assert.equal(db.getPptDeck(deck.id)?.slides[0].refundedCredits, 20);
});

test('append after stop uses a fresh controller and reports an actual completed page', async t => {
  const user = baseUser('append-after-stop', 90);
  const deck = makeDeck({ id: 'append-after-stop-deck', userId: user.id, pageCount: 1, chargedCredits: 10, slides: [{ id: 'done', status: 'done', billingCost: 10, chargedCredits: 10, refundedCredits: 0, plan }] });
  addRecords(user, deck);
  t.after(() => db.deleteUser(user.id));
  t.mock.method(db, 'resolveImageConfig', () => ({ baseUrl: 'https://mock.invalid/v1', apiKey: 'mock', modelName: 'mock' }));
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init?: RequestInit) => {
    if (init?.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    return nativeImage();
  });
  assert.ok('id' in stopDeck(user.id, deck.id));
  const result = await appendSlide(user.id, deck.id, plan);
  assert.ok('id' in result);
  assert.equal(result.slides.find(slide => slide.id === result.appendedSlideId)?.status, 'done');
  assert.equal(db.getUserById(user.id)?.credits, 85);
});

test('regeneration failure refunds unused prepayment once, while successful original pages retain their charge', async t => {
  const user = baseUser('regenerate-accounting', 80);
  const deck = makeDeck({
    id: 'regenerate-accounting-deck', userId: user.id, pageCount: 2, chargedCredits: 20,
    slides: [
      { id: 'pending', status: 'idle', billingCost: 10, chargedCredits: 10, refundedCredits: 0, plan },
      { id: 'done', status: 'done', billingCost: 10, chargedCredits: 10, refundedCredits: 0, plan },
    ],
  });
  db.createUser(user, 'regression-password'); db.createPptDeck(deck);
  t.after(() => db.deleteUser(user.id));
  const originalFetch = globalThis.fetch;
  t.mock.method(db, 'resolveImageConfig', () => ({ baseUrl: 'https://mock.invalid/v1', apiKey: 'mock', modelName: 'mock' }));
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
    if (!String(url).includes('mock.invalid')) return originalFetch(url, init);
    return Response.json({ error: { message: 'upstream failed' } }, { status: 502 });
  });
  const request = await hostPpt(t, user);
  assert.equal((await request(`/decks/${deck.id}/slides/pending/regenerate`)).status, 502);
  assert.equal(db.getUserById(user.id)?.credits, 90, 'unused original page prepayment and failed edit must both settle');
  assert.equal((await request(`/decks/${deck.id}/slides/pending/regenerate`)).status, 502);
  assert.equal(db.getUserById(user.id)?.credits, 90, 'another failed edit must not repeat the original refund');
  assert.equal((await request(`/decks/${deck.id}/slides/done/regenerate`)).status, 502);
  assert.equal(db.getUserById(user.id)?.credits, 90);
  assert.deepEqual(deleteDeck(user.id, deck.id), { ok: true });
  assert.equal(db.getUserById(user.id)?.credits, 90, 'a delivered original page remains billed after a failed edit');
});

test('stop during regeneration returns cancellation and refunds its edit instead of success on an idle page', async t => {
  const user = baseUser('regenerate-cancelled', 90);
  const deck = makeDeck({ id: 'regenerate-cancelled-deck', userId: user.id, pageCount: 1, chargedCredits: 10, slides: [{ id: 'done', status: 'done', chargedCredits: 10, refundedCredits: 0, billingCost: 10, plan }] });
  db.createUser(user, 'regression-password'); db.createPptDeck(deck);
  t.after(() => db.deleteUser(user.id));
  const originalFetch = globalThis.fetch;
  t.mock.method(db, 'resolveImageConfig', () => ({ baseUrl: 'https://mock.invalid/v1', apiKey: 'mock', modelName: 'mock' }));
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
    if (!String(url).includes('mock.invalid')) return originalFetch(url, init);
    stopDeck(user.id, deck.id);
    throw new DOMException('aborted', 'AbortError');
  });
  const request = await hostPpt(t, user);
  const response = await request(`/decks/${deck.id}/slides/done/regenerate`);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).success, false);
  assert.equal(db.getUserById(user.id)?.credits, 90);
});

test('resume refuses an in-flight single-page operation without resetting its controller', async t => {
  const user = baseUser('resume-busy', 90);
  const deck = makeDeck({ id: 'resume-busy-deck', userId: user.id, pageCount: 1, chargedCredits: 10, slides: [{ id: 'done', status: 'done', billingCost: 10, chargedCredits: 10, refundedCredits: 0, plan }] });
  addRecords(user, deck);
  t.after(() => db.deleteUser(user.id));
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  t.after(() => release());
  t.mock.method(db, 'resolveImageConfig', () => ({ baseUrl: 'https://mock.invalid/v1', apiKey: 'mock', modelName: 'mock' }));
  t.mock.method(globalThis, 'fetch', async () => { await gate; return nativeImage(); });
  const operation = regenerateSlide(user.id, deck.id, 'done');
  const result = resumeDeck(user.id, deck.id);
  release();
  await operation;
  assert.ok(!('id' in result));
  assert.match(result.error || '', /生成中/);
});

test('task creation failure rolls back charge, records and uploaded reference files together', t => {
  const user = baseUser('creation-rollback', 100);
  db.createUser(user);
  t.after(() => db.deleteUser(user.id));
  t.mock.method(db, 'getPlanningConfig', () => ({ baseUrl: 'https://mock.invalid/v1', apiKey: 'mock', modelName: 'mock', reasoningEffort: 'auto' }));
  t.mock.method(db, 'resolveImageConfig', () => ({ baseUrl: 'https://mock.invalid/v1', apiKey: 'mock', modelName: 'mock' }));
  const create = db.createPptDeck.bind(db);
  t.mock.method(db, 'createPptDeck', (item: PptDeck) => { create(item); throw new Error('creation failed'); });
  const bytes = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  bytes.writeUInt32BE(2048, 16); bytes.writeUInt32BE(1152, 20);
  assert.throws(() => startDeck(user.id, { prompt: 'rollback', pageCount: 1, concurrency: 6, referenceImages: [{ name: 'reference', dataUrl: 'data:image/png;base64,' + bytes.toString('base64') }] }), /creation failed/);
  assert.equal(db.getUserById(user.id)?.credits, 100);
  assert.equal(db.getUsageRecords().filter(record => record.userId === user.id).length, 0);
  assert.equal(db.getPptDecks(user.id).length, 0);
  const directory = `data/images/user-${user.id}`;
  assert.ok(!fs.existsSync(directory) || fs.readdirSync(directory).length === 0);
});

test('append commit failure rolls back both its new page and precharge', async t => {
  const user = baseUser('append-rollback', 90);
  const deck = makeDeck({ id: 'append-rollback-deck', userId: user.id, pageCount: 1, chargedCredits: 10, slides: [{ id: 'done', status: 'done', plan }] });
  addRecords(user, deck);
  t.after(() => { t.mock.restoreAll(); db.deleteUser(user.id); });
  t.mock.method(fs, 'renameSync', () => { throw new Error('commit failed'); });
  await assert.rejects(appendSlide(user.id, deck.id, plan), /commit failed/);
  assert.equal(db.getUserById(user.id)?.credits, 90);
  assert.equal(db.getPptDeck(deck.id)?.slides.length, 1);
  assert.equal(db.getPptDeck(deck.id)?.chargedCredits, 10);
  assert.equal(db.getUsageRecords().filter(record => record.userId === user.id).length, 0);
});

test('multi-reference output validation failure does not start another paid edit', async t => {
  const user = baseUser('multi-ref-no-replay', 90);
  const bytes = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  bytes.writeUInt32BE(1536, 16); bytes.writeUInt32BE(1024, 20);
  const directory = `data/images/user-${user.id}`;
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(directory + '/ref.png', bytes);
  const deck = makeDeck({ id: 'multi-ref-no-replay-deck', userId: user.id, pageCount: 1, chargedCredits: 10, slides: [{ id: 'done', status: 'done', plan }], referenceImages: [{ id: 'r1', name: '人物参考：1', storageKey: `user-${user.id}/ref.png` }, { id: 'r2', name: '商品参考：2', storageKey: `user-${user.id}/ref.png` }] });
  addRecords(user, deck);
  t.after(() => db.deleteUser(user.id));
  let posts = 0;
  t.mock.method(db, 'resolveImageConfig', () => ({ baseUrl: 'https://mock.invalid/v1', apiKey: 'mock', modelName: 'mock' }));
  t.mock.method(globalThis, 'fetch', async () => { posts++; return Response.json({ data: [{ b64_json: bytes.toString('base64') }] }); });
  const result = await regenerateSlide(user.id, deck.id, 'done');
  assert.ok('id' in result);
  assert.equal(result.slides[0].status, 'failed');
  assert.equal(posts, 1);
  assert.equal(db.getUserById(user.id)?.credits, 90);
});
