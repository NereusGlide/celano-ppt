import { PPT_PAGE_WIDTH, PPT_PAGE_HEIGHT, MAX_IMAGE_BYTES, MAX_IMAGE_DATA_URL_LENGTH, pixelResolution } from './src/shared/imageSpecs.js';
import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { extractReferenceFile } from './server/ppt/referenceFiles.js';
import dotenv from 'dotenv';
import PptxGenJS from 'pptxgenjs';
import { db } from './server/db.js';
import { adminRouter } from './server/adminRoutes.js';
import { pptRouter } from './server/ppt/routes.js';
import { deleteDeck, logoImagePath, slideImagePath } from './server/ppt/engine.js';
import { aiRouter } from './server/aiRoutes.js';
import { createCanvasRouter } from './server/canvasRoutes.js';
import { createCanvasAssetRouter } from './server/canvasAssetRoutes.js';
import { DEFAULT_ADMIN_USERNAME, DEFAULT_ADMIN_PASSWORD } from './server/adminAuth.js';
import { verifyPassword, isValidPhone, hashPassword, USERNAME_RULE } from './server/auth.js';
import { clearUserSessionCookie, getUserSession, setUserSessionCookie } from './server/userSession.js';
import { touchUser } from './server/presence.js';
import { requireUser as requireUserSession } from './server/sessionGuard.js';
import { generateImageEdit } from './server/imageProviders.js';
import { withImageSlot } from './server/ppt/imageSlots.js';
import { assertNative16x9, dataUrlBytes } from './server/ppt/imageDimensions.js';
import { chargeCredits, refundCredits } from './server/billing.js';
import type { User } from './src/types.js';

dotenv.config();
const app = express();
const PORT = Number(process.env.PORT) || 3000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isProduction = process.env.NODE_ENV === 'production';

/* =========================================================================
   安全与传输层加固
   ========================================================================= */

// 隐藏框架指纹
app.disable('x-powered-by');

// 反向代理后需要信任代理才能拿到真实客户端 IP；直接暴露公网时不要开启，
// 否则 X-Forwarded-For 可被伪造从而绕过限流。
const trustProxy = Number(process.env.TRUST_PROXY || 0);
if (trustProxy > 0) app.set('trust proxy', trustProxy);

// ---- 1. 安全响应头（CSP 白名单制）----
// 说明：生图结果是 data URL，第三方通道可能回传 https 图片，因此 img-src 需放开这两项；
// 开发环境 Vite 会注入内联脚本与 HMR WebSocket，需单独放宽，生产环境保持严格。
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      'default-src': ["'self'"],
      'script-src': isProduction ? ["'self'"] : ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      'style-src': ["'self'", "'unsafe-inline'"],
      'img-src': ["'self'", 'data:', 'blob:', 'https:'],
      'font-src': ["'self'", 'data:'],
      // Canvas reads generated data URLs and local Blob URLs before saving them to its asset library.
      'connect-src': isProduction ? ["'self'", 'data:', 'blob:'] : ["'self'", 'data:', 'blob:', 'ws:', 'wss:'],
      'frame-src': ["'self'"],
      'media-src': ["'self'", 'data:', 'blob:'],
      'worker-src': ["'self'", 'blob:'],
      'object-src': ["'none'"],
      'base-uri': ["'self'"],
      'form-action': ["'self'"],
      // The canvas editor is embedded by our own workspace; other pages remain unembeddable.
      'frame-ancestors': [(req) => {
        const pathname = (req as express.Request).path;
        return pathname === '/infinite-canvas' || pathname.startsWith('/infinite-canvas/') ? "'self'" : "'none'";
      }],
      ...(isProduction ? { 'upgrade-insecure-requests': [] } : {}),
    },
  },
  crossOriginResourcePolicy: { policy: 'same-site' },
  crossOriginEmbedderPolicy: false,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  hsts: isProduction ? { maxAge: 15552000, includeSubDomains: true } : false,
}));

// ---- 2. 响应压缩（前置 Nginx/CDN 已压缩时 compression 会自动跳过）----
app.use(compression());

// ---- 3. 请求体分级限制 ----
// 工作台的图生图编辑会传输 base64 图片与遮罩，必须放宽；
// 其余接口（登录、兑换、查询）一律 256KB，避免用超大 JSON 低成本打满内存。
const LARGE_BODY_PREFIXES = [
  '/api/workspace', '/api/presentations', '/api/ppt', '/api/ai',
  '/api/canvas', '/api/upload-reference', '/api/upload-logo', '/api/admin',
];
const smallBody = express.json({ limit: '256kb' });
const largeBody = express.json({ limit: '64mb' });
app.use((req, res, next) => {
  const needsLargeBody = LARGE_BODY_PREFIXES.some(prefix => req.path.startsWith(prefix));
  return (needsLargeBody ? largeBody : smallBody)(req, res, next);
});
app.use(express.urlencoded({ extended: true, limit: '256kb' }));
app.use(express.raw({ type: 'multipart/form-data', limit: '120mb' }));

