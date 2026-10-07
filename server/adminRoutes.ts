import express from 'express';
import { parseMembership } from '../src/shared/membership.js';
import { db } from './db.js';
import { verifyPassword, hashPassword, isValidPhone } from './auth.js';
import { signAdminToken, verifyAdminToken, credentialFingerprint, generateCode } from './adminAuth.js';
import { listThirdPartyModels, testThirdPartyConnection } from './imageProviders.js';
import { testTextModelConnection, mergeTextTestOverride } from './textProviders.js';
import { generateImage } from './ppt/aiClient.js';
import { withImageSlot } from './ppt/imageSlots.js';
import { dataUrlBytes, readImageDimensions } from './ppt/imageDimensions.js';
import { imageSizeFor } from '../src/shared/imageSpecs.js';
import { isUserOnline, onlineUserIds, forgetUser } from './presence.js';
import {
  AdminAccount,
  InviteCode,
  RechargeCode,
  AiProviderConfig,
  ImageResolution,
  MembershipPlanConfig,
  MembershipCode,
  PromptOptimizeModelConfig
} from '../src/types.js';

export const adminRouter = express.Router();

/* =========================================================
   工具
   ========================================================= */

const now = () => Date.now();

function parsePage(query: any) {
  const page = Math.max(1, parseInt(String(query.page || '1'), 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(String(query.pageSize || '10'), 10) || 10));
  return { page, pageSize };
}

function paginate<T>(list: T[], query: any) {
  const { page, pageSize } = parsePage(query);
  const total = list.length;
  const start = (page - 1) * pageSize;
  return { list: list.slice(start, start + pageSize), total, page, pageSize };
}

function recordUsage(userId: string, username: string, type: any, detail: string, credits = 0) {
  try {
    db.addUsageRecord({
      id: 'use_' + now() + '_' + Math.random().toString(36).slice(2, 7),
      userId,
      username,
      type,
      detail,
      credits,
      createdAt: now()
    });
  } catch (e) {
    console.error('[admin] 写入使用记录失败:', e);
  }
}

/* =========================================================
   鉴权中间件
   ========================================================= */

/**
 * 管理端会话 Cookie。
 *
 * 为什么不再用 localStorage 存令牌：localStorage 可被任意 JavaScript 读取，
 * 一旦出现 XSS，管理端令牌（权限高于普通用户）会被直接窃取。
 * 改为 HttpOnly Cookie 后，脚本无法读取，风险面显著收窄。
 *
 * 兼容策略：仍接受 Authorization: Bearer，便于灰度切换与运维脚本调用。
 */
const ADMIN_COOKIE = 'celano_admin_session';
const ADMIN_COOKIE_MAX_AGE = 60 * 60 * 8; // 8 小时

