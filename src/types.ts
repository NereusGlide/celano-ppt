export type ImageResolution = '2K' | '4K';
export type AspectRatio = '16:9';

export type SlideLayout = 
  | 'split-left'      // 左图右文
  | 'split-right'     // 左文右图
  | 'full-bleed'      // 全屏沉浸式背景
  | 'center-focus'    // 居中焦点
  | 'bottom-card';    // 顶图全景，底置卡片

export type PresentationStyle = 
  | 'tech-minimal'    // 科技极简 / 深色未来
  | 'business-clean'  // 商务精英 / 蓝灰专业
  | 'creative-gradient' // 艺术渐变 / 活泼创意
  | 'academic-slate'  // 学术沉稳 / 典雅岩灰
  | 'luxury-black'    // 奢华黑金 / 高端质感
  | 'nature-breeze';  // 自然清润 / 温暖大地

export type LogoPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
export type LogoSize = 'sm' | 'md' | 'lg';

export interface LogoConfig {
  url: string;
  position: LogoPosition;
  opacity: number; // 0.1 - 1.0
  size: LogoSize;
  enabled: boolean;
}

export interface ReferenceFile {
  id: string;
  name: string;
  size: number;
  type: string;
  extractedText?: string;
  uploadedAt: number;
}

export interface SlideItem {
  id: string;
  order: number;
  title: string;
  subtitle?: string;
  bulletPoints: string[];
  speakerNotes?: string;
  visualConcept: string;        // 画面概念描述
  rawPrompt: string;            // 基础生图提示词
  optimizedPrompt: string;      // AI 深度优化扩写提示词
  negativePrompt?: string;      // 负向提示词
  imageUrl?: string;            // 生图结果 URL 或 base64
  imageResolution: ImageResolution;
  layout: SlideLayout;
  isGeneratingImage?: boolean;
  imageError?: string;
  updatedAt?: number;
  /** 页面类型（参考实现的规划结构）：cover/agenda/core-insight/comparison/process/framework/data/case/checklist/conclusion */
  pageType?: string;
}

export interface Presentation {
  id: string;
  userId: string;
  title: string;
  description?: string;
  style: PresentationStyle;
  resolution: ImageResolution;
  aspectRatio: AspectRatio;
  slides: SlideItem[];
  logo?: LogoConfig;
  referenceFiles?: ReferenceFile[];
  createdAt: number;
  updatedAt: number;
  modelProvider?: string; // 'gemini' | 'openai' | 'siliconflow' | 'custom'
  /** 规划阶段产出的统一视觉方向（英文提示词片段，注入每页生图） */
  visualDirection?: string;
  /** 规划阶段产出的统一配色方案（英文提示词片段，注入每页生图） */
  colorScheme?: string;
  /** 用户原始需求（注入每页生图提示词的第一行） */
  originalPrompt?: string;
}

export interface User {
  id: string;
  /** 登录账号 */
  username: string;
  /** 邮箱（可选：新注册流程仅要求手机号） */
  email?: string;
  /** 手机号（注册必填） */
  phone?: string;
  name: string;
  avatar: string;
  role: 'admin' | 'creator' | 'member';
  createdAt: number;
  apiConfigs?: ThirdPartyApiConfig[];
  /** 剩余点数（由充值码充值，生成任务消耗） */
  credits?: number;
  /** 账号状态：禁用后无法登录 */
  status?: 'active' | 'disabled';
  /** 最后登录时间 */
  lastLoginAt?: number;
  /** 最后登录 IP */
  lastLoginIp?: string;
  /** 最近活跃时间（在线判定依据） */
  lastActiveAt?: number;
  /** 是否在线（服务端计算，不落盘） */
  online?: boolean;
  /** 注册时使用的邀请码 */
  inviteCode?: string;
  /** 服务端确认的会员权益，与账号角色和点数余额分开保存。 */
  membership?: {
    planId: string;
    status: 'active' | 'cancelled';
    expiresAt: number;
    /** 最近一次自动发放月点数的时间（每月到账的周期起点） */
    lastGrantAt?: number;
  };
}

/** 会员套餐目录项：管理端可配置，前端会员中心据此渲染套餐卡片。 */
export interface MembershipPlanConfig {
  id: string;
  name: string;
  /** 首月展示价（如 ¥33），仅作产品目录展示 */
  price: string;
  /** 续费价（元），用于计算年/季/单买价格 */
  renewalPrice: number;
  /** 每月发放点数 */
  points: number;
  note: string;
  accent: string;
  recommended?: boolean;
  benefits: string[];
  enabled: boolean;
}

export interface ThirdPartyApiConfig {
  id: string;
  provider: 'gemini' | 'openai' | 'siliconflow' | 'stability' | 'custom';
  name: string;
  /** 展示名称仅用于前端，不参与真实模型路由。 */
  displayName?: string;
  baseUrl: string;
  apiKey: string;
  modelName: string;
  isActive: boolean;
  resolutionSupport: ImageResolution[];
}

export interface GenerationJob {
  id: string;
  userId: string;
  presentationId: string;
  slideId?: string;
  type: 'outline' | 'slide_image' | 'optimize_prompt' | 'batch_images';
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number; // 0 - 100
  totalSteps?: number;
  currentStep?: number;
  /** 当前步骤文案（用于工作台实时进度展示） */
  step?: string;
  error?: string;
  result?: any;
  workerId?: number; // 标示执行该任务的多线程 Worker 编号
  /** 服务重启可恢复的内部任务参数；接口返回时不暴露 */
  requestPrompt?: string;
  requestResolution?: ImageResolution;
  dependsOnJobId?: string;
  batchIndex?: number;
  createdAt: number;
  completedAt?: number;
}

