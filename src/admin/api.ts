import {
  AdminAccount,
  User,
  InviteCode,
  RechargeCode,
  UsageRecord,
  AiProviderConfig,
  PlanningModelConfig,
  MembershipPlanConfig
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
  models?: string[];
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
    request<Paged<UsageRecord[]> & { records: UsageRecord[] }>('GET', '/usage-records?' + new URLSearchParams(query as any).toString()),

  deleteUsageRecord: (id: string) => request<{ success: boolean }>('DELETE', '/usage-records/' + id),

  inviteCodes: (query: Record<string, any>) =>
    request<Paged<InviteCode[]> & { inviteCodes: InviteCode[] }>('GET', '/invite-codes?' + new URLSearchParams(query as any).toString()),

  createInviteCodes: (payload: { count: number; prefix: string; maxUses: number; note?: string }) =>
    request<{ success: boolean; created: InviteCode[] }>('POST', '/invite-codes', payload),

  updateInviteCode: (code: string, updates: Partial<InviteCode>) =>
    request<{ success: boolean; inviteCode: InviteCode }>('PATCH', '/invite-codes/' + encodeURIComponent(code), updates),

  deleteInviteCode: (code: string) =>
    request<{ success: boolean }>('DELETE', '/invite-codes/' + encodeURIComponent(code)),

  rechargeCodes: (query: Record<string, any>) =>
    request<Paged<RechargeCode[]> & { rechargeCodes: RechargeCode[] }>('GET', '/recharge-codes?' + new URLSearchParams(query as any).toString()),

  createRechargeCodes: (payload: { count: number; credits: number; prefix: string; note?: string }) =>
    request<{ success: boolean; created: RechargeCode[] }>('POST', '/recharge-codes', payload),

  updateRechargeCode: (code: string, updates: Partial<RechargeCode>) =>
    request<{ success: boolean; rechargeCode: RechargeCode }>('PATCH', '/recharge-codes/' + encodeURIComponent(code), updates),

  deleteRechargeCode: (code: string) =>
    request<{ success: boolean }>('DELETE', '/recharge-codes/' + encodeURIComponent(code)),

  planningConfig: () => request<{ success: boolean; planningConfig: PlanningModelConfig }>('GET', '/planning-config'),

  updatePlanningConfig: (payload: Partial<PlanningModelConfig>) =>
    request<{ success: boolean; planningConfig: PlanningModelConfig }>('PUT', '/planning-config', payload),

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
