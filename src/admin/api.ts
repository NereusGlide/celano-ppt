import {
  AdminAccount,
  User,
  InviteCode,
  RechargeCode,
  UsageRecord,
  AiProviderConfig,
  PlanningModelConfig,
  PromptOptimizeModelConfig,
  MembershipPlanConfig,
  MembershipCode
} from '../types.js';

/** 管理端生图档位配置。apiKey 由服务端脱敏返回，空值代表保留现有密钥。 */
export type ImageConfigResolution = '2K' | '4K';
export type ImageConfigQuality = 'auto' | 'low' | 'medium' | 'high' | 'omit';
export interface AdminImageConfig {
  id?: string;
  resolution: ImageConfigResolution;
  name: string;
  displayName: string;
  baseUrl: string;
  apiKey: string;
  modelName: string;
  quality: ImageConfigQuality;
  enabled: boolean;
}
export interface ImageConfigSlot {
  resolution: ImageConfigResolution;
  id?: string;
  name: string;
  displayName: string;
  provider: string;
  baseUrl: string;
  modelName: string;
  enabled: boolean;
  isDefault?: boolean;
  remark?: string;
  hasApiKey: boolean;
  ready: boolean;
  diagnostic?: string;
}
export interface ImageConfigTestResult {
  success: boolean;
  message?: string;
  latencyMs?: number;
  requestedSize?: string;
  actualSize?: string;
  /** 上游返回尺寸是否与请求尺寸精确一致（2K 档按产品定义允许保留原生像素） */
  exact?: boolean;
  /** 真实出图测试返回的图片字节数 */
  bytes?: number;
  models?: string[];
}

/** 使用记录 + 关联到用户表的当前资料（账号已删除时为 null）。 */
export interface AdminUsageRecord extends UsageRecord {
  user: { id: string; username: string; name: string; phone: string; avatar: string } | null;
}

/** 码类列表「使用者」关联到的用户表当前资料。 */
export interface CodeUserBrief {
  id: string;
  username: string;
  name: string;
  phone: string;
}

export interface AdminInviteCode extends InviteCode {
  usedByUsers: CodeUserBrief[];
}

export interface AdminRechargeCode extends RechargeCode {
  usedByUser: CodeUserBrief | null;
}

export interface AdminMembershipCode extends MembershipCode {
  usedByUser: CodeUserBrief | null;
}

/** 文本模型（内容规划 / 提示词优化）真实连通性测试的可覆盖字段。 */
export type TextConfigTestOverride = {
  baseUrl?: string;
  apiKey?: string;
  modelName?: string;
  reasoningEffort?: string;
};

export interface TextConfigTestResult {
  success: boolean;
  message: string;
  latencyMs?: number;
  model?: string;
  /** 上游实际返回的内容片段 */
  reply?: string;
  /** 上游可用模型数量（失败诊断用） */
  availableModels?: number;
  /** 提示词优化实际生效的通道：独立配置 / 回退内容规划模型 */
  channel?: 'dedicated' | 'planning';
}

const BASE = '/api/admin';

export function getAdminToken(): string {
  // 令牌由服务端下发为 HttpOnly Cookie，前端不再读取或存储。
  return '';
}

export function setAdminToken(token: string) {
  // 令牌已由服务端写入 HttpOnly Cookie，前端不做任何持久化。
  void token;
}

export function clearAdminToken() {
  // 登出由服务端清除 Cookie，前端无需清理本地存储。
}

