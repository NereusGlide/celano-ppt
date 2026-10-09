import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { db } from './db.js';
import { chargeCredits, refundCredits, chargeImageCredits, quoteImageCredits, refundImageCredits, chargePromptOptimize, PROMPT_OPTIMIZE_COST } from './billing.js';

/**
 * 这组用例守住一个容易被悄悄改回去的约束：
 * 「改余额」与「记流水」必须落在同一次落盘里。
 * 一旦有人把它们拆成两次 save()，下面的写盘次数断言会立刻失败。
 *
 * 只拦掉磁盘写入（writeFileSync / renameSync），仓储方法保持真实，
 * 否则被 mock 掉的 save() 根本不会登记待落盘状态，断言就失去意义。
 */
function mockPersistence(t: import('node:test').TestContext): string[] {
  const writes: string[] = [];
  t.mock.method(fs, 'writeFileSync', ((file: unknown) => { writes.push(String(file)); }) as never);
  t.mock.method(fs, 'renameSync', (() => undefined) as never);
  return writes;
}

const USER_ID = 'user_billing_test';
function seedUser(): void {
  const existing = db.getUserById(USER_ID);
  if (existing) {
    db.updateUser(USER_ID, { credits: 100 });
    return;
  }
  db.createUser({
    id: USER_ID,
    username: 'billing_test',
    name: '计费测试',
    phone: '13800000000',
    avatar: '',
    role: 'creator',
    createdAt: Date.now(),
    credits: 100,
  }, 'test-password');
}

function storeWrites(writes: string[]): number {
  return writes.filter(file => file.includes('store.json')).length;
}

test('扣点与流水在同一事务内只落盘一次', t => {
  const writes = mockPersistence(t);
  seedUser();
  writes.length = 0;

  const result = chargeCredits(USER_ID, 6, '测试扣点');

  assert.equal(result.ok, true);
  assert.equal(db.getUserById(USER_ID)?.credits, 94);
  assert.equal(storeWrites(writes), 1, '扣点 + 记流水必须合并为一次落盘');
});

test('退款同样只落盘一次，且余额回到原值', t => {
  const writes = mockPersistence(t);
  seedUser();
  chargeCredits(USER_ID, 6, '测试扣点');
  writes.length = 0;

  refundCredits(USER_ID, 6, '测试退款');

  assert.equal(db.getUserById(USER_ID)?.credits, 100, '退款后应回到扣点前的余额');
  assert.equal(storeWrites(writes), 1);
});

test('余额不足时不写盘、不改动余额', t => {
  const writes = mockPersistence(t);
  seedUser();
  db.updateUser(USER_ID, { credits: 3 });
  writes.length = 0;

  const result = chargeCredits(USER_ID, 6, '余额不足');

  assert.equal(result.ok, false);
  assert.equal(db.getUserById(USER_ID)?.credits, 3, '失败路径不得改动余额');
  assert.equal(storeWrites(writes), 0);
});

test('事务回调失败与落盘失败都回滚余额', t => {
  mockPersistence(t); seedUser();
  assert.throws(() => db.transaction(() => { db.updateUser(USER_ID, { credits: 1 }); throw new Error('abort'); }), /abort/);
  assert.equal(db.getUserById(USER_ID)?.credits, 100);
  t.mock.method(fs, 'renameSync', (() => { throw new Error('disk failure'); }) as never);
  assert.throws(() => chargeCredits(USER_ID, 10, '失败落盘'), /disk failure/);
  assert.equal(db.getUserById(USER_ID)?.credits, 100);
});

test('免费额度报价、混合部分成功退款与失败恢复保持一致', t => {
  mockPersistence(t); seedUser();
  db.updateUser(USER_ID, { membership: undefined, freeDaily: undefined });
  const before = quoteImageCredits(db.getUserById(USER_ID), '2K', 5);
  assert.equal(before.free, 3); assert.equal(before.cost, 10);
  const payment = chargeImageCredits(USER_ID, '2K', 5, '混合批次');
  assert.equal(payment.ok, true);
  if (!payment.ok) return;
  assert.equal(payment.charged, 10); assert.equal(db.getUserById(USER_ID)?.credits, 90);
  // 前三张免费，第四张付费；只生成两张时应全退付费并恢复一张免费额度。
  refundImageCredits(USER_ID, payment, 5, 2);
  assert.equal(db.getUserById(USER_ID)?.credits, 100);
  assert.equal(db.getUserById(USER_ID)?.freeDaily?.used, 2);
  const next = chargeImageCredits(USER_ID, '2K', 1, '失败免费');
  assert.equal(next.ok, true);
  if (next.ok) refundImageCredits(USER_ID, next, 1);
  assert.equal(db.getUserById(USER_ID)?.freeDaily?.used, 2);
  assert.equal(quoteImageCredits(db.getUserById(USER_ID), '4K', 1).cost, 10);
  assert.equal(quoteImageCredits(db.getUserById(USER_ID), '2K', 1, true).free, 0);
  assert.equal(chargeImageCredits(USER_ID, '2K', Infinity, '非法数量').ok, false);
});

test('提示词优化统一扣 1 点，退款也回到同一类流水', t => {
  mockPersistence(t); seedUser();
  assert.equal(PROMPT_OPTIMIZE_COST, 1);
  const charged = chargePromptOptimize(USER_ID, 'PPT提示词优化');
  assert.equal(charged.ok, true);
  assert.equal(db.getUserById(USER_ID)?.credits, 99);
  const records = db.getUsageRecords().filter(item => item.userId === USER_ID);
  const last = records[0];
  assert.equal(last.credits, -1);
  assert.equal(last.type, 'optimize_prompt');
  refundCredits(USER_ID, PROMPT_OPTIMIZE_COST, 'PPT提示词优化失败退款', 'optimize_prompt');
  assert.equal(db.getUserById(USER_ID)?.credits, 100);
  const after = db.getUsageRecords().filter(item => item.userId === USER_ID);
  assert.equal(after[0].credits, 1);
  assert.equal(after[0].type, 'optimize_prompt');
});

test('退款金额为 0 时不产生任何写入', t => {
  const writes = mockPersistence(t);
  seedUser();
  writes.length = 0;

  refundCredits(USER_ID, 0, '无需退款');

  assert.equal(db.getUserById(USER_ID)?.credits, 100);
  assert.equal(storeWrites(writes), 0);
});
