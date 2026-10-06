import crypto from 'node:crypto';
import dotenv from 'dotenv';
import { resolveRuntimeSecret } from './runtimeSecret.js';

dotenv.config();

/**
 * 前台用户会话：与 admin token 完全独立的、带过期时间的 HMAC 签名 cookie。
 * 不在 cookie 中保存密码或其它用户资料；密码凭据指纹用于改密后使旧会话失效。
 */
export const USER_SESSION_COOKIE = 'celano_user_session';
export const USER_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type CredentialLike = { salt: string; hash: string };
export interface UserSessionPayload {
  userId: string;
  credentialTag: string;
  expiresAt: number;
}

const SESSION_SECRET = resolveRuntimeSecret(
  ['USER_SESSION_SECRET', 'USER_TOKEN_SECRET'],
  { fileEnv: 'USER_SESSION_KEY_FILE', defaultFile: 'data/user-session.key' },
);

export function credentialFingerprint(credential?: CredentialLike | null): string {
  if (!credential?.salt || !credential.hash) return '';
  return crypto.createHash('sha256').update(credential.salt + ':' + credential.hash).digest('hex');
}

function sign(payload: string): string {
  return crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
}

export function createUserSessionToken(
  userId: string,
  credential?: CredentialLike | null,
  now = Date.now()
): string {
  const body = Buffer.from(JSON.stringify({
    sub: userId,
    tag: credentialFingerprint(credential),
    exp: now + USER_SESSION_TTL_MS
  }), 'utf8').toString('base64url');
  return body + '.' + sign(body);
}

export function verifyUserSessionToken(token?: string | null, now = Date.now()): UserSessionPayload | null {
  if (!token || !token.includes('.')) return null;
  const separator = token.lastIndexOf('.');
  const body = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  if (!body || !signature) return null;
  const expected = sign(body);
  try {
    const actual = Buffer.from(signature, 'base64url');
    const expectedBytes = Buffer.from(expected, 'base64url');
    if (actual.length !== expectedBytes.length || !crypto.timingSafeEqual(actual, expectedBytes)) return null;
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { sub?: unknown; tag?: unknown; exp?: unknown };
    if (typeof parsed.sub !== 'string' || !parsed.sub || typeof parsed.tag !== 'string' || !parsed.tag ||
      typeof parsed.exp !== 'number' || !Number.isFinite(parsed.exp) || parsed.exp <= now) return null;
    return { userId: parsed.sub, credentialTag: parsed.tag, expiresAt: parsed.exp };
  } catch {
    return null;
  }
}

function serializeCookie(value: string, maxAge: number, domain?: string): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  const domainPart = domain ? '; Domain=' + domain : '';
  return USER_SESSION_COOKIE + '=' + encodeURIComponent(value) +
    '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + Math.max(0, Math.floor(maxAge)) + domainPart + secure;
}

/**
 * 从请求 Host 推导 cookie 共享域：让同一根域下的子域（如 www.yamuai.cn 与 yamuai.cn）
 * 共享登录态，避免跨子域跳转后被迫重新登录。
 * 跨根域（如 yamuai.cn 与 ai.celano.cn）属于浏览器安全边界，无法共享。
 * 取最后两段作为根域，对 .cn/.com 等常见后缀有效；对 .com.cn 等复合公共后缀不适用
 * （届时浏览器会拒绝该 Domain 的 cookie，退化为 host-only，不会造成安全问题）。
 */
export function resolveCookieDomain(host?: string | null): string | undefined {
  if (!host) return undefined;
  const h = host.split(':')[0].trim().toLowerCase();
  if (!h || h === 'localhost' || h === '127.0.0.1' || /^\d+(\.\d+){3}$/.test(h)) return undefined;
  const labels = h.split('.');
  if (labels.length < 2) return undefined;
  return labels.slice(-2).join('.');
}

type HeaderResponse = { setHeader(name: string, value: string): unknown };
type CookieRequest = { headers?: { cookie?: string } };

export function setUserSessionCookie(res: HeaderResponse, userId: string, credential?: CredentialLike | null, host?: string | null): void {
  res.setHeader('Set-Cookie', serializeCookie(createUserSessionToken(userId, credential), Math.floor(USER_SESSION_TTL_MS / 1000), resolveCookieDomain(host)));
}

export function clearUserSessionCookie(res: HeaderResponse, host?: string | null): void {
  res.setHeader('Set-Cookie', serializeCookie('', 0, resolveCookieDomain(host)));
}

export function getUserSessionToken(req: CookieRequest): string | null {
  const header = req.headers?.cookie || '';
  for (const item of header.split(';')) {
    const separator = item.indexOf('=');
    if (separator < 0) continue;
    const name = item.slice(0, separator).trim();
    if (name !== USER_SESSION_COOKIE) continue;
    const raw = item.slice(separator + 1).trim();
    try { return decodeURIComponent(raw); } catch { return null; }
  }
  return null;
}

export function getUserSession(req: CookieRequest, now = Date.now()): UserSessionPayload | null {
  return verifyUserSessionToken(getUserSessionToken(req), now);
}
