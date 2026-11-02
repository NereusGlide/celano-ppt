import { imageSizeFor, IMAGE_QUALITY, type ImageResolution } from '../shared/imageSpecs.js';
import { saveCanvasAsset } from './canvasAssets.js';
import { subscribeLibraryChanges } from '../shared/libraryEvents.js';

export type ImageDraft = { prompt: string; resolution: ImageResolution; ratio: string; reference: { name: string; file: File } | null };
export type ImageJob = {
  id: string; userId: string; input: ImageDraft; startedAt: number;
  phase: 'generating' | 'saving' | 'done' | 'failed';
  error?: string; image?: { url: string; width?: number; height?: number; mimeType?: string }; assetId?: string;
};
const drafts = new Map<string, ImageDraft>();
const listeners = new Set<() => void>();
let jobs: ImageJob[] = [];
let listening = false;
const PENDING_JOBS_KEY = 'celano.image.pendingJobs';
const IMAGE_JOB_WAIT_MS = 10 * 60_000;

type PersistedImageJob = { id: string; userId: string; startedAt: number; prompt: string; resolution: ImageResolution; ratio: string };

function persistPendingJobs() {
  if (typeof localStorage === 'undefined') return;
  try {
    const pending: PersistedImageJob[] = jobs.filter(job => job.phase === 'generating' || job.phase === 'saving').map(job => ({
      id: job.id, userId: job.userId, startedAt: job.startedAt, prompt: job.input.prompt, resolution: job.input.resolution, ratio: job.input.ratio,
    }));
    localStorage.setItem(PENDING_JOBS_KEY, JSON.stringify(pending));
  } catch { /* 配额不足时，当前页面仍能等这次请求结束 */ }
}

function notify() {
  persistPendingJobs();
  listeners.forEach(listener => listener());
}
export const defaultImageDraft = (): ImageDraft => ({ prompt: '', resolution: '2K', ratio: '1:1', reference: null });
export const getImageDraft = (userId: string) => drafts.get(userId) || defaultImageDraft();
export const setImageDraft = (userId: string, draft: ImageDraft) => { drafts.set(userId, draft); };
export const getImageJobs = () => jobs;
export const subscribeImageJobs = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
function update(id: string, patch: Partial<ImageJob>) {
  jobs = jobs.map(job => job.id === id ? { ...job, ...patch } : job);
  notify();
}
export function forgetImageJob(id: string) {
  jobs = jobs.filter(job => job.id !== id && job.assetId !== id);
  notify();
}

/** A route change does not own the request lifetime: results still save after leaving the composer. */
export function startImageGeneration(userId: string, input: ImageDraft): string {
  const running = jobs.find(job => job.userId === userId && ['generating', 'saving'].includes(job.phase));
  if (running) return running.id;
  const id = crypto.randomUUID();
  jobs = [{ id, userId, input: { ...input }, startedAt: Date.now(), phase: 'generating' }, ...jobs];
  notify();
  if (!listening && typeof window !== 'undefined') {
    listening = true;
    subscribeLibraryChanges(change => { if (change.resource === 'asset' && change.action === 'deleted') forgetImageJob(change.id); });
  }
  void runGeneration(id);
  return id;
}

async function runGeneration(id: string) {
  const job = jobs.find(item => item.id === id)!;
  try {
    const response = await fetch('/api/canvas/config');
    // 服务未启动/被网关拦截时会返回 HTML（502 页），先判 ok 再 json，
    // 避免 json() 抛出原始 SyntaxError 误导用户。
    if (!response.ok) throw new Error('服务未就绪，请稍后重试');
    const config = await response.json().catch(() => null);
    const channel = (config as any)?.channels?.find((item: any) => item.id === 'celano-image');
    const model = channel?.models?.[0]?.name;
    if (!model) throw new Error('请在管理后台配置生图模型接口');
    // 代理令牌由服务端下发，不写死在前端代码里。
    const proxyToken = String(config.proxyToken || channel?.apiKey || '');
    if (!proxyToken) throw new Error('画布代理令牌缺失，请重新加载页面');
    const { prompt, resolution, ratio, reference } = job.input;
    const fields = { model, prompt: prompt.trim(), size: imageSizeFor(resolution, ratio), resolution, quality: IMAGE_QUALITY[resolution], n: 1, expectedOwnerId: job.userId, celanoJobId: id };
    const headers: Record<string, string> = { Authorization: `Bearer ${proxyToken}` };
    let body: FormData | string;
    if (reference) {
      const form = new FormData();
      for (const [key, value] of Object.entries(fields)) form.set(key, String(value));
      form.set('image', reference.file);
      body = form;
    } else {
      headers['Content-Type'] = 'application/json'; body = JSON.stringify(fields);
    }
    const resultResponse = await fetch('/api/canvas/image/v1/images/' + (reference ? 'edits' : 'generations'), { method: 'POST', headers, body, credentials: 'same-origin' });
    const result = await resultResponse.json().catch(() => null);
    if (!resultResponse.ok) {
      const error = result?.error;
      throw new Error(typeof error === 'string' ? error : error?.message || (resultResponse.status === 401 ? '登录已失效，请重新登录' : '生成服务暂不可用，请稍后重试'));
    }
    if (!result) throw new Error('生成服务返回了无效结果，请稍后重试');
    await acceptImageResult(id, result);
  } catch (error) {
    if (isRequestDropped(error)) {
      try {
        await acceptImageResult(id, await pollImageJob(id));
        return;
      } catch (pollError) {
        update(id, { phase: 'failed', error: pollError instanceof Error ? pollError.message : '生成失败' });
        return;
      }
    }
    update(id, { phase: 'failed', error: error instanceof Error ? (error.message === 'Failed to fetch' ? '网络连接失败，请检查服务是否在线后重试。' : error.message) : '生成失败' });
  }
}

