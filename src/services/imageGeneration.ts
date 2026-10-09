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
export const defaultImageDraft = (): ImageDraft => ({ prompt: '', resolution: '2K', ratio: '1:1', reference: null });
export const getImageDraft = (userId: string) => drafts.get(userId) || defaultImageDraft();
export const setImageDraft = (userId: string, draft: ImageDraft) => { drafts.set(userId, draft); };
export const getImageJobs = () => jobs;
export const subscribeImageJobs = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
function update(id: string, patch: Partial<ImageJob>) {
  jobs = jobs.map(job => job.id === id ? { ...job, ...patch } : job);
  listeners.forEach(listener => listener());
}
export function forgetImageJob(id: string) {
  jobs = jobs.filter(job => job.id !== id && job.assetId !== id);
  listeners.forEach(listener => listener());
}

/** A route change does not own the request lifetime: results still save after leaving the composer. */
export function startImageGeneration(userId: string, input: ImageDraft): string {
  const running = jobs.find(job => job.userId === userId && ['generating', 'saving'].includes(job.phase));
  if (running) return running.id;
  const id = crypto.randomUUID();
  jobs = [{ id, userId, input: { ...input }, startedAt: Date.now(), phase: 'generating' }, ...jobs];
  listeners.forEach(listener => listener());
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
    const fields = { model, prompt: prompt.trim(), size: imageSizeFor(resolution, ratio), resolution, quality: IMAGE_QUALITY[resolution], n: 1, expectedOwnerId: job.userId };
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
    const image = result.data?.[0];
    if (!image?.url) throw new Error('接口没有返回图片');
    update(id, { image: { url: image.url, width: image.width, height: image.height, mimeType: image.mimeType }, phase: 'saving' });
    await saveImageGeneration(id);
  } catch (error) {
    update(id, { phase: 'failed', error: error instanceof Error ? (error.message === 'Failed to fetch' ? '网络连接失败，请检查服务是否在线后重试。' : error.message) : '生成失败' });
  }
}

export async function saveImageGeneration(id: string) {
  const job = jobs.find(item => item.id === id);
  if (!job?.image) return;
  update(id, { phase: 'saving', error: undefined });
  try {
    const saved = await saveCanvasAsset({ id, expectedOwnerId: job.userId, kind: 'image', title: job.input.prompt.trim().slice(0, 60), note: job.input.prompt, imageData: job.image.url, tags: ['文生图', job.input.resolution, job.input.ratio], data: { width: job.image.width, height: job.image.height }, metadata: { source: 'text-image' } });
    const assetId = saved.asset.id || id;
    update(id, { phase: 'done', assetId, image: { ...job.image, url: saved.asset.data.dataUrl || job.image.url, mimeType: saved.asset.data.mimeType || job.image.mimeType } });
  } catch (error) {
    update(id, { phase: 'failed', error: '图片已生成，保存失败：' + (error instanceof Error ? error.message : '请重试保存或下载原图') });
  }
}
