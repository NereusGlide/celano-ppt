import type { User } from '../types.js';
import { IMAGE_COST, type ImageResolution } from './imageSpecs.js';

/** 免费版档位（会员体系第 0 档，不可购买，用户未开通任何付费套餐时即处于该档）。 */
export const FREE_TIER_ID = 'celano-free';
export const FREE_TIER_NAME = '免费版';

/** 内置套餐名兜底：管理端可配置覆盖，见 applyMembershipCatalog */
const DEFAULT_MEMBERSHIP_NAMES: Record<string, string> = {
  'celano-basic': '基础会员', 'celano-pro': '专业会员',
  'celano-premium': '尊享会员', 'celano-flagship': '旗舰会员',
};

/** 会员档位：free = 免费版（未开通付费套餐），paid = 已开通付费会员。 */
export type MembershipTier = 'free' | 'paid';

/** 免费版权益（对齐《会员体系与积分充值方案》免费档）。 */
export const FREE_TIER_BENEFITS = [
  '每日 3 张 2K 免费额度',
  '提示词优化 1 点/次',
  '图片带水印 · JPG 下载',
  '作品保存 1 天',
  '2K 5 点 · 4K 10 点（无折扣）',
];

/** 运行时的套餐名映射（默认 + 管理端配置合并），供会员状态展示使用 */
let membershipNames: Record<string, string> = { ...DEFAULT_MEMBERSHIP_NAMES };

/** 运行时的套餐折扣目录（前端展示预计消耗用，与后端会员折扣口径一致） */
type PlanDiscount = { id: string; discount2k: number; discount4k: number };
let membershipDiscounts: PlanDiscount[] = [];
let membershipCatalogVersion = 0;
const membershipCatalogListeners = new Set<() => void>();
export const getMembershipCatalogVersion = () => membershipCatalogVersion;
export const subscribeMembershipCatalog = (listener: () => void) => { membershipCatalogListeners.add(listener); return () => membershipCatalogListeners.delete(listener); };

/** 前端拿到会员套餐目录后调用，更新套餐 ID → 名称/折扣 映射（未覆盖的内置名保留）。 */
export function applyMembershipCatalog(plans: Array<{ id: string; name: string; discount2k?: number; discount4k?: number }>): void {
  const next: Record<string, string> = { ...DEFAULT_MEMBERSHIP_NAMES };
  const discounts: PlanDiscount[] = [];
  for (const plan of plans) {
    if (plan && typeof plan.id === 'string' && plan.id && typeof plan.name === 'string' && plan.name) {
      next[plan.id] = plan.name;
      const d2k = Number(plan.discount2k);
      const d4k = Number(plan.discount4k);
      if (Number.isFinite(d2k) && d2k >= 1 && Number.isFinite(d4k) && d4k >= 1) {
        discounts.push({ id: plan.id, discount2k: Math.floor(d2k), discount4k: Math.floor(d4k) });
      }
    }
  }
  membershipNames = next;
  membershipDiscounts = discounts;
  membershipCatalogVersion += 1;
  membershipCatalogListeners.forEach(listener => listener());
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
  const expired = !!membership && !!expiresAt && Number(expiresAt) <= now;
  // 版本同步：未开通任何付费套餐（或已到期）统一归入「免费版」档位，
  // 与付费档名一起作为用户当前版本的统一展示口径。
  const tier: MembershipTier = active ? 'paid' : 'free';
  const label = active ? (name || planId!) : expired ? FREE_TIER_NAME + '（已到期）' : FREE_TIER_NAME;
  return { active, tier, name: label, planName: active ? name : undefined, expiresAt: expiresAt || null };
}

/** 会员是否有效（active 且未过期）——与后端 billing.hasActiveMembership 口径一致。 */
export function isActiveMember(user: Pick<User, 'membership'> | null | undefined, now = Date.now()): boolean {
  const m = user?.membership;
  return !!m && m.status === 'active' && Number.isFinite(Number(m.expiresAt)) && Number(m.expiresAt) > now;
}

/** 前端展示用：会员折扣后的单张点数；非会员返回零售价。 */
export function memberImageCost(user: Pick<User, 'membership'> | null | undefined, resolution: ImageResolution): number {
  const base = IMAGE_COST[resolution];
  if (!isActiveMember(user)) return base;
  const plan = membershipDiscounts.find(p => p.id === user!.membership!.planId);
  if (!plan) return base;
  const discounted = resolution === '2K' ? plan.discount2k : plan.discount4k;
  return Number.isFinite(discounted) && discounted >= 1 && discounted <= base ? discounted : base;
}

/** 免费版每日额度上限（前端展示用，与后端一致）。 */
export const FREE_DAILY_LIMIT = 3;

/** 今日剩余免费额度（仅对无有效会员的 2K 文生图生效）。 */
export function remainingFreeDaily(user: Pick<User, 'membership' | 'freeDaily'> | null | undefined, now = Date.now()): number {
  if (!user || isActiveMember(user, now)) return 0;
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(now);
  const used = user.freeDaily?.date === today ? Math.max(0, Math.floor(Number(user.freeDaily.used) || 0)) : 0;
  return Math.max(0, FREE_DAILY_LIMIT - used);
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
