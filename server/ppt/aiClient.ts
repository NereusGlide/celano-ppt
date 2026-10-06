import { imageSizeFor, IMAGE_QUALITY, pixelResolution, MAX_IMAGE_BYTES } from '../../src/shared/imageSpecs.js';
/**
 * AI 调用客户端（OpenAI 兼容协议）：
 * 文本规划走管理端「内容规划模型配置」，生图/图生图走管理端「AI 接口配置」。
 * 本模块不涉及计费与使用记录；支持外部 AbortSignal 取消。
 */
import type { PlanningModelConfig, ThirdPartyApiConfig } from '../../src/types.js';
import { normalizePlanningModelName } from '../planningModel.js';
import { assertPptImageSize, dataUrlBytes } from './imageDimensions.js';
import { withChineseTextAccuracy } from '../imagePrompt.js';

export type TextMessage = { role: 'system' | 'user' | 'assistant'; content: string };
export type VisionContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
export type VisionMessage = { role: 'system' | 'user' | 'assistant'; content: string | VisionContentPart[] };

function joinV1(baseUrl: string, path: string): string {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  if (base.includes(path)) return base; // 已给出完整端点
  return base.endsWith('/v1') ? base + path : base + '/v1' + path;
}

function timeoutSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  return signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
}

async function readApiError(resp: Response): Promise<string> {
  const text = (await resp.text()).slice(0, 500);
  try {
    const parsed = JSON.parse(text);
    return String(parsed?.error?.message || parsed?.message || text).slice(0, 180);
  } catch {
    return text.slice(0, 180);
  }
}

/** 上游中转站偶发网络抖动（连接超时/断流）时自动重试，避免整页/整任务因瞬时故障失败。 */
function isRetryableNetworkError(err: unknown): boolean {
  const cause = (err as any)?.cause?.message;
  const msg = String((err as any)?.message || cause || err || '');
  return /fetch failed|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|Connect Timeout|connect timeout|socket hang up|network error|undici|UND_ERR|terminated/i.test(msg);
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

async function withNetworkRetry<T>(fn: () => Promise<T>, signal: AbortSignal | undefined, attempts = 3): Promise<T> {
  for (let i = 0; i < attempts; i++) {
    if (signal?.aborted) throw new Error('任务已停止');
    try {
      return await fn();
    } catch (err) {
      if (i < attempts - 1 && isRetryableNetworkError(err) && !signal?.aborted) {
        await sleep(600 * (i + 1));
        continue;
      }
      throw err;
    }
  }
  throw new Error('网络请求失败');
}

/**
 * Materialize an upstream image response before it leaves the server boundary.
 * This makes signed URLs safe to persist and rejects non-native aspect ratios
 * before a deck or a single-page edit can be marked complete.
 */
async function materializeImage(item: any, signal: AbortSignal | undefined, context: string, requestedSize: string): Promise<string> {
  if (item?.b64_json) {
    const dataUrl = 'data:image/png;base64,' + String(item.b64_json);
    assertPptImageSize(dataUrlBytes(dataUrl), requestedSize, pixelResolution(requestedSize) || '2K', context);
    return dataUrl;
  }
  const value = String(item?.url || '');
  if (!value) throw new Error('图像接口未返回图片地址');
  if (value.startsWith('data:')) {
    assertPptImageSize(dataUrlBytes(value), requestedSize, pixelResolution(requestedSize) || '2K', context);
    return value;
  }
  let remote: URL;
  try { remote = new URL(value); } catch { throw new Error('图像接口返回了无效图片地址'); }
  if (remote.protocol !== 'http:' && remote.protocol !== 'https:') throw new Error('图像接口返回了不支持的图片地址');
  const response = await fetch(remote, { signal: timeoutSignal(signal, 120_000) });
  if (!response.ok) throw new Error('下载图像结果失败 HTTP ' + response.status);
  const mime = String(response.headers.get('content-type') || '').toLowerCase().split(';')[0].trim();
  if (mime !== 'image/png' && mime !== 'image/jpeg' && mime !== 'image/webp') throw new Error('图像接口返回的不是支持的图片格式');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error('图像结果过大，无法保存');
  assertPptImageSize(bytes, requestedSize, pixelResolution(requestedSize) || '2K', context);
  return 'data:' + mime + ';base64,' + bytes.toString('base64');
}

/** 文本规划：OpenAI 兼容 chat/completions，reasoning_effort 可选透传 */
export async function chatText(
  cfg: Pick<PlanningModelConfig, 'baseUrl' | 'apiKey' | 'modelName' | 'reasoningEffort'>,
  messages: TextMessage[],
  signal?: AbortSignal,
  // 高推理档（xhigh）+ 整套页面大纲的长输出会远超 240s；此处均为后台异步任务，等得起，改用 600s
  timeoutMs = 600_000,
): Promise<string> {
  if (!cfg || typeof cfg.baseUrl !== 'string' || !cfg.baseUrl.trim()) throw new Error('未配置规划模型接口，请在管理后台设置');
  if (!cfg.apiKey || !cfg.apiKey.trim()) throw new Error('规划模型 API Key 未配置，请在管理后台设置');
  const body: Record<string, unknown> = { model: normalizePlanningModelName(cfg.baseUrl, cfg.modelName || 'gpt-6.1-sol'), messages };
  if (cfg.reasoningEffort && cfg.reasoningEffort !== 'auto') body.reasoning_effort = cfg.reasoningEffort;
  return withNetworkRetry(async () => {
    const resp = await fetch(joinV1(cfg.baseUrl, '/chat/completions'), {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + String(cfg.apiKey).trim(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: timeoutSignal(signal, timeoutMs),
    });
    if (!resp.ok) throw new Error('规划模型接口 HTTP ' + resp.status + '：' + await readApiError(resp));
    const data: any = await resp.json();
    const text = String(data?.choices?.[0]?.message?.content || '').trim();
    if (!text) throw new Error('规划模型未返回内容');
    return text;
  }, signal);
}

/** 视觉读取：扫描版文件转图后，用多模态模型直接理解页面内容。 */
export async function chatVision(
  cfg: Pick<PlanningModelConfig, 'baseUrl' | 'apiKey' | 'modelName' | 'visionModelName'>,
  messages: VisionMessage[],
  signal?: AbortSignal,
  timeoutMs = 300_000,
): Promise<string> {
  if (!cfg || typeof cfg.baseUrl !== 'string' || !cfg.baseUrl.trim()) throw new Error('未配置规划模型接口，请在管理后台设置');
  if (!cfg.apiKey || !cfg.apiKey.trim()) throw new Error('规划模型 API Key 未配置，请在管理后台设置');
  const model = String(cfg.visionModelName || cfg.modelName || 'gpt-4o').trim();
  return withNetworkRetry(async () => {
    const resp = await fetch(joinV1(cfg.baseUrl, '/chat/completions'), {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + String(cfg.apiKey).trim(), 'Content-Type': 'application/json' },
      // max_tokens 给转录输出设上限，避免模型输出冗长拖慢每批耗时（3 页转录远小于 4096）。
      body: JSON.stringify({ model, messages, max_tokens: 4096 }),
      signal: timeoutSignal(signal, timeoutMs),
    });
    if (!resp.ok) throw new Error('视觉模型接口 HTTP ' + resp.status + '：' + await readApiError(resp));
    const data: any = await resp.json();
    const text = String(data?.choices?.[0]?.message?.content || '').trim();
    if (!text) throw new Error('视觉模型未返回内容');
    return text;
  }, signal);
}

/** 文生图：生成完整 16:9 页面图片，返回 data URL 或远程 URL */
export async function generateImage(
  config: ThirdPartyApiConfig,
  prompt: string,
  size = imageSizeFor('2K'),
  signal?: AbortSignal,
  timeoutMs = pixelResolution(size) === '2K' ? 600_000 : 270_000,
): Promise<string> {
  if (!config || !config.apiKey) throw new Error('未配置生图模型接口，请在管理后台设置');
  const endpoint = joinV1(config.baseUrl, '/images/generations');
  const attempt = async (attemptPrompt: string) => {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + String(config.apiKey).trim(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: config.modelName || 'gpt-image-2.5-sunburst', prompt: withChineseTextAccuracy(attemptPrompt, pixelResolution(size) || '2K'), size, quality: IMAGE_QUALITY[pixelResolution(size) || '2K'], ...(pixelResolution(size) === '4K' ? { output_format: 'png', n: 1 } : {}) }),
      signal: timeoutSignal(signal, timeoutMs),
    });
    if (!resp.ok) throw new Error('生图接口 HTTP ' + resp.status + '：' + await readApiError(resp));
    const data: any = await resp.json();
    const item = data?.data?.[0];
    if (!item) throw new Error('生图接口未返回图像');
    return materializeImage(item, signal, '生图结果', size);
  };
  return withNetworkRetry(() => attempt(prompt), signal);
}