// ---- 4. 分级限流 ----
// 全局档：宽松，只用于阻断脚本化爬取；
// 认证档 / 兑换档：加严并只统计失败请求，正常用户不受影响。
const limiterBase = { standardHeaders: 'draft-7' as const, legacyHeaders: false };
app.use('/api', rateLimit({
  ...limiterBase,
  windowMs: 5 * 60 * 1000,
  limit: 400,
  message: { success: false, error: '请求过于频繁，请稍后再试' },
}));
app.use(['/api/auth/login', '/api/auth/register', '/api/auth/password'], rateLimit({
  ...limiterBase,
  windowMs: 5 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  message: { success: false, error: '尝试次数过多，请 5 分钟后再试' },
}));
// 充值码是资金入口，单独加严，防止被脚本枚举
app.use('/api/wallet/redeem', rateLimit({
  ...limiterBase,
  windowMs: 5 * 60 * 1000,
  limit: 5,
  skipSuccessfulRequests: true,
  message: { success: false, error: '兑换尝试过于频繁，请稍后再试' },
}));
// 管理端登录是后台最高权限入口，此前完全不在任何限流档内，可被直接爆破。
app.use('/api/admin/auth/login', rateLimit({
  ...limiterBase,
  windowMs: 5 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  message: { success: false, error: '登录尝试过于频繁，请 5 分钟后再试' },
}));
// 旧首页遗留的 AI 端点（/api/ai/*）目前没有任何前端调用方，但仍直连付费上游模型，
// 匿名即可调用。单独加严，避免被当成免费 LLM 代理批量消耗额度。
app.use('/api/ai', rateLimit({
  ...limiterBase,
  windowMs: 5 * 60 * 1000,
  limit: 20,
  message: { success: false, error: '请求过于频繁，请稍后再试' },
}));

function publicUser(user: User): Omit<User, 'apiConfigs'> { const { apiConfigs: _keys, ...safe } = user as User & { apiConfigs?: unknown }; return safe; }

/** 流水只是审计信息，写失败不应让登录、兑换等主流程变成 500。 */
function recordUsage(userId: string, username: string, type: any, detail: string, credits = 0) {
  try {
    db.addUsageRecord({ id:'use_'+Date.now()+'_'+Math.random().toString(36).slice(2,7), userId, username, type, detail, credits, createdAt:Date.now() });
  } catch (err) {
    console.error('[usage] 写入使用记录失败:', String((err as Error)?.message || err).slice(0, 180));
  }
}

/**
 * 前台接口鉴权。与 PPT 工作路由共用同一份判定逻辑，
 * 差异只在于这里会刷新用户活跃时间（在线状态依赖它）。
 */
function requireUser(req: express.Request, res: express.Response): User | null {
  return requireUserSession(req, res, { onActive: markUserActive });
}

function jsonError(res: express.Response, status: number, error: string) { return res.status(status).json({success:false,error}); }

/**
 * 客户端 IP。
 *
 * 为什么必须先判断 trust proxy：X-Forwarded-For 是客户端可任意伪造的请求头。
 * 在未声明信任反向代理时直接采信它，等于把登录、兑换的限流开关交给了攻击者——
 * 每次请求换一个 XFF 就是一个新的限流桶。现在与 express 的 req.ip 判定保持一致：
 * 只有显式开启 TRUST_PROXY 才读取代理头。
 */
function clientIp(req: express.Request): string {
  if (trustProxy > 0) {
    const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (fwd) return fwd;
  }
  return String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
}

type MultipartFile = { field: string; filename: string; contentType: string; data: Buffer };

function decodeMultipartFilename(value: string): string {
  const raw = String(value || '').replace(/^UTF-8''/i, '');
  let decoded = raw;
  try { decoded = decodeURIComponent(raw); } catch { /* 保留原始文件名 */ }
  if (/%[0-9a-f]{2}/i.test(raw)) return decoded;
  // multipart 头部按 latin1 读取只是为了保护二进制正文；文件名仍需按 UTF-8 还原。
  const utf8 = Buffer.from(decoded, 'latin1').toString('utf8');
  return utf8.includes('\uFFFD') ? decoded : utf8;
}

/** 轻量 multipart 解析器：只用于旧首页的小型参考文件/Logo上传，不依赖额外原生模块。 */
async function readMultipartFile(req: express.Request, fields: string[], maxBytes = 200 * 1024 * 1024): Promise<MultipartFile | null> {
  const contentType = String(req.headers['content-type'] || '');
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!boundaryMatch) return null;
  const boundary = boundaryMatch[1] || boundaryMatch[2];
  const body = Buffer.isBuffer(req.body) ? req.body : await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer | string) => {
      const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += part.length;
      if (size > maxBytes) {
        reject(new Error('上传文件过大'));
        req.destroy();
        return;
      }
      chunks.push(part);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
  if (body.length > maxBytes) throw new Error('上传文件过大');
  // latin1 一一对应字节，既能解析头部，也不会破坏二进制文件内容。
  const raw = body.toString('latin1');
  for (const segment of raw.split('--' + boundary).slice(1)) {
    if (segment.startsWith('--')) break;
    const headerEnd = segment.indexOf('\r\n\r\n');
    if (headerEnd < 0) continue;
    const headers = segment.slice(0, headerEnd);
    if (!/content-disposition:\s*form-data/i.test(headers)) continue;
    const field = /(?:^|;)\s*name="([^"]+)"/i.exec(headers)?.[1] || '';
    const filenameMatch = /(?:^|;)\s*filename="([^"]*)"/i.exec(headers);
    const filenameStar = /(?:^|;)\s*filename\*=([^;\r\n]+)/i.exec(headers)?.[1];
    const filename = filenameStar !== undefined ? decodeMultipartFilename(filenameStar.trim()) : filenameMatch ? decodeMultipartFilename(filenameMatch[1]) : undefined;
    if (!fields.includes(field) || filename === undefined) continue;
    const typeMatch = /content-type:\s*([^\r\n]+)/i.exec(headers);
    let dataText = segment.slice(headerEnd + 4);
    if (dataText.endsWith('\r\n')) dataText = dataText.slice(0, -2);
    return { field, filename: filename || '上传文件', contentType: (typeMatch?.[1] || 'application/octet-stream').trim(), data: Buffer.from(dataText, 'latin1') };
  }
  return null;
}

