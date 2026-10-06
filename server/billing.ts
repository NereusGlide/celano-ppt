import { db } from './db.js';
import type { UsageRecord } from '../src/types.js';

import { IMAGE_COST, normalizeImageResolution, imageSizeFor } from '../src/shared/imageSpecs.js';
export const PPT_RESOLUTION_COST = IMAGE_COST;
export const normalizeResolution = normalizeImageResolution;
export function resolutionCost(value: unknown): number { return IMAGE_COST[normalizeResolution(value)]; }
export const resolutionImageSize = imageSizeFor;

type CreditResult = { ok: true; credits: number } | { ok: false; error: string; credits: number };

function addUsage(userId: string, username: string, credits: number, detail: string) {
  const record: UsageRecord = {
    id: 'use_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    userId,
    username,
    type: 'slide_image',
    detail,
    credits,
    createdAt: Date.now(),
  };
  db.addUsageRecord(record);
}

/**
 * 原子扣减积分；扣减发生在真正发起 AI 任务前，余额不足时不会创建任务。
 *
 * 「改余额」与「记流水」放在同一个写事务里：store.json 是全量落盘，
 * 分开两次写既多付一次整库序列化成本，也会在两次写之间留下崩溃窗口
 * （余额已扣但没有任何流水，事后无法对账）。
 */
export function chargeCredits(userId: string, amount: number, detail: string): CreditResult {
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
    if (cost > 0) addUsage(userId, user.username, -cost, detail);
    return { ok: true, credits: updated.credits || 0 };
  });
}

/** AI 调用失败时退回已预扣的积分，并保留一条可审计流水。 */
export function refundCredits(userId: string, amount: number, detail: string): number {
  const refund = Math.max(0, Math.floor(Number(amount) || 0));
  return db.transaction(() => {
    if (!refund) return Math.max(0, Math.floor(Number(db.getUserById(userId)?.credits) || 0));
    const user = db.getUserById(userId);
    if (!user) return 0;
    const updated = db.updateUser(userId, { credits: Math.max(0, Math.floor(Number(user.credits) || 0)) + refund });
    // 余额更新失败时不记流水，避免出现「流水显示已退款、余额却未变」的对账不一致。
    if (!updated) return Math.max(0, Math.floor(Number(user.credits) || 0));
    addUsage(userId, user.username, refund, detail);
    return updated.credits || 0;
  });
}
