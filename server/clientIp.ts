/**
 * 真实客户端 IP 解析。
 *
 * 从 server.ts 抽出来单独成模块，一是让这段「代理链取值」逻辑可以被单元测试
 * 覆盖（在本机直连时无法真实触发代理分支），二是避免其它模块为了拿到 IP 而
 * 反向 import server.ts 造成循环依赖。
 *
 * 安全前提：X-Forwarded-For 是客户端可自由伪造的请求头。
 * 因此只有显式声明了受信任代理跳数（TRUST_PROXY > 0）时才读取代理头 ——
 * 未声明时直接采信它，等于把登录、兑换的限流开关交给攻击者，
 * 每次请求换一个 XFF 就是一个新的限流桶。
 */

import { isIP } from 'node:net';

/** 请求头可能是字符串或数组，统一取第一个值。 */
export function headerText(value: unknown): string {
  if (Array.isArray(value)) return String(value[0] ?? '').trim();
  return String(value ?? '').trim();
}

/**
 * 归一化 IP 字面量，保证记录里存的是可直接比较的裸地址。
 * 例：`::ffff:127.0.0.1` → `127.0.0.1`；`[::1]:52341` → `::1`；`10.0.0.7:443` → `10.0.0.7`。
 */
export function normalizeIp(value: unknown): string {
  const raw = headerText(value);
  if (!raw) return '';
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(raw);
  const bare = bracketed ? bracketed[1] : raw.replace(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/, '$1');
  const normalized = bare.replace(/^::ffff:(?=\d+\.)/i, '').trim();
  return isIP(normalized) ? normalized.toLowerCase() : '';
}

/** 解析所需的最小请求形状，便于测试直接构造。 */
export interface ClientIpRequest {
  headers?: Record<string, unknown>;
  ip?: string;
  socket?: { remoteAddress?: string | null };
}

/**
 * 解析真实客户端 IP。
 *
 * TRUST_PROXY > 0 时的取值顺序：
 *   1. x-forwarded-for —— 取「从右往左第 TRUST_PROXY 跳」。列表最左值来自客户端自己
 *      填写，照抄它会记录到伪造地址；真实来源由受信任代理追加在右侧。
 *   2. socket 地址；没有 socket 时才使用 req.ip。
 *
 * cf-connecting-ip / x-real-ip 未声明专门可信来源时不能采信，普通反代可能透传客户端伪造值。
 *
 * 全部取不到时返回「未知」，避免写入空字符串让后台无法区分「没记录」与「解析失败」。
 */
export function resolveClientIp(req: ClientIpRequest, trustProxy = 0): string {
  if (Number.isSafeInteger(trustProxy) && trustProxy > 0) {
    const chain = headerText(req.headers?.['x-forwarded-for']).split(',').map(value => value.trim()).filter(Boolean);
    // 先选受信跳数再校验，不能删除非法段后将攻击者更左侧的值移进可信位置。
    if (chain.length) {
      const candidate = normalizeIp(chain[Math.max(0, chain.length - trustProxy)]);
      if (candidate) return candidate;
    }
    return normalizeIp(req.socket?.remoteAddress) || normalizeIp(req.ip) || '未知';
  }
  return normalizeIp(req.socket?.remoteAddress) || '未知';
}
