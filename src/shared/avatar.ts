/**
 * 用户头像解析。
 *
 * 资源：DiceBear「notionists」手绘卡通头像（开源，https://github.com/dicebear/dicebear），
 * 已离线预置在 public/avatars/（24 张 SVG），不依赖第三方接口，内网环境同样可用。
 *
 * 分配规则：以用户名为种子做确定性哈希 → 同一账号永远得到同一头像，
 * 刷新页面、换设备、重新登录都保持一致；若后端已返回 avatar 则优先使用。
 */

const AVATAR_COUNT = 24;

/** FNV-1a 32 位哈希：稳定、无依赖，跨环境取模结果一致。 */
function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** 返回用户的头像地址；未登录或缺少用户名时返回空字符串。 */
export function avatarUrl(user?: { username?: string; avatar?: string } | null): string {
  if (!user) return '';
  if (user.avatar) return user.avatar;
  const seed = user.username?.trim() || 'celano';
  const index = (hashSeed(seed) % AVATAR_COUNT) + 1;
  return `/avatars/avatar-${String(index).padStart(2, '0')}.svg`;
}
