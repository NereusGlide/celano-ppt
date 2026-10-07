import { MAX_IMAGE_DATA_URL_LENGTH } from '../../src/shared/imageSpecs.js';
/**
 * PPT 生成引擎（移植自「超级画布Agent」web/src/lib/ppt/background-deck.ts）
 * 步骤：规划（大纲）→ 逐页并发生图 → 任务状态机（停止/继续/重试失败页/单页修改）。
 * 服务端持久化到 data/store.json（任务）+ data/images（页面图片），服务重启自动恢复。
 * 任务创建与单页重生成的计费由路由/统一计费模块负责。
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { db } from '../db.js';
import { chargeCredits, normalizeResolution, resolutionCost, resolutionImageSize, refundCredits } from '../billing.js';
import { chatText, editImage, generateImage } from './aiClient.js';
import { GLOBAL_IMAGE_SLOTS, withImageSlot } from './imageSlots.js';
import { assertNative16x9, assertPptImageSize, dataUrlBytes, type ImageDimensions } from './imageDimensions.js';
import { analyzeReferences, analyzeStyleReferences, MAX_REFERENCE_TEXT, planningReferenceContext } from './referenceAnalysis.js';
import {
  buildPlanPrompts,
  buildSlidePrompt,
  DEFAULT_PPT_PALETTE,
  DEFAULT_PPT_VISUAL_DIRECTION,
  PLAN_BATCH_SIZE,
  PPT_PLAN_EFFORT,
  PPT_PLAN_MODEL,
  parseSlidePlan,
} from './plan.js';
import type { LogoConfig, PptDeck, PptDeckSlide, PptPalette, PptReferenceImage, PptSlidePlan } from '../../src/types.js';

const DATA_IMAGES = path.resolve(process.cwd(), 'data', 'images');
// 三张用户风格参考 + 一张已生成的封面，避免最后一张参考被封面挤掉。
const MAX_REFERENCE_IMAGES = 4;

interface DeckRuntime {
  controller: AbortController;
  cancelled: boolean;
  running: boolean;
  busy: Set<string>;
  workersActive: boolean;
  fatalImageError?: string;
  /** 每次启动/停止都递增，避免旧一轮请求在快速停止后继续恢复写状态。 */
  runToken: number;
}

const runtimes = new Map<string, DeckRuntime>();

function runtimeFor(deckId: string): DeckRuntime {
  let rt = runtimes.get(deckId);
  if (!rt) {
    rt = { controller: new AbortController(), cancelled: false, running: false, busy: new Set(), workersActive: false, runToken: 0 };
    runtimes.set(deckId, rt);
  }
  return rt;
}

const nanoid = (size = 8) => crypto.randomBytes(size).toString('hex');

function imageFullPath(storageKey: string): string {
  const full = path.join(DATA_IMAGES, storageKey);
  if (full !== DATA_IMAGES && !full.startsWith(DATA_IMAGES + path.sep)) return '';
  return full;
}

function ensureDir(filePath: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function saveDataUrlImage(storageKey: string, dataUrl: string) {
  const full = imageFullPath(storageKey);
  if (!full) throw new Error('非法存储路径');
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) throw new Error('图片数据格式无效');
  ensureDir(full);
  fs.writeFileSync(full, Buffer.from(match[2], 'base64'));
}

function imageExtensionFromMime(mime: string): 'png' | 'jpg' | 'webp' {
  const normalized = String(mime || '').toLowerCase().split(';')[0].trim();
  if (normalized === 'image/jpeg' || normalized === 'image/jpg') return 'jpg';
  if (normalized === 'image/webp') return 'webp';
  return 'png';
}

function imageExtensionFromDataUrl(dataUrl: string): 'png' | 'jpg' | 'webp' {
  const mime = /^data:([^;,]+)/i.exec(dataUrl)?.[1] || '';
  return imageExtensionFromMime(mime);
}

function loadImageDataUrl(storageKey: string): string | null {
  const full = imageFullPath(storageKey);
  if (!full || !fs.existsSync(full)) return null;
  try {
    const ext = path.extname(storageKey).toLowerCase();
    const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png';
    return 'data:' + mime + ';base64,' + fs.readFileSync(full).toString('base64');
  } catch {
    return null;
  }
}

/** 页面图片磁盘路径（供路由读取原图）。 */
export function slideImagePath(deck: PptDeck, slideId: string): string {
  const slide = deck.slides.find(s => s.id === slideId);
  if (!slide || !slide.storageKey) return '';
  const full = imageFullPath(slide.storageKey);
  return full && fs.existsSync(full) ? full : '';
}

/** 删除 deck 的全部页面图片文件（作品过期清理用，路径守卫防穿越）。 */
export function removeDeckImageFiles(deck: PptDeck): void {
  for (const slide of deck.slides) {
    if (!slide.storageKey) continue;
    const full = imageFullPath(slide.storageKey);
    if (full) { try { fs.unlinkSync(full); } catch { /* 文件可能已不存在 */ } }
  }
}