function isRequestDropped(error: unknown) {
  if (!(error instanceof Error)) return false;
  return error.name === 'AbortError' || error.name === 'TypeError' || error.message === 'Failed to fetch' || /NetworkError|ECONNRESET|aborted/i.test(error.message);
}

async function acceptImageResult(id: string, result: { data?: Array<{ url?: string; width?: number; height?: number; mimeType?: string }> }) {
  const image = result?.data?.[0];
  if (!image?.url) throw new Error('接口没有返回图片');
  update(id, { image: { url: image.url, width: image.width, height: image.height, mimeType: image.mimeType }, phase: 'saving' });
  await saveImageGeneration(id);
}

async function pollImageJob(id: string) {
  const deadline = Date.now() + IMAGE_JOB_WAIT_MS;
  while (Date.now() < deadline) {
    let response: Response;
    try {
      response = await fetch('/api/canvas/image/jobs/' + encodeURIComponent(id), { credentials: 'same-origin' });
    } catch (error) {
      if (!isRequestDropped(error)) throw error;
      await new Promise(resolve => setTimeout(resolve, 1500));
      continue;
    }
    const body = await response.json().catch(() => null) as { status?: string; result?: { data?: Array<{ url?: string; width?: number; height?: number; mimeType?: string }> }; error?: { message?: string } } | null;
    if (response.status === 404) throw new Error('生成任务不存在或已过期，请重新生成');
    if (response.status === 401 || response.status === 403) throw new Error('登录已失效，请重新登录');
    if (!response.ok || !body) {
      await new Promise(resolve => setTimeout(resolve, 1500));
      continue;
    }
    if (body.status === 'running') {
      await new Promise(resolve => setTimeout(resolve, 1500));
      continue;
    }
    if (body.status === 'succeeded' && body.result) return body.result;
    throw new Error(body.error?.message || (body.status === 'cancelled' ? '请求已取消' : '生成失败'));
  }
  throw new Error('生成超时，请稍后在作品页查看；若仍没有结果，请重新生成');
}

/** 重新打开页面时接着领取已经在服务端继续的生图，不再发起第二次扣费请求。 */
export function resumePersistedImageJobs() {
  if (typeof localStorage === 'undefined') return;
  let saved: PersistedImageJob[] = [];
  try { saved = JSON.parse(localStorage.getItem(PENDING_JOBS_KEY) || '[]'); } catch { return; }
  if (!Array.isArray(saved)) return;
  for (const item of saved) {
    if (!item || typeof item.id !== 'string' || typeof item.userId !== 'string') continue;
    if (jobs.some(job => job.id === item.id)) continue;
    const input: ImageDraft = { prompt: String(item.prompt || ''), resolution: item.resolution === '4K' ? '4K' : '2K', ratio: String(item.ratio || '1:1'), reference: null };
    jobs = [{ id: item.id, userId: item.userId, input, startedAt: Number(item.startedAt) || Date.now(), phase: 'generating' }, ...jobs];
    notify();
    void resumeServerJob(item.id);
  }
}

async function resumeServerJob(id: string) {
  try { await acceptImageResult(id, await pollImageJob(id)); }
  catch (error) { update(id, { phase: 'failed', error: error instanceof Error ? error.message : '生成失败' }); }
}

export async function saveImageGeneration(id: string) {
  const job = jobs.find(item => item.id === id);
  if (!job?.image) return;
  update(id, { phase: 'saving', error: undefined });
  try {
    // 服务端物化后返回鉴权短地址。这里引用该地址保存，不再把整张 data URL 传回。
    const saved = await saveCanvasAsset({ id, expectedOwnerId: job.userId, kind: 'image', title: job.input.prompt.trim().slice(0, 60), note: job.input.prompt, imageData: job.image.url, tags: ['文生图', job.input.resolution, job.input.ratio], data: { width: job.image.width, height: job.image.height }, metadata: { source: 'text-image' } });
    const assetId = saved.asset.id || id;
    update(id, { phase: 'done', assetId, image: { ...job.image, url: saved.asset.data.dataUrl || job.image.url, mimeType: saved.asset.data.mimeType || job.image.mimeType } });
  } catch (error) {
    update(id, { phase: 'failed', error: '图片已生成，保存失败：' + (error instanceof Error ? error.message : '请重试保存或下载原图') });
  }
}
