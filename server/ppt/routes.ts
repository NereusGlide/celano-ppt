/**
 * PPT 生成路由（移植自「超级画布Agent」的 PPT 工作台，服务端化）。
 * 全部接口需要前台用户会话；生成与单页修改由统一计费模块记录。
 */
import express from 'express';
import fs from 'fs';
import { db } from '../db.js';
import { chargeCredits, refundCredits } from '../billing.js';
import { requireUser } from '../sessionGuard.js';
import { MAX_REFERENCE_TEXT } from './referenceAnalysis.js';
import { optimizePrompt } from './promptOptimization.js';
import {
  deckView,
  deleteDeck,
  deleteSlide,
  recoverDecksOnBoot,
  regenerateSlide,
  replaceSlideImage,
  resumeDeck,
  retryFailedDeck,
  slideImagePath,
  logoImagePath,
  startDeck,
  stopDeck,
} from './engine.js';
import type { PptDeck, User } from '../../src/types.js';

export const pptRouter = express.Router();

pptRouter.post('/optimize-prompt', async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const prompt = typeof (req.body || {}).prompt === 'string' ? String(req.body.prompt).trim().slice(0, 4000) : '';
  if (!prompt) return res.status(400).json({ success: false, error: '请输入需要优化的主题或需求' });
  const referencesText = typeof req.body.referencesText === 'string' ? req.body.referencesText : '';
  if (referencesText.length > MAX_REFERENCE_TEXT) return res.status(400).json({ success: false, error: '参考资料内容超过分析上限，请拆分上传' });
  const planning = db.getPlanningConfig();
  if (!planning?.apiKey || !planning.baseUrl) {
    return res.status(503).json({ success: false, error: '未配置内容规划模型，无法进行 AI 提示词优化，请在管理后台设置' });
  }
  try {
    const optimizeConfig = { ...planning, reasoningEffort: planning.optimizeReasoningEffort || planning.reasoningEffort };
    const result = await optimizePrompt(optimizeConfig, prompt, referencesText);
    res.json({ success: true, prompt: result.slice(0, 4000), fallback: false });
  } catch (err: any) {
    console.warn('[ppt] 提示词优化调用失败：', String(err?.message || err).slice(0, 180));
    res.status(502).json({ success: false, error: 'AI 提示词优化失败：' + String(err?.message || err).slice(0, 200) });
  }
});

function ownDeck(req: express.Request, res: express.Response, user: User): PptDeck | null {
  const deck = db.getPptDeck(String(req.params.id || ''));
  if (!deck) {
    res.status(404).json({ success: false, error: '任务不存在' });
    return null;
  }
  if (deck.userId !== user.id) {
    res.status(403).json({ success: false, error: '无权访问该任务' });
    return null;
  }
  return deck;
}

pptRouter.get('/decks', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  res.json({ success: true, decks: db.getPptDecks(user.id).map(deckView) });
});

pptRouter.post('/decks', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const body = (req.body || {}) as Record<string, unknown>;
  const result = startDeck(user.id, {
    prompt: typeof body.prompt === 'string' ? body.prompt : '',
    pageCount: Number(body.pageCount),
    concurrency: Number(body.concurrency),
    requestKey: typeof body.requestKey === 'string' ? body.requestKey : req.get('Idempotency-Key') || undefined,
    resolution: body.resolution === '2K' || body.resolution === '4K' ? body.resolution : '2K',
    referencesText: typeof body.referencesText === 'string' ? body.referencesText : '',
    referenceImages: Array.isArray(body.referenceImages) ? body.referenceImages as { name: string; dataUrl: string }[] : [],
    logo: body.logo && typeof body.logo === 'object' ? body.logo as any : undefined,
  });
  if (!('id' in result)) {
    const error = String(result.error || '任务创建失败');
    return res.status(error.startsWith('点数不足') ? 402 : 400).json({ success: false, error });
  }
  res.json({ success: true, deck: deckView(result) });
});

pptRouter.get('/decks/:id', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const deck = ownDeck(req, res, user);
  if (!deck) return;
  res.json({ success: true, deck: deckView(deck) });
});

pptRouter.post('/decks/:id/stop', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const deck = ownDeck(req, res, user);
  if (!deck) return;
  const result = stopDeck(user.id, deck.id);
  if ('error' in result) return res.status(400).json({ success: false, error: result.error });
  res.json({ success: true, deck: deckView(result) });
});

pptRouter.post('/decks/:id/resume', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const deck = ownDeck(req, res, user);
  if (!deck) return;
  const result = resumeDeck(user.id, deck.id);
  if ('error' in result) {
    const error = result.error || '任务继续失败';
    return res.status(error.startsWith('点数不足') ? 402 : 400).json({ success: false, error });
  }
  res.json({ success: true, deck: deckView(result) });
});

pptRouter.post('/decks/:id/retry-failed', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const deck = ownDeck(req, res, user);
  if (!deck) return;
  const result = retryFailedDeck(user.id, deck.id);
  if ('error' in result) {
    const error = result.error || '失败页面重试失败';
    return res.status(error.startsWith('点数不足') ? 402 : 400).json({ success: false, error });
  }
  res.json({ success: true, deck: deckView(result) });
});

