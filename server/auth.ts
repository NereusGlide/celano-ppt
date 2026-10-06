import crypto from 'crypto';

/**
 * 认证相关的纯逻辑：密码哈希 / 校验、邀请码与账号密码规则。
 * 密码使用 scrypt + 随机盐，绝不明文落盘。
 */

/** 预置演示账号的默认密码（历史数据迁移时补齐用） */
export const DEFAULT_DEMO_PASSWORD = 'celano123';

/** 有效邀请码（按需增删） */
export const VALID_INVITE_CODES = ['CELANO', 'QINGLAN', 'CELANO2026'];

/** 账号规则：3-20 位字母、数字或下划线 */
export const USERNAME_RULE = /^[a-zA-Z0-9_]{3,20}$/;

/** 中国大陆手机号规则 */
export const PHONE_RULE = /^1[3-9]\d{9}$/;

export interface PasswordCredential {
  salt: string;
  hash: string;
}

export function hashPassword(password: string, salt?: string): PasswordCredential {
  const useSalt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, useSalt, 64).toString('hex');
  return { salt: useSalt, hash };
}

export function verifyPassword(password: string, credential?: PasswordCredential | null): boolean {
  if (!credential || !credential.salt || !credential.hash) return false;
  try {
    const candidate = crypto.scryptSync(password, credential.salt, 64);
    const expected = Buffer.from(credential.hash, 'hex');
    if (candidate.length !== expected.length) return false;
    return crypto.timingSafeEqual(candidate, expected);
  } catch {
    return false;
  }
}

export function isValidInviteCode(code: unknown): boolean {
  return VALID_INVITE_CODES.includes(String(code || '').trim().toUpperCase());
}

export function isValidPhone(phone: unknown): boolean {
  return PHONE_RULE.test(String(phone || '').trim());
}