export class AdminApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(method: string, path: string, body?: any): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  const res = await fetch(BASE + path, {
    method,
    headers,
    // 认证凭据走 HttpOnly Cookie，必须显式声明同源携带
    credentials: 'same-origin',
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  let data: any = {};
  try { data = await res.json(); } catch { /* 空响应 */ }

  if (res.status === 401) {
    clearAdminToken();
    throw new AdminApiError(data.error || '登录已失效', 401);
  }
  if (!res.ok || data.success === false) {
    throw new AdminApiError(data.error || '请求失败', res.status);
  }
  return data as T;
}

export interface Paged<T> {
  success: boolean;
  total: number;
  page: number;
  pageSize: number;
}

export const adminApi = {
  login: (username: string, password: string) =>
    request<{ success: boolean; token: string; admin: AdminAccount }>('POST', '/auth/login', { username, password }),

  profile: () => request<{ success: boolean; admin: AdminAccount }>('GET', '/auth/profile'),

  changePassword: (oldPassword: string, newPassword: string) =>
    request<{ success: boolean }>('POST', '/auth/password', { oldPassword, newPassword }),

  stats: () => request<{ success: boolean; stats: any }>('GET', '/stats'),

  users: (query: Record<string, any>) =>
    request<Paged<User[]> & { users: (User & { presentationCount: number })[] }>('GET', '/users?' + new URLSearchParams(query as any).toString()),

  updateUser: (id: string, updates: Partial<Omit<User, 'membership'>> & { membership?: User['membership'] | null }) =>
    request<{ success: boolean; user: User }>('PATCH', '/users/' + id, updates),

  deleteUser: (id: string) => request<{ success: boolean }>('DELETE', '/users/' + id),

  resetUserPassword: (id: string, newPassword: string) =>
    request<{ success: boolean }>('POST', '/users/' + id + '/password', { newPassword }),

  banUser: (id: string) =>
    request<{ success: boolean; user: User }>('POST', '/users/' + id + '/ban', {}),

  unbanUser: (id: string) =>
    request<{ success: boolean; user: User }>('POST', '/users/' + id + '/unban', {}),

  usageRecords: (query: Record<string, any>) =>
    request<Paged<AdminUsageRecord[]> & { records: AdminUsageRecord[] }>('GET', '/usage-records?' + new URLSearchParams(query as any).toString()),

  deleteUsageRecord: (id: string) => request<{ success: boolean }>('DELETE', '/usage-records/' + id),

  inviteCodes: (query: Record<string, any>) =>
    request<Paged<AdminInviteCode[]> & { inviteCodes: AdminInviteCode[] }>('GET', '/invite-codes?' + new URLSearchParams(query as any).toString()),

  createInviteCodes: (payload: { count: number; prefix: string; maxUses: number; note?: string }) =>
    request<{ success: boolean; created: InviteCode[] }>('POST', '/invite-codes', payload),

  updateInviteCode: (code: string, updates: Partial<InviteCode>) =>
    request<{ success: boolean; inviteCode: InviteCode }>('PATCH', '/invite-codes/' + encodeURIComponent(code), updates),

  deleteInviteCode: (code: string) =>
    request<{ success: boolean }>('DELETE', '/invite-codes/' + encodeURIComponent(code)),

  rechargeCodes: (query: Record<string, any>) =>
    request<Paged<AdminRechargeCode[]> & { rechargeCodes: AdminRechargeCode[] }>('GET', '/recharge-codes?' + new URLSearchParams(query as any).toString()),

  createRechargeCodes: (payload: { count: number; credits: number; prefix: string; note?: string }) =>
    request<{ success: boolean; created: RechargeCode[] }>('POST', '/recharge-codes', payload),

  updateRechargeCode: (code: string, updates: Partial<RechargeCode>) =>
    request<{ success: boolean; rechargeCode: RechargeCode }>('PATCH', '/recharge-codes/' + encodeURIComponent(code), updates),

  deleteRechargeCode: (code: string) =>
    request<{ success: boolean }>('DELETE', '/recharge-codes/' + encodeURIComponent(code)),

  membershipCodes: (query: Record<string, any>) =>
    request<Paged<AdminMembershipCode[]> & { membershipCodes: AdminMembershipCode[] }>('GET', '/membership-codes?' + new URLSearchParams(query as any).toString()),

  createMembershipCodes: (payload: { count: number; planId: string; months: number; prefix: string; note?: string }) =>
    request<{ success: boolean; created: MembershipCode[] }>('POST', '/membership-codes', payload),

  deleteMembershipCode: (code: string) =>
    request<{ success: boolean }>('DELETE', '/membership-codes/' + encodeURIComponent(code)),

  planningConfig: () => request<{ success: boolean; planningConfig: PlanningModelConfig }>('GET', '/planning-config'),

  updatePlanningConfig: (payload: Partial<PlanningModelConfig>) =>
    request<{ success: boolean; planningConfig: PlanningModelConfig }>('PUT', '/planning-config', payload),

  /** 内容规划模型真实连通性测试（真的发一次最小对话请求）。 */
  testPlanningConfig: (payload?: TextConfigTestOverride) =>
    request<TextConfigTestResult>('POST', '/planning-config/test', payload || {}),

  /** 提示词优化独立通道配置（未启用时前端回退内容规划模型）。 */
  promptOptimizeConfig: () =>
    request<{ success: boolean; promptOptimizeConfig: PromptOptimizeModelConfig }>('GET', '/prompt-optimize-config'),

  updatePromptOptimizeConfig: (payload: Partial<PromptOptimizeModelConfig>) =>
    request<{ success: boolean; promptOptimizeConfig: PromptOptimizeModelConfig }>('PUT', '/prompt-optimize-config', payload),

  /** 提示词优化模型真实连通性测试；结果里的 channel 指明实测的是哪条通道。 */
  testPromptOptimizeConfig: (payload?: TextConfigTestOverride) =>
    request<TextConfigTestResult>('POST', '/prompt-optimize-config/test', payload || {}),

  membershipPlans: () => request<{ success: boolean; membershipPlans: MembershipPlanConfig[] }>('GET', '/membership-plans'),

  saveMembershipPlans: (membershipPlans: MembershipPlanConfig[]) =>
    request<{ success: boolean; membershipPlans: MembershipPlanConfig[] }>('PUT', '/membership-plans', { membershipPlans }),

  aiConfigs: () => request<{ success: boolean; aiConfigs: AiProviderConfig[] }>('GET', '/ai-configs'),

  /** 三个生图档位的聚合配置，密钥由服务端脱敏。 */
  imageConfigs: () => request<{ success: boolean; slots: ImageConfigSlot[] }>('GET', '/image-configs'),

  updateImageConfig: (resolution: ImageConfigResolution, payload: Partial<AdminImageConfig>) =>
    request<{ success: boolean; slot: ImageConfigSlot }>('PUT', '/image-configs/' + resolution, payload),

  testImageConfig: (resolution: ImageConfigResolution, mode: 'connection' | 'image') =>
    request<ImageConfigTestResult>('POST', '/image-configs/' + resolution + '/test', { mode }),

  discoverImageModels: (payload: { resolution: ImageConfigResolution; baseUrl: string; apiKey: string }) =>
    request<{ success: boolean; models?: string[]; message?: string }>('POST', '/image-configs/models', payload),

  createAiConfig: (payload: Partial<AiProviderConfig>) =>
    request<{ success: boolean; aiConfig: AiProviderConfig }>('POST', '/ai-configs', payload),

  updateAiConfig: (id: string, updates: Partial<AiProviderConfig>) =>
    request<{ success: boolean; aiConfig: AiProviderConfig }>('PATCH', '/ai-configs/' + id, updates),

  deleteAiConfig: (id: string) => request<{ success: boolean }>('DELETE', '/ai-configs/' + id),

  testAiConfig: (id: string) =>
    request<{ success: boolean; message?: string; latencyMs?: number }>('POST', '/ai-configs/' + id + '/test', {})
};
