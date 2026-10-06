import type { PptDeck, PptDeckSlide, User } from '../types.js';
import { publishLibraryChange } from '../shared/libraryEvents.js';
export interface RegisterPayload { username:string; phone:string; password:string; confirmPassword:string; inviteCode:string; }
async function json<T>(path:string, init:RequestInit={}):Promise<T>{const res=await fetch('/api'+path,{...init,credentials:'same-origin',headers:{'Content-Type':'application/json',...(init.headers||{})}});const data=await res.json().catch(()=>null);if(!res.ok||!data?.success){const error=new Error(data?.error||'请求失败') as Error & {status?:number};error.status=res.status;throw error;}return data;}
export async function loginUser(identifier:string,password:string):Promise<User>{return (await json<{user:User}>('/auth/login',{method:'POST',body:JSON.stringify({identifier,password})})).user;}
export async function registerUser(payload:RegisterPayload):Promise<User>{return (await json<{user:User}>('/auth/register',{method:'POST',body:JSON.stringify(payload)})).user;}

/** 工作台：涂抹/框选 + 指令 → 图生图编辑 */
export async function workspaceEditPage(payload: { image: string; mask?: string; prompt: string }): Promise<{ image: string }> {
  return json<{ image: string }>('/workspace/edit-page', { method: 'POST', body: JSON.stringify(payload) });
}

/* =========================================================
   PPT 生成（服务端任务执行，按页数与画质计费）
   ========================================================= */

export interface CreatePptDeckPayload {
  prompt: string;
  pageCount: number;
  concurrency: number;
  requestKey?: string;
  resolution?: '2K' | '4K';
  referencesText?: string;
  referenceImages?: { name: string; dataUrl: string }[];
  logo?: import('../types.js').LogoConfig;
}

export type PptDeckView = Omit<PptDeck, 'slides' | 'referenceImages'> & {
  slides: (PptDeckSlide & { imageUrl?: string })[];
  referenceImages: { id: string; name: string }[];
};

export async function createPptDeck(payload: CreatePptDeckPayload): Promise<{ deck: PptDeckView }> {
  return json<{ deck: PptDeckView }>('/ppt/decks', { method: 'POST', body: JSON.stringify(payload) });
}
export async function listPptDecks(): Promise<{ decks: PptDeckView[] }> {
  return json<{ decks: PptDeckView[] }>('/ppt/decks');
}
export async function getPptDeck(id: string): Promise<{ deck: PptDeckView }> {
  return json<{ deck: PptDeckView }>('/ppt/decks/' + encodeURIComponent(id));
}
export async function stopPptDeck(id: string): Promise<{ deck: PptDeckView }> {
  return json<{ deck: PptDeckView }>('/ppt/decks/' + encodeURIComponent(id) + '/stop', { method: 'POST' });
}
export async function resumePptDeck(id: string): Promise<{ deck: PptDeckView }> {
  return json<{ deck: PptDeckView }>('/ppt/decks/' + encodeURIComponent(id) + '/resume', { method: 'POST' });
}
export async function retryFailedPptDeck(id: string): Promise<{ deck: PptDeckView }> {
  return json<{ deck: PptDeckView }>('/ppt/decks/' + encodeURIComponent(id) + '/retry-failed', { method: 'POST' });
}
export async function regeneratePptSlide(id: string, slideId: string, instruction?: string): Promise<{ deck: PptDeckView }> {
  return json<{ deck: PptDeckView }>('/ppt/decks/' + encodeURIComponent(id) + '/slides/' + encodeURIComponent(slideId) + '/regenerate', { method: 'POST', body: JSON.stringify({ instruction: instruction || '' }) });
}
export async function replacePptSlideImage(id: string, slideId: string, image: string): Promise<{ deck: PptDeckView }> {
  return json<{ deck: PptDeckView }>('/ppt/decks/' + encodeURIComponent(id) + '/slides/' + encodeURIComponent(slideId) + '/replace-image', { method: 'POST', body: JSON.stringify({ image }) });
}
export async function deletePptDeck(id: string): Promise<{ ok: boolean }> {
  const result = await json<{ ok: boolean }>('/ppt/decks/' + encodeURIComponent(id), { method: 'DELETE' });
  publishLibraryChange({ resource: 'ppt', action: 'deleted', id });
  return result;
}
export async function deletePptSlide(id: string, slideId: string): Promise<{ deck: PptDeckView | null }> {
  const result = await json<{ deck: PptDeckView | null }>('/ppt/decks/' + encodeURIComponent(id) + '/slides/' + encodeURIComponent(slideId), { method: 'DELETE' });
  publishLibraryChange({ resource: 'ppt', action: result.deck ? 'saved' : 'deleted', id });
  return result;
}
export async function optimizePptPrompt(prompt: string): Promise<{ prompt: string }> {
  return json<{ prompt: string }>('/ppt/optimize-prompt', { method: 'POST', body: JSON.stringify({ prompt }) });
}