pptRouter.post('/decks/:id/slides/:slideId/regenerate', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const deck = ownDeck(req, res, user);
  if (!deck) return;
  const instruction = typeof (req.body || {}).instruction === 'string' ? (req.body as { instruction: string }).instruction : '';
  const editCost = 2;
  const charged = chargeCredits(user.id, editCost, '单页重新生成：' + deck.title.slice(0, 40));
  if (!charged.ok) return res.status(402).json({ success: false, error: charged.error, credits: charged.credits });
  const slideId = String(req.params.slideId || '');
  /** 无论走哪条失败分支，已预扣的点数都必须回到账上，且只能退一次。 */
  const refundOnce = (reason: string) => {
    if (!db.refundPptSlide(user.id, deck.id, slideId, editCost, reason)) {
      refundCredits(user.id, editCost, reason);
    }
  };

  void regenerateSlide(user.id, deck.id, slideId, instruction)
    .then(result => {
      try {
        if ('error' in result) {
          if (deck.slides.some(item => item.id === slideId)) refundOnce('单页重新生成失败，退回点数');
          else refundCredits(user.id, editCost, '单页重新生成目标不存在，退回点数');
          return res.status(400).json({ success: false, error: result.error });
        }
        const slide = result.slides.find(item => item.id === slideId);
        if (slide?.status === 'failed') {
          refundOnce('单页重新生成失败，退回点数');
          return res.status(502).json({ success: false, error: slide.error || '单页重新生成失败' });
        }
        res.json({ success: true, deck: deckView(result) });
      } catch (err) {
        // 响应构造阶段异常（如 deckView 失败）同样不能吞掉已扣的点数。
        refundOnce('单页重新生成响应异常，退回点数');
        throw err;
      }
    })
    .catch(err => {
      // 这里原先完全缺失：regenerateSlide 一旦抛出，用户已被扣的 2 点既不退、
      // 也不响应，请求挂到超时，同时产生 unhandledRejection 污染进程。
      refundOnce('单页重新生成异常，退回点数');
      console.error('[ppt] 单页重新生成异常，已退回点数:', deck.id, slideId, String(err?.message || err).slice(0, 180));
      if (!res.headersSent) res.status(500).json({ success: false, error: '单页重新生成失败，已退回点数' });
    });
});

pptRouter.post('/decks/:id/slides/:slideId/replace-image', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const deck = ownDeck(req, res, user);
  if (!deck) return;
  const image = typeof (req.body || {}).image === 'string' ? String((req.body as { image: string }).image) : '';
  const result = replaceSlideImage(user.id, deck.id, String(req.params.slideId || ''), image);
  if ('error' in result) return res.status(400).json({ success: false, error: result.error });
  res.json({ success: true, deck: deckView(result) });
});

pptRouter.delete('/decks/:id/slides/:slideId', (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  const deck = ownDeck(req, res, user); if (!deck) return;
  const result = deleteSlide(user.id, deck.id, String(req.params.slideId));
  if ('error' in result) return res.status(409).json({ success: false, error: result.error });
  res.json({ success: true, deck: 'deleted' in result ? null : deckView(result) });
});

pptRouter.delete('/decks/:id', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const deck = ownDeck(req, res, user);
  if (!deck) return;
  const result = deleteDeck(user.id, deck.id);
  if ('error' in result) return res.status(400).json({ success: false, error: result.error });
  res.json({ success: true });
});

pptRouter.get('/decks/:id/slides/:slideId/image', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const deck = ownDeck(req, res, user);
  if (!deck) return;
  const slide = deck.slides.find(s => s.id === String(req.params.slideId || ''));
  if (!slide || slide.status !== 'done') {
    res.status(404).json({ success: false, error: '页面图片不存在' });
    return;
  }
  const filePath = slideImagePath(deck, slide.id);
  if (!filePath) {
    res.status(404).json({ success: false, error: '页面图片不存在' });
    return;
  }
  const ext = filePath.toLowerCase().split('.').pop();
  res.set('Content-Type', ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png');
  res.set('Cache-Control', 'private, immutable, max-age=31536000');
  res.set('X-Content-Type-Options', 'nosniff');
  fs.createReadStream(filePath).on('error', () => {
    if (!res.headersSent) res.status(404).json({ success: false, error: '页面图片不存在' });
  }).pipe(res);
});

pptRouter.get('/decks/:id/logo', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const deck = ownDeck(req, res, user);
  if (!deck) return;
  const filePath = logoImagePath(deck);
  if (!filePath) return res.status(404).json({ success: false, error: 'Logo 文件不存在' });
  const ext = filePath.toLowerCase().split('.').pop();
  res.set('Content-Type', ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png');
  res.set('Cache-Control', 'private, max-age=60');
  fs.createReadStream(filePath).on('error', () => {
    if (!res.headersSent) res.status(404).json({ success: false, error: 'Logo 文件不存在' });
  }).pipe(res);
});

// 服务启动时恢复未完成的任务
recoverDecksOnBoot();