function serializeAdminCookie(value: string, maxAge: number): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${ADMIN_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.max(0, Math.floor(maxAge))}${secure}`;
}

function readAdminCookie(req: express.Request): string {
  const raw = String(req.headers.cookie || '');
  for (const part of raw.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() !== ADMIN_COOKIE) continue;
    try { return decodeURIComponent(part.slice(index + 1).trim()); } catch { return ''; }
  }
  return '';
}

function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  const header = String(req.headers.authorization || '');
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
  const token = bearer || readAdminCookie(req);
  const payload = verifyAdminToken(token);
  if (!payload) {
    return res.status(401).json({ success: false, error: '登录已失效，请重新登录' });
  }
  const admin = db.getAdminById(payload.id);
  if (!admin || admin.status !== 'active') {
    return res.status(401).json({ success: false, error: '管理员账号不可用' });
  }
  if (admin.role !== 'super' && admin.role !== 'operator') {
    return res.status(403).json({ success: false, error: '管理员权限不足' });
  }
  if (payload.credentialTag !== credentialFingerprint(db.getCredentials(admin.id))) {
    return res.status(401).json({ success: false, error: '会话已失效，请重新登录' });
  }
  const selfService = req.path === '/auth/password' || req.path === '/auth/logout';
  if (admin.role !== 'super' && !['GET', 'HEAD'].includes(req.method) && !selfService) {
    return res.status(403).json({ success: false, error: '此操作需要超级管理员权限' });
  }
  (req as any).admin = admin;
  next();
}

/* =========================================================
   登录 / 资料
   ========================================================= */

const unknownAdminCredential = hashPassword('invalid-admin-login-placeholder');

function maskedConfig<T extends { apiKey?: string }>(config: T) {
  return { ...config, apiKey: '', hasApiKey: !!config.apiKey };
}

function maskedAiConfig(config: AiProviderConfig) {
  const safe = maskedConfig(config);
  if (config.resolutionConfigs) {
    safe.resolutionConfigs = Object.fromEntries(Object.entries(config.resolutionConfigs).map(([resolution, tier]) => [resolution, tier ? maskedConfig(tier) : tier]));
  }
  return safe;
}

adminRouter.post('/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ success: false, error: '请输入管理员账号与密码' });
  }
  const admin = db.getAdminByUsername(String(username));
  const passwordValid = verifyPassword(String(password), admin ? db.getCredentials(admin.id) : unknownAdminCredential);
  if (!admin || !passwordValid) {
    return res.status(401).json({ success: false, error: '账号或密码错误' });
  }
  if (admin.status !== 'active') {
    return res.status(403).json({ success: false, error: '该管理员账号已被禁用' });
  }
  const updated = db.updateAdmin(admin.id, { lastLoginAt: now() }) || admin;
  const credential = db.getCredentials(admin.id);
  const token = signAdminToken(admin.id, credential);
  res.setHeader('Set-Cookie', serializeAdminCookie(token, ADMIN_COOKIE_MAX_AGE));
  res.json({ success: true, token, admin: updated });
});

adminRouter.get('/auth/profile', requireAdmin, (req, res) => {
  res.json({ success: true, admin: (req as any).admin });
});

adminRouter.post('/auth/logout', requireAdmin, (_req, res) => {
  res.setHeader('Set-Cookie', serializeAdminCookie('', 0));
  res.json({ success: true });
});

adminRouter.post('/auth/password', requireAdmin, (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  const admin: AdminAccount = (req as any).admin;
  if (!verifyPassword(String(oldPassword || ''), db.getCredentials(admin.id))) {
    return res.status(400).json({ success: false, error: '原密码不正确' });
  }
  if (String(newPassword || '').length < 6) {
    return res.status(400).json({ success: false, error: '新密码至少 6 位' });
  }
  const credential = hashPassword(String(newPassword));
  db.setCredentials(admin.id, credential);
  const token = signAdminToken(admin.id, credential);
  res.setHeader('Set-Cookie', serializeAdminCookie(token, ADMIN_COOKIE_MAX_AGE));
  res.json({ success: true, token });
});

/* =========================================================
   概览统计
   ========================================================= */

adminRouter.get('/stats', requireAdmin, (_req, res) => {
  const users = db.getUsers();
  const startOfToday = new Date(new Date().setHours(0, 0, 0, 0)).getTime();
  const usage = db.getUsageRecords();
  const invites = db.getInviteCodes();
  const recharges = db.getRechargeCodes();
  const aiConfigs = db.getAiConfigs();
  const jobs = db.getJobs();

  res.json({
    success: true,
    stats: {
      users: {
        total: users.length,
        active: users.filter(u => (u.status || 'active') === 'active').length,
        disabled: users.filter(u => u.status === 'disabled').length,
        newToday: users.filter(u => u.createdAt >= startOfToday).length,
        online: onlineUserIds().length
      },
      presentations: db.getPresentations().length,
      usage: {
        total: usage.length,
        today: usage.filter(r => r.createdAt >= startOfToday).length,
        credits: usage.filter(r => r.credits < 0).reduce((sum, r) => sum - r.credits, 0)
      },
      inviteCodes: {
        total: invites.length,
        active: invites.filter(i => i.status === 'active').length,
        usedCount: invites.reduce((sum, i) => sum + i.usedCount, 0)
      },
      rechargeCodes: {
        total: recharges.length,
        unused: recharges.filter(r => r.status === 'unused').length,
        used: recharges.filter(r => r.status === 'used').length,
        creditsIssued: recharges.reduce((sum, r) => sum + r.credits, 0),
        creditsUsed: recharges.filter(r => r.status === 'used').reduce((sum, r) => sum + r.credits, 0)
      },
      aiConfigs: {
        total: aiConfigs.length,
        enabled: aiConfigs.filter(c => c.enabled).length
      },
      jobs: {
        total: jobs.length,
        completed: jobs.filter(j => j.status === 'completed').length,
        failed: jobs.filter(j => j.status === 'failed').length,
        running: jobs.filter(j => j.status === 'pending' || j.status === 'processing').length
      }
    }
  });
});

/* =========================================================
   用户注册管理
   ========================================================= */

adminRouter.get('/users', requireAdmin, (req, res) => {
  const { keyword = '', status = '', online = '' } = req.query as any;
  const kw = String(keyword).trim().toLowerCase();

  let list = db.getUsers().slice().sort((a, b) => b.createdAt - a.createdAt);
  if (kw) {
    list = list.filter(u =>
      u.username.toLowerCase().includes(kw) ||
      u.name.toLowerCase().includes(kw) ||
      (u.phone || '').includes(kw) ||
      (u.email || '').toLowerCase().includes(kw)
    );
  }
  if (status) {
    list = list.filter(u => (u.status || 'active') === status);
  }
  if (online === 'online' || online === 'offline') {
    list = list.filter(u => (isUserOnline(u.id) ? 'online' : 'offline') === online);
  }

  const page = paginate(list, req.query);
  res.json({
    success: true,
    total: page.total,
    page: page.page,
    pageSize: page.pageSize,
    users: page.list.map(u => ({
      ...u,
      online: isUserOnline(u.id),
      presentationCount: db.getPresentations(u.id).length,
      hasPassword: !!db.getCredentials(u.id)
    }))
  });
});

adminRouter.patch('/users/:id', requireAdmin, (req, res) => {
  const body = req.body || {};
  const updates: any = {};
  const existing = db.getUserById(req.params.id);
  if (!existing) return res.status(404).json({ success: false, error: '用户不存在' });
  // 会员从「非有效」变为「有效」视为一次开通：自动赠送套餐对应月点数
  let membershipGrant = 0;
  let grantPlanName = '';
  if (body.membership !== undefined) {
    try { updates.membership = parseMembership(body.membership); }
    catch (error) { return res.status(400).json({ success: false, error: (error as Error).message }); }
    const wasActive = existing.membership?.status === 'active' && Number(existing.membership.expiresAt) > Date.now();
    const isActive = updates.membership?.status === 'active';
    if (isActive && !wasActive && updates.membership?.planId) {
      // 开通即首月到账，并记录发放时间作为后续每月到账的周期起点
      updates.membership = { ...updates.membership, lastGrantAt: Date.now() };
      const plan = db.getMembershipPlans().find(p => p.id === updates.membership.planId);
      if (plan && plan.points > 0) { membershipGrant = plan.points; grantPlanName = plan.name; }
    } else if (isActive && existing.membership?.status === 'active' && existing.membership.planId === updates.membership?.planId && existing.membership.lastGrantAt && !updates.membership.lastGrantAt) {
      // 同套餐续费或改到期时间：保留已发放时间，不重置每月到账周期
      updates.membership = { ...updates.membership, lastGrantAt: existing.membership.lastGrantAt };
    }
  }
  if (body.status === 'active' || body.status === 'disabled') {
    updates.status = body.status;
    if (body.status === 'disabled') forgetUser(req.params.id);
  }
  if (body.role === 'admin' || body.role === 'creator' || body.role === 'member') updates.role = body.role;
  if (typeof body.credits === 'number' && body.credits >= 0) updates.credits = Math.floor(body.credits);
  if (membershipGrant > 0) updates.credits = (updates.credits ?? existing.credits ?? 0) + membershipGrant;
  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 30) {
      return res.status(400).json({ success: false, error: '昵称需为 1-30 个字符' });
    }
    updates.name = body.name.trim();
  }
  if (body.phone !== undefined) {
    const phone = String(body.phone).trim();
    if (phone && !isValidPhone(phone)) {
      return res.status(400).json({ success: false, error: '手机号格式不正确' });
    }
    const other = db.getUsers().find(u => u.id !== req.params.id && u.phone === phone);
    if (other) return res.status(409).json({ success: false, error: '该手机号已被其他账号使用' });
    updates.phone = phone;
  }

  const updated = db.updateUser(req.params.id, updates);
  if (!updated) return res.status(404).json({ success: false, error: '用户不存在' });
  if (membershipGrant > 0) {
    recordUsage(req.params.id, updated.username, 'membership_grant', '会员开通「' + grantPlanName + '」赠送 ' + membershipGrant + ' 点', membershipGrant);
  }
  res.json({ success: true, user: { ...updated, online: isUserOnline(updated.id) } });
});

// 管理员重置用户密码（改密后该用户所有旧会话自动失效）
adminRouter.post('/users/:id/password', requireAdmin, (req, res) => {
  const user = db.getUserById(req.params.id);
  if (!user) return res.status(404).json({ success: false, error: '用户不存在' });
  const pwd = String((req.body || {}).newPassword || '');
  if (pwd.length < 6 || pwd.length > 128) {
    return res.status(400).json({ success: false, error: '新密码长度需为 6-128 位' });
  }
  db.setCredentials(user.id, hashPassword(pwd));
  forgetUser(user.id);
  res.json({ success: true });
});

// 封禁 / 解封
adminRouter.post('/users/:id/ban', requireAdmin, (req, res) => {
  const updated = db.updateUser(req.params.id, { status: 'disabled' });
  if (!updated) return res.status(404).json({ success: false, error: '用户不存在' });
  forgetUser(req.params.id);
  res.json({ success: true, user: { ...updated, online: false } });
});
adminRouter.post('/users/:id/unban', requireAdmin, (req, res) => {
  const updated = db.updateUser(req.params.id, { status: 'active' });
  if (!updated) return res.status(404).json({ success: false, error: '用户不存在' });
  res.json({ success: true, user: { ...updated, online: isUserOnline(updated.id) } });
});

adminRouter.delete('/users/:id', requireAdmin, (req, res) => {
  const ok = db.deleteUser(req.params.id);
  if (!ok) return res.status(404).json({ success: false, error: '用户不存在' });
  res.json({ success: true });
});

/* =========================================================
   使用记录管理
   ========================================================= */

/**
 * 使用记录里的用户快照只是写入当时的副本；这里附上用户表的当前资料，
 * 让后台展示的「使用者」始终是真实的、最新的（改名或换头像后不再失真）。
 * 账号已被删除时返回 null，由前端明确标注，而不是继续显示一个查不到的快照。
 */
function usageUserBrief(userId: string) {
  const user = db.getUserById(userId);
  if (!user) return null;
  return { id: user.id, username: user.username, name: user.name || '', phone: user.phone || '', avatar: user.avatar || '' };
}

/** 码类列表「使用者」按 userId 关联用户表当前资料；查不到（含账号已删除）返回 null。 */
function codeUserBrief(userId?: string | null) {
  if (!userId) return null;
  const user = db.getUserById(userId);
  if (!user) return null;
  return { id: user.id, username: user.username, name: user.name || '', phone: user.phone || '' };
}

adminRouter.get('/usage-records', requireAdmin, (req, res) => {
  const { keyword = '', type = '' } = req.query as any;
  const kw = String(keyword).trim().toLowerCase();

  let list = db.getUsageRecords().slice();
  if (kw) {
    // 支持按用户名、详情与客户端 IP 检索
    list = list.filter(r =>
      String(r.username || '').toLowerCase().includes(kw) ||
      String(r.detail || '').toLowerCase().includes(kw) ||
      String(r.ip || '').toLowerCase().includes(kw)
    );
  }
  if (type) {
    list = list.filter(r => r.type === type);
  }

  const page = paginate(list, req.query);
  res.json({
    success: true,
    total: page.total,
    page: page.page,
    pageSize: page.pageSize,
    records: page.list.map(record => ({ ...record, user: usageUserBrief(record.userId) }))
  });
});

adminRouter.delete('/usage-records/:id', requireAdmin, (req, res) => {
  // 此前直接对 db.getUsageRecords() 返回的数组 splice：它改的是内存里的状态，
  // 但没有落盘，进程重启后被删的记录会「复活」。必须走会持久化的仓储方法。
  const ok = db.deleteUsageRecord(req.params.id);
  if (!ok) return res.status(404).json({ success: false, error: '记录不存在' });
  res.json({ success: true });
});

/* =========================================================
   邀请码管理
   ========================================================= */

adminRouter.get('/invite-codes', requireAdmin, (req, res) => {
  const { keyword = '', status = '' } = req.query as any;
  const kw = String(keyword).trim().toUpperCase();

  let list = db.getInviteCodes().slice().sort((a, b) => b.createdAt - a.createdAt);
  if (kw) list = list.filter(i => i.code.includes(kw) || (i.note || '').includes(String(keyword)));
  if (status) list = list.filter(i => i.status === status);

  const page = paginate(list, req.query);
  res.json({ success: true, total: page.total, page: page.page, pageSize: page.pageSize, inviteCodes: page.list.map(c => ({ ...c, usedByUsers: (c.usedBy || []).map(codeUserBrief).filter(Boolean) })) });
});

adminRouter.post('/invite-codes', requireAdmin, (req, res) => {
  const { count = 1, prefix = 'INV', maxUses = 1, expiresAt, note = '' } = req.body || {};
  const n = Math.min(50, Math.max(1, parseInt(String(count), 10) || 1));
  const created: InviteCode[] = [];
  const existing = new Set(db.getInviteCodes().map(i => i.code.toUpperCase()));

  for (let i = 0; i < n; i++) {
    let code = generateCode(String(prefix || '').toUpperCase(), 2, 4);
    while (existing.has(code.toUpperCase())) code = generateCode(String(prefix || '').toUpperCase(), 2, 4);
    existing.add(code.toUpperCase());
    created.push({
      code,
      maxUses: Math.max(0, parseInt(String(maxUses), 10) || 0),
      usedCount: 0,
      usedBy: [],
      status: 'active',
      note: String(note || ''),
      createdAt: now(),
      expiresAt: expiresAt ? Number(expiresAt) : undefined
    });
  }

  // 批量创建走一次落盘：逐个 createInviteCode 会让「生成 50 个码」触发 50 次全量写盘。
  db.createInviteCodes(created);
  res.json({ success: true, created });
});

adminRouter.patch('/invite-codes/:code', requireAdmin, (req, res) => {
  const { status, maxUses, note, expiresAt } = req.body || {};
  const updates: Partial<InviteCode> = {};
  if (status === 'active' || status === 'disabled') updates.status = status;
  if (typeof maxUses === 'number' && maxUses >= 0) updates.maxUses = Math.floor(maxUses);
  if (typeof note === 'string') updates.note = note;
  if (expiresAt === null) updates.expiresAt = undefined;
  else if (expiresAt !== undefined) updates.expiresAt = Number(expiresAt);

  const updated = db.updateInviteCode(req.params.code, updates);
  if (!updated) return res.status(404).json({ success: false, error: '邀请码不存在' });
  res.json({ success: true, inviteCode: updated });
});

adminRouter.delete('/invite-codes/:code', requireAdmin, (req, res) => {
  const ok = db.deleteInviteCode(req.params.code);
  if (!ok) return res.status(404).json({ success: false, error: '邀请码不存在' });
  res.json({ success: true });
});

/* =========================================================
   充值码管理
   ========================================================= */

adminRouter.get('/recharge-codes', requireAdmin, (req, res) => {
  const { keyword = '', status = '' } = req.query as any;
  const kw = String(keyword).trim().toUpperCase();

  let list = db.getRechargeCodes().slice().sort((a, b) => b.createdAt - a.createdAt);
  if (kw) list = list.filter(c => c.code.includes(kw) || (c.note || '').includes(String(keyword)));
  if (status) list = list.filter(c => c.status === status);

  const page = paginate(list, req.query);
  res.json({ success: true, total: page.total, page: page.page, pageSize: page.pageSize, rechargeCodes: page.list.map(c => ({ ...c, usedByUser: codeUserBrief(c.usedBy) })) });
});

adminRouter.post('/recharge-codes', requireAdmin, (req, res) => {
  const { count = 1, credits = 100, prefix = 'RC', note = '' } = req.body || {};
  const n = Math.min(100, Math.max(1, parseInt(String(count), 10) || 1));
  const value = Math.max(1, parseInt(String(credits), 10) || 100);
  const created: RechargeCode[] = [];
  const existing = new Set(db.getRechargeCodes().map(c => c.code.toUpperCase()));

  for (let i = 0; i < n; i++) {
    let code = generateCode(String(prefix || '').toUpperCase(), 3, 4);
    while (existing.has(code.toUpperCase())) code = generateCode(String(prefix || '').toUpperCase(), 3, 4);
    existing.add(code.toUpperCase());
    created.push({
      code,
      credits: value,
      status: 'unused',
      note: String(note || ''),
      createdAt: now()
    });
  }

  db.createRechargeCodes(created);
  res.json({ success: true, created });
});

adminRouter.patch('/recharge-codes/:code', requireAdmin, (req, res) => {
  const { status, credits, note } = req.body || {};
  const updates: Partial<RechargeCode> = {};
  if (status === 'unused' || status === 'used' || status === 'disabled') updates.status = status;
  if (typeof credits === 'number' && credits > 0) updates.credits = Math.floor(credits);
  if (typeof note === 'string') updates.note = note;

  const updated = db.updateRechargeCode(req.params.code, updates);
  if (!updated) return res.status(404).json({ success: false, error: '充值码不存在' });
  res.json({ success: true, rechargeCode: updated });
});

adminRouter.delete('/recharge-codes/:code', requireAdmin, (req, res) => {
  const ok = db.deleteRechargeCode(req.params.code);
  if (!ok) return res.status(404).json({ success: false, error: '充值码不存在' });
  res.json({ success: true });
});

/* =========================================================
   会员兑换码管理
   ========================================================= */

adminRouter.get('/membership-codes', requireAdmin, (req, res) => {
  const { keyword = '', status = '' } = req.query as any;
  const kw = String(keyword).trim().toUpperCase();

  let list = db.getMembershipCodes().slice().sort((a, b) => b.createdAt - a.createdAt);
  if (kw) list = list.filter(c => c.code.includes(kw) || (c.note || '').includes(String(keyword)));
  if (status) list = list.filter(c => c.status === status);

  const page = paginate(list, req.query);
  res.json({ success: true, total: page.total, page: page.page, pageSize: page.pageSize, membershipCodes: page.list.map(c => ({ ...c, usedByUser: codeUserBrief(c.usedBy) })) });
});

adminRouter.post('/membership-codes', requireAdmin, (req, res) => {
  const { count = 1, planId = '', months = 1, prefix = 'MC', note = '' } = req.body || {};
  const n = Math.min(100, Math.max(1, parseInt(String(count), 10) || 1));
  const m = Math.min(36, Math.max(1, parseInt(String(months), 10) || 1));
  const plan = db.getMembershipPlans().find(p => p.id === String(planId));
  if (!plan) return res.status(400).json({ success: false, error: '请选择有效的会员套餐' });
  const created: MembershipCode[] = [];
  const existing = new Set(db.getMembershipCodes().map(c => c.code.toUpperCase()));

  for (let i = 0; i < n; i++) {
    let code = generateCode(String(prefix || '').toUpperCase(), 3, 4);
    while (existing.has(code.toUpperCase())) code = generateCode(String(prefix || '').toUpperCase(), 3, 4);
    existing.add(code.toUpperCase());
    created.push({ code, planId: plan.id, months: m, status: 'unused', note: String(note || ''), createdAt: now() });
  }

  db.createMembershipCodes(created);
  res.json({ success: true, created });
});

adminRouter.delete('/membership-codes/:code', requireAdmin, (req, res) => {
  const ok = db.deleteMembershipCode(req.params.code);
  if (!ok) return res.status(404).json({ success: false, error: '会员兑换码不存在' });
  res.json({ success: true });
});

/* =========================================================
   内容规划模型配置（仅管理端可见，前台不可见）
   ========================================================= */

adminRouter.get('/planning-config', requireAdmin, (_req, res) => {
  res.json({ success: true, planningConfig: maskedConfig(db.getPlanningConfig()) });
});

adminRouter.put('/planning-config', requireAdmin, (req, res) => {
  const { baseUrl, apiKey, modelName, reasoningEffort, optimizeReasoningEffort, visionModelName } = req.body || {};
  const updates: any = {};
  if (typeof baseUrl === 'string' && baseUrl.trim()) updates.baseUrl = baseUrl.trim();
  if (typeof apiKey === 'string' && apiKey.trim()) updates.apiKey = apiKey.trim();
  if (typeof modelName === 'string' && modelName.trim()) updates.modelName = modelName.trim();
  if (typeof reasoningEffort === 'string' && reasoningEffort.trim()) updates.reasoningEffort = reasoningEffort.trim();
  if (typeof optimizeReasoningEffort === 'string' && optimizeReasoningEffort.trim()) updates.optimizeReasoningEffort = optimizeReasoningEffort.trim();
  // 视觉模型允许清空（清空即回退 OCR）
  if (typeof visionModelName === 'string') updates.visionModelName = visionModelName.trim();
  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ success: false, error: '没有可更新的配置项' });
  }
  const saved = db.updatePlanningConfig(updates);
  res.json({ success: true, planningConfig: maskedConfig(saved) });
});

/** 内容规划模型的真实连通性测试：真的发一次最小对话请求，而不是只读模型列表。 */
adminRouter.post('/planning-config/test', requireAdmin, async (req, res) => {
  const saved = db.getPlanningConfig();
  const config = mergeTextTestOverride({
    baseUrl: saved.baseUrl,
    apiKey: saved.apiKey,
    modelName: saved.modelName,
    reasoningEffort: saved.reasoningEffort
  }, req.body);
  const result = await testTextModelConnection(config, '内容规划模型');
  res.json(testPayload(result, { channel: 'planning' }));
});

/* =========================================================
   提示词优化模型配置（独立通道；未启用时回退内容规划模型）
   ---------------------------------------------------------
   提示词优化是比整篇规划轻得多的文本调用，常需更快/更便宜的通道，
   因此单独配置。前端三处优化入口（PPT 页、旧版首页、画布）统一读这份配置。
   ========================================================= */

adminRouter.get('/prompt-optimize-config', requireAdmin, (_req, res) => {
  res.json({ success: true, promptOptimizeConfig: maskedConfig(db.getPromptOptimizeConfig()) });
});

adminRouter.put('/prompt-optimize-config', requireAdmin, (req, res) => {
  const { enabled, baseUrl, apiKey, modelName, reasoningEffort, temperature, maxOutputTokens, systemPrompt } = req.body || {};
  const updates: Partial<PromptOptimizeModelConfig> = {};
  if (typeof enabled === 'boolean') updates.enabled = enabled;
  // 接口地址与模型允许清空：清空即视为未配置，自动回退内容规划模型
  if (typeof baseUrl === 'string') updates.baseUrl = baseUrl.trim().slice(0, 500);
  // 密钥留空表示保持原密钥（避免管理端展示后误清空）
  if (typeof apiKey === 'string' && apiKey.trim()) updates.apiKey = apiKey.trim().slice(0, 500);
  if (typeof modelName === 'string') updates.modelName = modelName.trim().slice(0, 200);
  if (typeof reasoningEffort === 'string') updates.reasoningEffort = reasoningEffort.trim().slice(0, 20);
  if (typeof temperature === 'string') {
    const text = temperature.trim();
    if (text && (!Number.isFinite(Number(text)) || Number(text) < 0 || Number(text) > 2)) {
      return res.status(400).json({ success: false, error: '采样温度需为 0–2 之间的数字，留空表示使用上游默认' });
    }
    updates.temperature = text;
  }
  if (typeof maxOutputTokens === 'string') {
    const text = maxOutputTokens.trim();
    if (text && (!Number.isSafeInteger(Number(text)) || Number(text) <= 0)) {
      return res.status(400).json({ success: false, error: '最大输出 token 需为正整数，留空表示使用上游默认' });
    }
    updates.maxOutputTokens = text;
  }
  if (typeof systemPrompt === 'string') updates.systemPrompt = systemPrompt.slice(0, 2000);
  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ success: false, error: '没有可更新的配置项' });
  }
  // 启用独立通道时三项连接信息必须齐备，否则解析阶段会静默回退，管理员会误以为已生效
  if (updates.enabled === true) {
    const merged = { ...db.getPromptOptimizeConfig(), ...updates };
    if (!String(merged.baseUrl || '').trim() || !String(merged.apiKey || '').trim() || !String(merged.modelName || '').trim()) {
      return res.status(400).json({ success: false, error: '启用独立通道前，请先填写接口地址、API Key 与真实模型 ID' });
    }
  }
  const saved = db.updatePromptOptimizeConfig(updates);
  res.json({ success: true, promptOptimizeConfig: maskedConfig(saved) });
});

/**
 * 提示词优化模型的真实连通性测试。
 *
 * 走 resolvePromptOptimizeConfig()，因此测的就是正式调用实际会用的通道：
 * enabled 且填齐时是独立配置，否则是回退后的内容规划模型 —— 返回值里的
 * channel 会把这一点告诉管理员，避免「以为在测独立通道，其实测的是回退」。
 */
adminRouter.post('/prompt-optimize-config/test', requireAdmin, async (req, res) => {
  const resolved = db.resolvePromptOptimizeConfig();
  const config = mergeTextTestOverride({
    baseUrl: resolved.baseUrl,
    apiKey: resolved.apiKey,
    modelName: resolved.modelName,
    reasoningEffort: resolved.reasoningEffort,
    temperature: resolved.temperature,
    maxOutputTokens: resolved.maxOutputTokens
  }, req.body);
  const result = await testTextModelConnection(config, '提示词优化模型');
  res.json(testPayload(result, { channel: resolved.source }));
});

/* =========================================================
   会员套餐目录管理
   ========================================================= */

/** 校验整套会员套餐目录；返回归一化后的数组，非法时抛错。 */
function normalizeMembershipPlans(value: unknown): MembershipPlanConfig[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 50) throw new Error('会员套餐需为 1-50 项');
  const seen = new Set<string>();
  return value.map((item, index) => {
    if (!item || typeof item !== 'object') throw new Error(`第 ${index + 1} 项套餐格式无效`);
    const plan = item as Record<string, unknown>;
    const id = String(plan.id || '').trim();
    if (!/^[a-zA-Z0-9_-]{1,40}$/.test(id)) throw new Error(`第 ${index + 1} 项套餐 ID 需为 1-40 位字母数字或 -_`);
    if (seen.has(id)) throw new Error(`套餐 ID「${id}」重复`);
    seen.add(id);
    const name = String(plan.name || '').trim();
    if (!name || name.length > 30) throw new Error(`第 ${index + 1} 项套餐名称需为 1-30 个字符`);
    const points = Number(plan.points);
    if (!Number.isSafeInteger(points) || points < 0) throw new Error(`第 ${index + 1} 项套餐点数需为非负整数`);
    const renewalPrice = Number(plan.renewalPrice);
    if (!Number.isFinite(renewalPrice) || renewalPrice < 0) throw new Error(`第 ${index + 1} 项套餐续费价需为非负数`);
    const benefits = Array.isArray(plan.benefits) ? plan.benefits.filter((b): b is string => typeof b === 'string' && !!b.trim()).map(b => b.trim().slice(0, 80)).slice(0, 12) : [];
    // 画质折扣：落在 1..零售价 区间（2K=10、4K=20），非法值回退到默认值。
    const discount2k = Math.max(1, Math.min(10, Math.floor(Number(plan.discount2k) || 10)));
    const discount4k = Math.max(1, Math.min(20, Math.floor(Number(plan.discount4k) || 20)));
    return {
      id,
      name,
      price: String(plan.price || '').trim().slice(0, 20),
      renewalPrice,
      points,
      note: String(plan.note || '').trim().slice(0, 80),
      accent: String(plan.accent || 'slate').trim().slice(0, 20),
      recommended: plan.recommended === true,
      benefits,
      enabled: plan.enabled !== false,
      discount2k,
      discount4k,
    };
  });
}

adminRouter.get('/membership-plans', requireAdmin, (_req, res) => {
  res.json({ success: true, membershipPlans: db.getMembershipPlans() });
});

adminRouter.put('/membership-plans', requireAdmin, (req, res) => {
  try {
    const plans = normalizeMembershipPlans(req.body?.membershipPlans ?? req.body);
    res.json({ success: true, membershipPlans: db.setMembershipPlans(plans) });
  } catch (error) {
    res.status(400).json({ success: false, error: (error as Error).message });
  }
});

/* =========================================================
   AI 接口配置管理
   ========================================================= */

adminRouter.get('/ai-configs', requireAdmin, (_req, res) => {
  const list = db.getAiConfigs().slice().sort((a, b) => b.updatedAt - a.updatedAt);
  res.json({ success: true, aiConfigs: list.map(maskedAiConfig) });
});

const IMAGE_RESOLUTIONS: ImageResolution[] = ['2K', '4K'];
function validImageResolution(value: unknown): ImageResolution | null {
  const normalized = String(value || '').toUpperCase();
  return IMAGE_RESOLUTIONS.includes(normalized as ImageResolution) ? normalized as ImageResolution : null;
}
function publicImageConfig(config: AiProviderConfig | undefined, resolution: ImageResolution) {
  return {
    id: config?.id || '', resolution,
    name: config?.name || '', displayName: config?.displayName || config?.name || '',
    provider: config?.provider || 'custom', baseUrl: config?.baseUrl || '',
    modelName: config?.modelName || '', enabled: config?.enabled !== false,
    isDefault: !!config?.isDefault, remark: config?.remark || '',
    hasApiKey: !!config?.apiKey, ready: !!config && config.enabled !== false && !!config.baseUrl && !!config.apiKey && !!config.modelName,
    updatedAt: config?.updatedAt || 0
  };
}

/** Purpose-built image settings API: one explicit slot per native resolution. */
adminRouter.get('/image-configs', requireAdmin, (_req, res) => {
  const configs = db.getAiConfigs();
  const slots = IMAGE_RESOLUTIONS.map(resolution => publicImageConfig(configs.find(item => item.resolution === resolution), resolution));
  res.json({ success: true, slots });
});

adminRouter.put('/image-configs/:resolution', requireAdmin, (req, res) => {
  const resolution = validImageResolution(req.params.resolution);
  if (!resolution) return res.status(400).json({ success: false, error: '画质档位只能是 2K 或 4K' });
  const body = req.body || {};
  const displayName = String(body.displayName ?? body.name ?? '').trim();
  const baseUrl = String(body.baseUrl ?? '').trim();
  const modelName = String(body.modelName ?? '').trim();
  if (!displayName) return res.status(400).json({ success: false, error: '请填写前端展示名称' });
  if (!baseUrl) return res.status(400).json({ success: false, error: '请填写接口地址' });
  if (!modelName) return res.status(400).json({ success: false, error: '请填写真实模型 ID' });
  const existing = db.getAiConfigs().find(item => item.resolution === resolution);
  const updates: Partial<AiProviderConfig> = {
    name: displayName, displayName, provider: body.provider || existing?.provider || 'custom',
    baseUrl, modelName, resolution, resolutionSupport: [resolution],
    enabled: body.enabled !== false, isDefault: false, remark: String(body.remark || '')
  };
  // An empty key in an edit means “keep the existing secret”, so masked forms are safe.
  if (typeof body.apiKey === 'string' && body.apiKey.trim()) updates.apiKey = body.apiKey.trim();
  else if (!existing?.apiKey) updates.apiKey = '';
  const saved = existing ? db.updateAiConfig(existing.id, updates) : (() => {
    const nowMs = now();
    const item: AiProviderConfig = { id: 'image_' + resolution.toLowerCase() + '_' + nowMs, apiKey: updates.apiKey || '', createdAt: nowMs, updatedAt: nowMs, ...updates } as AiProviderConfig;
    db.createAiConfig(item); return item;
  })();
  res.json({ success: true, slot: publicImageConfig(saved || undefined, resolution) });
});

/**
 * 真实出图测试用的极小提示词：只验证「接口能按该档位出图且尺寸合规」，
 * 不追求画面质量，尽量压低单次测试成本。
 */
const TEST_IMAGE_PROMPT = '连通性测试用图：纯色背景，画面中央一个圆点，不要文字。';

/**
 * 测试类接口统一在 HTTP 200 上返回 success 标记（请求本身执行成功了，
 * 只是对上游的结论可能是否定的）。但前端的 request() 会把 success:false
 * 抛成 AdminApiError 并且只取 error 字段，若不同时写入 error，管理员
 * 看到的会是无意义的「请求失败」而不是真实原因。
 */
function testPayload(result: { success: boolean; message: string }, extra: Record<string, unknown> = {}) {
  return { ...result, ...extra, error: result.success ? undefined : result.message };
}

adminRouter.post('/image-configs/:resolution/test', requireAdmin, async (req, res) => {
  const resolution = validImageResolution(req.params.resolution);
  if (!resolution) return res.status(400).json({ success: false, error: '画质档位只能是 2K 或 4K' });
  const mode = req.body?.mode === 'image' ? 'image' : 'connection';
  const config = db.getAiConfigs().find(item => item.resolution === resolution);
  if (!config) return res.status(404).json({ success: false, error: resolution + ' 尚未配置' });

  // 真实出图测试：真的生成一张图并校验尺寸。
  // 「模型列表可连通」不等于「渠道真的能出图」——渠道停用、额度耗尽、
  // 上游尺寸策略变化都只有走到出图这一步才暴露。
  if (mode === 'image') {
    const provider = db.resolveImageConfig(resolution);
    const size = imageSizeFor(resolution);
    if (!provider.baseUrl || !provider.apiKey || !provider.modelName) {
      return res.status(400).json({ success: false, error: resolution + ' 未配置可用的接口地址、密钥与模型' });
    }
    const started = Date.now();
    try {
      const dataUrl = await withImageSlot(() => generateImage(provider, TEST_IMAGE_PROMPT, size, undefined, 300_000));
      const buffer = dataUrlBytes(dataUrl);
      // 报告上游实际返回的像素，而不是假定值 —— 这正是「真实出图」相对
      // 只读模型列表的价值所在（尺寸策略变化会在这里暴露）。
      const actual = readImageDimensions(buffer);
      const [wantW, wantH] = size.split('x').map(Number);
      const exact = actual.width === wantW && actual.height === wantH;
      // 2K 档的产品定义是「保留上游原生像素」：只校验 16:9 与像素下限，不要求
      // 精确等于 2048×1152；4K 档才要求精确像素。文案必须写清实测值，
      // 否则管理员会把「上游返回 1672×941」误读成校验没生效。
      const verdict = resolution === '4K'
        ? '4K 精确像素校验通过'
        : '2K 保留上游原生像素，16:9 与像素下限校验通过';
      return res.json(testPayload(
        { success: true, message: `真实出图成功：上游返回 ${actual.width}×${actual.height}，请求 ${size} · ${verdict}` },
        {
          resolution,
          requestedSize: size,
          actualSize: `${actual.width}x${actual.height}`,
          exact,
          bytes: buffer.length,
          latencyMs: Date.now() - started
        }
      ));
    } catch (err: any) {
      return res.json(testPayload(
        { success: false, message: String(err?.message || '出图失败').slice(0, 240) },
        { resolution, requestedSize: size, latencyMs: Date.now() - started }
      ));
    }
  }

  const result = await testThirdPartyConnection({ id: config.id, provider: config.provider, name: config.name, displayName: config.displayName, baseUrl: config.baseUrl, apiKey: config.apiKey, modelName: config.modelName, isActive: config.enabled, resolutionSupport: [resolution] });
  res.json(testPayload(result, { resolution, requestedSize: resolution === '2K' ? '2048x1152' : '3840x2160' }));
});

adminRouter.post('/image-configs/models', requireAdmin, async (req, res) => {
  const result = await listThirdPartyModels({ baseUrl: String(req.body?.baseUrl || ''), apiKey: String(req.body?.apiKey || '') });
  res.status(result.success ? 200 : 400).json(result);
});

adminRouter.post('/ai-configs', requireAdmin, (req, res) => {
  const { name, displayName, provider = 'custom', baseUrl = '', apiKey = '', modelName = '', resolution, resolutionSupport, resolutionConfigs, enabled = true, isDefault = false, remark = '' } = req.body || {};
  if (!String(name || displayName || '').trim() || !String(baseUrl || '').trim()) {
    return res.status(400).json({ success: false, error: '展示名称与接口地址为必填项' });
  }
  const normalizedResolution = ['2K', '4K'].includes(String(resolution)) ? resolution as ImageResolution : undefined;
  const item: AiProviderConfig = {
    id: 'ai_' + now() + '_' + Math.random().toString(36).slice(2, 6),
    name: String(name || displayName).trim(),
    displayName: String(displayName || name).trim(),
    provider,
    baseUrl: String(baseUrl),
    apiKey: String(apiKey),
    modelName: String(modelName),
    resolution: normalizedResolution,
    resolutionSupport: Array.isArray(resolutionSupport) && resolutionSupport.length
      ? resolutionSupport as ImageResolution[]
      : ['2K', '4K'],
    resolutionConfigs: resolutionConfigs && typeof resolutionConfigs === 'object' ? resolutionConfigs : undefined,
    enabled: !!enabled,
    isDefault: !!isDefault,
    remark: String(remark || ''),
    createdAt: now(),
    updatedAt: now()
  };
  db.createAiConfig(item);
  res.json({ success: true, aiConfig: maskedAiConfig(item) });
});

adminRouter.patch('/ai-configs/:id', requireAdmin, (req, res) => {
  const allowed = ['name', 'displayName', 'provider', 'baseUrl', 'apiKey', 'modelName', 'resolution', 'resolutionSupport', 'resolutionConfigs', 'enabled', 'isDefault', 'remark'];
  const updates: any = {};
  for (const key of allowed) {
    if (req.body && req.body[key] !== undefined) updates[key] = req.body[key];
  }
  const existing = db.getAiConfigs().find(config => config.id === req.params.id);
  if (!existing) return res.status(404).json({ success: false, error: 'AI 配置不存在' });
  if (typeof updates.apiKey === 'string' && !updates.apiKey.trim()) delete updates.apiKey;
  if (updates.resolutionConfigs && typeof updates.resolutionConfigs === 'object') {
    const tiers: AiProviderConfig['resolutionConfigs'] = {};
    for (const resolution of IMAGE_RESOLUTIONS) {
      const incoming = updates.resolutionConfigs[resolution];
      const saved = existing.resolutionConfigs?.[resolution];
      if (incoming && typeof incoming === 'object') {
        const { hasApiKey: _hasApiKey, ...fields } = incoming;
        tiers[resolution] = { ...saved, ...fields, apiKey: typeof fields.apiKey === 'string' && fields.apiKey.trim() ? fields.apiKey.trim() : saved?.apiKey || '' };
      } else if (saved) tiers[resolution] = saved;
    }
    updates.resolutionConfigs = tiers;
  }
  const updated = db.updateAiConfig(req.params.id, updates);
  if (!updated) return res.status(404).json({ success: false, error: 'AI 配置不存在' });
  res.json({ success: true, aiConfig: maskedAiConfig(updated) });
});

adminRouter.delete('/ai-configs/:id', requireAdmin, (req, res) => {
  const ok = db.deleteAiConfig(req.params.id);
  if (!ok) return res.status(404).json({ success: false, error: 'AI 配置不存在' });
  res.json({ success: true });
});

adminRouter.post('/ai-configs/:id/test', requireAdmin, async (req, res) => {
  const config = db.getAiConfigs().find(c => c.id === req.params.id);
  if (!config) return res.status(404).json({ success: false, error: 'AI 配置不存在' });
  try {
    const result = await testThirdPartyConnection({
      id: config.id,
      provider: config.provider,
      name: config.name,
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      modelName: config.modelName,
      isActive: config.enabled,
      resolutionSupport: config.resolutionSupport
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || '连通性测试失败' });
  }
});