export interface WorkerThreadInfo {
  id: number;
  name: string;
  status: 'idle' | 'busy';
  currentJobId?: string;
  currentSlideTitle?: string;
  startedAt?: number;
}

/* =========================================================
   管理后台数据模型
   ========================================================= */

/** 后台管理员账号（与前台用户体系完全独立） */
export interface AdminAccount {
  id: string;
  username: string;
  name: string;
  role: 'super' | 'operator';
  status: 'active' | 'disabled';
  createdAt: number;
  lastLoginAt?: number;
}

/** 邀请码 */
export interface InviteCode {
  code: string;
  /** 最大可用次数，0 表示不限次 */
  maxUses: number;
  usedCount: number;
  /** 使用过的用户 id */
  usedBy: string[];
  status: 'active' | 'disabled';
  note?: string;
  createdAt: number;
  /** 过期时间戳，空表示永久有效 */
  expiresAt?: number;
}

/** 充值码 */
export interface RechargeCode {
  code: string;
  /** 面额（点数） */
  credits: number;
  status: 'unused' | 'used' | 'disabled';
  usedBy?: string;
  usedByName?: string;
  usedAt?: number;
  note?: string;
  createdAt: number;
}

/** 使用记录 */
export interface UsageRecord {
  id: string;
  userId: string;
  username: string;
  type: 'register' | 'login' | 'outline' | 'slide_image' | 'optimize_prompt' | 'export_pptx' | 'recharge' | 'membership_grant';
  detail: string;
  credits: number;
  createdAt: number;
}

/** 内容规划模型配置（仅管理端可见与配置，前台不可见） */
export interface PlanningModelConfig {
  baseUrl: string;
  apiKey: string;
  modelName: string;
  /** 整篇大纲规划的思考强度（如 xhigh） */
  reasoningEffort: string;
  /** 提示词优化类轻量调用的思考强度（如 medium），单独配置以便控制速度 */
  optimizeReasoningEffort?: string;
  /** 扫描版参考文件视觉读取用的多模态模型（如 gpt-4o）；留空则退回 OCR */
  visionModelName?: string;
}

/** AI 接口配置（后台统一维护，供前台取用） */
export interface AiProviderConfig {
  id: string;
  provider: 'gemini' | 'openai' | 'siliconflow' | 'stability' | 'custom';
  /** 管理端内部标识；保留用于兼容旧配置。 */
  name: string;
  /** 展示给前台用户的名称，不参与上游模型路由。 */
  displayName?: string;
  baseUrl: string;
  apiKey: string;
  modelName: string;
  /** 该配置专用的画质档位；为空表示通用回退配置。 */
  resolution?: ImageResolution;
  resolutionSupport: ImageResolution[];
  /** 各分辨率独立的生图通道；未填写时回退到本配置的通用字段。 */
  resolutionConfigs?: Partial<Record<ImageResolution, ImageTierConfig>>;
  /** 是否全局启用（前台可选） */
  enabled: boolean;
  /** 是否设为默认模型 */
  isDefault: boolean;
  remark?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ImageTierConfig {
  provider?: AiProviderConfig['provider'];
  baseUrl: string;
  apiKey: string;
  modelName: string;
  enabled?: boolean;
}

/* =========================================================
   PPT 生成（移植自「超级画布Agent」的 PPT 工作台逻辑）
   ========================================================= */

export type PptPageType = 'cover' | 'agenda' | 'core-insight' | 'comparison' | 'process' | 'framework' | 'data' | 'case' | 'checklist' | 'conclusion';
export type PptSlideStatus = 'idle' | 'generating' | 'done' | 'failed';

export interface PptPalette {
  accent: string;
  deep: string;
  ink: string;
  muted: string;
}

export interface PptSlidePlan {
  title: string;
  subtitle?: string;
  bullets: string[];
  summary?: string;
  pageType: PptPageType;
  imagePrompt?: string;
}

export interface PptReferenceImage {
  id: string;
  name: string;
  /** 服务端磁盘上的图片相对路径（data/images 下） */
  storageKey?: string;
}

export interface PptDeckSlide {
  id: string;
  plan: PptSlidePlan;
  status: PptSlideStatus;
  /** 服务端磁盘上的图片相对路径（data/images 下） */
  storageKey?: string;
  /** 原图实际像素，2K 为接口画质档位，不将返回图缩放成请求尺寸。 */
  width?: number;
  height?: number;
  error?: string;
}

export interface PptDeck {
  id: string;
  userId: string;
  /** 首页跳转创建任务的幂等键，避免刷新/重复提交产生两套任务。 */
  requestKey?: string;
  /** 创建任务时预扣的总点数及已退回金额，供失败重试保持账务幂等。 */
  chargedCredits?: number;
  refundedCredits?: number;
  refundedSlideIds?: string[];
  title: string;
  prompt: string;
  /** 全套页面生图画质，决定单页积分与上游图片尺寸。 */
  resolution: ImageResolution;
  planningSource?: 'ai' | 'fallback';
  planningWarning?: string;
  referenceAnalysisStatus?: 'analyzing' | 'done' | 'failed';
  referenceAnalysisProgress?: { done: number; total: number };
  referenceAnalysis?: string;
  referencesText: string;
  referenceImages: PptReferenceImage[];
  /** 首页上传的品牌标识配置，随任务保存并在工作台/导出时复用。 */
  logo?: LogoConfig;
  subtitle: string;
  visualDirection: string;
  palette: PptPalette;
  slides: PptDeckSlide[];
  pageCount: number;
  concurrency: number;
  stage: 'planning' | 'rendering' | 'finished' | 'paused';
  running: boolean;
  finished: boolean;
  startedAt: number;
  updatedAt: number;
  /** 首次全部生成完成的时间，作为 7 天保留期的起点 */
  finishedAt?: number;
  error?: string;
}