/** Logo 上传文件仍由首页的鉴权 URL 提供；工作台路由用同一配置读取它。 */
export function logoImagePath(deck: PptDeck): string {
  const url = String(deck.logo?.url || '');
  const match = /^\/api\/legacy-uploads\/([^/]+)\/([^/?#]+)$/i.exec(url);
  if (!match) return '';
  const userSegment = decodeURIComponent(match[1]);
  if (userSegment !== deck.userId) return '';
  const filename = path.basename(decodeURIComponent(match[2]));
  const full = path.resolve(process.cwd(), 'data', 'legacy-uploads', 'user-' + deck.userId, filename);
  const root = path.resolve(process.cwd(), 'data', 'legacy-uploads', 'user-' + deck.userId) + path.sep;
  return full.startsWith(root) && fs.existsSync(full) ? full : '';
}

function patchSlide(deckId: string, slideId: string, patch: Partial<PptDeckSlide>) {
  const fresh = db.getPptDeck(deckId);
  if (!fresh) return;
  const idx = fresh.slides.findIndex(s => s.id === slideId);
  if (idx === -1) return;
  const slides = fresh.slides.slice();
  slides[idx] = { ...slides[idx], ...patch };
  db.updatePptDeck(deckId, { slides });
}

/**
 * 失败页按页退回预扣点数，并记录已处理的 slide id，避免轮询/恢复流程重复退款。
 * 只在任务一轮渲染结束后调用；停止中的 generating 页属于可继续任务，不退款。
 */
function refundFailedSlides(deckId: string): void {
  const deck = db.getPptDeck(deckId);
  if (!deck) return;
  const refundedIds = new Set(deck.refundedSlideIds || []);
  const failed = deck.slides.filter(slide => slide.status === 'failed' && !refundedIds.has(slide.id));
  if (!failed.length) return;
  const amount = failed.length * resolutionCost(deck.resolution);
  const result = db.refundPptFailedSlides(deck.userId, deckId, failed.map(slide => slide.id), amount, 'PPT 失败页面退款：' + failed.length + ' 页');
  if (result.refunded > 0) {
    db.updatePptDeck(deckId, { error: deck.error || ('有 ' + failed.length + ' 页生成失败，已退回对应点数；可重试失败页面') });
    console.log('[ppt] 失败页面已退款:', deckId, failed.length, '页，余额:', result.credits);
  }
}

/** 重试已退款的失败页前重新扣除对应点数，防止无限免费重试。 */
function chargeRetrySlides(deck: PptDeck, slideIds: string[]): { ok: true; deck: PptDeck } | { ok: false; error: string } {
  const refundedIds = new Set(deck.refundedSlideIds || []);
  const retryIds = slideIds.filter(id => refundedIds.has(id));
  if (!retryIds.length) return { ok: true, deck };
  const amount = retryIds.length * resolutionCost(deck.resolution);
  const result = db.chargePptRetry(deck.userId, deck.id, retryIds, amount, 'PPT 失败页面重试：' + retryIds.length + ' 页');
  if (!result.ok) return result;
  return result;
}

/** 先分析参考文件，再逐批规划；AI 失败时暂停，不带着备用内容继续扣费生图。 */
async function planDeck(deckId: string, token: number): Promise<boolean> {
  const deck = db.getPptDeck(deckId);
  if (!deck) return false;
  const rt = runtimeFor(deckId);
  const controller = rt.controller;
  const isCurrent = () => rt.runToken === token && !rt.cancelled && !controller.signal.aborted;
  const planning = db.getPlanningConfig();
  const planned: PptSlidePlan[] = [];
  let title = deck.prompt;
  let meta: { subtitle: string; visualDirection: string; palette: PptPalette } = { subtitle: '', visualDirection: DEFAULT_PPT_VISUAL_DIRECTION, palette: { ...DEFAULT_PPT_PALETTE } };
  const planModel = planning?.modelName?.trim() || PPT_PLAN_MODEL;
  const planEffort = planning?.reasoningEffort || PPT_PLAN_EFFORT;
  console.log('[ppt] 开始规划:', deckId, '页数:', deck.pageCount, '模型:', planning?.apiKey ? planModel : '(未配置)', 'effort:', planEffort);
  let usedFallback = false;
  let planningWarning = '';
  let referenceAnalysis = '';
  if (planning && planning.apiKey) {
    try {
      if (deck.referencesText.trim()) {
        db.updatePptDeck(deckId, { referenceAnalysisStatus: 'analyzing', referenceAnalysis: undefined, referenceAnalysisProgress: undefined });
        referenceAnalysis = await analyzeReferences(planning, deck.prompt, deck.referencesText, controller.signal, (done, total) => {
          if (isCurrent()) db.updatePptDeck(deckId, { referenceAnalysisProgress: { done, total } });
        });
        if (!isCurrent()) return false;
        db.updatePptDeck(deckId, { referenceAnalysisStatus: 'done', referenceAnalysis });
      }
      // 风格参考图分析：用视觉模型反推每张图值得借鉴的设计点，供渲染阶段综合延申（最多取前 3 张）
      const styleRefs = deck.referenceImages.filter(ref => ref.name.startsWith('视觉风格参考：'));
      if (styleRefs.length && !deck.styleAnalysis) {
        const styleUrls = styleRefs
          .map(ref => ref.storageKey ? loadImageDataUrl(ref.storageKey) : null)
          .filter((url): url is string => Boolean(url))
          .slice(0, 3);
        if (styleUrls.length) {
          try {
            const styleAnalysis = await analyzeStyleReferences(planning, styleUrls, controller.signal);
            if (!isCurrent()) return false;
            db.updatePptDeck(deckId, { styleAnalysis });
          } catch (err) {
            // 视觉模型不可用（未配 visionModelName 或上游不支持图像）时跳过风格反推，不阻断规划
            console.warn('[ppt] 风格参考反推失败，跳过:', String((err as Error)?.message || err).slice(0, 120));
          }
        }
      }
      const batched = deck.pageCount > PLAN_BATCH_SIZE;
      const totalBatches = batched ? Math.ceil(deck.pageCount / PLAN_BATCH_SIZE) : 1;
      let batchIndex = 0;
      for (let from = 1; from <= deck.pageCount; from += batched ? PLAN_BATCH_SIZE : deck.pageCount) {
        if (!isCurrent()) return false;
        batchIndex += 1;
        if (isCurrent()) db.updatePptDeck(deckId, { planningProgress: { batch: batchIndex, totalBatches } });
        const to = batched ? Math.min(deck.pageCount, from + PLAN_BATCH_SIZE - 1) : deck.pageCount;
        const prompts = buildPlanPrompts({
          topic: deck.prompt,
          pageCount: to - from + 1,
          references: referenceAnalysis ? planningReferenceContext(deck.referencesText, referenceAnalysis) : deck.referencesText,
          faithfulReference: deck.referenceImages.some(ref => ref.name.startsWith('视觉风格参考：')),
          batch: batched ? {
            from,
            to,
            total: deck.pageCount,
            planned: planned.map(item => ({ title: item.title, pageType: item.pageType, summary: item.summary })),
          } : undefined,
        });
        const text = await chatText(
          { ...planning, modelName: planModel, reasoningEffort: planEffort },
          [{ role: 'system', content: prompts.system }, { role: 'user', content: prompts.user }],
          controller.signal,
        );
        const batchPlan = parseSlidePlan(text, to - from + 1, { coverFirst: from === 1, closingLast: to === deck.pageCount });
        if (batchPlan.slides.length !== to - from + 1) throw new Error('AI 返回的规划页数不完整');
        planned.push(...batchPlan.slides);
        if (from === 1) {
          title = batchPlan.title;
          meta = { subtitle: batchPlan.subtitle, visualDirection: batchPlan.visualDirection, palette: batchPlan.palette };
        }
      }
      if (planned.length !== deck.pageCount) throw new Error('规划页数不完整');
    } catch (err) {
      console.error('[ppt] AI 规划失败，暂停任务:', err);
      usedFallback = true;
      planningWarning = 'AI 内容规划失败，已暂停生成：' + String(err instanceof Error ? err.message : err).slice(0, 200);
      if (deck.referencesText.trim() && !referenceAnalysis && isCurrent()) db.updatePptDeck(deckId, { referenceAnalysisStatus: 'failed' });
    }
  } else {
    usedFallback = true;
    planningWarning = '未配置内容规划接口，已暂停生成';
    if (deck.referencesText.trim() && isCurrent()) db.updatePptDeck(deckId, { referenceAnalysisStatus: 'failed' });
  }
  if (usedFallback) {
    if (!isCurrent()) return false;
    db.updatePptDeck(deckId, {
      planningSource: 'fallback', planningWarning, error: planningWarning,
      running: false, finished: false, stage: 'paused',
      slides: Array.from({ length: deck.pageCount }, (_, index) => ({
        id: deck.slides[index]?.id || 's_' + nanoid(),
        plan: { title: `第 ${index + 1} 页 · 规划未完成`, bullets: [], pageType: 'core-insight' as const },
        status: 'failed' as const, error: planningWarning,
      })),
    });
    refundFailedSlides(deckId);
    return false;
  }
  const current = db.getPptDeck(deckId);
  if (!current || !isCurrent()) return false;
  db.updatePptDeck(deckId, {
    title: title.slice(0, 48),
    subtitle: meta.subtitle,
    visualDirection: meta.visualDirection,
    palette: meta.palette,
    planningSource: usedFallback ? 'fallback' : 'ai',
    planningWarning: planningWarning || undefined,
    error: undefined,
    slides: planned.map((plan, index) => ({ id: current.slides[index]?.id || 's_' + nanoid(), plan, status: 'idle' as const })),
    stage: 'rendering',
  });
  console.log('[ppt] 规划完成:', deckId, '页数:', planned.length);
  return true;
}

/** 渲染单页：无参考图走文生图，有参考图（用户参考 + 封面风格锚定）走图生图编辑。 */
async function renderSlide(deckId: string, slideId: string, instruction?: string, token = runtimeFor(deckId).runToken): Promise<void> {
  const deck = db.getPptDeck(deckId);
  if (!deck) return;
  const rt = runtimeFor(deckId);
  const controller = rt.controller;
  if (rt.runToken !== token) return;
  const slide = deck.slides.find(s => s.id === slideId);
  if (!slide) return;
  const index = deck.slides.findIndex(s => s.id === slideId);
  patchSlide(deckId, slideId, { status: 'generating', error: undefined });
  try {
    const imageConfig = db.resolveImageConfig(deck.resolution);
    const references: string[] = [];
    const referenceLabels: string[] = [];
    const faithfulReference = deck.referenceImages.some(ref => ref.name.startsWith('视觉风格参考：'));
    const cover = deck.slides[0];
    const addCover = () => {
      if (cover && cover.id !== slide.id && cover.status === 'done' && cover.storageKey) {
        const dataUrl = loadImageDataUrl(cover.storageKey);
        if (dataUrl) { references.push(dataUrl); referenceLabels.push('已生成封面，仅辅助系列一致性'); }
      }
    };
    const addReference = (ref: PptReferenceImage) => {
      const dataUrl = ref.storageKey ? loadImageDataUrl(ref.storageKey) : null;
      if (dataUrl) { references.push(dataUrl); referenceLabels.push(ref.name); }
    };
    if (faithfulReference) {
      // 原始模版排在第一位：多图接口失败时，单图重试仍保留模版，不能只剩已生成封面。
      const styleRefs = deck.referenceImages.filter(ref => ref.name.startsWith('视觉风格参考：'));
      const offset = index % styleRefs.length;
      for (let i = 0; i < Math.min(styleRefs.length, MAX_REFERENCE_IMAGES - 1); i++) {
        addReference(styleRefs[(offset + i) % styleRefs.length]);
      }
      addCover();
      for (const ref of deck.referenceImages.filter(ref => !ref.name.startsWith('视觉风格参考：'))) {
        if (references.length >= MAX_REFERENCE_IMAGES) break;
        addReference(ref);
      }
    } else {
      addCover();
      const offset = index * Math.max(1, MAX_REFERENCE_IMAGES - references.length);
      for (let i = 0; i < deck.referenceImages.length; i++) {
        addReference(deck.referenceImages[(offset + i) % deck.referenceImages.length]);
      }
    }
    const refs = references.slice(0, MAX_REFERENCE_IMAGES);
    const buildPrompt = (count: number) => buildSlidePrompt({
      deckPrompt: deck.prompt,
      slide: slide.plan,
      index,
      referenceCount: count,
      faithfulReference,
      referenceLabels: referenceLabels.slice(0, count),
      styleAnalysis: deck.styleAnalysis,
      editInstruction: instruction,
    });
    const prompt = buildPrompt(refs.length);
    console.log('[ppt] 页面参考:', deckId, slideId, faithfulReference ? '风格延申' : '原生创作', referenceLabels.slice(0, refs.length));
    const signal = controller.signal;
    let dataUrl: string;
    if (!references.length) {
      dataUrl = await withImageSlot(() => generateImage(imageConfig, prompt, resolutionImageSize(deck.resolution), signal));
    } else {
      try {
        dataUrl = await withImageSlot(() => editImage(imageConfig, refs, prompt, resolutionImageSize(deck.resolution), signal));
      } catch (err) {
        // 多参考图被上游拒绝时退化为仅用第一张参考图
        if (refs.length > 1) {
          console.warn('[ppt] 多图参考失败，保留首张参考重试:', deckId, slideId, referenceLabels[0]);
          dataUrl = await withImageSlot(() => editImage(imageConfig, refs.slice(0, 1), buildPrompt(1), resolutionImageSize(deck.resolution), signal));
        }
        else throw err;
      }
    }
    if (rt.runToken !== token) return;
    if (rt.cancelled || controller.signal.aborted) {
      patchSlide(deckId, slideId, { status: 'idle', error: undefined });
      return;
    }
    let storageKey = 'user-' + deck.userId + '/deck-' + deckId + '/slide-' + slideId + '.png';
    let dimensions: ImageDimensions;
    if (dataUrl.startsWith('data:')) {
      dimensions = assertPptImageSize(dataUrlBytes(dataUrl), resolutionImageSize(deck.resolution), deck.resolution);
      storageKey = 'user-' + deck.userId + '/deck-' + deckId + '/slide-' + slideId + '.' + imageExtensionFromDataUrl(dataUrl);
      saveDataUrlImage(storageKey, dataUrl);
    } else {
      const resp = await fetch(dataUrl, { signal: AbortSignal.timeout(120_000) });
      if (!resp.ok) throw new Error('下载生成图片失败 HTTP ' + resp.status);
      const contentType = String(resp.headers.get('content-type') || '').toLowerCase().split(';')[0].trim();
      if (contentType !== 'image/png' && contentType !== 'image/jpeg' && contentType !== 'image/webp') {
        throw new Error('生图接口返回的不是支持的图片格式');
      }
      const bytes = Buffer.from(await resp.arrayBuffer());
      dimensions = assertPptImageSize(bytes, resolutionImageSize(deck.resolution), deck.resolution);
      storageKey = 'user-' + deck.userId + '/deck-' + deckId + '/slide-' + slideId + '.' + imageExtensionFromMime(contentType);
      const full = imageFullPath(storageKey);
      if (!full) throw new Error('非法存储路径');
      ensureDir(full);
      fs.writeFileSync(full, bytes);
    }
    // 远程 URL 下载本身会跨越异步边界，期间可能发生 stop/resume；
    // 丢弃已经过期的一轮结果，避免旧请求覆盖新一轮页面。
    if (rt.runToken !== token) return;
    patchSlide(deckId, slideId, { status: 'done', storageKey, width: dimensions.width, height: dimensions.height, updatedAt: Date.now() });
    console.log('[ppt] 页面生成完成:', deckId, slideId);
  } catch (err: any) {
    // 停止后立即继续时，旧请求不能覆盖新一轮任务的状态。
    if (rt.runToken !== token) return;
    if (controller.signal.aborted) {
      patchSlide(deckId, slideId, { status: 'idle', error: undefined });
    } else {
      const error = String(err?.message || err).slice(0, 200);
      patchSlide(deckId, slideId, { status: 'failed', error });
      if (error.includes('尺寸不符合所选画质') || error.includes('必须是原生 16:9')) {
        // A provider that ignores native dimensions will fail every queued page.
        // Stop the batch immediately instead of spending on the remaining pages.
        rt.fatalImageError = error;
        rt.cancelled = true;
        controller.abort();
      }
    }
  }
}

/** 并发渲染剩余页面。 */
async function runWorkers(deckId: string, token: number): Promise<void> {
  const deck = db.getPptDeck(deckId);
  if (!deck || !deck.slides.length) return;
  const rt = runtimeFor(deckId);
  if (rt.runToken !== token) return;
  if (rt.workersActive) return;
  const controller = rt.controller;
  rt.workersActive = true;
  rt.running = true;
  db.updatePptDeck(deckId, { running: true, finished: false, stage: 'rendering' });

  // 所有待生成页面进入同一个 worker 池，确保产品承诺的 6 路并发真正生效。
  // 封面完成后，后续页面会自动把它作为视觉参考；首轮并发时未完成封面的页面
  // 仍然可以先生成，避免为了视觉锚点把吞吐降成 5 路。
  let cursor = 0;
  // 历史任务可能保存过旧的并发值；从现在起所有 PPT 任务统一按 6 路恢复，
  // 避免刷新/重启后同一任务又退回旧吞吐。
  const concurrency = Math.min(GLOBAL_IMAGE_SLOTS, 6);
  if (deck.concurrency !== concurrency) db.updatePptDeck(deckId, { concurrency });
  const workers = Array.from({ length: Math.min(concurrency, deck.slides.length) }, async () => {
    for (;;) {
      if (rt.runToken !== token || rt.cancelled || controller.signal.aborted) return;
      const fresh = db.getPptDeck(deckId);
      if (!fresh || !fresh.running) return;
      const slide = fresh.slides[cursor++];
      if (!slide) return;
      if (slide.status !== 'idle') continue;
      // 单页重新生成会把目标页加入 busy 集合；让批量 worker 跳过它，避免
      // 同一页面同时发起两次上游请求并发生最后写入覆盖。
      if (rt.busy.has(slide.id)) continue;
      await renderSlide(deckId, slide.id, undefined, token);
    }
  });
  await Promise.all(workers);
  // 旧一轮请求可能在停止后才结束，不能清理新一轮任务的 workersActive 标记。
  if (rt.runToken !== token) return;
  rt.workersActive = false;
  if (rt.fatalImageError) {
    const current = db.getPptDeck(deckId);
    if (current) db.updatePptDeck(deckId, {
      running: false, finished: false, stage: 'paused',
      error: '生图接口未遵守原生尺寸要求，已暂停整套生成并退回未完成页面点数：' + rt.fatalImageError,
      slides: current.slides.map(slide => slide.status === 'done' ? slide : { ...slide, status: 'failed' as const, error: slide.error || '尺寸接口异常，后续页面已停止' }),
    });
  }
  const fresh = db.getPptDeck(deckId);
  if (!fresh) return;
  refundFailedSlides(deckId);
  const afterRefund = db.getPptDeck(deckId);
  if (!afterRefund) return;
  if (!rt.cancelled && !controller.signal.aborted && fresh.running) {
    const allDone = afterRefund.slides.length > 0 && afterRefund.slides.every(s => s.status === 'done');
    db.updatePptDeck(deckId, { running: false, finished: allDone, stage: allDone ? 'finished' : 'paused' });
  }
  rt.running = false;
}

/** 完整任务：先规划（若尚无页面），再逐页渲染。 */
async function runDeck(deckId: string, token: number) {
  const rt = runtimeFor(deckId);
  if (rt.runToken !== token) return;
  if (rt.running) return;
  rt.running = true;
  const deck = db.getPptDeck(deckId);
  if (!deck) { rt.running = false; return; }
  if (!deck.slides.length || deck.planningSource === 'fallback') {
    db.updatePptDeck(deckId, { stage: 'planning', running: true, finished: false });
    const planned = await planDeck(deckId, token);
    if (!planned) {
      if (rt.runToken === token) {
        db.updatePptDeck(deckId, { running: false, stage: 'paused' });
        rt.running = false;
      }
      return;
    }
    const afterPlan = db.getPptDeck(deckId);
    if (afterPlan && !afterPlan.slides.length) {
      // 防御：规划未产出任何页面时不要永久占用 running 状态，否则会阻塞所有新任务。
      db.updatePptDeck(deckId, { running: false, finished: false, stage: 'paused', error: '规划未产出页面，任务已暂停' });
      rt.running = false;
      return;
    }
  }
  await runWorkers(deckId, token);
}

function launchDeck(deckId: string, token = runtimeFor(deckId).runToken) {
  void runDeck(deckId, token).catch(err => {
    console.error('[ppt] 任务异常:', deckId, err);
    const rt = runtimeFor(deckId);
    if (rt.runToken === token) {
      // 未预期异常时，把仍在 generating/idle 的页归为失败并执行一次按页退款，
      // 防止任务卡在 running 且用户为完全没有产出的页面永久扣点。
      const current = db.getPptDeck(deckId);
      if (current) {
        const failedSlides = current.slides.map(slide => slide.status === 'done' ? slide : { ...slide, status: 'failed' as const, error: slide.error || '任务异常中断' });
        if (failedSlides.some((slide, index) => slide !== current.slides[index])) {
          db.updatePptDeck(deckId, { slides: failedSlides });
          refundFailedSlides(deckId);
        }
      }
      db.updatePptDeck(deckId, { running: false, finished: false, stage: 'paused', error: String(err?.message || err).slice(0, 200) });
      rt.running = false;
      rt.workersActive = false;
    }
  });
}

export type PptStartInput = {
  prompt: string;
  pageCount: number;
  concurrency: number;
  requestKey?: string;
  resolution?: '2K' | '4K';
  referencesText?: string;
  referenceImages?: { name: string; dataUrl: string }[];
  logo?: LogoConfig;
};

/** 新建生成任务并启动。 */
export function startDeck(userId: string, input: PptStartInput): PptDeck | { error: string } {
  const requestKey = String(input.requestKey || '').trim().slice(0, 160);
  if (requestKey) {
    const previous = db.getPptDecks(userId).find(deck => deck.requestKey === requestKey);
    if (previous) return previous;
  }
  const active = db.getPptDecks(userId).find(d => d.running);
  if (active) return { error: '已有正在进行的生成任务，请先停止或等待完成' };
  const prompt = String(input.prompt || '').trim();
  if (!prompt) return { error: '请输入主题或需求' };
  const pageCount = Number(input.pageCount);
  if (String(input.referencesText || '').length > MAX_REFERENCE_TEXT) return { error: '参考资料内容超过分析上限，请拆分上传' };
  if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > 100) return { error: 'PPT 页数必须为 1–100 的整数' };
  const planning = db.getPlanningConfig();
  if (!planning?.apiKey || !planning.baseUrl) return { error: '未配置内容规划模型，请先在管理后台设置后生成' };
  const resolution = normalizeResolution(input.resolution);
  // 预检：按用户选择的画质档位检查对应接口，避免扣点后页面必然全部失败。
  const imageConfig = db.resolveImageConfig(resolution);
  if (!imageConfig || !imageConfig.apiKey) {
    return { error: '未配置生图模型接口，请在管理后台「AI 接口配置」中填写 API 密钥后再生成' };
  }
  const costPerSlide = resolutionCost(resolution);
  const totalCost = pageCount * costPerSlide;
  const charged = chargeCredits(userId, totalCost, 'PPT 生成：' + pageCount + ' 页 · ' + resolution + '，每页 ' + costPerSlide + ' 点');
  if (!charged.ok) return { error: charged.error };
  // 产品固定 6 路并发，避免界面显示的并发数与实际吞吐不一致。
  const concurrency = 6;
  const id = 'deck_' + Date.now() + '_' + nanoid();
  const referenceImages: PptReferenceImage[] = [];
  const refs = Array.isArray(input.referenceImages) ? input.referenceImages.slice(0, 18) : [];
  for (let i = 0; i < refs.length; i++) {
    const item = refs[i];
    if (!item || typeof item.dataUrl !== 'string' || !/^data:image\/(png|jpeg|webp);base64,/.test(item.dataUrl)) continue;
    // data URL 会比原始文件膨胀约三分之一；允许约 6MB 的上传图片正常进入任务。
    if (item.dataUrl.length > 12_000_000) continue;
    const ext = item.dataUrl.match(/^data:image\/(png|jpeg|webp);/)?.[1] === 'jpeg' ? 'jpg' : (item.dataUrl.match(/^data:image\/(png|jpeg|webp);/)?.[1] || 'png');
    const storageKey = 'user-' + userId + '/deck-' + id + '/ref-' + i + '.' + ext;
    try {
      saveDataUrlImage(storageKey, item.dataUrl);
      referenceImages.push({ id: 'ref_' + i, name: String(item.name || '参考图').slice(0, 60), storageKey });
    } catch {
      // 单张参考图保存失败不影响整体任务
    }
  }
  const deck: PptDeck = {
    id,
    userId,
    requestKey: requestKey || undefined,
    chargedCredits: totalCost,
    refundedCredits: 0,
    refundedSlideIds: [],
    title: prompt.slice(0, 48),
    prompt,
    resolution,
    referencesText: String(input.referencesText || ''),
    referenceImages,
    logo: input.logo && typeof input.logo.url === 'string' ? {
      url: input.logo.url,
      position: input.logo.position === 'top-left' || input.logo.position === 'bottom-left' || input.logo.position === 'bottom-right' ? input.logo.position : 'top-right',
      size: input.logo.size === 'sm' || input.logo.size === 'lg' ? input.logo.size : 'md',
      opacity: Math.min(1, Math.max(0.1, Number(input.logo.opacity) || 0.9)),
      enabled: input.logo.enabled !== false,
    } : undefined,
    subtitle: '',
    visualDirection: DEFAULT_PPT_VISUAL_DIRECTION,
    palette: { ...DEFAULT_PPT_PALETTE },
    slides: [],
    pageCount,
    concurrency,
    stage: 'planning',
    running: true,
    finished: false,
    startedAt: Date.now(),
    updatedAt: Date.now(),
  };
  try {
    db.createPptDeck(deck);
  } catch (err) {
    refundCredits(userId, totalCost, 'PPT 任务创建失败，退回生成点数');
    throw err;
  }
  const rt = runtimeFor(id);
  rt.cancelled = false;
  rt.fatalImageError = undefined;
  rt.controller = new AbortController();
  rt.runToken += 1;
  launchDeck(id, rt.runToken);
  return deck;
}

/** 停止任务：已完成页面保留，生成中的页面回到待生成。 */
export function stopDeck(userId: string, deckId: string): PptDeck | { error: string } {
  const deck = db.getPptDeck(deckId);
  if (!deck || deck.userId !== userId) return { error: '任务不存在' };
  const rt = runtimeFor(deckId);
  rt.cancelled = true;
  rt.controller.abort();
  rt.runToken += 1;
  rt.workersActive = false;
  const slides = deck.slides.map(s => (s.status === 'generating' ? { ...s, status: 'idle' as const, error: undefined } : s));
  const updated = db.updatePptDeck(deckId, { running: false, slides, stage: deck.finished ? 'finished' : 'paused' });
  rt.running = false;
  return updated || deck;
}

/** 继续生成：把停止后剩余的页面重新排进任务。 */
export function resumeDeck(userId: string, deckId: string): PptDeck | { error: string } {
  const deck = db.getPptDeck(deckId);
  if (!deck || deck.userId !== userId) return { error: '任务不存在' };
  if (deck.running) return { error: '任务正在进行中' };
  if (deck.finished) return { error: '任务已完成' };
  const failedIds = deck.slides.filter(s => s.status === 'failed').map(s => s.id);
  const retryBilling = chargeRetrySlides(deck, failedIds);
  if (!retryBilling.ok) return { error: retryBilling.error };
  const billingDeck = retryBilling.deck;
  const rt = runtimeFor(deckId);
  rt.cancelled = false;
  rt.fatalImageError = undefined;
  rt.controller = new AbortController();
  rt.runToken += 1;
  const token = rt.runToken;
  const slides = billingDeck.slides.map(s => (s.status !== 'done' ? { ...s, status: 'idle' as const, error: undefined } : s));
  db.updatePptDeck(deckId, { running: true, finished: false, slides, stage: billingDeck.slides.length ? 'rendering' : 'planning' });
  launchDeck(deckId, token);
  return db.getPptDeck(deckId) || deck;
}

/** 重新生成全部失败页。 */
export function retryFailedDeck(userId: string, deckId: string): PptDeck | { error: string } {
  const deck = db.getPptDeck(deckId);
  if (!deck || deck.userId !== userId) return { error: '任务不存在' };
  if (deck.running) return { error: '任务正在进行中' };
  const failed = deck.slides.filter(s => s.status === 'failed');
  if (!failed.length) return { error: '没有失败的页面' };
  const retryBilling = chargeRetrySlides(deck, failed.map(s => s.id));
  if (!retryBilling.ok) return { error: retryBilling.error };
  const billingDeck = retryBilling.deck;
  const rt = runtimeFor(deckId);
  rt.cancelled = false;
  rt.fatalImageError = undefined;
  rt.controller = new AbortController();
  rt.runToken += 1;
  const token = rt.runToken;
  const slides = billingDeck.slides.map(s => (s.status === 'failed' ? { ...s, status: 'idle' as const, error: undefined } : s));
  db.updatePptDeck(deckId, { running: true, finished: false, slides, stage: 'rendering' });
  launchDeck(deckId, token);
  return db.getPptDeck(deckId) || deck;
}

/** 单页重新生成/修改：只处理当前页。 */
export async function regenerateSlide(userId: string, deckId: string, slideId: string, instruction?: string): Promise<PptDeck | { error: string }> {
  const deck = db.getPptDeck(deckId);
  if (!deck || deck.userId !== userId) return { error: '任务不存在' };
  const slide = deck.slides.find(s => s.id === slideId);
  if (!slide) return { error: '页面不存在' };
  if (slide.status === 'generating') return { error: '该页面正在生成中' };
  const rt = runtimeFor(deckId);
  if (rt.busy.has(slideId)) return { error: '该页面正在生成中' };
  rt.busy.add(slideId);
  try {
    await renderSlide(deckId, slideId, instruction ? String(instruction).trim().slice(0, 2000) || undefined : undefined);
  } finally {
    rt.busy.delete(slideId);
    const fresh = db.getPptDeck(deckId);
    if (fresh && !fresh.running && !rt.workersActive) {
      // failed 也代表作品尚未完成，否则单页失败后会被错误标成 finished，
      // 作品库会把它当成可导出的完整 PPT。
      const finished = fresh.slides.length > 0 && fresh.slides.every(s => s.status === 'done');
      db.updatePptDeck(deckId, { finished, stage: finished ? 'finished' : 'paused' });
    }
  }
  return db.getPptDeck(deckId) || deck;
}

/** 给已完成/暂停的任务追加一页，并复用整套视觉风格生成该页图片。 */
export async function appendSlide(userId: string, deckId: string, plan: PptSlidePlan): Promise<PptDeck | { error: string }> {
  const deck = db.getPptDeck(deckId);
  if (!deck || deck.userId !== userId) return { error: '任务不存在' };
  if (deck.running) return { error: '任务正在生成中，无法追加页面' };
  const slideId = 's_' + crypto.randomBytes(8).toString('hex');
  const slide: PptDeckSlide = { id: slideId, plan, status: 'idle' };
  db.updatePptDeck(deckId, { slides: [...deck.slides, slide], pageCount: deck.slides.length + 1, finished: false, stage: 'paused' });
  const rt = runtimeFor(deckId);
  rt.busy.add(slideId);
  try {
    await renderSlide(deckId, slideId);
  } finally {
    rt.busy.delete(slideId);
    const fresh = db.getPptDeck(deckId);
    if (fresh && !fresh.running && !rt.workersActive) {
      const finished = fresh.slides.length > 0 && fresh.slides.every(s => s.status === 'done');
      db.updatePptDeck(deckId, { finished, stage: finished ? 'finished' : 'paused' });
    }
  }
  return db.getPptDeck(deckId) || deck;
}

/** 保存工作台单页编辑后的最终图片，替换任务中的原页面，确保作品库和再次打开工作台都使用新图。 */
export function replaceSlideImage(userId: string, deckId: string, slideId: string, dataUrl: string): PptDeck | { error: string } {
  const deck = db.getPptDeck(deckId);
  if (!deck || deck.userId !== userId) return { error: '任务不存在' };
  const slide = deck.slides.find(s => s.id === slideId);
  if (!slide) return { error: '页面不存在' };
  if (typeof dataUrl !== 'string' || dataUrl.length > MAX_IMAGE_DATA_URL_LENGTH || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(dataUrl)) {
    return { error: '单页图片格式无效或文件过大' };
  }
  const ext = imageExtensionFromDataUrl(dataUrl);
  try {
    const dimensions = assertNative16x9(dataUrlBytes(dataUrl), '单页替换图片');
    const original = slide.storageKey ? imageFullPath(slide.storageKey) : null;
    if (original && fs.existsSync(original)) {
      const previous = assertNative16x9(fs.readFileSync(original), '原始页面');
      if (previous.width !== dimensions.width || previous.height !== dimensions.height) throw new Error('单页修改必须保留原图像素尺寸');
    } else assertPptImageSize(dataUrlBytes(dataUrl), resolutionImageSize(deck.resolution), deck.resolution, '单页替换图片');
  } catch (err: any) {
    return { error: String(err?.message || '单页图片必须为原生 16:9').slice(0, 200) };
  }
  const nextKey = 'user-' + deck.userId + '/deck-' + deckId + '/slide-' + slideId + '.' + ext;
  try {
    saveDataUrlImage(nextKey, dataUrl);
    if (slide.storageKey && slide.storageKey !== nextKey) {
      const previous = imageFullPath(slide.storageKey);
      if (previous) fs.rmSync(previous, { force: true });
    }
  } catch (err: any) {
    return { error: '保存单页图片失败：' + String(err?.message || err).slice(0, 120) };
  }
  const dimensions = assertNative16x9(dataUrlBytes(dataUrl));
  patchSlide(deckId, slideId, { status: 'done', storageKey: nextKey, width: dimensions.width, height: dimensions.height, updatedAt: Date.now(), error: undefined });
  const fresh = db.getPptDeck(deckId);
  if (!fresh) return { error: '任务不存在' };
  const finished = !fresh.running && fresh.slides.every(item => item.status === 'done');
  return db.updatePptDeck(deckId, { finished, stage: finished ? 'finished' : fresh.stage }) || fresh;
}

/** 删除任务与磁盘图片。 */
export function deleteDeck(userId: string, deckId: string): { ok: boolean } | { error: string } {
  const deck = db.getPptDeck(deckId);
  if (!deck || deck.userId !== userId) return { error: '任务不存在' };
  const rt = runtimeFor(deckId);
  rt.cancelled = true;
  rt.controller.abort();
  rt.runToken++;
  rt.busy.clear();
  runtimes.delete(deckId);
  // Cancelled, unfinished pages must not retain their prepaid generation charge.
  if ((deck.chargedCredits || 0) > 0) {
    db.updatePptDeck(deckId, { running: false, slides: deck.slides.map(slide => slide.status === 'done' ? slide : { ...slide, status: 'failed' as const }) });
    refundFailedSlides(deckId);
  }
  const dir = imageFullPath('user-' + userId + '/deck-' + deckId);
  if (dir) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 清理失败不阻塞删除记录 */ }
  }
  db.deletePptDeck(deckId);
  return { ok: true };
}