const LEGACY_UPLOADS = path.resolve(process.cwd(), 'data', 'legacy-uploads');
function saveLegacyUpload(userId: string, file: MultipartFile) {
  const extension = path.extname(file.filename).toLowerCase().replace(/[^a-z0-9.]/g, '').slice(0, 10) || '.bin';
  const id = crypto.randomBytes(12).toString('hex');
  const relative = path.join('user-' + userId, id + extension);
  const full = path.join(LEGACY_UPLOADS, relative);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, file.data);
  return { id, extension, relative, full };
}

/** 活跃度落盘节流表容量上限：无上限时每个历史用户都会永久占一条记录。 */
const ACTIVE_PERSIST_LIMIT = 20_000;
const activePersist = new Map<string, number>();
function markUserActive(user: User) {
  touchUser(user.id);
  const now = Date.now();
  const last = activePersist.get(user.id) || 0;
  if (now - last <= 60000) return;
  if (activePersist.size >= ACTIVE_PERSIST_LIMIT) {
    // 淘汰最久未活跃的一半。这些只是节流标记，淘汰后最多让下次请求多写一次
    // lastActiveAt，不影响任何对外可见行为。
    const stale = [...activePersist.entries()].sort((a, b) => a[1] - b[1]).slice(0, Math.ceil(ACTIVE_PERSIST_LIMIT / 2));
    for (const [id] of stale) activePersist.delete(id);
  }
  activePersist.set(user.id, now);
  db.updateUser(user.id, { lastActiveAt: now });
}

app.use('/api/admin', adminRouter);
app.use('/api/ppt', pptRouter);
app.use('/api/ai', aiRouter);
app.use('/api/canvas', createCanvasRouter(requireUser));
app.use('/api/canvas/assets', createCanvasAssetRouter(requireUser));

app.get('/api/auth/users', (req,res) => { const user=requireUser(req,res); if(!user)return; res.json({success:true,users:[publicUser(user)]}); });
app.post('/api/auth/login', (req,res) => {
  const {identifier,password}=req.body||{}; if(!identifier||!password)return jsonError(res,400,'请输入账号与密码');
  const user=db.getUserByUsernameOrEmail(String(identifier)); if(!user)return jsonError(res,404,'账号不存在，请先注册');
  if(user.status==='disabled')return jsonError(res,403,'该账号已被禁用，请联系管理员');
  if(!verifyPassword(String(password),db.getCredentials(user.id)))return jsonError(res,401,'密码错误，请重试');
  const ip = clientIp(req);
  db.updateUser(user.id,{lastLoginAt:Date.now(), lastLoginIp: ip});
  touchUser(user.id);
  recordUsage(user.id,user.username,'login','账号登录 · IP ' + ip,0);
  setUserSessionCookie(res,user.id,db.getCredentials(user.id),req.hostname);
  res.json({success:true,user:publicUser(db.getUserById(user.id)||user)});
});
app.post('/api/auth/register', (req,res) => {
  const {username,phone,password,confirmPassword,inviteCode,avatar}=req.body||{}; if(!username||!phone||!password)return jsonError(res,400,'账号、手机号与密码均为必填项');
  const name=String(username).trim(), mobile=String(phone).trim(), pwd=String(password);
  if(!USERNAME_RULE.test(name))return jsonError(res,400,'账号需为 3-20 位字母、数字或下划线');
  if(!isValidPhone(mobile))return jsonError(res,400,'请输入有效的 11 位手机号');
  if(pwd.length<6||pwd.length>128)return jsonError(res,400,'密码长度需为 6-128 位');
  if(String(confirmPassword||'')!==pwd)return jsonError(res,400,'两次输入的密码不一致');
  const check=db.validateInviteCode(String(inviteCode||'')); if(!check.ok)return jsonError(res,400,'邀请码无效：'+(check.reason||'不可用'));
  if(db.getUserByUsernameOrEmail(name))return jsonError(res,409,'该账号已被注册，请直接登录');
  if(db.getUserByUsernameOrEmail(mobile))return jsonError(res,409,'该手机号已被注册');
  // id 必须带随机后缀：仅用 Date.now() 时，同一毫秒内的两次注册会拿到完全相同
  // 的 id，后注册者会与先注册者共用凭据与数据（getUserById 永远只返回第一个）。
  const user:User={id:'user_'+Date.now()+'_'+crypto.randomBytes(4).toString('hex'),username:name,name,phone:mobile,avatar:avatar||'',role:'creator',createdAt:Date.now()}; db.createUser(user,pwd);
  const saved=db.updateUser(user.id,{credits:100,inviteCode:String(inviteCode).trim().toUpperCase(),lastLoginAt:Date.now(),lastLoginIp:clientIp(req)})||user; db.consumeInviteCode(String(inviteCode),user.id); recordUsage(user.id,user.username,'register','通过邀请码 '+String(inviteCode).trim().toUpperCase()+' 注册，赠送 100 点',100); setUserSessionCookie(res,user.id,db.getCredentials(user.id),req.hostname);
  res.json({success:true,user:publicUser(saved)});
});
app.get('/api/auth/me',(req,res)=>{const user=requireUser(req,res);if(!user)return;res.json({success:true,user:publicUser(user)});});
app.post('/api/auth/logout',(req,res)=>{clearUserSessionCookie(res,req.hostname);res.json({success:true});});
app.patch('/api/auth/profile',(req,res)=>{const user=requireUser(req,res);if(!user)return;const body=req.body||{};const keys=Object.keys(body);if(!keys.length||keys.some(k=>!['name','phone'].includes(k)))return jsonError(res,400,'仅允许修改 name、phone');const updates:Partial<User>={};if(body.name!==undefined){if(typeof body.name!=='string'||!body.name.trim()||body.name.trim().length>30)return jsonError(res,400,'显示名称需为1-30个字符');updates.name=body.name.trim();}if(body.phone!==undefined){if(typeof body.phone!=='string'||!isValidPhone(body.phone.trim()))return jsonError(res,400,'请输入有效的11位手机号');if(db.getUsers().some(x=>x.id!==user.id&&x.phone===body.phone.trim()))return jsonError(res,409,'该手机号已被其他账号使用');updates.phone=body.phone.trim();}res.json({success:true,user:publicUser(db.updateUser(user.id,updates)||user)});});
app.post('/api/auth/password',(req,res)=>{const user=requireUser(req,res);if(!user)return;const {currentPassword,newPassword,confirmPassword}=req.body||{};if(typeof currentPassword!=='string'||!verifyPassword(currentPassword,db.getCredentials(user.id)))return jsonError(res,401,'当前密码错误');if(typeof newPassword!=='string'||newPassword.length<6||newPassword.length>128)return jsonError(res,400,'新密码长度需为6-128位');if(newPassword!==confirmPassword)return jsonError(res,400,'两次输入的新密码不一致');if(verifyPassword(newPassword,db.getCredentials(user.id)))return jsonError(res,400,'新密码不能与当前密码相同');db.setCredentials(user.id,hashPassword(newPassword));setUserSessionCookie(res,user.id,db.getCredentials(user.id),req.hostname);res.json({success:true,user:publicUser(user)});});

