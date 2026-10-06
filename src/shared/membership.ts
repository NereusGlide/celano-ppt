import type { User } from '../types.js';

export const MEMBERSHIP_NAMES = {
  'celano-basic': '基础会员', 'celano-standard': '标准会员',
  'celano-advanced': '高级会员', 'celano-super': '超级会员',
} as const;

export function membershipView(user: Pick<User, 'membership'> | null | undefined, now = Date.now()) {
  const membership = user?.membership;
  const name = membership && Object.prototype.hasOwnProperty.call(MEMBERSHIP_NAMES, membership.planId) ? MEMBERSHIP_NAMES[membership.planId] : undefined;
  const expiresAt = membership?.expiresAt;
  const active = !!name && membership?.status === 'active' && Number.isFinite(expiresAt) && expiresAt! > now;
  return { active, name: active ? name : membership && expiresAt! <= now ? '会员已到期' : '未开通会员', expiresAt: expiresAt || null };
}

/** 只在管理员确认开通或可信支付回调后写入，前台不能自行声明会员。 */
export function parseMembership(value: unknown): User['membership'] {
  if (value === null) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('会员配置无效');
  const { planId, status, expiresAt } = value as Record<string, unknown>;
  if (typeof planId !== 'string' || !Object.prototype.hasOwnProperty.call(MEMBERSHIP_NAMES, planId)) throw new Error('请选择有效的会员套餐');
  if (status !== 'active' && status !== 'cancelled') throw new Error('会员状态无效');
  if (typeof expiresAt !== 'number' || !Number.isSafeInteger(expiresAt) || expiresAt <= 0 || expiresAt > 8640000000000000) throw new Error('请选择有效的会员到期时间');
  if (status === 'active' && expiresAt <= Date.now()) throw new Error('开通会员的到期时间必须晚于当前时间');
  return { planId: planId as keyof typeof MEMBERSHIP_NAMES, status, expiresAt };
}