export function deleteSlide(userId: string, deckId: string, slideId: string): PptDeck | { deleted: true } | { error: string } {
  const deck = db.getPptDeck(deckId);
  if (!deck || deck.userId !== userId) return { error: '任务不存在' };
  if (deck.running || runtimeFor(deckId).busy.size) return { error: '请先停止生成或等待修改完成，再删除页面' };
  const slide = deck.slides.find(item => item.id === slideId);
  if (!slide) return { error: '页面不存在' };
  if (deck.slides.length === 1) {
    const result = deleteDeck(userId, deckId);
    return 'error' in result ? result : { deleted: true };
  }
  if (slide.status !== 'done' && (deck.chargedCredits || 0) > 0) {
    db.updatePptDeck(deckId, { slides: deck.slides.map(item => item.id === slideId ? { ...item, status: 'failed' as const } : item) });
    refundFailedSlides(deckId);
  }
  const fresh = db.getPptDeck(deckId)!;
  const slides = fresh.slides.filter(item => item.id !== slideId);
  const finished = slides.every(item => item.status === 'done');
  const updated = db.updatePptDeck(deckId, { slides, pageCount: slides.length, finished, stage: finished ? 'finished' : 'paused', error: finished ? undefined : fresh.error })!;
  if (slide.storageKey && !slides.some(item => item.storageKey === slide.storageKey) && !fresh.referenceImages.some(item => item.storageKey === slide.storageKey)) {
    const file = imageFullPath(slide.storageKey);
    if (file) try { fs.rmSync(file, { force: true }); } catch { /* A later cleanup may reclaim an unused file. */ }
  }
  return updated;
}

