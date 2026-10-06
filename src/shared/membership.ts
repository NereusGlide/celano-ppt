import type { User } from '../types.js';

/** 内置套餐名兜底：管理端可配置覆盖，见 applyMembershipCatalog */
const DEFAULT_MEMBERSHIP_NAMES: Record<string, string> = {
  'celano-basic': '基础会员', 'celano-standard': '标准会员',
  'celano-advanced': '高级会员', 'celano-super': '超级会员',
};

/** 运行时的套餐名映射（默认 + 管理端配置合并），供会员状态展示使用 */
let membershipNames: Record<string, string> = { ...DEFAULT_MEMBERSHIP_NAMES };

/** 前端拿到会员套餐目录后调用，更新套餐 ID → 名称 的映射（未覆盖的内置名保留）。 */
export function applyMembershipCatalog(plans: Array<{ id: string; name: string }>): void {
  const next: Record<string, string> = { ...DEFAULT_MEMBERSHIP_NAMES };
  for (const plan of plans) {
    if (plan && typeof plan.id === 'string' && plan.id && typeof plan.name === 'string' && plan.name) {
      next[plan.id] = plan.name;
    }
  }
  membershipNames = next;
}

export function membershipName(planId: string | undefined): string {
  if (!planId) return '';
  return Object.prototype.hasOwnProperty.call(membershipNames, planId) ? membershipNames[planId] : planId;
}

export function membershipView(user: Pick<User, 'membership'> | null | undefined, now = Date.now()) {
  const membership = user?.membership;
  const planId = membership?.planId;
  const name = planId ? membershipName(planId) : undefined;
  const expiresAt = membership?.expiresAt;
  const active = !!planId && membership?.status === 'active' && Number.isFinite(expiresAt) && expiresAt! > now;
  return { active, name: active ? name! : membership && expiresAt! <= now ? '会员已到期' : '未开通会员', expiresAt: expiresAt || null };
}

/** 只在管理员确认开通或可信支付回调后写入，前台不能自行声明会员。 */
export function parseMembership(value: unknown): User['membership'] {
  if (value === null) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('会员配置无效');
  const { planId, status, expiresAt } = value as Record<string, unknown>;
  if (typeof planId !== 'string' || !/^[a-zA-Z0-9_-]{1,40}$/.test(planId) || ['__proto__', 'constructor', 'prototype'].includes(planId)) throw new Error('请选择有效的会员套餐');
  if (status !== 'active' && status !== 'cancelled') throw new Error('会员状态无效');
  if (typeof expiresAt !== 'number' || !Number.isSafeInteger(expiresAt) || expiresAt <= 0 || expiresAt > 8640000000000000) throw new Error('请选择有效的会员到期时间');
  if (status === 'active' && expiresAt <= Date.now()) throw new Error('开通会员的到期时间必须晚于当前时间');
  return { planId, status, expiresAt };
}
