import type { Presentation, User, UsageRecord } from '../types.js';
import { publishLibraryChange } from '../shared/libraryEvents.js';
export interface AccountJob { id: string; userId: string; presentationId: string; type: string; status: string; progress: number; createdAt: number; updatedAt?: number; step?: string; }
export interface AccountSummary { user: User; records: UsageRecord[]; presentations: Presentation[]; jobs: AccountJob[]; }
export class AccountApiError extends Error { constructor(message:string,public status:number){super(message);} }
async function request<T>(path:string,init:RequestInit={}):Promise<T>{const res=await fetch('/api'+path,{...init,credentials:'same-origin',headers:{'Content-Type':'application/json',...(init.headers||{})}});const data=await res.json().catch(()=>null);if(!res.ok||!data?.success)throw new AccountApiError(data?.error||'请求失败，请稍后重试',res.status);return data;}
export async function fetchCurrentUser(signal?:AbortSignal):Promise<User|null>{try{return(await request<{user:User}>('/auth/me',{signal})).user}catch(e){if(e instanceof AccountApiError&&e.status===401)return null;throw e}}
export async function logoutSession(){await request('/auth/logout',{method:'POST'})}
export async function fetchAccountSummary(signal?:AbortSignal):Promise<AccountSummary>{return request<AccountSummary>('/account/summary',{signal})}
export async function deleteAccountWork(id: string) {
  const result = await request('/presentations/' + encodeURIComponent(id), { method: 'DELETE' });
  publishLibraryChange({ resource: 'ppt', action: 'deleted', id });
  return result;
}
export async function updateAccountProfile(payload:{name:string;phone:string}){return(await request<{user:User}>('/auth/profile',{method:'PATCH',body:JSON.stringify(payload)})).user}
export async function changeAccountPassword(payload:{currentPassword:string;newPassword:string;confirmPassword:string}){await request('/auth/password',{method:'POST',body:JSON.stringify(payload)})}
export async function redeemAccountCode(code:string,userId?:string){return request<{added:number;credits:number}>('/wallet/redeem',{method:'POST',body:JSON.stringify(userId?{code,userId}:{code})})}