app.post('/api/wallet/redeem',(req,res)=>{
  const user=requireUser(req,res);if(!user)return;
  const {userId,code}=req.body||{};
  if(userId!==undefined&&String(userId)!==user.id)return jsonError(res,403,'用户身份与当前会话不一致');
  if(!code)return jsonError(res,400,'缺少充值码');
  // 校验、标记已用、入账、记流水必须在同一次落盘内完成。
  // 原先分四步写盘，任一步崩溃都会留下「码已作废但点数未到账」（或反之）的不一致状态，
  // 且这种差额事后无法对账。
  const result=db.redeemRechargeCode(user.id,String(code));
  if(!result.ok)return jsonError(res,result.error==='充值码不存在'?404:400,result.error);
  res.json({success:true,added:result.added,credits:result.credits});
});
app.get('/api/account/summary',(req,res)=>{
  const user=requireUser(req,res);if(!user)return;
  const records=db.getUsageRecords().filter(x=>x.userId===user.id).sort((a,b)=>b.createdAt-a.createdAt).slice(0,200);
  // 个人中心与首页作品库必须读取同一份 PPT 任务数据。过去这里固定返回空数组，
  // 导致任务虽已写入当前 userId，个人中心却永远看不到新作品。
  const presentations=[
    ...db.getPresentations(user.id).map(legacyPresentationView),
    ...db.getPptDecks(user.id).map(legacyPresentationView),
  ].sort((a,b)=>Number(b.updatedAt||b.createdAt||0)-Number(a.updatedAt||a.createdAt||0));
  const jobs=db.getPptDecks(user.id).filter(deck=>deck.running||!deck.finished).map(deck=>({
    id: deck.id,
    userId: deck.userId,
    presentationId: deck.id,
    type: 'batch_images',
    status: deck.running ? 'processing' : 'failed',
    progress: deck.slides.length ? Math.round(deck.slides.filter(slide=>slide.status==='done').length / deck.slides.length * 100) : 5,
    createdAt: deck.startedAt,
    updatedAt: deck.updatedAt,
    step: deck.stage === 'planning' ? '正在规划页面' : deck.running ? '正在生成页面' : '任务已暂停',
  }));
  res.json({success:true,user:publicUser(user),records,jobs,presentations,stats:{recordsIncluded:records.length,recordsTruncated:records.length>=200}});
});
app.get('/api/users/:userId/usage-records',(req,res)=>{const user=requireUser(req,res);if(!user)return;if(req.params.userId!==user.id)return jsonError(res,403,'无权查看其他用户的使用记录');const records=db.getUsageRecords().filter(x=>x.userId===user.id).sort((a,b)=>b.createdAt-a.createdAt).slice(0,200);res.json({success:true,user:publicUser(user),records});});
app.get('/api/users/:userId/configs',(req,res)=>{const user=requireUser(req,res);if(!user)return;if(req.params.userId!==user.id)return jsonError(res,403,'无权查看其他用户配置');res.json({success:true,configs:[]});});
app.post('/api/users/:userId/configs',(req,res)=>jsonError(res,403,'AI 接口配置仅由管理端维护'));
app.get('/api/jobs',(req,res)=>{const session=getUserSession(req);const user=session?db.getUserById(session.userId):null;if(!user||user.status==='disabled')return res.json({success:true,jobs:[]});res.json({success:true,jobs:[]});});

