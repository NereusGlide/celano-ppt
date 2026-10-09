import test from 'node:test';
import assert from 'node:assert/strict';
import { applyMembershipCatalog, getMembershipCatalogVersion, memberImageCost, membershipView, parseMembership, subscribeMembershipCatalog } from './membership.js';

test('会员目录加载和更新通知订阅方重算实时折扣', () => {
  const user = { membership: { planId: 'custom-plan', status: 'active' as const, expiresAt: Date.now() + 60_000 } };
  let notifications = 0;
  const version = getMembershipCatalogVersion();
  const stop = subscribeMembershipCatalog(() => { notifications++; });
  try {
    applyMembershipCatalog([{ id: 'custom-plan', name: '定制会员', discount2k: 3, discount4k: 7 }]);
    assert.equal(getMembershipCatalogVersion(), version + 1);
    assert.equal(memberImageCost(user, '2K'), 3);
    applyMembershipCatalog([{ id: 'custom-plan', name: '定制会员', discount2k: 4, discount4k: 8 }]);
    assert.equal(getMembershipCatalogVersion(), version + 2);
    assert.equal(memberImageCost(user, '2K'), 4);
    assert.equal(notifications, 2);
  } finally { stop(); applyMembershipCatalog([]); }
});

test('会员以确认状态和有效期为准，余额或账号角色不能冒充会员', () => {
  const now = Date.now();
  assert.equal(membershipView(null, now).active, false);
  assert.equal(membershipView({} as any, now).active, false);
  assert.equal(membershipView({ role: 'member', credits: 999999 } as any, now).active, false);
  const user = { membership: { planId: 'celano-pro' as const, status: 'active' as const, expiresAt: now + 1000 } };
  assert.equal(membershipView(user, now).name, '专业会员');
  assert.equal(membershipView(user, now).active, true);
  assert.equal(membershipView(user, now + 1000).active, false);
  assert.equal(membershipView({ membership: { ...user.membership, status: 'cancelled' } }, now).active, false);
});

test('会员写入拒绝未知套餐、无效状态和非法有效期，清除不会授予权益', () => {
  const valid = { planId: 'celano-basic', status: 'active', expiresAt: Date.now() + 86400000 };
  assert.deepEqual(parseMembership(valid), valid);
  assert.equal(parseMembership(null), undefined);
  // 套餐 ID 由管理端动态配置，任意合法 ID 均可写入；仅拒绝危险键与非法状态/有效期
  assert.deepEqual(parseMembership({ ...valid, planId: 'celano-vip' }), { ...valid, planId: 'celano-vip' });
  for (const value of [false, [], {}, { ...valid, planId: '__proto__' }, { ...valid, planId: '' }, { ...valid, status: 'pending' }, { ...valid, expiresAt: NaN }, { ...valid, expiresAt: Date.now() - 1 }, { ...valid, expiresAt: 'tomorrow' }]) {
    assert.throws(() => parseMembership(value));
  }
});
