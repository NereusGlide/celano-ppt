import express from 'express';
import { db } from './db.js';
import { clearUserSessionCookie, credentialFingerprint, getUserSession } from './userSession.js';
import { forgetUser } from './presence.js';
import type { User } from '../src/types.js';

export interface SessionGuardOptions {
  /**
   * 鉴权通过后的活跃度回调。仅由需要「在线状态」的路由传入；
   * PPT 工作路由此前不刷新活跃时间，为保持行为一致，这里保持可选。
   */
  onActive?: (user: User) => void;
}

/**
 * 前台用户会话鉴权的唯一实现。
 *
 * 此前 server.ts 与 server/ppt/routes.ts 各有一份几乎相同的副本，
 * 任何一处改动（如新增封禁判断）都容易漏掉另一处。收敛到一处后，
 * 行为差异通过 options.onActive 显式表达，而不是靠两份代码各自演化。
 */
export function requireUser(req: express.Request, res: express.Response, options: SessionGuardOptions = {}): User | null {
  const session = getUserSession(req);
  if (!session) {
    res.status(401).json({ success: false, error: '请先登录' });
    return null;
  }
  const user = db.getUserById(session.userId);
  if (!user || user.status === 'disabled') {
    if (user) forgetUser(user.id);
    clearUserSessionCookie(res);
    res.status(403).json({ success: false, error: '账号不存在或已被禁用' });
    return null;
  }
  // 凭据指纹随密码哈希变化：改密后所有旧会话自动失效。
  if (credentialFingerprint(db.getCredentials(user.id)) !== session.credentialTag) {
    forgetUser(user.id);
    clearUserSessionCookie(res);
    res.status(401).json({ success: false, error: '会话已失效，请重新登录' });
    return null;
  }
  options.onActive?.(user);
  return user;
}
