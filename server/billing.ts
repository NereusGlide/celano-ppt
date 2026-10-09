import { db } from './db.js';
import type { UsageRecord, User } from '../src/types.js';

import { IMAGE_COST, normalizeImageResolution, imageSizeFor } from '../src/shared/imageSpecs.js';
export const PPT_RESOLUTION_COST = IMAGE_COST;
export const PROMPT_OPTIMIZE_COST = 1;
export const normalizeResolution = normalizeImageResolution;
export function resolutionCost(value: unknown): number { return IMAGE_COST[normalizeResolution(value)]; }
export const resolutionImageSize = imageSizeFor;

type CreditResult = { ok: true; credits: number } | { ok: false; error: string; credits: number };

function addUsage(userId: string, username: string, credits: number, detail: string, type: UsageRecord['type'] = 'slide_image') {
  const record: UsageRecord = {
    id: 'use_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    userId,
    username,
    type,
    detail,
    credits,
    createdAt: Date.now(),
  };
  db.addUsageRecord(record);
}

/** 免费版每日额度：每日 3 张 2K 文生图免费（跨天自动重置）。 */
export const FREE_DAILY_LIMIT = 3;

/** 当前时区的日期键（YYYY-MM-DD），与服务端本地时区对齐。 */
function todayKey(now = Date.now()): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(now);
}

/** 报价与实际扣费共用同一免费额度口径；不依赖服务器部署时区。 */
export function quoteImageCredits(user: User | undefined, resolution: '2K' | '4K', count: number, editing = false) {
  if (!Number.isSafeInteger(count) || count < 1 || count > 100) throw new Error('生成数量须为 1–100 的整数');
  const unit = memberImageCost(user, resolution);
  const date = todayKey();
  const used = user?.freeDaily?.date === date ? Math.max(0, Math.floor(Number(user.freeDaily.used) || 0)) : 0;
  const free = !editing && user && resolution === '2K' && !hasActiveMembership(user)
    ? Math.min(count, Math.max(0, FREE_DAILY_LIMIT - used)) : 0;
  return { unit, free, date, cost: (count - free) * unit };
}

/** 会员是否有效（active 且未过期）。 */
export function hasActiveMembership(user: User | undefined, now = Date.now()): boolean {
  const m = user?.membership;
  return !!m && m.status === 'active' && Number.isFinite(Number(m.expiresAt)) && Number(m.expiresAt) > now;
}

/** 会员档位对应的 2K/4K 实扣点数；非会员返回零售价。 */
export function memberImageCost(user: User | undefined, resolution: '2K' | '4K'): number {
  if (!hasActiveMembership(user)) return IMAGE_COST[resolution];
  const plan = db.getMembershipPlans().find(p => p.id === user!.membership!.planId);
  if (!plan) return IMAGE_COST[resolution];
  const discounted = resolution === '2K' ? Number(plan.discount2k) : Number(plan.discount4k);
  // 折扣字段必须落在 1..零售价 区间，异常值回退零售价，避免误扣或倒贴。
  return Number.isFinite(discounted) && discounted >= 1 && discounted <= IMAGE_COST[resolution]
    ? Math.floor(discounted)
    : IMAGE_COST[resolution];
}

/** 图生图 / 局部重绘的单次成本：对齐文生图同分辨率（方案待确认成本，暂同价）。 */
export function editCostFor(user: User | undefined, resolution: '2K' | '4K'): number {
  return memberImageCost(user, resolution);
}

/**
 * 文生图扣费入口（含免费额度 + 会员折扣）：
 *  1. 免费用户（无有效会员）每天前 3 张 2K 文生图免费，不扣点；
 *  2. 超出免费额度或 4K 按会员折扣后单价扣点；
 *  3. 免费额度的计数与扣点在同一写事务内完成，避免「记了额度却没扣点」或反之。
 * 返回 charged 为实际扣费点数（免费额度外的部分），供调用方按此退款。
 */
export type ImageChargeResult =
  | { ok: true; credits: number; charged: number; free: number; unit: number; date: string }
  | { ok: false; error: string; credits: number };