function dataUrlToFormImage(dataUrl: string): { blob: Blob; ext: string } {
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) throw new Error('参考图格式无效');
  const buffer = Buffer.from(match[2], 'base64');
  return { blob: new Blob([new Uint8Array(buffer)], { type: 'image/' + match[1] }), ext: match[1] === 'jpeg' ? 'jpg' : match[1] };
}

/** 图生图编辑：多张参考图（用户参考图 + 封面风格锚定） */
export async function editImage(
  config: ThirdPartyApiConfig,
  images: string[],
  prompt: string,
  size = imageSizeFor('2K'),
  signal?: AbortSignal,
  timeoutMs = pixelResolution(size) === '2K' ? 600_000 : 270_000,
): Promise<string> {
  if (!config || !config.apiKey) throw new Error('未配置生图模型接口，请在管理后台设置');
  const endpoint = joinV1(config.baseUrl, '/images/edits');
  const attempt = async (attemptPrompt: string) => {
    const form = new FormData();
    form.append('model', config.modelName || 'gpt-image-2.5-sunburst');
    form.append('prompt', withChineseTextAccuracy(attemptPrompt, pixelResolution(size) || '2K'));
    form.append('size', size);
    form.append('quality', IMAGE_QUALITY[pixelResolution(size) || '2K']);
    if (pixelResolution(size) === '4K') {
      form.append('output_format', 'png');
      form.append('n', '1');
    }
    for (const image of images) {
      const converted = dataUrlToFormImage(image);
      form.append(images.length > 1 ? 'image[]' : 'image', converted.blob, 'ref-' + Math.random().toString(36).slice(2, 8) + '.' + converted.ext);
    }
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + String(config.apiKey).trim() },
      body: form,
      signal: timeoutSignal(signal, timeoutMs),
    });
    if (!resp.ok) throw new Error('图像编辑接口 HTTP ' + resp.status + '：' + await readApiError(resp));
    const data: any = await resp.json();
    const item = data?.data?.[0];
    if (!item) throw new Error('图像编辑接口未返回图像');
    return materializeImage(item, signal, '图像编辑结果', size);
  };
  return withNetworkRetry(() => attempt(prompt), signal);
}

export function isImageDataUrl(value: string): boolean {
  return /^data:image\/(png|jpeg|webp);base64,/.test(value);
}
