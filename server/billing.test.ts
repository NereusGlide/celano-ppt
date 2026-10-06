import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { db } from './db.js';
import { chargeCredits, refundCredits } from './billing.js';

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

test('退款金额为 0 时不产生任何写入', t => {
  const writes = mockPersistence(t);
  seedUser();
  writes.length = 0;

  refundCredits(USER_ID, 0, '无需退款');

  assert.equal(db.getUserById(USER_ID)?.credits, 100);
  assert.equal(storeWrites(writes), 0);
});
