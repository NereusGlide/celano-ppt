import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * 进程级签名密钥的统一解析策略：环境变量 → 持久化密钥文件 → 进程随机密钥。
 *
 * 为什么必须有「持久化文件」这一档：若环境变量缺失就直接用随机密钥，
 * 每次进程重启都会让所有已签发的令牌/会话立刻失效（用户集体掉线、
 * 管理员被迫重新登录）。落盘一次随机密钥后，重启不再影响在线状态。
 * 该文件只保存密钥本身，不写入 store.json，也不会返回给客户端。
 */
export function resolveRuntimeSecret(
  envNames: string[],
  options: { fileEnv?: string; defaultFile: string },
): string {
  for (const name of envNames) {
    const configured = process.env[name];
    if (configured && configured.length > 0) return configured;
  }

  const keyFile = (options.fileEnv && process.env[options.fileEnv]) || path.resolve(process.cwd(), options.defaultFile);
  try {
    fs.mkdirSync(path.dirname(keyFile), { recursive: true });
    try {
      // 'wx' 保证并发启动只有一个进程能创建，其余进程走 EEXIST 读取同一份密钥。
      const fd = fs.openSync(keyFile, 'wx', 0o600);
      const generated = crypto.randomBytes(32).toString('base64url');
      fs.writeFileSync(fd, generated, { encoding: 'utf8' });
      fs.closeSync(fd);
      return generated;
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== 'EEXIST') throw err;
      const existing = fs.readFileSync(keyFile, 'utf8').trim();
      if (existing.length >= 32) return existing;
    }
  } catch {
    // 只读或受限部署环境下回退到进程级随机密钥；不阻止服务器启动。
  }
  return crypto.randomBytes(32).toString('base64url');
}
