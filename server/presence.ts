/** 用户在线状态跟踪（内存态）：最近 5 分钟内有通过会话鉴权的请求即视为在线。 */
const ONLINE_WINDOW_MS = 5 * 60 * 1000;
/**
 * 跟踪表容量上限。此前 lastSeen 只增不减，任何鉴权过的用户都会永久占一条记录，
 * 长期运行是确定的内存泄漏。超过上限时只清理过期条目——「在线」本就由时间窗定义，
 * 清理过期数据不改变任何对外语义。
 */
const MAX_TRACKED_USERS = 20_000;

const lastSeen = new Map<string, number>();

function pruneStale(now: number): void {
  for (const [id, seenAt] of lastSeen) {
    if (now - seenAt >= ONLINE_WINDOW_MS) lastSeen.delete(id);
  }
}

export function touchUser(userId: string): void {
  const now = Date.now();
  lastSeen.set(userId, now);
  if (lastSeen.size > MAX_TRACKED_USERS) pruneStale(now);
}
export function forgetUser(userId: string): void { lastSeen.delete(userId); }
export function isUserOnline(userId: string, now = Date.now()): boolean {
  const t = lastSeen.get(userId);
  return t !== undefined && now - t < ONLINE_WINDOW_MS;
}
export function onlineUserIds(now = Date.now()): string[] {
  const ids: string[] = [];
  for (const [id, t] of lastSeen) if (now - t < ONLINE_WINDOW_MS) ids.push(id);
  return ids;
}