/** 接口返回视图：页面图片以受鉴权的路由地址暴露。 */
export function deckView(deck: PptDeck) {
  return {
    id: deck.id,
    title: deck.title,
    prompt: deck.prompt,
    resolution: normalizeResolution(deck.resolution),
    subtitle: deck.subtitle,
    visualDirection: deck.visualDirection,
    palette: deck.palette,
    pageCount: deck.pageCount,
    concurrency: deck.concurrency,
    chargedCredits: deck.chargedCredits || 0,
    refundedCredits: deck.refundedCredits || 0,
    stage: deck.stage,
    running: deck.running,
    finished: deck.finished,
    startedAt: deck.startedAt,
    updatedAt: deck.updatedAt,
    finishedAt: deck.finishedAt,
    error: deck.error,
    planningSource: deck.planningSource,
    planningWarning: deck.planningWarning,
    referenceAnalysisStatus: deck.referenceAnalysisStatus,
    referenceAnalysisProgress: deck.referenceAnalysisProgress,
    referenceAnalysis: deck.referenceAnalysis,
    logo: deck.logo,
    referenceImages: deck.referenceImages.map(r => ({ id: r.id, name: r.name })),
    slides: deck.slides.map(s => ({
      id: s.id,
      plan: s.plan,
      status: s.status,
      error: s.error,
      width: s.width,
      height: s.height,
      // slide.updatedAt 作为缓存版本号：单页重生成只改变本页 URL，其他页图片继续命中长缓存。
      imageUrl: s.status === 'done' && s.storageKey ? '/api/ppt/decks/' + deck.id + '/slides/' + s.id + '/image?v=' + encodeURIComponent(String(s.updatedAt || deck.updatedAt)) : undefined,
    })),
  };
}