export function chargeImageCredits(userId: string, resolution: '2K' | '4K', count: number, detail: string, editing = false): ImageChargeResult {
  if (!Number.isSafeInteger(count) || count < 1 || count > 100) {
    return { ok: false, error: '生成数量须为 1–100 的整数', credits: db.getUserById(userId)?.credits || 0 };
  }
  const n = count;
  return db.transaction(() => {
    const user = db.getUserById(userId);
    if (!user) return { ok: false, error: '账号不存在', credits: 0 };
    const balance = Math.max(0, Math.floor(Number(user.credits) || 0));
    const { date: today, free: freeCount, unit, cost } = quoteImageCredits(user, resolution, n, editing);
    const chargeCount = n - freeCount;
    if (balance < cost) {
      return { ok: false, error: '点数不足：本次需要 ' + cost + ' 点，当前余额 ' + balance + ' 点', credits: balance };
    }

    const patch: Partial<User> = {};
    if (freeCount > 0) {
      patch.freeDaily = { date: today, used: (user.freeDaily?.date === today ? Number(user.freeDaily!.used) || 0 : 0) + freeCount };
    }
    if (cost > 0) patch.credits = balance - cost;

    const updated = db.updateUser(userId, patch);
    if (!updated) return { ok: false, error: '扣减点数失败，请重试', credits: balance };

    if (freeCount > 0) addUsage(userId, user.username, 0, `${detail}（免费额度 ${freeCount} 张）`);
    if (cost > 0) addUsage(userId, user.username, -cost, `${detail}（${chargeCount} 张 × ${unit} 点）`);
    return { ok: true, credits: updated.credits || 0, charged: cost, free: freeCount, unit, date: today };
  });
}

/** 请求失败或部分出图时，按预扣快照退付费张数，并恢复未成功的当日免费额度。 */
export function refundImageCredits(userId: string, payment: Extract<ImageChargeResult, { ok: true }>, requested: number, completed = 0): number {
  const success = Math.max(0, Math.min(requested, Math.floor(completed)));
  const freeSucceeded = Math.min(payment.free, success);
  const paidSucceeded = Math.max(0, success - freeSucceeded);
  const refund = Math.max(0, payment.charged - paidSucceeded * payment.unit);
  const restoreFree = payment.free - freeSucceeded;
  return db.transaction(() => {
    const user = db.getUserById(userId);
    if (!user) return 0;
    if (restoreFree > 0 && user.freeDaily?.date === payment.date) {
      db.updateUser(userId, { freeDaily: { date: payment.date, used: Math.max(0, user.freeDaily.used - restoreFree) } });
    }
    return refundCredits(userId, refund, '智能画布：未完成图片退回');
  });
}

/**
 * 原子扣减积分；扣减发生在真正发起 AI 任务前，余额不足时不会创建任务。
 *
 * 「改余额」与「记流水」放在同一个写事务里：store.json 是全量落盘，
 * 分开两次写既多付一次整库序列化成本，也会在两次写之间留下崩溃窗口
 * （余额已扣但没有任何流水，事后无法对账）。
 */
export function chargeCredits(userId: string, amount: number, detail: string, type: UsageRecord['type'] = 'slide_image'): CreditResult {
  const cost = Math.max(0, Math.floor(Number(amount) || 0));
  return db.transaction(() => {
    const user = db.getUserById(userId);
    if (!user) return { ok: false, error: '账号不存在', credits: 0 };
    const balance = Math.max(0, Math.floor(Number(user.credits) || 0));
    if (balance < cost) {
      return { ok: false, error: '点数不足：本次需要 ' + cost + ' 点，当前余额 ' + balance + ' 点', credits: balance };
    }
    const updated = db.updateUser(userId, { credits: balance - cost });
    if (!updated) return { ok: false, error: '扣减点数失败，请重试', credits: balance };
    if (cost > 0) addUsage(userId, user.username, -cost, detail, type);
    return { ok: true, credits: updated.credits || 0 };
  });
}

/** AI 调用失败时退回已预扣的积分，并保留一条可审计流水。 */
export function chargePromptOptimize(userId: string, detail: string): CreditResult {
  return chargeCredits(userId, PROMPT_OPTIMIZE_COST, detail, 'optimize_prompt');
}

export function refundCredits(userId: string, amount: number, detail: string, type: UsageRecord['type'] = 'slide_image'): number {
  const refund = Math.max(0, Math.floor(Number(amount) || 0));
  return db.transaction(() => {
    if (!refund) return Math.max(0, Math.floor(Number(db.getUserById(userId)?.credits) || 0));
    const user = db.getUserById(userId);
    if (!user) return 0;
    const updated = db.updateUser(userId, { credits: Math.max(0, Math.floor(Number(user.credits) || 0)) + refund });
    // 余额更新失败时不记流水，避免出现「流水显示已退款、余额却未变」的对账不一致。
    if (!updated) return Math.max(0, Math.floor(Number(user.credits) || 0));
    addUsage(userId, user.username, refund, detail, type);
    return updated.credits || 0;
  });
}
