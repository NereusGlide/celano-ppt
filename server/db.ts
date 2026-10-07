import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import {
  Presentation,
  User,
  ThirdPartyApiConfig,
  GenerationJob,
  AdminAccount,
  InviteCode,
  RechargeCode,
  UsageRecord,
  AiProviderConfig,
  ImageTierConfig,
  ImageResolution,
  PlanningModelConfig,
  PromptOptimizeModelConfig,
  PromptOptimizeCallConfig,
  PptDeck,
  MembershipPlanConfig,
  MembershipCode
} from '../src/types.js';
import {
  PasswordCredential,
  DEFAULT_DEMO_PASSWORD,
  hashPassword
} from './auth.js';
import { DEFAULT_ADMIN_USERNAME, resolveInitialAdminPassword } from './adminAuth.js';
import type { CanvasAsset } from '../src/services/canvasAssets.js';
import { normalizePlanningModelName } from './planningModel.js';

interface DatabaseSchema {
  canvasAssets?: Array<CanvasAsset & { userId: string; imageFile?: string; deletedAt?: string }>;
  users: User[];
  /** 密码凭据（scrypt 哈希 + 盐），与 User 分开存放，避免随 API 泄露 */
  credentials: Record<string, PasswordCredential>; // keyed by userId
  presentations: Presentation[];
  jobs: GenerationJob[];
  apiConfigs: Record<string, ThirdPartyApiConfig[]>; // keyed by userId

  /* ---------- 管理后台 ---------- */
  admins: AdminAccount[];
  inviteCodes: InviteCode[];
  rechargeCodes: RechargeCode[];
  membershipCodes: MembershipCode[];
  usageRecords: UsageRecord[];
  aiConfigs: AiProviderConfig[];
  /** 内容规划模型配置（仅管理端可见） */
  planningConfig: PlanningModelConfig;
  /** 提示词优化模型配置（仅管理端可见；未启用时回退内容规划模型） */
  promptOptimizeConfig: PromptOptimizeModelConfig;
  /** 会员套餐目录（管理端可编辑） */
  membershipPlans: MembershipPlanConfig[];
  /** PPT 生成任务（移植自超级画布Agent，无计费） */
  pptDecks: PptDeck[];
  /** 已执行的数据兼容迁移版本，避免历史计费修正重复执行 */
  billingMigrationVersion?: number;
  /** 使用记录 IP 回填迁移版本（把 detail 文本里的 IP 搬到独立字段） */
  usageIpBackfillVersion?: number;
  /** 码类「使用者」用户名回填迁移版本（补齐历史漏写的 usedByName） */
  codeUserNameBackfillVersion?: number;
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'store.json');
/** 页面图片根目录：大图与 store.json 分离存放，避免二进制内容进入主存储。 */
const DATA_IMAGES = path.resolve(process.cwd(), 'data', 'images');
/** 集合硬上限：store.json 是全量落盘，任一无界集合都会把单次写入拖垮。 */
const USAGE_RECORD_LIMIT = 5000;

// 纯净发行版不预置前台用户或演示作品。
const initialUsers: User[] = [];
const initialPresentations: Presentation[] = [];

/** 默认会员套餐目录：管理后台可整体增删改；首月价仅作展示，真实成交以后端支付配置为准。 */
const DEFAULT_MEMBERSHIP_PLANS: MembershipPlanConfig[] = [
  { id: 'celano-basic', name: '基础会员', price: '¥29', renewalPrice: 29, points: 300, note: '适合轻度创作与日常出图', accent: 'blue', benefits: ['每月 300 点', '2K / 4K 九折', '无水印 · PNG 无损', '失败免费重试'], discount2k: 9, discount4k: 18, enabled: true },
  { id: 'celano-pro', name: '专业会员', price: '¥79', renewalPrice: 79, points: 850, note: '适合稳定高频的视觉创作', accent: 'teal', recommended: true, benefits: ['每月 850 点', '2K 九折 · 4K 八折', '优先生成队列', '批量生成（一次 4 张）'], discount2k: 9, discount4k: 16, enabled: true },
  { id: 'celano-premium', name: '尊享会员', price: '¥199', renewalPrice: 199, points: 2400, note: '适合重度个人创作者', accent: 'violet', benefits: ['每月 2400 点', '2K 八折 · 4K 七折', '极速生成通道', '批量生成（一次 20 张）'], discount2k: 8, discount4k: 14, enabled: true },
  { id: 'celano-flagship', name: '旗舰会员', price: '¥399', renewalPrice: 399, points: 5000, note: '适合专业商用与团队生产', accent: 'gold', benefits: ['每月 5000 点', '2K 七折 · 4K 六折', '极速 + 最高并发', '批量生成（一次 100 张）'], discount2k: 7, discount4k: 12, enabled: true },
];

/**
 * 提示词优化模型配置的默认值：默认关闭独立通道。
 *
 * 关闭时所有提示词优化接口回退到「内容规划模型」，与新增本配置之前的行为完全一致，
 * 因此升级不会改变现有部署的实际调用链路；管理员显式启用并填齐后才切换通道。
 */
export const DEFAULT_PROMPT_OPTIMIZE_CONFIG: PromptOptimizeModelConfig = {
  enabled: false,
  baseUrl: '',
  apiKey: '',
  modelName: '',
  reasoningEffort: 'medium',
  temperature: '',
  maxOutputTokens: '',
  systemPrompt: ''
};

// 默认 endpoint 仅用于本地演示，生产部署请用 PIAO_BASE_URL / 管理后台覆盖为自有地址。
// 密钥只能从环境变量或管理后台注入，源代码和示例数据不携带可用凭据。
export const DEFAULT_XIAOYI_CONFIG: ThirdPartyApiConfig = {
  id: 'xiaoyi_image',
  provider: 'custom',
  name: '小易图片接口',
  baseUrl: process.env.XIAOYI_BASE_URL || 'https://image.xiaoyiapi.xyz/v1',
  apiKey: process.env.XIAOYI_API_KEY || '',
  modelName: process.env.XIAOYI_IMAGE_MODEL || 'gpt-image-2',
  isActive: true,
  resolutionSupport: ['2K']
};

// 同上：默认 endpoint 只在本地演示时生效，生产请用 PIAO_BASE_URL 覆盖为自有中转地址。
export const DEFAULT_PIAO_CONFIG: ThirdPartyApiConfig = {
  id: 'piao_world_sunburst',
  provider: 'custom',
  name: 'Piao.world (gpt-image-2.5-sunburst)',
  baseUrl: process.env.PIAO_BASE_URL || 'https://piao.world/v1',
  // 密钥只能从环境变量或管理后台注入，源代码和示例数据不再携带可用凭据。
  apiKey: process.env.PIAO_API_KEY || '',
  modelName: 'gpt-image-2.5-sunburst',
  isActive: true,
  resolutionSupport: ['2K', '4K']
};