/** 服务启动时恢复：进行中的任务自动继续（与源实现「刷新后自动恢复」一致）。 */
export function recoverDecksOnBoot() {
  const decks = db.getPptDecks();
  const interrupted = decks.filter(deck => deck.running || deck.slides.some(slide => slide.status === 'generating'));
  if (!interrupted.length) return;
  for (const deck of interrupted) {
    // 进程重启后，生成中的请求已经不存在，统一重新排队；已完成页面继续复用。
    const slides = deck.slides.map(slide => slide.status === 'generating' ? { ...slide, status: 'idle' as const, error: undefined } : slide);
    db.updatePptDeck(deck.id, { running: false, finished: false, stage: 'paused', slides });
  }
  // 错峰恢复：此前所有中断任务在同一时刻（1.5s 后）一起 resume，
  // 重启瞬间会同时向生图上游发起 任务数 × 6 路请求，极易触发上游限流，
  // 表现为「重启后一批任务集体失败并退款」。改为按顺序每隔 3s 拉起一个。
  interrupted.forEach((deck, index) => {
    const deckId = deck.id;
    const userId = deck.userId;
    setTimeout(() => {
      try {
        resumeDeck(userId, deckId);
      } catch (err) {
        console.error('[ppt] 恢复任务失败:', err);
      }
    }, 1500 + index * 3000);
  });
}