/* 旧首页兼容层：保留列表、详情和删除接口，避免 legacy 构建产物访问已移除的接口时出现 404。新任务统一走 /api/ppt/decks。 */
function legacyPresentationView(item: any) {
  if (item && Array.isArray(item.slides) && item.pageCount !== undefined) {
    return {
      id: item.id,
      userId: item.userId,
      title: item.title,
      description: item.subtitle || item.prompt,
      style: 'business-clean',
      resolution: item.resolution || '2K',
      aspectRatio: '16:9',
      slides: item.slides.map((slide: any, index: number) => ({
        id: slide.id,
        order: index + 1,
        title: slide.plan?.title || '页面 ' + (index + 1),
        subtitle: slide.plan?.subtitle,
        bulletPoints: slide.plan?.bullets || [],
        speakerNotes: slide.plan?.summary,
        visualConcept: slide.plan?.imagePrompt || '',
        rawPrompt: slide.plan?.imagePrompt || '',
        optimizedPrompt: slide.plan?.imagePrompt || '',
        imageUrl: slide.imageUrl || (slide.status === 'done' && slide.storageKey
          ? '/api/ppt/decks/' + item.id + '/slides/' + slide.id + '/image?v=' + encodeURIComponent(String(item.updatedAt || item.startedAt || Date.now()))
          : undefined),
        imageResolution: item.resolution || '2K',
        layout: 'full-bleed',
        pageType: slide.plan?.pageType,
      })),
      createdAt: item.startedAt,
      updatedAt: item.updatedAt,
      // 个人中心需要区分生成中、暂停和已完成的新版任务；这些字段为旧首页
      // 兼容字段之外的附加信息，不影响旧编辑器读取。
      finished: !!item.finished,
      running: !!item.running,
      stage: item.stage,
      pageCount: item.pageCount,
      concurrency: item.concurrency,
    };
  }
  return item;
}

type ExportItem = { kind: 'deck' | 'presentation'; value: any };

function exportIdsFromRequest(req: express.Request): string[] {
  const bodyIds = Array.isArray(req.body?.ids) ? req.body.ids : [];
  const queryIds = typeof req.query.ids === 'string' ? String(req.query.ids).split(',') : [];
  return [...new Set([...bodyIds, ...queryIds].map(id => String(id || '').trim()).filter(Boolean))].slice(0, 20);
}

