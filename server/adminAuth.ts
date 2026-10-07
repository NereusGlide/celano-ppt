import crypto from 'crypto';
import { resolveRuntimeSecret } from './runtimeSecret.js';

/**
 * 后台独立鉴权：HMAC 签名令牌 + 默认管理员常量。
 * 与前台用户体系完全隔离。
 */

export const DEFAULT_ADMIN_USERNAME = 'admin';

/**
 * 纯净版初始管理员口令，仅用于本地启动与演示。
 * 源码仓库是公开的，这个常量等同于「公开口令」：生产环境必须通过环境变量
 * ADMIN_INITIAL_PASSWORD 注入强口令，或在后台首次登录后立即修改。
 * 服务端会在生产模式下检测并告警，见 server.ts 的 assertNotDefaultAdminPassword。
 */
export const DEFAULT_ADMIN_PASSWORD = 'admin123';
const MIN_INITIAL_ADMIN_PASSWORD_LENGTH = 12;

/** 初始口令解析：开发环境允许演示默认值；生产环境缺失或过弱时直接拒绝创建管理员。 */
export function resolveInitialAdminPassword(): string {
  const configured = process.env.ADMIN_INITIAL_PASSWORD?.trim();
  if (process.env.NODE_ENV === 'production') {
    if (!configured || configured.length < MIN_INITIAL_ADMIN_PASSWORD_LENGTH || configured === DEFAULT_ADMIN_PASSWORD) {
      throw new Error('生产环境必须通过 ADMIN_INITIAL_PASSWORD 注入至少 12 位且非公开默认值的初始管理员口令');
    }
    return configured;
  }
  return configured && configured.length >= 8 ? configured : DEFAULT_ADMIN_PASSWORD;
}

// 生产环境应设置 ADMIN_TOKEN_SECRET。此前未配置时直接用进程级随机密钥，
// 结果是每次重启都会让所有已登录管理员掉线（令牌签名全部失效）。
// 改为与前台会话一致的「环境变量 → 持久化密钥文件 → 随机密钥」策略。
const TOKEN_SECRET = resolveRuntimeSecret(
  ['ADMIN_TOKEN_SECRET'],
  { fileEnv: 'ADMIN_TOKEN_KEY_FILE', defaultFile: 'data/admin-token.key' },
);
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12 小时

type AdminCredentialLike = { salt: string; hash: string };

export function credentialFingerprint(credential?: AdminCredentialLike | null): string {
  if (!credential?.salt || !credential.hash) return '';
  return crypto.createHash('sha256').update(credential.salt + ':' + credential.hash).digest('hex');
}

export function signAdminToken(adminId: string, credential?: AdminCredentialLike | null): string {
  const tag = credentialFingerprint(credential);
  const payload = Buffer.from(JSON.stringify({ id: adminId, tag, exp: Date.now() + TOKEN_TTL_MS })).toString('base64url');
  const sig = crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest('base64url');
  return payload + '.' + sig;
}

export function verifyAdminToken(token?: string | null): { id: string; credentialTag: string } | null {
  if (!token || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest('base64url');
  if (sig.length !== expected.length) return null;
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.id || typeof data.tag !== 'string' || !data.tag || !data.exp || data.exp < Date.now()) return null;
    return { id: data.id, credentialTag: data.tag };
  } catch {
    return null;
  }
}

/** 生成随机码：前缀 + 大写字母数字（去掉易混字符） */
export function generateCode(prefix: string, segments = 2, segLen = 4): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const part = () => Array.from({ length: segLen }, () => alphabet[crypto.randomInt(alphabet.length)]).join('');
  const body = Array.from({ length: segments }, part).join('-');
  return prefix ? prefix + '-' + body : body;
}
