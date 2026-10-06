import express from 'express';
import { parseMembership } from '../src/shared/membership.js';
import { db } from './db.js';
import { verifyPassword, hashPassword, isValidPhone } from './auth.js';
import { signAdminToken, verifyAdminToken, generateCode } from './adminAuth.js';
import { listThirdPartyModels, testThirdPartyConnection } from './imageProviders.js';
import { isUserOnline, onlineUserIds, forgetUser } from './presence.js';
import {
  AdminAccount,
  InviteCode,
  RechargeCode,
  AiProviderConfig,
  ImageResolution
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
  (req as any).admin = admin;
  next();
}

/* =========================================================
   登录 / 资料
   ========================================================= */

adminRouter.post('/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ success: false, error: '请输入管理员账号与密码' });
  }
  const admin = db.getAdminByUsername(String(username));
  if (!admin) {
    return res.status(404).json({ success: false, error: '管理员账号不存在' });
  }
  if (admin.status !== 'active') {
    return res.status(403).json({ success: false, error: '该管理员账号已被禁用' });
  }
  if (!verifyPassword(String(password), db.getCredentials(admin.id))) {
    return res.status(401).json({ success: false, error: '密码错误' });
  }
  const updated = db.updateAdmin(admin.id, { lastLoginAt: now() }) || admin;
  const token = signAdminToken(admin.id);
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
  db.setCredentials(admin.id, hashPassword(String(newPassword)));
  res.json({ success: true });
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
  if (body.membership !== undefined) {
    try { updates.membership = parseMembership(body.membership); }
    catch (error) { return res.status(400).json({ success: false, error: (error as Error).message }); }
  }
  if (body.status === 'active' || body.status === 'disabled') {
    updates.status = body.status;
    if (body.status === 'disabled') forgetUser(req.params.id);
  }
  if (body.role === 'admin' || body.role === 'creator' || body.role === 'member') updates.role = body.role;
  if (typeof body.credits === 'number' && body.credits >= 0) updates.credits = Math.floor(body.credits);
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

adminRouter.get('/usage-records', requireAdmin, (req, res) => {
  const { keyword = '', type = '' } = req.query as any;
  const kw = String(keyword).trim().toLowerCase();

  let list = db.getUsageRecords().slice();
  if (kw) {
    list = list.filter(r => r.username.toLowerCase().includes(kw) || r.detail.toLowerCase().includes(kw));
  }
  if (type) {
    list = list.filter(r => r.type === type);
  }

  const page = paginate(list, req.query);
  res.json({ success: true, total: page.total, page: page.page, pageSize: page.pageSize, records: page.list });
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
  res.json({ success: true, total: page.total, page: page.page, pageSize: page.pageSize, inviteCodes: page.list });
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
  res.json({ success: true, total: page.total, page: page.page, pageSize: page.pageSize, rechargeCodes: page.list });
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
   内容规划模型配置（仅管理端可见，前台不可见）
   ========================================================= */

adminRouter.get('/planning-config', requireAdmin, (_req, res) => {
  res.json({ success: true, planningConfig: db.getPlanningConfig() });
});

adminRouter.put('/planning-config', requireAdmin, (req, res) => {
  const { baseUrl, apiKey, modelName, reasoningEffort, optimizeReasoningEffort } = req.body || {};
  const updates: any = {};
  if (typeof baseUrl === 'string' && baseUrl.trim()) updates.baseUrl = baseUrl.trim();
  if (typeof apiKey === 'string' && apiKey.trim()) updates.apiKey = apiKey.trim();
  if (typeof modelName === 'string' && modelName.trim()) updates.modelName = modelName.trim();
  if (typeof reasoningEffort === 'string' && reasoningEffort.trim()) updates.reasoningEffort = reasoningEffort.trim();
  if (typeof optimizeReasoningEffort === 'string' && optimizeReasoningEffort.trim()) updates.optimizeReasoningEffort = optimizeReasoningEffort.trim();
  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ success: false, error: '没有可更新的配置项' });
  }
  const saved = db.updatePlanningConfig(updates);
  res.json({ success: true, planningConfig: saved });
});

/* =========================================================
   AI 接口配置管理
   ========================================================= */

adminRouter.get('/ai-configs', requireAdmin, (_req, res) => {
  const list = db.getAiConfigs().slice().sort((a, b) => b.updatedAt - a.updatedAt);
  res.json({ success: true, aiConfigs: list });
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

adminRouter.post('/image-configs/:resolution/test', requireAdmin, async (req, res) => {
  const resolution = validImageResolution(req.params.resolution);
  if (!resolution) return res.status(400).json({ success: false, error: '画质档位只能是 2K 或 4K' });
  const config = db.getAiConfigs().find(item => item.resolution === resolution);
  if (!config) return res.status(404).json({ success: false, error: resolution + ' 尚未配置' });
  const result = await testThirdPartyConnection({ id: config.id, provider: config.provider, name: config.name, displayName: config.displayName, baseUrl: config.baseUrl, apiKey: config.apiKey, modelName: config.modelName, isActive: config.enabled, resolutionSupport: [resolution] });
  res.json({ ...result, resolution, requestedSize: resolution === '2K' ? '2048x1152' : '3840x2160' });
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
  res.json({ success: true, aiConfig: item });
});

adminRouter.patch('/ai-configs/:id', requireAdmin, (req, res) => {
  const allowed = ['name', 'displayName', 'provider', 'baseUrl', 'apiKey', 'modelName', 'resolution', 'resolutionSupport', 'resolutionConfigs', 'enabled', 'isDefault', 'remark'];
  const updates: any = {};
  for (const key of allowed) {
    if (req.body && req.body[key] !== undefined) updates[key] = req.body[key];
  }
  const updated = db.updateAiConfig(req.params.id, updates);
  if (!updated) return res.status(404).json({ success: false, error: 'AI 配置不存在' });
  res.json({ success: true, aiConfig: updated });
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