async function imageDataForExport(slide: any, deck?: any): Promise<string> {
  if (deck) {
    const file = slideImagePath(deck, slide.id);
    if (file) {
      const ext = path.extname(file).toLowerCase();
      const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png';
      // 4K 页面图片可达数十 MB，同步 readFileSync 会逐页阻塞事件循环，
      // 导出期间整个进程的其它请求都被拖住。改为异步读取。
      return 'data:' + mime + ';base64,' + (await fs.promises.readFile(file)).toString('base64');
    }
  }
  const source = String(slide.imageUrl || '').trim();
  if (/^data:image\/(png|jpeg|webp);base64,/.test(source)) return source;
  if (!/^https?:\/\//i.test(source)) throw new Error('页面图片不存在');
  const response = await fetch(source, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error('下载作品图片失败 HTTP ' + response.status);
  const mime = String(response.headers.get('content-type') || '').toLowerCase().split(';')[0].trim();
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(mime)) throw new Error('作品图片格式不受支持');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error('作品图片过大');
  return 'data:' + mime + ';base64,' + bytes.toString('base64');
}

async function exportSelectedPresentations(req: express.Request, res: express.Response, ids: string[]) {
  const user = requireUser(req, res);
  if (!user) return;
  if (!ids.length) return jsonError(res, 400, '请至少选择一套已完成作品');
  const items: ExportItem[] = [];
  for (const id of ids) {
    const deck = db.getPptDeck(id);
    if (deck) {
      if (deck.userId !== user.id) return jsonError(res, 403, '无权导出该作品');
      if (!deck.finished || deck.slides.some((slide: any) => slide.status !== 'done')) return jsonError(res, 409, '作品尚未全部生成完成，暂时无法导出');
      items.push({ kind: 'deck', value: deck });
      continue;
    }
    const presentation = db.getPresentationById(id);
    if (!presentation) return jsonError(res, 404, '作品不存在');
    if (presentation.userId !== user.id) return jsonError(res, 403, '无权导出该作品');
    items.push({ kind: 'presentation', value: presentation });
  }

  try {
    const pptx = new PptxGenJS();
    pptx.defineLayout({ name: 'CELANO_16_9', width: PPT_PAGE_WIDTH, height: PPT_PAGE_HEIGHT });
    pptx.layout = 'CELANO_16_9';
    pptx.author = 'CELANO PPT';
    pptx.title = items.length === 1 ? String(items[0].value.title || '演示文稿') : 'CELANO 合并作品';
    let pageCount = 0;
    for (const item of items) {
      const deck = item.kind === 'deck' ? item.value : undefined;
      const slides = Array.isArray(item.value.slides) ? item.value.slides : [];
      for (const slide of slides) {
        const data = await imageDataForExport(slide, deck);
        const page = pptx.addSlide();
        page.addImage({ data, x: 0, y: 0, w: PPT_PAGE_WIDTH, h: PPT_PAGE_HEIGHT });
        if (deck?.logo?.enabled) {
          const logoFile = logoImagePath(deck);
          if (logoFile) {
            const logoSize = deck.logo.size === 'sm' ? 0.8 : deck.logo.size === 'lg' ? 1.45 : 1.1;
            const margin = 0.42;
            const position = deck.logo.position || 'top-right';
            const x = position.endsWith('left') ? margin : PPT_PAGE_WIDTH - margin - logoSize;
            const y = position.startsWith('bottom') ? 7.5 - margin - logoSize * 0.55 : margin;
            page.addImage({ path: logoFile, x, y, w: logoSize, h: logoSize * 0.55, transparency: Math.round((1 - Math.min(1, Math.max(0.1, Number(deck.logo.opacity) || 0.9))) * 100) });
          }
        }
        pageCount += 1;
      }
    }
    if (!pageCount) return jsonError(res, 409, '作品没有可导出的页面图片');
    const output = await pptx.write({ outputType: 'nodebuffer' });
    const buffer = Buffer.isBuffer(output) ? output : Buffer.from(output as Uint8Array);
    const filename = (items.length === 1 ? String(items[0].value.title || '演示文稿') : 'CELANO-合并文稿').replace(/[\\/:*?"<>|\r\n]+/g, '_').slice(0, 80) + '.pptx';
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(filename),
      'Content-Length': String(buffer.length),
    });
    recordUsage(user.id, user.username, 'export_pptx', '导出 ' + pageCount + ' 页 PPTX', 0);
    return res.send(buffer);
  } catch (err: any) {
    return jsonError(res, 502, '导出 PPTX 失败：' + String(err?.message || err).slice(0, 160));
  }
}

app.get('/api/presentations/merged-export', (req, res) => {
  void exportSelectedPresentations(req, res, exportIdsFromRequest(req));
});

app.get('/api/presentations', (req, res) => {
  const session = getUserSession(req);
  const user = session ? db.getUserById(session.userId) : null;
  if (!user || user.status === 'disabled') return res.json({ success: true, presentations: [] });
  const requestedUserId = String(req.query.userId || '');
  if (requestedUserId && requestedUserId !== user.id) return res.status(403).json({ success: false, error: '无权查看其他用户的演示文稿' });
  const oldPresentations = db.getPresentations(user.id).map(legacyPresentationView);
  // 新版任务完成后直接进入旧首页的作品库，避免用户只能在工作台任务后台找到作品。
  const generatedPresentations = db.getPptDecks(user.id).filter(deck => deck.finished).map(legacyPresentationView);
  const presentations = [...oldPresentations, ...generatedPresentations].sort((a, b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0));
  res.json({ success: true, presentations });
});
app.get('/api/presentations/:id', (req, res) => {
  const id = String(req.params.id || '');
  if (id === 'merged-export') return res.status(410).json({ success: false, error: '旧版合并导出入口已迁移，请在 PPT 工作台中导出' });
  const session = getUserSession(req);
  const user = session ? db.getUserById(session.userId) : null;
  if (!user || user.status === 'disabled') return res.status(401).json({ success: false, error: '请先登录' });
  const old = db.getPresentationById(id);
  if (old && old.userId !== user.id) return res.status(403).json({ success: false, error: '无权访问该演示文稿' });
  if (old) return res.json({ success: true, presentation: legacyPresentationView(old) });
  const deck = db.getPptDeck(id);
  if (deck && deck.userId !== user.id) return res.status(403).json({ success: false, error: '无权访问该演示文稿' });
  if (deck) return res.json({ success: true, presentation: legacyPresentationView(deck) });
  return res.status(404).json({ success: false, error: '演示文稿不存在' });
});
app.put('/api/presentations/:id', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const old = db.getPresentationById(String(req.params.id || ''));
  if (!old || old.userId !== user.id) return jsonError(res, 404, '演示文稿不存在');
  const updated = db.updatePresentation(old.id, req.body || {});
  res.json({ success: true, presentation: legacyPresentationView(updated || old) });
});
app.delete('/api/presentations/:id', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const id = String(req.params.id || '');
  const deck = db.getPptDeck(id);
  if (deck && deck.userId === user.id) {
    const result = deleteDeck(user.id, id);
    if ('error' in result) return jsonError(res, 400, result.error);
    return res.json({ success: true });
  }
  const old = db.getPresentationById(id);
  if (!old || old.userId !== user.id) return jsonError(res, 404, '演示文稿不存在');
  db.deletePresentation(id);
  res.json({ success: true });
});
app.get('/api/presentations/:id/download', (req, res) => {
  void exportSelectedPresentations(req, res, [String(req.params.id || '')]);
});
app.get('/api/jobs/stream', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders?.();
  res.write('data: ' + JSON.stringify({ type: 'ready' }) + '\n\n');
  const timer = setInterval(() => {
    // 连接已结束仍写入会抛 ERR_STREAM_WRITE_AFTER_END，变成进程级噪音。
    if (!res.writableEnded && !res.destroyed) res.write(': keep-alive\n\n');
  }, 15000);
  req.on('close', () => clearInterval(timer));
});
app.get('/api/queue/metrics', (_req, res) => res.json({ success: true, metrics: { pending: 0, processing: 0, concurrency: 2 } }));
app.post('/api/queue/concurrency', (_req, res) => res.json({ success: true, metrics: { pending: 0, processing: 0, concurrency: 2 } }));
app.post('/api/upload-reference', async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    const file = await readMultipartFile(req, ['file', 'reference'], 100 * 1024 * 1024);
    if (!file) return jsonError(res, 400, '未找到参考文件，请使用 multipart/form-data 上传');
    const saved = saveLegacyUpload(user.id, file);
    const extraction = await extractReferenceFile(file, saved.full);
    res.json({ success: true, file: { id: saved.id, name: file.filename.slice(0, 160), size: file.data.length, type: file.contentType, ...extraction, url: '/api/legacy-uploads/' + encodeURIComponent(user.id) + '/' + saved.id + saved.extension } });
  } catch (err: any) {
    res.status(413).json({ success: false, error: String(err?.message || '参考文件上传失败').slice(0, 160) });
  }
});
app.post('/api/upload-logo', async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    const file = await readMultipartFile(req, ['logo', 'file'], 8 * 1024 * 1024);
    if (!file) return jsonError(res, 400, '未找到 Logo 文件，请使用 multipart/form-data 上传');
    const saved = saveLegacyUpload(user.id, file);
    res.json({ success: true, url: '/api/legacy-uploads/' + encodeURIComponent(user.id) + '/' + saved.id + saved.extension });
  } catch (err: any) {
    res.status(413).json({ success: false, error: String(err?.message || 'Logo 上传失败').slice(0, 160) });
  }
});
app.get('/api/legacy-uploads/:userId/:filename', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  if (req.params.userId !== user.id) return jsonError(res, 403, '无权访问该文件');
  const filename = path.basename(String(req.params.filename || ''));
  const full = path.join(LEGACY_UPLOADS, 'user-' + user.id, filename);
  if (!full.startsWith(path.join(LEGACY_UPLOADS, 'user-' + user.id) + path.sep) || !fs.existsSync(full)) return jsonError(res, 404, '文件不存在');
  res.set('Cache-Control', 'private, max-age=3600');
  res.sendFile(full);
});
app.post('/api/account/export', (req, res) => {
  void exportSelectedPresentations(req, res, exportIdsFromRequest(req));
});
app.delete('/api/account/works/:id', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const id = String(req.params.id || '');
  const deck = db.getPptDeck(id);
  if (deck && deck.userId === user.id) db.deletePptDeck(id);
  else if (db.getPresentationById(id)?.userId === user.id) db.deletePresentation(id);
  res.json({ success: true });
});