// 显式提供小易凭据时，默认走小易；没有凭据则继续使用现有配置，避免启动后把生图服务切到不可用状态。
export const DEFAULT_IMAGE_CONFIG = process.env.XIAOYI_API_KEY
  ? DEFAULT_XIAOYI_CONFIG
  : DEFAULT_PIAO_CONFIG;

const IMAGE_RESOLUTIONS: ImageResolution[] = ['2K', '4K'];

/** A configuration is usable only when it can actually reach an upstream model. */
function usableImageConfig(config: AiProviderConfig | undefined): config is AiProviderConfig {
  return !!config && config.enabled !== false && !!String(config.baseUrl || '').trim() && !!String(config.apiKey || '').trim() && !!String(config.modelName || '').trim();
}

/** 把表单里的可选数值转成有限数字；留空或非法时返回 undefined（表示使用上游默认）。 */
function parseOptionalNumber(raw: unknown, min: number, max: number): number | undefined {
  const text = String(raw ?? '').trim();
  if (!text) return undefined;
  const value = Number(text);
  if (!Number.isFinite(value) || value < min || value > max) return undefined;
  return value;
}

/** 同上的整型版本，用于 token 上限这类必须为正整数的参数。 */
function parseOptionalInteger(raw: unknown): number | undefined {
  const text = String(raw ?? '').trim();
  if (!text) return undefined;
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value <= 0) return undefined;
  return value;
}

function displayNameFor(config: AiProviderConfig, resolution?: ImageResolution): string {
  const label = String(config.displayName || config.name || '').trim();
  return label || (resolution ? `${resolution} 生图` : 'CELANO 生图');
}

function tierIsUsable(config: AiProviderConfig, resolution: ImageResolution): boolean {
  const tier = config.resolutionConfigs?.[resolution];
  return !!tier && tier.enabled !== false && !!String(tier.baseUrl || '').trim() && !!String(tier.apiKey || '').trim() && !!String(tier.modelName || '').trim();
}

/**
 * Select the source row for one image resolution.
 *
 * Resolution rows are intentionally strict: a 4K row is never silently used
 * for a lower-tier request. A single generic row remains supported as an explicit
 * fallback when it advertises the requested resolution (or has no support list).
 */
function selectImageConfig(list: AiProviderConfig[], resolution?: ImageResolution): { config?: AiProviderConfig; tier?: ImageTierConfig; exact?: ImageResolution } {
  const enabled = list.filter(item => item.enabled !== false);
  if (!resolution) {
    const generic = enabled.find(item => !item.resolution && item.isDefault && usableImageConfig(item))
      || enabled.find(item => !item.resolution && usableImageConfig(item));
    if (generic) return { config: generic };
    const first = enabled.find(item => Boolean(usableImageConfig(item)) || IMAGE_RESOLUTIONS.includes(item.resolution as ImageResolution));
    return first ? { config: first, exact: first.resolution } : {};
  }

  // Explicit per-resolution rows have priority over all compatibility modes.
  const exact = enabled.find(item => item.resolution === resolution && usableImageConfig(item));
  if (exact) return { config: exact, exact: resolution };

  // Keep support for the previous nested shape while routing through its own
  // endpoint credentials and model ID.
  const nested = enabled.find(item => !item.resolution && tierIsUsable(item, resolution));
  if (nested) return { config: nested, tier: nested.resolutionConfigs?.[resolution], exact: resolution };

  // A generic row is a deliberate fallback only when it supports this tier.
  const generic = enabled.find(item => !item.resolution && usableImageConfig(item) && (!item.resolutionSupport?.length || item.resolutionSupport.includes(resolution)));
  if (generic) return { config: generic, exact: resolution };
  return {};
}

class Database {
  private data: DatabaseSchema;
  /** 事务嵌套深度与待落盘标记，配合 transaction() 合并写盘。 */
  private saveDepth = 0;
  private savePending = false;
  /** 初始化失败时禁止后续写入，保留原文件等待恢复。 */
  private initializationFailed = false;

  constructor() {
    this.data = {
      users: [...initialUsers],
      credentials: {},
      presentations: [...initialPresentations],
      jobs: [],
      apiConfigs: {},
      admins: [],
      inviteCodes: [],
      rechargeCodes: [],
      membershipCodes: [],
      usageRecords: [],
      aiConfigs: [],
      planningConfig: { baseUrl: '', apiKey: '', modelName: '', reasoningEffort: '', visionModelName: '' },
      promptOptimizeConfig: { ...DEFAULT_PROMPT_OPTIMIZE_CONFIG },
      membershipPlans: [...DEFAULT_MEMBERSHIP_PLANS],
      pptDecks: [],
      billingMigrationVersion: 0
    };
    this.init();
  }