// 工作台：涂抹/框选 + 修改指令 → 图生图编辑
app.post('/api/workspace/edit-page', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const { image, mask, prompt } = (req.body || {}) as { image?: string; mask?: string; prompt?: string };
  if (typeof image !== 'string' || !/^data:image\/(png|jpeg|webp);base64,/.test(image) || image.length > MAX_IMAGE_DATA_URL_LENGTH) {
    return jsonError(res, 400, '缺少有效的页面图片');
  }
  if (mask !== undefined && (typeof mask !== 'string' || !/^data:image\/(png|jpeg|webp);base64,/.test(mask) || mask.length > MAX_IMAGE_DATA_URL_LENGTH)) {
    return jsonError(res, 400, '局部编辑遮罩格式无效');
  }
  const instruction = typeof prompt === 'string' ? prompt.trim() : '';
  if (!instruction || instruction.length > 2000) {
    return jsonError(res, 400, '请输入 1-2000 字的修改指令');
  }
  let originalSize: { width: number; height: number };
  try {
    originalSize = assertNative16x9(dataUrlBytes(image), '原始页面');
    if (mask) {
      const maskSize = assertNative16x9(dataUrlBytes(mask), '局部编辑遮罩');
      if (maskSize.width !== originalSize.width || maskSize.height !== originalSize.height) return jsonError(res, 400, '遮罩像素尺寸必须与原图一致');
    }
  } catch (error) { return jsonError(res, 400, error instanceof Error ? error.message : '图片尺寸无效'); }
  // 单页编辑沿用原图像素档位，确保 2K/4K 编辑分别走对应上游配置。
  const cfg = db.resolveImageConfig(pixelResolution(originalSize.width + 'x' + originalSize.height));
  if (!cfg || !cfg.apiKey) {
    return jsonError(res, 503, '当前图片画质档位尚未配置生图模型接口');
  }
  const editCost = 2;
  const charged = chargeCredits(user.id, editCost, '画板单页修改：' + instruction.slice(0, 40));
  if (!charged.ok) return res.status(402).json({ success: false, error: charged.error, credits: charged.credits });
  void (async () => {
    try {
      // 单页画板编辑与 PPT 批量生图共用六路上游并发闸门。
      const generated = await withImageSlot(() => generateImageEdit(cfg, image, instruction, originalSize.width + 'x' + originalSize.height, mask));
      // 上游可能只返回临时远程 URL，而工作台随后会把结果写回作品库。
      // 统一转成受校验的 data URL，避免前端把远程 URL 当成本地图片保存而失败。
      let result = generated;
      if (!/^data:image\/(png|jpeg|webp);base64,/.test(result)) {
        const remote = await fetch(result, { signal: AbortSignal.timeout(120_000) });
        if (!remote.ok) throw new Error('下载修改结果失败 HTTP ' + remote.status);
        const mime = String(remote.headers.get('content-type') || '').toLowerCase().split(';')[0].trim();
        if (mime !== 'image/png' && mime !== 'image/jpeg' && mime !== 'image/webp') throw new Error('修改结果不是支持的图片格式');
        const bytes = Buffer.from(await remote.arrayBuffer());
        if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error('修改结果文件过大');
        assertNative16x9(bytes, '单页修改结果');
        result = 'data:' + mime + ';base64,' + bytes.toString('base64');
      }
      if (/^data:image\/(png|jpeg|webp);base64,/.test(result)) {
        assertNative16x9(dataUrlBytes(result), '单页修改结果');
      }
      res.json({ success: true, image: result });
    } catch (err: any) {
      refundCredits(user.id, editCost, '画板单页修改失败，退回点数');
      if (!res.headersSent) res.status(502).json({ success: false, error: '图像修改失败：' + String(err?.message || err).slice(0, 160) });
    }
  })().catch(err => {
    // 客户端提前断开时写响应会抛错；兜住它，避免变成 unhandledRejection 污染进程。
    console.error('[workspace] 单页修改响应失败:', String(err?.message || err).slice(0, 180));
  });
});
app.use('/api',(_req,res)=>res.status(404).json({success:false,error:'接口不存在'}));
// 旧首页静态入口已从正式版本移除，避免旧地址被 SPA fallback 再次渲染成页面。
app.use('/legacy', (_req, res) => res.status(410).send('旧版页面已下线，请访问首页或正式工作台'));
const canvasDir = path.resolve(__dirname, 'public/infinite-canvas');
app.use('/infinite-canvas', express.static(canvasDir, { setHeaders(res){ res.setHeader('Cache-Control','public, max-age=86400'); } }));
app.get('/infinite-canvas/*', (_req, res) => res.sendFile(path.join(canvasDir, 'index.html')));

async function startServer(){const isProd=process.env.NODE_ENV==='production';if(!isProd){const {createServer}=await import('vite');const vite=await createServer({server:{middlewareMode:true,watch:{ignored:['**/data/**','**/dist/**','**/integrations/**','**/public/infinite-canvas/**','**/screenshots/**','**/2026-10-*/**','**/.tmp-*/**']}},appType:'spa'});app.use(vite.middlewares);}else{
    const distDir = path.resolve(__dirname,'dist');
    // sourcemap 仅用于上传到错误监控平台，绝不随产物公开分发：
    // 否则任何人下载 .map 即可还原完整源码（含业务逻辑与内部接口结构）。
    app.use((req, res, next) => {
      if (req.path.endsWith('.map')) return res.status(404).type('text/plain').send('Not Found');
      return next();
    });
    // 缓存策略：Vite 产物文件名带内容哈希，可永久缓存；
    // 模板图等无哈希的静态资源给一天；HTML 必须每次校验，保证发版即时生效。
    app.use(express.static(distDir, {
      setHeaders(res, filePath) {
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else if (/\.html?$/i.test(filePath)) {
          res.setHeader('Cache-Control', 'no-cache');
        } else {
          res.setHeader('Cache-Control', 'public, max-age=86400');
        }
      },
    }));
    app.get('*',(_req,res)=>{ res.setHeader('Cache-Control','no-cache'); res.sendFile(path.join(distDir,'index.html')); });
  }
  const httpServer = app.listen(PORT,'0.0.0.0',()=>{console.log('[CELANO PPT] 重构基线服务已启动: http://0.0.0.0:'+PORT);assertNotDefaultAdminPassword(isProd);});
  installGracefulShutdown(httpServer);
}

/**
 * 默认管理员口令是随源码公开的，生产环境继续使用它等于把后台交给任何人。
 * 检测到仍在使用默认口令时，生产模式给出明确处置提示；开发模式只做一次性提醒。
 */
function assertNotDefaultAdminPassword(isProd: boolean){
  const admin = db.getAdminByUsername(DEFAULT_ADMIN_USERNAME);
  const credential = admin ? db.getCredentials(admin.id) : undefined;
  const stillDefault = !!credential && verifyPassword(DEFAULT_ADMIN_PASSWORD, credential);
  if (!stillDefault) return;
  if (isProd) {
    console.warn('[安全告警] 管理员仍在初始口令 ' + DEFAULT_ADMIN_PASSWORD + ' 上，请立即登录 /admin 修改，或设置 ADMIN_INITIAL_PASSWORD 后重建 data/。');
  } else {
    console.warn('[安全提示] 当前使用初始管理员口令 ' + DEFAULT_ADMIN_PASSWORD + '，仅供本地开发；生产部署请设置 ADMIN_INITIAL_PASSWORD。');
  }
}

/**
 * 优雅关闭：先停止接收新连接，再等在途请求结束。
 * 此前进程收到 SIGTERM 会立刻退出，正在生成/下载的页面结果直接丢失，
 * 用户已扣的点数只能靠下一轮启动的恢复逻辑兜底。
 */
function installGracefulShutdown(httpServer: import('node:http').Server) {
  let closing = false;
  const shutdown = (signal: string) => {
    if (closing) return;
    closing = true;
    console.log('[CELANO PPT] 收到 ' + signal + '，开始优雅关闭…');
    httpServer.close(() => { console.log('[CELANO PPT] 已停止接收新请求，进程退出'); process.exit(0); });
    // SSE 等长连接不会自行断开，给兜底上限，避免进程永远退不出去。
    const timer = setTimeout(() => { console.warn('[CELANO PPT] 关闭超时，强制退出'); process.exit(0); }, 10_000);
    timer.unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

startServer();