  private init() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      if (fs.existsSync(DATA_FILE)) {
        const raw = fs.readFileSync(DATA_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        if (!parsed || !Array.isArray(parsed.users) || !Array.isArray(parsed.presentations)) {
          throw new Error('数据文件结构无效，拒绝覆盖已有数据');
        }
        // 先用构造函数默认值兜底（如 credentials），再被落盘数据覆盖
        this.data = { ...this.data, ...parsed };
      }
      this.migrate();
      this.save();
    } catch (err) {
      this.initializationFailed = true;
      if (process.env.NODE_ENV === 'production') throw err;
      // 数据文件损坏/不可读时，先把原文件备份一份，再退回内存数据继续启动。
      // 否则任何后续写操作都会用空数据把原 store.json 覆盖掉，造成二次且不可逆的丢失。
      try {
        if (fs.existsSync(DATA_FILE)) {
          const backup = DATA_FILE + '.corrupt-' + Date.now() + '.bak';
          fs.copyFileSync(DATA_FILE, backup);
          console.error('[DB] 已备份损坏的数据文件到:', backup);
        }
      } catch (backupErr) {
        console.error('[DB] 备份损坏的数据文件失败:', backupErr);
      }
      console.error('[DB] 初始化数据文件失败，已回退内存数据。请立即排查并恢复备份，勿在恢复前进行写操作:', err);
    }
  }

  /** 兼容历史数据：补齐预置账号手机号，并为缺少凭据的账号补默认密码 */
  private migrate() {
    if (!this.data.credentials) this.data.credentials = {};

    for (const seed of initialUsers) {
      const existing = this.data.users.find(u => u.id === seed.id);
      if (existing && !existing.phone && seed.phone) {
        existing.phone = seed.phone;
      }
    }

    for (const u of this.data.users) {
      if (!this.data.credentials[u.id]) {
        this.data.credentials[u.id] = hashPassword(DEFAULT_DEMO_PASSWORD);
      }
      if (typeof u.credits !== 'number') u.credits = 100;
      if (!u.status) u.status = 'active';
    }

    // 后台集合兜底
    if (!this.data.admins) this.data.admins = [];
    if (!this.data.inviteCodes) this.data.inviteCodes = [];
    if (!this.data.rechargeCodes) this.data.rechargeCodes = [];
    if (!this.data.membershipCodes) this.data.membershipCodes = [];
    if (!this.data.usageRecords) this.data.usageRecords = [];
    if (!this.data.aiConfigs) this.data.aiConfigs = [];
    if (!Array.isArray(this.data.membershipPlans) || !this.data.membershipPlans.length) this.data.membershipPlans = [...DEFAULT_MEMBERSHIP_PLANS];
    for (const config of this.data.aiConfigs) {
      if (!config.displayName) config.displayName = config.name;
      if (!Array.isArray(config.resolutionSupport)) config.resolutionSupport = [...IMAGE_RESOLUTIONS];
    }
    if (!this.data.pptDecks) this.data.pptDecks = [];
    for (const deck of this.data.pptDecks) {
      if (deck.resolution !== '2K' && deck.resolution !== '4K') deck.resolution = '2K';
      // PPT 产品固定使用 6 路页面生图并发；历史任务可能保存过旧的并发数，
      // 恢复/重试时也应遵循当前吞吐策略。
      deck.concurrency = 6;
    }

    // 旧版画板修改曾按 4 点扣费，并把消耗流水错误记录为正数。
    // 当前规则是单页修改 2 点；仅对明确属于旧版“涂抹修改页面”的流水做一次性校正。
    if ((this.data.billingMigrationVersion || 0) < 1) {
      for (const record of this.data.usageRecords) {
        if (record.type !== 'slide_image' || record.credits !== 4 || !record.detail.startsWith('涂抹修改页面')) continue;
        record.credits = -2;
        const user = this.data.users.find(item => item.id === record.userId);
        if (user) user.credits = Math.max(0, Math.floor(Number(user.credits) || 0) + 2);
      }
      this.data.billingMigrationVersion = 1;
    }

    // 点数价值体系升级（1 元 = 10 点，2K=10、4K=20，原 2K=3、4K=5）：
    // 把存量余额按 10/3 比例向上取整迁移，保证用户既有购买力不缩水。
    if ((this.data.billingMigrationVersion || 0) < 2) {
      for (const user of this.data.users) {
        const balance = Math.max(0, Math.floor(Number(user.credits) || 0));
        if (balance > 0) user.credits = Math.ceil(balance * 10 / 3);
      }
      this.data.billingMigrationVersion = 2;
    }

    // 旧会员计划（无画质折扣字段）整表替换为新的四档付费套餐。
    // 用「字段缺失」而非版本号做幂等判断：billingMigrationVersion 可能已先被
    // 前面的余额迁移推进，但计划可能仍是旧结构；仅当整套计划都缺折扣字段时替换，
    // 避免覆盖管理员在新体系下自定义过的折扣套餐。
    const plansWithoutDiscount = Array.isArray(this.data.membershipPlans) && this.data.membershipPlans.length > 0
      && this.data.membershipPlans.every(plan => !('discount2k' in plan) || !('discount4k' in plan));
    if (plansWithoutDiscount) this.data.membershipPlans = [...DEFAULT_MEMBERSHIP_PLANS];

    // 预置超级管理员
    if (this.data.admins.length === 0) {
      const adminId = 'admin_root';
      this.data.admins.push({
        id: adminId,
        username: DEFAULT_ADMIN_USERNAME,
        name: '超级管理员',
        role: 'super',
        status: 'active',
        createdAt: Date.now()
      });
      // 生产部署应通过 ADMIN_INITIAL_PASSWORD 注入强口令，回落到默认值时服务端会告警。
      this.data.credentials[adminId] = hashPassword(resolveInitialAdminPassword());
    }

    // 邀请码由管理员在后台创建，发行版不附带历史或公开邀请码。

    // 预置内容规划模型配置（仅管理端可见，前台不可见）
    if (!this.data.planningConfig) {
      this.data.planningConfig = {
        baseUrl: DEFAULT_IMAGE_CONFIG.baseUrl,
        apiKey: DEFAULT_IMAGE_CONFIG.apiKey,
        modelName: 'gpt-6.1-sol',
        reasoningEffort: 'xhigh',
        visionModelName: 'gpt-6'
      };
    } else {
      if (!this.data.planningConfig.baseUrl) this.data.planningConfig.baseUrl = DEFAULT_PIAO_CONFIG.baseUrl;
      if (!this.data.planningConfig.apiKey) this.data.planningConfig.apiKey = DEFAULT_PIAO_CONFIG.apiKey;
      if (!this.data.planningConfig.modelName) this.data.planningConfig.modelName = 'gpt-6.1-sol';
      if (!this.data.planningConfig.reasoningEffort) this.data.planningConfig.reasoningEffort = 'xhigh';
      if (!this.data.planningConfig.optimizeReasoningEffort) this.data.planningConfig.optimizeReasoningEffort = 'medium';
      if (!this.data.planningConfig.visionModelName) this.data.planningConfig.visionModelName = 'gpt-6';
    }

    // 预置提示词优化模型配置：默认不启用独立通道，继续回退内容规划模型，
    // 保证升级到本版本后既有部署的调用链路与行为不变。
    if (!this.data.promptOptimizeConfig) {
      this.data.promptOptimizeConfig = { ...DEFAULT_PROMPT_OPTIMIZE_CONFIG };
    } else {
      const own = this.data.promptOptimizeConfig;
      if (typeof own.enabled !== 'boolean') own.enabled = false;
      if (typeof own.baseUrl !== 'string') own.baseUrl = '';
      if (typeof own.apiKey !== 'string') own.apiKey = '';
      if (typeof own.modelName !== 'string') own.modelName = '';
      if (!own.reasoningEffort) own.reasoningEffort = DEFAULT_PROMPT_OPTIMIZE_CONFIG.reasoningEffort;
      if (typeof own.temperature !== 'string') own.temperature = '';
      if (typeof own.maxOutputTokens !== 'string') own.maxOutputTokens = '';
      if (typeof own.systemPrompt !== 'string') own.systemPrompt = '';
    }

    // 使用记录 IP 回填：早期版本把客户端 IP 只拼在 detail 文本尾部
    //（如「账号登录 · IP 127.0.0.1」）。后台新增了独立的 IP 列，若不回填，
    // 历史记录在这一列上会是一片空白，看不出真实来源。
    if (this.data.usageIpBackfillVersion !== 1) {
      let filled = 0;
      for (const record of this.data.usageRecords || []) {
        if (record.ip) continue;
        const matched = /·\s*IP\s+([0-9a-fA-F:.]+)\s*$/.exec(record.detail || '');
        if (matched) { record.ip = matched[1]; filled += 1; }
      }
      this.data.usageIpBackfillVersion = 1;
      if (filled) console.log('[usage] 已从历史详情回填 ' + filled + ' 条记录的真实 IP');
    }

    // 码类「使用者」回填：历史数据可能只写了 usedBy(userId) 而漏写 usedByName。
    // 用用户表当前用户名补上，让数据层的「使用者」也不再是空的。
    // 展示层仍以运行时按 userId 关联为准（改名后自动更新），这里只是兜底。
    if (this.data.codeUserNameBackfillVersion !== 1) {
      let filled = 0;
      for (const item of [...(this.data.rechargeCodes || []), ...(this.data.membershipCodes || [])]) {
        if (item.usedBy && !item.usedByName) {
          const user = this.getUserById(item.usedBy);
          if (user) { item.usedByName = user.username; filled += 1; }
        }
      }
      this.data.codeUserNameBackfillVersion = 1;
      if (filled) console.log('[admin] 已回填 ' + filled + ' 条码记录的「使用者」真实用户名');
    }

    // 生图接口由管理员分别配置 2K、4K，发行版不保存已有接口。

  }

  /**
   * 把一批写操作合并成一次落盘。
   *
   * store.json 是全量序列化后整体替换，写一次的成本与库大小成正比。
   * 「扣点 + 记流水」这类必须成对出现的操作若各写一次，既放大了写成本，
   * 又在两次写之间留下崩溃窗口（余额已变但流水缺失，事后无法对账）。
   * 事务内所有 save() 只登记一次，提交时才真正写盘。
   */
  transaction<T>(fn: () => T): T {
    const snapshot = structuredClone(this.data);
    const previousPending = this.savePending;
    const depth = this.saveDepth;
    this.saveDepth = depth + 1;
    try {
      const result = fn();
      // 该仓储使用同步落盘；异步回调会在事务提交后继续修改数据。
      if (result && typeof (result as { then?: unknown }).then === 'function') {
        throw new Error('数据库事务回调必须同步执行');
      }
      this.saveDepth = depth;
      if (depth === 0 && this.savePending) {
        this.save();
        this.savePending = false;
      }
      return result;
    } catch (error) {
      // 回调或原子落盘失败均恢复内存，避免下一次保存写入半笔账务。
      this.data = snapshot;
      this.saveDepth = depth;
      this.savePending = previousPending;
      throw error;
    }
  }

  private save() {
    if (this.initializationFailed) throw new Error('数据库初始化失败，写入已禁用，请恢复数据后重启服务');
    if (this.saveDepth > 0) { this.savePending = true; return; }
    // 原子替换避免断电/崩溃留下半份 JSON；生图大文件保存在 data/images，不写进 store.json
    const temp = DATA_FILE + '.' + process.pid + '.tmp';
    try {
      fs.writeFileSync(temp, JSON.stringify(this.data), 'utf-8');
      fs.renameSync(temp, DATA_FILE);
    } catch (err) {
      try { if (fs.existsSync(temp)) fs.unlinkSync(temp); } catch { /* best effort */ }
      console.error('[DB] 保存数据失败:', err);
      throw err;
    }
  }

  /**
   * 流水的唯一写入口：统一 id 规则、排序与条数上限。
   * 注意：本方法只改内存，不落盘——调用方需自行 save()，
   * 以便在同一次落盘内完成「余额变更 + 流水」，避免中途崩溃造成账务不平。
   */
  private pushUsageRecord(record: UsageRecord): UsageRecord {
    this.data.usageRecords.unshift(record);
    if (this.data.usageRecords.length > USAGE_RECORD_LIMIT) {
      this.data.usageRecords = this.data.usageRecords.slice(0, USAGE_RECORD_LIMIT);
    }
    return record;
  }

  private newUsageRecord(input: { userId: string; username: string; type: UsageRecord['type']; detail: string; credits: number }): UsageRecord {
    return {
      id: 'use_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      ...input,
      createdAt: Date.now(),
    };
  }

  // Users
  getUsers(): User[] {
    return this.data.users;
  }

  getCanvasAssets(userId: string) {
    return (this.data.canvasAssets || []).filter(asset => asset.userId === userId && !asset.deletedAt);
  }

  /** 全部未删除的画布素材（过期清理扫描用）。 */
  getAllCanvasAssets() {
    return (this.data.canvasAssets || []).filter(asset => !asset.deletedAt);
  }

  /** 与 getCanvasAssets 保持一致：软删除后不再可被读取（否则已删素材的图片仍能取到）。 */
  getCanvasAsset(userId: string, id: string, includeDeleted = false) {
    return (this.data.canvasAssets || []).find(asset => asset.userId === userId && asset.id === id && (includeDeleted || !asset.deletedAt));
  }

  putCanvasAsset(asset: CanvasAsset & { userId: string; imageFile?: string }) {
    const assets = this.data.canvasAssets ||= [];
    const index = assets.findIndex(item => item.userId === asset.userId && item.id === asset.id);
    if (index >= 0) assets[index] = asset; else assets.push(asset);
    this.save();
    return asset;
  }

  deleteCanvasAsset(userId: string, id: string) {
    const asset = this.getCanvasAsset(userId, id);
    if (asset) asset.deletedAt = new Date().toISOString();
    this.save();
  }

  getUserById(id: string): User | undefined {
    return this.data.users.find(u => u.id === id);
  }

  /** 按账号 / 邮箱 / 手机号定位用户（登录入口统一走这里） */
  getUserByUsernameOrEmail(identifier: string): User | undefined {
    const q = identifier.trim().toLowerCase();
    return this.data.users.find(u =>
      u.username.toLowerCase() === q ||
      (u.email || '').toLowerCase() === q ||
      (u.phone || '') === q
    );
  }

  createUser(user: User, password?: string): User {
    this.data.users.push(user);
    if (password) {
      this.data.credentials[user.id] = hashPassword(password);
    }
    this.save();
    return user;
  }

  // Credentials
  getCredentials(userId: string): PasswordCredential | undefined {
    return this.data.credentials[userId];
  }

  setCredentials(userId: string, credential: PasswordCredential): void {
    this.data.credentials[userId] = credential;
    this.save();
  }

  updateUser(id: string, updates: Partial<User>): User | null {
    const idx = this.data.users.findIndex(u => u.id === id);
    if (idx === -1) return null;
    this.data.users[idx] = { ...this.data.users[idx], ...updates };
    this.save();
    return this.data.users[idx];
  }

  // Presentations
  getPresentations(userId?: string): Presentation[] {
    if (userId) {
      return this.data.presentations.filter(p => p.userId === userId);
    }
    return this.data.presentations;
  }

  getPresentationById(id: string): Presentation | undefined {
    return this.data.presentations.find(p => p.id === id);
  }

  createPresentation(pres: Presentation): Presentation {
    this.data.presentations.unshift(pres);
    this.save();
    return pres;
  }

  updatePresentation(id: string, updates: Partial<Presentation>): Presentation | null {
    const idx = this.data.presentations.findIndex(p => p.id === id);
    if (idx === -1) return null;
    this.data.presentations[idx] = {
      ...this.data.presentations[idx],
      ...updates,
      updatedAt: Date.now()
    };
    this.save();
    return this.data.presentations[idx];
  }

  deletePresentation(id: string): boolean {
    const idx = this.data.presentations.findIndex(p => p.id === id);
    if (idx === -1) return false;
    this.data.presentations.splice(idx, 1);
    this.save();
    return true;
  }

  // Third party API configs
  getUserApiConfigs(userId: string): ThirdPartyApiConfig[] {
    const list = this.data.apiConfigs[userId] || [];
    if (!list.some(c => c.id === 'piao_world_sunburst')) {
      return [DEFAULT_IMAGE_CONFIG, ...list];
    }
    return list;
  }

  saveUserApiConfigs(userId: string, configs: ThirdPartyApiConfig[]): ThirdPartyApiConfig[] {
    this.data.apiConfigs[userId] = configs;
    this.save();
    return configs;
  }

  // Jobs
  getJobs(userId?: string): GenerationJob[] {
    if (userId) {
      return this.data.jobs.filter(j => j.userId === userId);
    }
    return this.data.jobs;
  }

  getJobById(id: string): GenerationJob | undefined {
    return this.data.jobs.find(j => j.id === id);
  }

  createJob(job: GenerationJob): GenerationJob {
    this.data.jobs.unshift(job);
    if (this.data.jobs.length > 200) {
      // 仅裁剪历史终态任务，不能丢弃仍在排队/处理中或被依赖的任务
      const active = this.data.jobs.filter(j => j.status === 'pending' || j.status === 'processing');
      const done = this.data.jobs.filter(j => j.status === 'completed' || j.status === 'failed');
      this.data.jobs = [...active, ...done.slice(0, Math.max(0, 200 - active.length))].sort((a, b) => b.createdAt - a.createdAt);
    }
    this.save();
    return job;
  }

  updateJob(id: string, updates: Partial<GenerationJob>): GenerationJob | null {
    const idx = this.data.jobs.findIndex(j => j.id === id);
    if (idx === -1) return null;
    this.data.jobs[idx] = { ...this.data.jobs[idx], ...updates };
    this.save();
    return this.data.jobs[idx];
  }

  // ---------- PPT 生成任务 ----------
  getPptDecks(userId?: string): PptDeck[] {
    const list = userId ? this.data.pptDecks.filter(d => d.userId === userId) : this.data.pptDecks;
    return [...list].sort((a, b) => b.startedAt - a.startedAt);
  }

  getPptDeck(id: string): PptDeck | undefined {
    return this.data.pptDecks.find(d => d.id === id);
  }

  createPptDeck(deck: PptDeck): PptDeck {
    this.data.pptDecks.unshift(deck);
    // 仅裁剪已结束的旧任务，不丢弃进行中/未完成的任务
    if (this.data.pptDecks.length > 200) {
      const active = this.data.pptDecks.filter(d => d.running || !d.finished);
      const done = this.data.pptDecks.filter(d => !d.running && d.finished);
      this.data.pptDecks = [...active, ...done.slice(0, Math.max(0, 200 - active.length))].sort((a, b) => b.startedAt - a.startedAt);
    }
    this.save();
    return deck;
  }

  updatePptDeck(id: string, updates: Partial<PptDeck>): PptDeck | null {
    const idx = this.data.pptDecks.findIndex(d => d.id === id);
    if (idx === -1) return null;
    const current = this.data.pptDecks[idx];
    const next = { ...current, ...updates, updatedAt: Date.now() };
    // 首次全部完成时记录完成时间，作为 7 天保留期起点（后续编辑不再刷新）
    if (updates.finished === true && !current.finished) next.finishedAt = Date.now();
    this.data.pptDecks[idx] = next;
    this.save();
    return this.data.pptDecks[idx];
  }

  /**
   * 将失败页退款、标记退款页和写入流水放在一次 store 保存中，
   * 避免进程在“已加余额但尚未记账”之间崩溃后重复退款。
   */
  refundPptFailedSlides(userId: string, deckId: string, slideIds: string[], amount: number, detail: string, amounts?: Map<string, number>): { refunded: number; credits: number } {
    return this.transaction(() => this.refundPptFailedSlidesInternal(userId, deckId, slideIds, amount, detail, amounts));
  }

  private refundPptFailedSlidesInternal(userId: string, deckId: string, slideIds: string[], amount: number, detail: string, amounts?: Map<string, number>): { refunded: number; credits: number } {
    const deck = this.data.pptDecks.find(item => item.id === deckId && item.userId === userId);
    const user = this.data.users.find(item => item.id === userId);
    if (!deck || !user) return { refunded: 0, credits: Math.max(0, Math.floor(Number(user?.credits) || 0)) };
    const ids = new Set(deck.refundedSlideIds || []);
    const eligible = deck.slides.filter(slide => slideIds.includes(slide.id) && slide.status === 'failed' && !ids.has(slide.id));
    if (!eligible.length) return { refunded: 0, credits: Math.max(0, Math.floor(Number(user.credits) || 0)) };
    const requested = Math.max(0, Math.floor(Number(amount) || 0));
    const fallbackPerSlide = amounts ? 0 : (eligible.length ? Math.floor(requested / eligible.length) : 0);
    const perSlideAmount = (slide: PptDeck['slides'][number]) => Math.max(0, Math.floor(Number(amounts?.get(slide.id) ?? fallbackPerSlide) || 0));
    const refund = Math.min(requested, eligible.reduce((sum, slide) => sum + perSlideAmount(slide), 0));
    if (!refund) return { refunded: 0, credits: Math.max(0, Math.floor(Number(user.credits) || 0)) };
    user.credits = Math.max(0, Math.floor(Number(user.credits) || 0)) + refund;
    const refundedIds = eligible.filter(slide => perSlideAmount(slide) > 0).map(slide => slide.id);
    deck.refundedSlideIds = [...ids, ...refundedIds];
    for (const slide of eligible) {
      const perSlide = perSlideAmount(slide);
      if (!perSlide) continue;
      slide.refundedCredits = Math.max(0, Math.floor(Number(slide.refundedCredits) || 0)) + perSlide;
    }
    deck.refundedCredits = Math.max(0, Math.floor(Number(deck.refundedCredits) || 0)) + refund;
    deck.updatedAt = Date.now();
    this.pushUsageRecord(this.newUsageRecord({ userId, username: user.username, type: 'slide_image', detail, credits: refund }));
    this.save();
    return { refunded: refund, credits: user.credits || 0 };
  }

  /** 单页修改失败的原子退款与去重登记。 */
  refundPptSlide(userId: string, deckId: string, slideId: string, amount: number, detail: string): boolean {
    const deck = this.data.pptDecks.find(item => item.id === deckId && item.userId === userId);
    const user = this.data.users.find(item => item.id === userId);
    if (!deck || !user || !deck.slides.some(slide => slide.id === slideId)) return false;
    const ids = new Set(deck.refundedSlideIds || []);
    if (ids.has(slideId)) return true;
    const refund = Math.max(0, Math.floor(Number(amount) || 0));
    if (!refund) return true;
    user.credits = Math.max(0, Math.floor(Number(user.credits) || 0)) + refund;
    deck.refundedSlideIds = [...ids, slideId];
    deck.refundedCredits = Math.max(0, Math.floor(Number(deck.refundedCredits) || 0)) + refund;
    deck.updatedAt = Date.now();
    this.pushUsageRecord(this.newUsageRecord({ userId, username: user.username, type: 'slide_image', detail, credits: refund }));
    this.save();
    return true;
  }

  /**
   * 仅登记某页已退款（不改余额、不记流水），供单页重生成失败退款使用。
   *
   * 单页重生成是独立的扣费-退款闭环（每次重生成单独扣 2 点、失败单独退 2 点），
   * 退款金额走 refundCredits 记流水；这里只把该页加入 refundedSlideIds 幂等集合，
   * 避免后续批量退款流程（refundFailedSlides）对这个 failed 页重复退。
   * 与 refundPptSlide 的区别是它不因「已登记」而吞掉本次退款。
   */
  markPptSlideRefunded(userId: string, deckId: string, slideId: string): boolean {
    const deck = this.data.pptDecks.find(item => item.id === deckId && item.userId === userId);
    if (!deck || !deck.slides.some(slide => slide.id === slideId)) return false;
    const ids = new Set(deck.refundedSlideIds || []);
    if (ids.has(slideId)) return true;
    deck.refundedSlideIds = [...ids, slideId];
    deck.updatedAt = Date.now();
    this.save();
    return true;
  }

  /** 失败页重试扣点与“已退款页”标记一次完成，避免进程崩溃造成重复扣点。 */
  chargePptRetry(userId: string, deckId: string, slideIds: string[], amount: number, detail: string, amounts?: Map<string, number>): { ok: true; deck: PptDeck } | { ok: false; error: string } {
    return this.transaction(() => this.chargePptRetryInternal(userId, deckId, slideIds, amount, detail, amounts));
  }

  private chargePptRetryInternal(userId: string, deckId: string, slideIds: string[], amount: number, detail: string, amounts?: Map<string, number>): { ok: true; deck: PptDeck } | { ok: false; error: string } {
    const deck = this.data.pptDecks.find(item => item.id === deckId && item.userId === userId);
    const user = this.data.users.find(item => item.id === userId);
    if (!deck || !user) return { ok: false, error: '任务不存在' };
    const refunded = new Set(deck.refundedSlideIds || []);
    const retryIds = slideIds.filter(id => refunded.has(id));
    if (!retryIds.length) return { ok: true, deck };
    const cost = Math.max(0, Math.floor(Number(amount) || 0));
    const balance = Math.max(0, Math.floor(Number(user.credits) || 0));
    if (balance < cost) return { ok: false, error: '点数不足：本次需要 ' + cost + ' 点，当前余额 ' + balance + ' 点' };
    user.credits = balance - cost;
    deck.refundedSlideIds = [...refunded].filter(id => !retryIds.includes(id));
    for (const slide of deck.slides) {
      if (!retryIds.includes(slide.id)) continue;
      const perSlide = Math.max(0, Math.floor(Number(amounts?.get(slide.id) ?? (retryIds.length ? cost / retryIds.length : 0)) || 0));
      if (!Number.isFinite(Number(slide.billingCost)) || Number(slide.billingCost) < 0) slide.billingCost = perSlide;
      slide.chargedCredits = Math.max(0, Math.floor(Number(slide.chargedCredits) || 0)) + perSlide;
      // 历史退款是累计账务事实，重试扣费不能把它减掉。
      slide.refundedCredits = Math.max(0, Math.floor(Number(slide.refundedCredits) || 0));
    }
    deck.chargedCredits = Math.max(0, Math.floor(Number(deck.chargedCredits) || 0)) + cost;
    deck.error = undefined;
    deck.updatedAt = Date.now();
    this.pushUsageRecord(this.newUsageRecord({ userId, username: user.username, type: 'slide_image', detail, credits: -cost }));
    this.save();
    return { ok: true, deck };
  }

  deletePptDeck(id: string): boolean {
    const idx = this.data.pptDecks.findIndex(d => d.id === id);
    if (idx === -1) return false;
    this.data.pptDecks.splice(idx, 1);
    this.save();
    return true;
  }

  /* =========================================================
     管理后台
     ========================================================= */

  // ---------- 管理员 ----------
  getAdmins(): AdminAccount[] {
    return this.data.admins;
  }

  getAdminById(id: string): AdminAccount | undefined {
    return this.data.admins.find(a => a.id === id);
  }

  getAdminByUsername(username: string): AdminAccount | undefined {
    const q = String(username || '').trim().toLowerCase();
    return this.data.admins.find(a => a.username.toLowerCase() === q);
  }

  createAdmin(admin: AdminAccount, password: string): AdminAccount {
    this.data.admins.push(admin);
    this.data.credentials[admin.id] = hashPassword(password);
    this.save();
    return admin;
  }

  updateAdmin(id: string, updates: Partial<AdminAccount>): AdminAccount | null {
    const idx = this.data.admins.findIndex(a => a.id === id);
    if (idx === -1) return null;
    this.data.admins[idx] = { ...this.data.admins[idx], ...updates };
    this.save();
    return this.data.admins[idx];
  }

  // ---------- 邀请码 ----------
  getInviteCodes(): InviteCode[] {
    return this.data.inviteCodes;
  }

  getInviteCode(code: string): InviteCode | undefined {
    const q = String(code || '').trim().toUpperCase();
    return this.data.inviteCodes.find(c => c.code.toUpperCase() === q);
  }

  /** 校验邀请码是否可用（存在 / 启用 / 未过期 / 未超次数） */
  validateInviteCode(code: string): { ok: boolean; reason?: string; invite?: InviteCode } {
    const invite = this.getInviteCode(code);
    if (!invite) return { ok: false, reason: '邀请码不存在' };
    if (invite.status !== 'active') return { ok: false, reason: '邀请码已停用' };
    if (invite.expiresAt && invite.expiresAt < Date.now()) return { ok: false, reason: '邀请码已过期' };
    if (invite.maxUses > 0 && invite.usedCount >= invite.maxUses) {
      return { ok: false, reason: '邀请码使用次数已达上限' };
    }
    return { ok: true, invite };
  }

  consumeInviteCode(code: string, userId: string): void {
    const invite = this.getInviteCode(code);
    if (!invite) return;
    invite.usedCount += 1;
    if (!invite.usedBy.includes(userId)) invite.usedBy.push(userId);
    this.save();
  }

  createInviteCode(item: InviteCode): InviteCode {
    this.data.inviteCodes.unshift(item);
    this.save();
    return item;
  }

  /** 批量创建：一次落盘。逐个 createInviteCode 会让「生成 50 个码」触发 50 次全量写盘。 */
  createInviteCodes(items: InviteCode[]): InviteCode[] {
    if (!items.length) return items;
    this.data.inviteCodes.unshift(...items);
    this.save();
    return items;
  }

  updateInviteCode(code: string, updates: Partial<InviteCode>): InviteCode | null {
    const invite = this.getInviteCode(code);
    if (!invite) return null;
    Object.assign(invite, updates);
    this.save();
    return invite;
  }

  deleteInviteCode(code: string): boolean {
    const q = String(code || '').trim().toUpperCase();
    const idx = this.data.inviteCodes.findIndex(c => c.code.toUpperCase() === q);
    if (idx === -1) return false;
    this.data.inviteCodes.splice(idx, 1);
    this.save();
    return true;
  }

  // ---------- 充值码 ----------
  getRechargeCodes(): RechargeCode[] {
    return this.data.rechargeCodes;
  }

  getRechargeCode(code: string): RechargeCode | undefined {
    const q = String(code || '').trim().toUpperCase();
    return this.data.rechargeCodes.find(c => c.code.toUpperCase() === q);
  }

  createRechargeCodes(items: RechargeCode[]): RechargeCode[] {
    this.data.rechargeCodes.unshift(...items);
    this.save();
    return items;
  }

  updateRechargeCode(code: string, updates: Partial<RechargeCode>): RechargeCode | null {
    const item = this.getRechargeCode(code);
    if (!item) return null;
    Object.assign(item, updates);
    this.save();
    return item;
  }

  deleteRechargeCode(code: string): boolean {
    const q = String(code || '').trim().toUpperCase();
    const idx = this.data.rechargeCodes.findIndex(c => c.code.toUpperCase() === q);
    if (idx === -1) return false;
    this.data.rechargeCodes.splice(idx, 1);
    this.save();
    return true;
  }

  // ---------- 会员兑换码 ----------
  getMembershipCodes(): MembershipCode[] {
    return this.data.membershipCodes;
  }

  getMembershipCode(code: string): MembershipCode | undefined {
    const q = String(code || '').trim().toUpperCase();
    return this.data.membershipCodes.find(c => c.code.toUpperCase() === q);
  }

  createMembershipCodes(items: MembershipCode[]): MembershipCode[] {
    this.data.membershipCodes.unshift(...items);
    this.save();
    return items;
  }

  deleteMembershipCode(code: string): boolean {
    const q = String(code || '').trim().toUpperCase();
    const idx = this.data.membershipCodes.findIndex(c => c.code.toUpperCase() === q);
    if (idx === -1) return false;
    this.data.membershipCodes.splice(idx, 1);
    this.save();
    return true;
  }

  /**
   * 原子会员兑换码兑换：校验 → 标记已用 → 开通/顺延会员 + 首月到账 → 流水，一次落盘。
   */
  redeemMembershipCode(userId: string, rawCode: string): { ok: true; planName: string; months: number; expiresAt: number; granted: number } | { ok: false; error: string } {
    const code = String(rawCode || '').trim().toUpperCase();
    const item = this.data.membershipCodes.find(entry => entry.code.toUpperCase() === code);
    if (!item) return { ok: false, error: '会员兑换码不存在' };
    if (item.status === 'disabled') return { ok: false, error: '该兑换码已停用' };
    if (item.status === 'used') return { ok: false, error: '该兑换码已被使用' };
    const user = this.data.users.find(entry => entry.id === userId);
    if (!user) return { ok: false, error: '账号不存在' };
    const plan = this.data.membershipPlans.find(p => p.id === item.planId);
    if (!plan) return { ok: false, error: '兑换码对应的会员套餐已下线' };
    const now = Date.now();
    const activeNow = user.membership?.status === 'active' && Number(user.membership.expiresAt) > now;
    const base = activeNow ? Number(user.membership!.expiresAt) : now;
    const months = Math.max(1, Math.floor(Number(item.months) || 1));
    const expiresAt = base + months * 30 * 24 * 3600 * 1000;
    // 同套餐续费不重复送首月点数；新开通或换套餐送一次首月
    const samePlan = activeNow && user.membership!.planId === item.planId;
    const granted = samePlan ? 0 : Math.max(0, Math.floor(Number(plan.points) || 0));
    item.status = 'used';
    item.usedBy = userId;
    item.usedByName = user.username;
    item.usedAt = now;
    user.membership = {
      planId: item.planId,
      status: 'active',
      expiresAt,
      lastGrantAt: samePlan && user.membership!.lastGrantAt ? user.membership!.lastGrantAt : now,
    };
    if (granted > 0) user.credits = Math.max(0, Math.floor(Number(user.credits) || 0)) + granted;
    this.pushUsageRecord(this.newUsageRecord({
      userId,
      username: user.username,
      type: 'membership_grant',
      detail: '会员兑换码 ' + item.code + ' 开通「' + plan.name + '」' + months + ' 个月' + (granted > 0 ? '，赠送 ' + granted + ' 点' : ''),
      credits: granted,
    }));
    this.save();
    return { ok: true, planName: plan.name, months, expiresAt, granted };
  }

  // ---------- 使用记录 ----------
  getUsageRecords(): UsageRecord[] {
    return this.data.usageRecords;
  }

  addUsageRecord(record: UsageRecord): UsageRecord {
    this.pushUsageRecord(record);
    this.save();
    return record;
  }

  /** 删除单条流水并落盘。此前只在内存 splice，进程重启后记录会复活。 */
  deleteUsageRecord(id: string): boolean {
    const idx = this.data.usageRecords.findIndex(record => record.id === id);
    if (idx === -1) return false;
    this.data.usageRecords.splice(idx, 1);
    this.save();
    return true;
  }

  /**
   * 原子充值码兑换：校验 → 标记已用 → 入账 → 流水，一次落盘。
   * 旧的兑换流程分四步独立写盘，任何一步崩溃都会留下「码已作废但点数未到账」
   * 或「点数已到账但码仍可用」的不一致状态。
   */
  redeemRechargeCode(userId: string, rawCode: string): { ok: true; added: number; credits: number } | { ok: false; error: string } {
    const code = String(rawCode || '').trim().toUpperCase();
    const item = this.data.rechargeCodes.find(entry => entry.code.toUpperCase() === code);
    if (!item) return { ok: false, error: '充值码不存在' };
    if (item.status === 'disabled') return { ok: false, error: '该充值码已停用' };
    if (item.status === 'used') return { ok: false, error: '该充值码已被使用' };
    const user = this.data.users.find(entry => entry.id === userId);
    if (!user) return { ok: false, error: '账号不存在' };
    const added = Math.max(0, Math.floor(Number(item.credits) || 0));
    item.status = 'used';
    item.usedBy = userId;
    item.usedByName = user.username;
    item.usedAt = Date.now();
    user.credits = Math.max(0, Math.floor(Number(user.credits) || 0)) + added;
    this.pushUsageRecord(this.newUsageRecord({ userId, username: user.username, type: 'recharge', detail: '充值码 ' + item.code + ' 充值 ' + item.credits + ' 点', credits: item.credits }));
    this.save();
    return { ok: true, added: item.credits, credits: user.credits || 0 };
  }

  // ---------- AI 接口配置 ----------
  getAiConfigs(): AiProviderConfig[] {
    return this.data.aiConfigs;
  }

  createAiConfig(item: AiProviderConfig): AiProviderConfig {
    if (item.isDefault) {
      this.data.aiConfigs.forEach(c => { c.isDefault = false; });
    }
    this.data.aiConfigs.unshift(item);
    this.save();
    return item;
  }

  updateAiConfig(id: string, updates: Partial<AiProviderConfig>): AiProviderConfig | null {
    const idx = this.data.aiConfigs.findIndex(c => c.id === id);
    if (idx === -1) return null;
    if (updates.isDefault) {
      this.data.aiConfigs.forEach(c => { c.isDefault = false; });
    }
    this.data.aiConfigs[idx] = { ...this.data.aiConfigs[idx], ...updates, updatedAt: Date.now() };
    this.save();
    return this.data.aiConfigs[idx];
  }

  deleteAiConfig(id: string): boolean {
    const idx = this.data.aiConfigs.findIndex(c => c.id === id);
    if (idx === -1) return false;
    this.data.aiConfigs.splice(idx, 1);
    this.save();
    return true;
  }

  // ---------- 规划模型配置（仅管理端） ----------
  getPlanningConfig(): PlanningModelConfig {
    return this.data.planningConfig;
  }

  updatePlanningConfig(updates: Partial<PlanningModelConfig>): PlanningModelConfig {
    this.data.planningConfig = { ...this.data.planningConfig, ...updates };
    this.data.planningConfig.modelName = normalizePlanningModelName(this.data.planningConfig.baseUrl, this.data.planningConfig.modelName);
    this.save();
    return this.data.planningConfig;
  }

  // ---------- 提示词优化模型配置（仅管理端） ----------
  getPromptOptimizeConfig(): PromptOptimizeModelConfig {
    return this.data.promptOptimizeConfig;
  }

  updatePromptOptimizeConfig(updates: Partial<PromptOptimizeModelConfig>): PromptOptimizeModelConfig {
    this.data.promptOptimizeConfig = { ...this.data.promptOptimizeConfig, ...updates };
    const own = this.data.promptOptimizeConfig;
    if (own.modelName) own.modelName = normalizePlanningModelName(own.baseUrl, own.modelName);
    this.save();
    return own;
  }

  /**
   * 解析提示词优化实际生效的调用配置。
   *
   * 独立配置只有在「已启用 + 接口地址 / 密钥 / 模型三项填齐」时才算可用；
   * 任一条件不满足都回退到内容规划模型，避免管理员只打开开关却漏填字段时
   * 让前台的提示词优化整体不可用。
   */
  resolvePromptOptimizeConfig(): PromptOptimizeCallConfig & { source: 'dedicated' | 'planning' } {
    const own = this.data.promptOptimizeConfig;
    if (own?.enabled && String(own.baseUrl || '').trim() && String(own.apiKey || '').trim() && String(own.modelName || '').trim()) {
      return {
        baseUrl: String(own.baseUrl).trim(),
        apiKey: String(own.apiKey).trim(),
        modelName: String(own.modelName).trim(),
        reasoningEffort: String(own.reasoningEffort || '').trim() || 'medium',
        temperature: parseOptionalNumber(own.temperature, 0, 2),
        maxOutputTokens: parseOptionalInteger(own.maxOutputTokens),
        systemPrompt: String(own.systemPrompt || '').trim() || undefined,
        source: 'dedicated'
      };
    }
    const plan = this.data.planningConfig;
    return {
      baseUrl: plan?.baseUrl || '',
      apiKey: plan?.apiKey || '',
      modelName: plan?.modelName || '',
      reasoningEffort: plan?.optimizeReasoningEffort || plan?.reasoningEffort || '',
      source: 'planning'
    };
  }

  // ---------- 会员套餐目录（管理端可编辑） ----------
  getMembershipPlans(): MembershipPlanConfig[] {
    return this.data.membershipPlans;
  }

  setMembershipPlans(plans: MembershipPlanConfig[]): MembershipPlanConfig[] {
    this.data.membershipPlans = plans;
    this.save();
    return this.data.membershipPlans;
  }

  /**
   * Resolve the real upstream credentials for a requested image tier.
   * The returned `name` is display-only; callers must always use `modelName`
   * from this result when forwarding to the provider.
   */
  resolveImageConfig(resolution?: ImageResolution): ThirdPartyApiConfig {
    const list = this.data.aiConfigs || [];
    const selected = selectImageConfig(list, resolution);
    const config = selected.config;
    if (config) {
      const tier = selected.tier;
      const source = tier || config;
      return {
        id: config.id,
        provider: source.provider || config.provider,
        name: displayNameFor(config, selected.exact),
        displayName: displayNameFor(config, selected.exact),
        baseUrl: source.baseUrl,
        apiKey: source.apiKey,
        modelName: source.modelName,
        isActive: config.enabled,
        resolutionSupport: config.resolutionSupport
      };
    }

    // Return an unusable sentinel instead of another tier's credentials. This
    // lets callers show a precise "tier not configured" error and prevents a
    // lower-tier request from accidentally spending against the 4K account.
    return {
      ...DEFAULT_IMAGE_CONFIG,
      id: `unconfigured-${resolution || 'image'}`,
      name: resolution ? `${resolution} 生图（未配置）` : 'CELANO 生图（未配置）',
      displayName: resolution ? `${resolution} 生图（未配置）` : 'CELANO 生图（未配置）',
      baseUrl: '',
      apiKey: '',
      modelName: '',
      isActive: false,
      resolutionSupport: resolution ? [resolution] : []
    };
  }

  /** Safe frontend model descriptors. No upstream model IDs or API keys leave the server. */
  getImageDisplayModels(): Array<{ name: string; resolution: ImageResolution }> {
    const list = this.data.aiConfigs || [];
    return IMAGE_RESOLUTIONS.flatMap(resolution => {
      const selected = selectImageConfig(list, resolution);
      if (!selected.config) return [];
      return [{ name: displayNameFor(selected.config, resolution), resolution }];
    });
  }

  // ---------- 用户（后台） ----------

  /**
   * 删除单个任务的页面图片目录。
   * 带路径前缀守卫：即便 userId / deckId 被污染，也不会越过 data/images 根。
   */
  private removeDeckImages(userId: string, deckId: string): void {
    const target = path.join(DATA_IMAGES, 'user-' + userId, 'deck-' + deckId);
    if (!target.startsWith(DATA_IMAGES + path.sep)) return;
    try { fs.rmSync(target, { recursive: true, force: true }); } catch { /* 清理失败不阻塞删除记录 */ }
  }

  deleteUser(id: string): boolean {
    const idx = this.data.users.findIndex(u => u.id === id);
    if (idx === -1) return false;
    // PPT 任务此前不随用户删除，会留下孤儿任务：它们仍占用 200 条的任务上限、
    // 出现在后台统计里，磁盘图片也永远不会回收。
    const ownedDecks = this.data.pptDecks.filter(deck => deck.userId === id);
    this.data.pptDecks = this.data.pptDecks.filter(deck => deck.userId !== id);
    this.data.users.splice(idx, 1);
    delete this.data.credentials[id];
    this.data.presentations = this.data.presentations.filter(p => p.userId !== id);
    delete this.data.apiConfigs[id];
    this.save();
    for (const deck of ownedDecks) this.removeDeckImages(id, deck.id);
    return true;
  }
}

export const db = new Database();
