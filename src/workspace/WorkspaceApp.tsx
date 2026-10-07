import { PPT_PAGE_WIDTH, PPT_PAGE_HEIGHT, MAX_IMAGE_BYTES, MAX_IMAGE_DATA_URL_LENGTH } from '../shared/imageSpecs.js';
import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Download, Clock, Undo2, Trash2, Image as ImageIcon, Hand, ZoomIn, ZoomOut, Maximize, Paintbrush, SquareDashed, Wand2, X, Square, RefreshCw, LoaderCircle, ChevronRight, Plus } from 'lucide-react';
import { DrawCanvas } from './DrawCanvas.js';
import { PagePreview } from './PagePreview.js';
import { DrawTool, Annotation, TOOL_META, composeEditInput, buildEditPrompt, DEFAULT_MARK_WIDTH, MARK_WIDTH_MIN, MARK_WIDTH_MAX } from './draw.js';
import { workspaceEditPage, replacePptSlideImage, createPptDeck, listPptDecks, getPptDeck, stopPptDeck, resumePptDeck, retryFailedPptDeck, regeneratePptSlide, deletePptDeck, deletePptSlide, appendPptSlide, type PptDeckView } from '../services/api.js';
import { DeleteConfirmation } from '../components/DeleteConfirmation.js';
import { publishLibraryChange, subscribeLibraryChanges } from '../shared/libraryEvents.js';
import { memberImageCost } from '../shared/membership.js';
import { useAuth } from '../context/AuthContext.js';
import { UserAuthModal } from '../components/UserAuthModal.js';
import '../styles/workspace.css';

/** 作品 7 天保留期的剩余时间提示。 */
function retentionLabel(finishedAt: number | undefined, now: number): string {
  if (!finishedAt) return '';
  const remain = finishedAt + 7 * 24 * 3600 * 1000 - now;
  if (remain <= 0) return ' · 已过期，请重新生成';
  if (remain < 24 * 3600 * 1000) return ` · 剩 ${Math.ceil(remain / 3600 / 1000)} 小时，即将过期请保存`;
  return ` · 剩 ${Math.floor(remain / 86400 / 1000)} 天`;
}

interface PageData {
  id: string;
  title: string;
  annotations: Annotation[];
  /** 整体修改指令（可选），作用于整页 */
  instruction: string;
  /** 生成流程产出后填充：本页 16:9 图片 */
  imageUrl?: string;
}

const STORAGE_KEY = 'celano_ws_annotations';

function logoPositionStyle(logo: { position?: string }): React.CSSProperties {
  if (logo.position === 'top-left') return { top: '6%', left: '5%' };
  if (logo.position === 'bottom-left') return { bottom: '6%', left: '5%' };
  if (logo.position === 'bottom-right') return { bottom: '6%', right: '5%' };
  return { top: '6%', right: '5%' };
}

function logoSizeStyle(logo: { size?: string }): React.CSSProperties {
  if (logo.size === 'sm') return { width: '9%', maxHeight: '10%' };
  if (logo.size === 'lg') return { width: '16%', maxHeight: '16%' };
  return { width: '12%', maxHeight: '13%' };
}

function normalizeAnnotations(raw: any[]): Annotation[] {
  const list: Annotation[] = [];
  for (const a of (raw || [])) {
    if (!a || (a.kind !== 'scribble' && a.kind !== 'box')) continue;
    if (a.kind === 'scribble' && !Array.isArray(a.points)) continue;
    list.push({
      ...a,
      number: 0,
      instruction: typeof a.instruction === 'string' ? a.instruction : '',
      width: a.kind === 'scribble' ? (typeof a.width === 'number' ? a.width : DEFAULT_MARK_WIDTH) : undefined
    });
  }
  return list.map((a, i) => ({ ...a, number: i + 1 }));
}

async function materializeHandoffImages(raw: any[]): Promise<Array<{ name: string; dataUrl: string }>> {
  const result: Array<{ name: string; dataUrl: string }> = [];
  for (const item of Array.isArray(raw) ? raw.slice(0, 18) : []) {
    const source = typeof item?.dataUrl === 'string' ? item.dataUrl : typeof item?.url === 'string' ? item.url : '';
    if (!source) continue;
    try {
      let dataUrl = source;
      if (!/^data:image\/(png|jpeg|webp);base64,/i.test(source)) {
        const parsed = new URL(source, window.location.origin);
        if (parsed.origin !== window.location.origin) continue;
        const response = await fetch(parsed.toString(), { credentials: 'same-origin' });
        if (!response.ok) continue;
        const blob = await response.blob();
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(blob.type.toLowerCase()) || blob.size > 6 * 1024 * 1024) continue;
        dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ''));
          reader.onerror = () => reject(new Error('读取参考图失败'));
          reader.readAsDataURL(blob);
        });
      }
      if (/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/i.test(dataUrl)) {
        result.push({ name: String(item?.name || '参考图片').slice(0, 80), dataUrl });
      }
    } catch { /* 单张素材读取失败不阻断整个任务 */ }
  }
  return result;
}

const EMPTY_PAGE: PageData = { id: 'ws-empty', title: '待生成', annotations: [], instruction: '' };

const MIN_SCALE = 0.25, MAX_SCALE = 4;

export const WorkspaceApp: React.FC = () => {
  const { currentUser, authReady } = useAuth();
  const [pages, setPages] = useState<PageData[]>([]);
  const [deck, setDeck] = useState<PptDeckView | null>(null);
  const [taskList, setTaskList] = useState<PptDeckView[]>([]);
  const [genError, setGenError] = useState('');
  const [taskCreating, setTaskCreating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<'deck' | 'slide' | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [appendOpen, setAppendOpen] = useState(false);
  const [appendTitle, setAppendTitle] = useState('');
  const [appendContent, setAppendContent] = useState('');
  const [appending, setAppending] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [nowMs, setNowMs] = useState(Date.now());
  const [activeIndex, setActiveIndex] = useState(0);
  const [taskPanelOpen, setTaskPanelOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(() => {
    // 窄屏下检查器是底部抽屉，首屏展开会遮住画布；桌面端保持展开。
    if (typeof window === 'undefined') return true;
    return !window.matchMedia('(max-width:1023px)').matches;
  });
  const [tool, setTool] = useState<DrawTool>('mark');
  const [markWidth, setMarkWidth] = useState(DEFAULT_MARK_WIDTH);
  const [clearArmed, setClearArmed] = useState(false);

  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  const viewportRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const panRef = useRef<{ x: number; y: number } | null>(null);
  const autoCreateStarted = useRef(false);

  const [sending, setSending] = useState(false);
  const [editNotice, setEditNotice] = useState('');
  const [editError, setEditError] = useState('');

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(pages)); } catch { /* 忽略 */ }
  }, [pages]);

  useEffect(() => {
    // 等待初始会话恢复完成再判断：避免已登录用户在 /auth/me 返回前被误弹登录框。
    if (!authReady) return;
    if (currentUser) { setAuthOpen(false); return; }
    // 直接访问 /workspace 或浏览器恢复了过期会话时，不能只渲染一个
    // 看似空白的工作台；统一引导登录，登录成功后再加载任务。
    setAuthOpen(true);
  }, [authReady, currentUser]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const editing = !!target?.closest('input, textarea, select, [contenteditable="true"]');
      // 文本框中保留浏览器原生撤销/方向键行为；否则输入修改要求时
      // Ctrl/Cmd+Z 会误删画布标记，方向键也会偷偷切页。
      if (editing) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); selectPage(activeIndex - 1); }
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); selectPage(activeIndex + 1); }
      if (e.key === 'Home') { e.preventDefault(); selectPage(0); }
      if (e.key === 'End') { e.preventDefault(); selectPage(pages.length - 1); }
      if (e.key === 'Escape') {
        if (inspectorOpen && window.matchMedia('(max-width:1023px)').matches) { e.preventDefault(); setInspectorOpen(false); return; }
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') { e.preventDefault(); setInspectorOpen(v => !v); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });


  useEffect(() => {
    if (!clearArmed) return;
    const t = setTimeout(() => setClearArmed(false), 3000);
    return () => clearTimeout(t);
  }, [clearArmed]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      setView(v => {
        const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor));
        const k = scale / v.scale;
        return { x: px - (px - v.x) * k, y: py - (py - v.y) * k, scale };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const active = pages[activeIndex] || EMPTY_PAGE;
  const activeSlide = deck?.slides.find(s => s.id === active.id);
  const activeSlideStatus = activeSlide?.status;

  const selectPage = (index: number) => {
    if (!pages.length) return;
    const next = Math.max(0, Math.min(pages.length - 1, index));
    setActiveIndex(next);
    setClearArmed(false);
    window.requestAnimationFrame(() => {
      const thumbnail = document.querySelector<HTMLButtonElement>('[data-page-index="' + next + '"]');
      // 只滚动左侧缩略图区。scrollIntoView 会沿所有祖先容器滚动，
      // 在工作台布局中可能连带把右侧画布/主页面滚走。
      const sidebar = sidebarRef.current;
      if (sidebar && thumbnail) {
        const sidebarRect = sidebar.getBoundingClientRect();
        const thumbnailRect = thumbnail.getBoundingClientRect();
        const thumbnailTop = thumbnailRect.top - sidebarRect.top + sidebar.scrollTop;
        const thumbnailBottom = thumbnailTop + thumbnailRect.height;
        const viewTop = sidebar.scrollTop;
        const viewBottom = viewTop + sidebar.clientHeight;
        if (thumbnailTop < viewTop) {
          sidebar.scrollTo({ top: thumbnailTop, behavior: 'smooth' });
        } else if (thumbnailBottom > viewBottom) {
          sidebar.scrollTo({ top: thumbnailBottom - sidebar.clientHeight, behavior: 'smooth' });
        }
      }
      thumbnail?.focus({ preventScroll: true });
    });
  };

  const updatePage = (patch: Partial<PageData>) => {
    setPages(prev => prev.map((p, i) => (i === activeIndex ? { ...p, ...patch } : p)));
  };

  const commitAnnotation = (draft: Omit<ScribbleLike, 'number' | 'instruction'>) => {
    const next: Annotation = { ...draft, number: active.annotations.length + 1, instruction: '' } as Annotation;
    updatePage({ annotations: [...active.annotations, next] });
  };

  type ScribbleLike = { kind: string; points?: any[]; width?: number };

  const undo = () => {
    updatePage({ annotations: active.annotations.slice(0, -1) });
  };

  const clearPage = () => {
    if (!clearArmed) { setClearArmed(true); return; }
    setClearArmed(false);
    updatePage({ annotations: [] });
  };

  const removeAnnotation = (index: number) => {
    const list = active.annotations.filter((_, i) => i !== index);
    updatePage({ annotations: list.map((a, i) => ({ ...a, number: i + 1 })) });
  };

  const setAnnotationInstruction = (index: number, value: string) => {
    updatePage({ annotations: active.annotations.map((a, i) => (i === index ? { ...a, instruction: value } : a)) });
  };

  const setInstruction = (value: string) => updatePage({ instruction: value });

  const zoomBy = (factor: number) => {
    setView(v => {
      const el = viewportRef.current;
      const rect = el ? el.getBoundingClientRect() : { width: 0, height: 0 };
      const px = rect.width / 2, py = rect.height / 2;
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor));
      const k = scale / v.scale;
      return { x: px - (px - v.x) * k, y: py - (py - v.y) * k, scale };
    });
  };
  const fit = () => setView({ x: 0, y: 0, scale: 1 });

  const onViewportPointerDown = (e: React.PointerEvent) => {
    if (tool !== 'pan') return;
    panRef.current = { x: e.clientX - view.x, y: e.clientY - view.y };
    try { (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId); } catch { /* 合成事件 */ }
  };
  const onViewportPointerMove = (e: React.PointerEvent) => {
    const pan = panRef.current;
    if (!pan) return;
    setView(v => ({ ...v, x: e.clientX - pan.x, y: e.clientY - pan.y }));
  };
  const onViewportPointerUp = () => { panRef.current = null; };

  const hasInstruction = active.instruction.trim() !== '' || active.annotations.some(a => a.instruction.trim() !== '');

  /** 原图 + 局部遮罩 + 逐处修改指令 → 局部图生图编辑 */
  const sendEdit = async () => {
    const page = pages[activeIndex];
    if (!page.imageUrl || sending) return;
    if (!page.annotations.length) { setEditError('请先涂抹或框选需要修改的区域，未选中的内容将保持原样'); return; }
    if (!hasInstruction) { setEditError('请为标记区域填写修改指令（或填写整体修改指令）'); return; }
    const prompt = buildEditPrompt(page.annotations, page.instruction);
    if (prompt.length > 2000) { setEditError('指令总长度超过 2000 字，请精简各处的修改要求'); return; }
    setSending(true); setEditError(''); setEditNotice('');
    try {
      const input = await composeEditInput(page.imageUrl, page.annotations);
      const res = await workspaceEditPage({ image: input.image, mask: input.mask, prompt });
      if (deck) {
        const saved = await replacePptSlideImage(deck.id, page.id, res.image);
        setDeck(saved.deck);
        setTaskList(prev => prev.map(item => item.id === saved.deck.id ? saved.deck : item));
        const replacement = saved.deck.slides.find(slide => slide.id === page.id)?.imageUrl;
        setPages(prev => prev.map(item => item.id === page.id ? { ...item, imageUrl: replacement || res.image, annotations: [], instruction: '' } : item));
      } else {
        updatePage({ imageUrl: res.image, annotations: [], instruction: '' });
      }
      setEditNotice('修改已生成，页面图片已更新');
    } catch (e: any) {
      setEditError(e.message || '修改失败，请重试');
    } finally {
      setSending(false);
    }
  };

  /* =========================================================
     PPT 生成（服务端任务）：大纲规划 → 逐页生成 → 页面联动
     ========================================================= */

  const deckRunning = !!deck?.running;
  const doneCount = deck ? deck.slides.filter(s => s.status === 'done').length : 0;
  const failedCount = deck ? deck.slides.filter(s => s.status === 'failed').length : 0;
  const totalSlides = deck ? deck.slides.length : 0;
  // 账务透明：失败页面不计费，后端已退回的点数必须在界面上说出来，
  // 否则用户看到「生成失败」的第一反应是「我的点被吞了」。
  const perSlideCost = deck ? (memberImageCost(currentUser, deck.resolution as '2K' | '4K') || 0) : 0;
  const refundedCredits = deck?.refundedCredits || 0;
  const spentCredits = Math.max(0, (deck?.chargedCredits || 0) - refundedCredits);
  const concurrency = deck?.concurrency || 0;

  function buildDeckPages(value: PptDeckView): PageData[] {
    let saved: any[] = [];
    try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { /* 忽略损坏数据 */ }
    return value.slides.map((slide, i) => {
      const hit = saved.find((s: any) => s && s.id === slide.id);
      return {
        id: slide.id,
        title: slide.plan.title || '页面 ' + (i + 1),
        annotations: normalizeAnnotations(hit?.annotations || []),
        instruction: typeof hit?.instruction === 'string' ? hit.instruction : '',
        imageUrl: hit?.imageUrl && String(hit.imageUrl).startsWith('data:') ? hit.imageUrl : slide.imageUrl,
      };
    });
  }

  // 打开工作台时接管最近一次任务；首页提交的主题会在这里自动创建后台任务。
  useEffect(() => {
    if (!currentUser) return;
    let alive = true;
    void (async () => {
      try {
        const res = await listPptDecks();
        if (!alive) return;
        const list = res.decks || [];
        setTaskList(list);

        const storedTopic = sessionStorage.getItem('celano_new_topic')?.trim();
        if (storedTopic && !autoCreateStarted.current) {
          autoCreateStarted.current = true;
          setTaskCreating(true);
          let options: any = {};
          try { options = JSON.parse(sessionStorage.getItem('celano_new_ppt_options') || '{}'); } catch { /* ignore malformed handoff */ }
          const finalPrompt = [storedTopic, options.extraRequirements].filter(Boolean).join('\n');
          const referenceImages = await materializeHandoffImages(options.referenceImages);
          // 兼容新旧桥接：新首页把 requestKey 放进 options，旧版本可能单独存储。
          const requestKey = sessionStorage.getItem('celano_new_request_key') || options.requestKey || undefined;
          const created = await createPptDeck({
            prompt: finalPrompt,
            pageCount: Number(options.pageCount) || 6,
            concurrency: 6,
            requestKey,
            resolution: options.resolution === '2K' || options.resolution === '4K' ? options.resolution : '2K',
            referencesText: options.referenceContext || undefined,
            referenceImages,
            logo: options.logo && typeof options.logo === 'object' ? options.logo : undefined,
          });
          if (!alive) return;
          setDeck(created.deck);
          setTaskList(prev => [created.deck, ...prev.filter(item => item.id !== created.deck.id)]);
          setPages([]);
          setActiveIndex(0);
          sessionStorage.removeItem('celano_new_topic');
          sessionStorage.removeItem('celano_new_ppt_options');
          sessionStorage.removeItem('celano_new_request_key');
          sessionStorage.removeItem('celano_open_deck');
          setTaskCreating(false);
          return;
        }

        // 任务后台默认只接管当前正在生成的任务；作品库进入工作台时通过
        // open/active handoff 指定作品。active 作为刷新后的恢复兜底，否则
        // 作品库跳转后如果先消费了 open_deck，工作台会误显示空状态。
        const requestedIds = [
          sessionStorage.getItem('celano_open_deck'),
          sessionStorage.getItem('celano_active_deck'),
        ].map(value => value?.trim()).filter((value): value is string => !!value);
        const requested = requestedIds.find(id => list.some(item => item.id === id));
        const adopt = requested
          ? list.find(d => d.id === requested) || null
          : list.find(d => d.running || d.stage === 'planning') || null;
        if (requestedIds.length && !requested) {
          // 避免旧作品已被删除时无限携带失效 ID，随后又重复尝试打开它。
          sessionStorage.removeItem('celano_open_deck');
          sessionStorage.removeItem('celano_active_deck');
          setGenError('该作品已不存在或已过期，请从作品库重新打开');
        } else {
          setGenError('');
        }
        setDeck(adopt);
        if (adopt) sessionStorage.setItem('celano_active_deck', adopt.id);
        setTaskCreating(false);
      } catch (e: any) {
        setTaskCreating(false);
        setGenError(e?.message || '任务加载失败，请稍后重试');
      }
    })();
    return () => { alive = false; };
  }, [currentUser]);

  useEffect(() => {
    if (deck) sessionStorage.setItem('celano_active_deck', deck.id);
  }, [deck?.id]);

  // 规划阶段每秒刷新一次「已耗时」显示，避免看起来像卡住
  useEffect(() => {
    if (!deck || deck.stage !== 'planning') return;
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [deck?.stage]);

  // 任务进行中轮询刷新
  useEffect(() => {
  // 只有服务端明确处于运行状态时轮询。暂停/失败/已完成的任务保持当前结果，
  // 避免工作台在用户离开生成页面后仍持续请求接口，造成“自动刷新”的观感。
  if (!deck || !deck.running) return;
    let alive = true;
    let delay = 1500;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const res = await getPptDeck(deck.id);
        if (!alive) return;
        delay = 1500;
        setGenError(current => current.startsWith('任务连接') ? '' : current);
        setDeck(res.deck);
        setTaskList(prev => prev.map(item => item.id === res.deck.id ? res.deck : item));
      } catch (error: any) {
        if (!alive) return;
        const message = String(error?.message || '');
        // 任务可能已在作品库或其他窗口被删除；停止无意义的重试并回到空工作台。
        if (/任务不存在|页面不存在|404/.test(message)) {
          sessionStorage.removeItem('celano_active_deck');
          sessionStorage.removeItem('celano_open_deck');
          setDeck(null);
          setPages([]);
          setActiveIndex(0);
          setGenError('当前任务已不存在，请从首页重新创建');
          return;
        }
        // 网络抖动时退避，避免每 1.5 秒反复请求造成“页面一直刷新”的观感；
        // 一旦恢复成功，间隔自动回到实时进度刷新频率。
        setGenError(message || '任务连接暂时中断，正在重试');
        delay = Math.min(8000, delay * 2);
      }
      if (alive) timer = window.setTimeout(poll, delay);
    };
    timer = window.setTimeout(poll, delay);
    return () => { alive = false; if (timer !== undefined) window.clearTimeout(timer); };
  }, [deck?.id, deck?.running, deck?.finished]);

  // 任务页面 ↔ 工作台页面联动：页面集合变化时重建，否则仅同步状态与图片
  useEffect(() => {
    if (!deck) return;
    setPages(prev => {
      if (!deck.slides.length) return prev;
      const deckIds = deck.slides.map(s => s.id).join(',');
      const prevIds = prev.map(p => p.id).join(',');
      if (prevIds !== deckIds) return buildDeckPages(deck);
      return prev.map(p => {
        const s = deck.slides.find(x => x.id === p.id);
        if (!s) return p;
        const override = p.imageUrl && p.imageUrl.startsWith('data:') ? p.imageUrl : undefined;
        if (s.status === 'done' && s.imageUrl) return { ...p, imageUrl: override || s.imageUrl };
        if (s.status === 'generating' || s.status === 'idle' || s.status === 'failed') return { ...p, imageUrl: override || undefined };
        return p;
      });
    });
  }, [deck]);

  const handleStop = async () => {
    if (!deck) return;
    try { const res = await stopPptDeck(deck.id); setDeck(res.deck); setTaskList(prev => prev.map(item => item.id === res.deck.id ? res.deck : item)); } catch (e: any) { setGenError(e?.message || '操作失败'); }
  };
  const handleResume = async () => {
    if (!deck) return;
    try { const res = await resumePptDeck(deck.id); setDeck(res.deck); setTaskList(prev => prev.map(item => item.id === res.deck.id ? res.deck : item)); } catch (e: any) { setGenError(e?.message || '操作失败'); }
  };
  const handleRetryFailed = async () => {
    if (!deck) return;
    try { const res = await retryFailedPptDeck(deck.id); setDeck(res.deck); setTaskList(prev => prev.map(item => item.id === res.deck.id ? res.deck : item)); } catch (e: any) { setGenError(e?.message || '操作失败'); }
  };
  const resetWork = () => {
    sessionStorage.removeItem('celano_active_deck');
    sessionStorage.removeItem('celano_open_deck');
    localStorage.removeItem(STORAGE_KEY);
    setDeck(null);
    setPages([]);
    setActiveIndex(0);
    setGenError('');
  };
  useEffect(() => subscribeLibraryChanges(change => {
    if (change.resource !== 'ppt' || change.id !== deck?.id) return;
    if (change.action === 'deleted') { setTaskList(items => items.filter(item => item.id !== change.id)); resetWork(); }
    else void getPptDeck(change.id).then(result => { setDeck(result.deck); setPages(buildDeckPages(result.deck)); }).catch(() => undefined);
  }), [deck?.id]);
  useEffect(() => { if (deck?.finished) publishLibraryChange({ resource: 'ppt', action: 'saved', id: deck.id }); }, [deck?.id, deck?.finished]);
  const handleClear = () => setDeleteTarget('deck');
  const confirmDelete = async () => {
    if (!deck || !deleteTarget || deleting) return;
    setDeleting(true);
    try {
      if (deleteTarget === 'slide') {
        const result = await deletePptSlide(deck.id, active.id);
        if (result.deck) {
          setDeck(result.deck); setPages(buildDeckPages(result.deck));
          setActiveIndex(index => Math.min(index, result.deck!.slides.length - 1));
        } else resetWork();
      } else {
        await deletePptDeck(deck.id);
        setTaskList(items => items.filter(item => item.id !== deck.id)); resetWork();
      }
      setDeleteTarget(null);
    } catch (error) { setGenError(error instanceof Error ? error.message : '删除失败'); }
    finally { setDeleting(false); }
  };
  const handleRegenCurrent = async () => {
    if (!deck) return;
    const slide = deck.slides.find(s => s.id === active.id);
    if (!slide || slide.status === 'generating') return;
    try {
      const res = await regeneratePptSlide(deck.id, slide.id);
      setDeck(res.deck);
      // 生成本页后以服务端新图为准，清掉本地覆盖
      setPages(prev => prev.map(p => (p.id === slide.id ? { ...p, imageUrl: undefined } : p)));
    } catch (e: any) { setGenError(e?.message || '操作失败'); }
  };
  const handleAppendSlide = async () => {
    if (!deck || appending) return;
    const title = appendTitle.trim();
    if (!title) { setGenError('请输入新页面标题'); return; }
    setAppending(true); setGenError('');
    try {
      const res = await appendPptSlide(deck.id, { title, imagePrompt: appendContent.trim() || undefined });
      setDeck(res.deck);
      setPages(buildDeckPages(res.deck));
      setActiveIndex(res.deck.slides.length - 1);
      setAppendOpen(false);
      setAppendTitle('');
      setAppendContent('');
    } catch (e: any) { setGenError(e?.message || '新增页面失败'); }
    finally { setAppending(false); }
  };

  // PPTX 导出（与源实现一致：16:9 版面，比例不符时居中留白绝不拉伸）
  function urlToDataUrl(url: string): Promise<string> {
    if (url.startsWith('data:')) return Promise.resolve(url);
    return fetch(url, { credentials: 'same-origin' }).then(res => {
      if (!res.ok) throw new Error('下载页面图片失败 HTTP ' + res.status);
      return res.blob();
    }).then(blob => new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('读取页面图片失败'));
      reader.readAsDataURL(blob);
    }));
  }
  function readImageRatio(dataUrl: string): Promise<number | null> {
    return new Promise(resolve => {
      const image = new Image();
      image.onload = () => resolve(image.naturalWidth && image.naturalHeight ? image.naturalWidth / image.naturalHeight : null);
      image.onerror = () => resolve(null);
      image.src = dataUrl;
    });
  }
  const exportPptx = async () => {
    if (deck && (!deck.finished || deck.slides.some(s => s.status !== 'done'))) {
      setGenError('请等待所有页面生成完成后再导出，失败页面请先重试');
      return;
    }
    const slides = pages.filter(p => p.imageUrl);
    if (!slides.length) { setGenError('还没有可导出的页面图片'); return; }
    setExporting(true);
    try {
      const { default: PptxGenJS } = await import('pptxgenjs');
      const pptx = new PptxGenJS();
      pptx.defineLayout({ name: 'SLIDE_16_9', width: PPT_PAGE_WIDTH, height: PPT_PAGE_HEIGHT });
      pptx.layout = 'SLIDE_16_9';
      pptx.title = deck?.title || '演示文稿';
      const slideWidth = PPT_PAGE_WIDTH;
      const slideHeight = PPT_PAGE_HEIGHT;
      const slideRatio = slideWidth / slideHeight;
      // 并行拉取所有页面图片，避免逐页串行等待网络；浏览器会按域名并发上限自动排队。
      const slidesWithData = await Promise.all(slides.map(async (slide) => {
        const data = await urlToDataUrl(slide.imageUrl as string);
        const ratio = await readImageRatio(data);
        return { data, ratio };
      }));
      for (const { data, ratio } of slidesWithData) {
        const page = pptx.addSlide();
        if (!ratio || Math.abs(ratio - slideRatio) < 0.02) {
          page.addImage({ data, x: 0, y: 0, w: slideWidth, h: slideHeight });
          continue;
        }
        page.background = { color: 'FFFFFF' };
        if (ratio > slideRatio) {
          const w = slideWidth;
          const h = w / ratio;
          page.addImage({ data, x: 0, y: (slideHeight - h) / 2, w, h });
        } else {
          const h = slideHeight;
          const w = h * ratio;
          page.addImage({ data, x: (slideWidth - w) / 2, y: 0, w, h });
        }
      }
      await pptx.writeFile({ fileName: (deck?.title || '演示文稿') + '.pptx' });
    } catch (e: any) {
      setGenError(e?.message || '导出失败');
    } finally {
      setExporting(false);
    }
  };

  const goHome = () => {
    sessionStorage.removeItem('celano_open_deck');
    sessionStorage.removeItem('celano_new_topic');
    sessionStorage.removeItem('celano_new_ppt_options');
    sessionStorage.removeItem('celano_new_request_key');
    // 直接访问 /workspace 时，仅修改 hash 会留下 /workspace pathname，
    // 路由管理器会立即把它判定为工作台。使用 pushState 切回根路径，
    // 再手动通知 hash 路由，不触发整页刷新。
    if ((window.location.pathname.replace(/\/+$/, '') || '/') === '/workspace') {
      window.history.pushState({}, '', '/#/');
      window.dispatchEvent(new Event('hashchange'));
    } else {
      window.location.hash = '/';
    }
  };

  const toolBtn = (t: DrawTool, Icon: any) => (
    <button key={t} className={'ws-button ' + (tool === t ? 'ws-primary' : 'ws-ghost')} onClick={() => setTool(t)} title={TOOL_META[t].label}>
      <Icon size={14} /> {TOOL_META[t].label}
    </button>
  );

  return (
    <div className="ws-root ws-editor celano-page-surface">
      <header className="ws-topbar">
        <div className="ws-topbar-left">
          <button className="ws-brand" onClick={goHome} title="返回首页">
            <img src="/brand/celano-wordmark-white.png" alt="CELANO" className="ws-brand-wordmark" />
          </button>
          <span className="ws-topbar-divider" aria-hidden="true" />
          <div className="ws-topbar-title">
            <strong>PPT 工作台</strong>
            <small title={deck?.title || ''}>{deck?.title ? `主题：${deck.title}` : '任务预览与画板编辑'}</small>
          </div>
        </div>
        <div className="ws-header-tools">
          <span className="ws-account-chip"><Clock size={14} /> 标记 {pages.reduce((n, p) => n + p.annotations.length, 0)} 处</span>
          <button
            type="button"
            className="ws-task-chip"
            data-state={deck?.finished ? 'done' : deck?.running ? 'running' : deck ? 'paused' : 'idle'}
            aria-expanded={taskPanelOpen}
            aria-controls="ws-task-panel"
            onClick={() => setTaskPanelOpen(v => !v)}
            title="任务后台：查看当前生成任务的状态与进度"
          >
            <span className="ws-task-dot" aria-hidden="true" />
            <span>{deck?.running ? `生成中 ${doneCount}/${totalSlides || '…'}` : deck?.finished ? '已完成' : deck ? '已暂停' : '任务后台'}</span>
          </button>
          <button className="ws-button ws-ghost" disabled={exporting || !pages.some(p => p.imageUrl)} title={pages.some(p => p.imageUrl) ? '将已生成页面导出为 PPTX' : '生成页面后可导出 PPTX'} onClick={() => void exportPptx()}><Download size={14} /> {exporting ? '导出中…' : '下载 PPTX'}</button>
        </div>
      </header>

      {taskPanelOpen ? (
        <>
          <div className="ws-task-scrim" onClick={() => setTaskPanelOpen(false)} />
          <section id="ws-task-panel" className="ws-task-panel" role="dialog" aria-label="任务后台">
            <header className="ws-task-panel-head">
              <strong>任务后台</strong>
              <span className="ws-task-panel-deck" title={deck?.title || ''}>{deck?.title || '当前无任务'}</span>
              <button type="button" className="ws-icon-btn" onClick={() => setTaskPanelOpen(false)} aria-label="关闭任务后台"><X size={15} /></button>
            </header>
            <div className="ws-task-panel-body">
              {deck ? (
                <>
                  <div className="ws-task-stage-row">
                    <span className="ws-task-stage">{deck.stage === 'planning' ? (deck.planningProgress && deck.planningProgress.totalBatches > 1 ? `大纲规划中… 第 ${deck.planningProgress.batch}/${deck.planningProgress.totalBatches} 批（已 ${Math.max(0, Math.floor((nowMs - deck.startedAt) / 1000))} 秒）` : `大纲规划中…（已 ${Math.max(0, Math.floor((nowMs - deck.startedAt) / 1000))} 秒）`) : deck.finished ? '已全部完成' + retentionLabel(deck.finishedAt, nowMs) : deck.running ? '逐页生成 ' + doneCount + '/' + totalSlides : '已暂停'}</span>
                    {failedCount > 0 ? <span className="ws-task-fail">失败 {failedCount} 页{refundedCredits > 0 ? ` · 已退回 ${refundedCredits} 点` : ''}</span> : null}
                  </div>
                  <div className="ws-task-progress"><div style={{ width: (totalSlides ? Math.round((doneCount / totalSlides) * 100) : 0) + '%' }} /></div>
                  <div className="ws-task-actions">
                    {deck.running ? (
                      <button className="ws-button ws-ghost" onClick={() => void handleStop()}><Square size={12} /> 停止生成</button>
                    ) : null}
                    {!deck.running && !deck.finished ? (
                      <button className="ws-button ws-ghost" onClick={() => void handleResume()}><RefreshCw size={12} /> 继续生成</button>
                    ) : null}
                    {!deck.running && failedCount > 0 ? (
                      <button className="ws-button ws-ghost" onClick={() => void handleRetryFailed()}>重试失败页</button>
                    ) : null}
                    {deck.finished ? (
                      <button className="ws-button ws-ghost ws-task-danger" onClick={() => void handleClear()}><Trash2 size={12} /> 删除作品</button>
                    ) : !deck.running ? (
                      <button className="ws-button ws-ghost ws-task-danger" onClick={() => void handleClear()}>删除任务</button>
                    ) : null}
                  </div>
                  {failedCount > 0 ? <p className="ws-task-note">失败页面不计费，已自动退回{refundedCredits > 0 ? ` ${refundedCredits} 点` : '对应点数'}。重试按 {perSlideCost} 点/页 重新计费。</p> : null}
                  {genError ? <p className="ws-task-error">{genError}</p> : null}
                  {deck.planningSource ? <p className={deck.planningSource === 'ai' ? 'ws-task-note' : 'ws-task-error'}>{deck.planningSource === 'ai' ? 'AI 内容规划已完成 · 逐页提示词已生成' : deck.planningWarning || 'AI 规划未成功，任务已暂停'}</p> : null}
                  {deck.referenceAnalysisStatus ? <p className={deck.referenceAnalysisStatus === 'failed' ? 'ws-task-error' : 'ws-task-note'}>{deck.referenceAnalysisStatus === 'analyzing' ? `参考文件分析中${deck.referenceAnalysisProgress ? ` · ${deck.referenceAnalysisProgress.done}/${deck.referenceAnalysisProgress.total} 段` : ''}` : deck.referenceAnalysisStatus === 'done' ? `参考文件分析已完成${deck.planningSource === 'ai' ? ' · 已用于逐页内容规划' : ''}` : '参考文件 AI 分析失败'}</p> : null}
                  {deck.error && deck.error !== genError ? <p className="ws-task-error" role="alert">{deck.error}</p> : null}
                </>
              ) : (
                <div className="ws-task-empty">
                  <ImageIcon size={20} />
                  <div>
                    <strong>{taskCreating ? '正在创建 PPT 任务…' : '暂无进行中的任务'}</strong>
                    <span>{taskCreating ? '首页提交的内容正在进入后台，完成后会自动展示缩略图。' : '从首页填写主题创建 PPT，生成进度会显示在这里。'}</span>
                  </div>
                  {genError ? <small>{genError}</small> : null}
                </div>
              )}
            </div>
          </section>
        </>
      ) : null}

      <div className="ws-layout" data-inspector={inspectorOpen ? 'on' : 'off'}>
        <aside ref={sidebarRef} className="ws-sidebar">
          <p className="ws-nav-label">PAGES</p>
          <div className="ws-pages">
            {pages.map((p, i) => (
              <button
                key={p.id}
                data-page-index={i}
                onClick={() => selectPage(i)}
                title={deck?.slides.find(s => s.id === p.id)?.error || p.title}
                aria-current={i === activeIndex ? 'page' : undefined}
                style={{
                  border: i === activeIndex ? '2px solid var(--text-primary)' : '1px solid var(--border-default)',
                  borderRadius: 12, overflow: 'hidden', padding: 0, background: '#ffffff04',
                  aspectRatio: '16 / 9', position: 'relative', display: 'block', width: '100%'
                }}
              >
                {p.imageUrl
                  ? <>
                    <img src={p.imageUrl} alt={p.title} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
                    {deck?.logo?.enabled && deck.logo.url ? <img src={deck.logo.url} alt="Logo" style={{ position: 'absolute', zIndex: 2, ...logoPositionStyle(deck.logo), ...logoSizeStyle(deck.logo), opacity: deck.logo.opacity ?? .9, objectFit: 'contain', pointerEvents: 'none' }} /> : null}
                  </>
                  : deck && deck.slides.find(s => s.id === p.id)?.status === 'failed'
                    ? <span style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', gap: 3, color: 'var(--danger-text)', fontSize: 11, textAlign: 'center', padding: 6, border: '1px dashed rgba(232,131,111,.32)', borderRadius: 8 }}>生成失败<span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>已退回点数</span></span>
                    : deck && deck.slides.find(s => s.id === p.id)?.status === 'generating'
                      ? <span style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}><LoaderCircle size={16} style={{ color: 'var(--text-secondary)', animation: 'ws-spin 0.9s linear infinite' }} /></span>
                      : <PagePreview annotations={p.annotations} />}
                <span style={{ position: 'absolute', left: 8, bottom: 8, fontSize: 10, color: i === activeIndex ? '#0B0E10' : 'var(--text-secondary)', background: i === activeIndex ? 'var(--text-primary)' : '#ffffff14', borderRadius: 6, padding: '2px 7px' }}>
                  {p.title}{p.annotations.length > 0 ? ' · ' + p.annotations.length + ' 处' : ''}
                </span>
              </button>
            ))}
          </div>
          <div className="ws-sidebar-bottom">
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {deck && pages.length ? <button className="ws-button ws-ghost" disabled={deck.running || sending || deleting} onClick={() => setDeleteTarget('slide')}><Trash2 size={13} /> 删除本页</button> : null}
              {deck && !deck.running ? <button className="ws-button ws-ghost" onClick={() => { setAppendOpen(v => !v); setGenError(''); }}><Plus size={13} /> 新增页</button> : null}
            </div>
            {appendOpen && deck ? (
              <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
                <input className="ws-input" placeholder="页面标题（必填）" value={appendTitle} onChange={e => setAppendTitle(e.target.value)} disabled={appending} maxLength={100} />
                <textarea className="ws-input" placeholder="这一页要讲什么？留空则按标题生成" value={appendContent} onChange={e => setAppendContent(e.target.value)} disabled={appending} rows={3} style={{ resize: 'vertical', minHeight: 60 }} />
                <button className="ws-button ws-primary" onClick={handleAppendSlide} disabled={appending || !appendTitle.trim()}>{appending ? <><LoaderCircle size={13} style={{ animation: 'ws-spin 0.9s linear infinite' }} /> 生成中…</> : <><Plus size={13} /> 生成这一页</>}</button>
              </div>
            ) : null}
            <p className="ws-sidebar-note">涂抹/框选自动编号，逐处填指令后发送修改</p>
          </div>
        </aside>

        <main className="ws-stage">
          {/* 画布工具栏 */}
          <div className="ws-panel ws-toolbar">
              {toolBtn('mark', Paintbrush)}
              {toolBtn('box', SquareDashed)}
              {tool === 'mark' && (
                <span className="ws-mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--text-secondary)' }}>
                  <span style={{ width: 14, height: 14, borderRadius: '50%', background: 'var(--danger-text)', display: 'inline-block' }} />
                  笔刷
                  <input
                    type="range"
                    min={MARK_WIDTH_MIN}
                    max={MARK_WIDTH_MAX}
                    value={markWidth}
                    onChange={e => setMarkWidth(Number(e.target.value))}
                    style={{ width: 110, accentColor: 'var(--danger-text)' }}
                  />
                  {markWidth}px
                </span>
              )}
              <span style={{ width: 1, height: 22, background: '#ffffff1a' }} />
              <button className="ws-button ws-ghost" onClick={undo} disabled={!active.annotations.length} title="撤销上一个标记（Ctrl+Z）"><Undo2 size={14} /> 撤销</button>
              <button className={'ws-button ' + (clearArmed ? 'ws-danger' : 'ws-ghost')} onClick={clearPage} disabled={!active.annotations.length} title="清空本页标记">
                <Trash2 size={14} /> {clearArmed ? '再次点击确认清空' : '清空本页'}
              </button>
              <span style={{ width: 1, height: 22, background: '#ffffff1a' }} />
              {toolBtn('pan', Hand)}
              <button className="ws-button ws-ghost" onClick={() => zoomBy(1 / 1.25)} title="缩小"><ZoomOut size={14} /></button>
              <span className="ws-mono" style={{ fontSize: 11, color: 'var(--text-secondary)', minWidth: 42, textAlign: 'center' }}>{Math.round(view.scale * 100)}%</span>
              <button className="ws-button ws-ghost" onClick={() => zoomBy(1.25)} title="放大"><ZoomIn size={14} /></button>
              <button className="ws-button ws-ghost" onClick={fit} title="适应窗口"><Maximize size={14} /></button>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-secondary)' }}>
                涂抹圈选 · 框选范围 · 自动编号 1 2 3…
              </span>
          </div>

          {/* 画布区 */}
          <div className="ws-canvas-frame">
            <div className="ws-canvas-inner">
              <div className="ws-canvas-head">
                <span className="ws-canvas-title">{active.title}</span>
                <span className="ws-mono ws-canvas-meta">16:9 · 标记 {active.annotations.length} 处</span>
              </div>
              <div
                ref={viewportRef}
                className="ws-panel ws-stage-viewport"
                onPointerDown={onViewportPointerDown}
                onPointerMove={onViewportPointerMove}
                onPointerUp={onViewportPointerUp}
                style={{ touchAction: 'none' }}
              >
                <div style={{ position: 'absolute', inset: 0, transform: 'translate(' + view.x + 'px, ' + view.y + 'px) scale(' + view.scale + ')', transformOrigin: '0 0' }}>
                  {active.imageUrl ? (
                    <>
                      <img src={active.imageUrl} alt={active.title} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', pointerEvents: 'none' }} />
                      {deck?.logo?.enabled && deck.logo.url ? <img src={deck.logo.url} alt="Logo" style={{ position: 'absolute', zIndex: 2, ...logoPositionStyle(deck.logo), ...logoSizeStyle(deck.logo), opacity: deck.logo.opacity ?? .9, objectFit: 'contain', pointerEvents: 'none' }} /> : null}
                    </>
                  ) : (
                    <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none', textAlign: 'center', color: 'var(--text-secondary)', padding: 24 }}>
                      <div>
                        <ImageIcon size={36} style={{ margin: '0 auto 12px', opacity: .5 }} />
                        <p style={{ fontSize: 13, color: 'var(--text-primary)', margin: 0 }}>
                          {activeIndex === 0 ? '封面页 · 生成后页面图片显示在这里' : active.title + ' · 等待生成'}
                        </p>
                        <p style={{ fontSize: 11, margin: '6px 0 0', maxWidth: 340, lineHeight: 1.8 }}>
                          {deck ? '页面生成完成后，可在画板中标记区域并发送修改。' : '请从首页创建 PPT 任务后开始编辑。'}
                        </p>
                      </div>
                    </div>
                  )}
                  <DrawCanvas annotations={active.annotations} tool={tool} markWidth={markWidth} onCommit={commitAnnotation} />
                </div>

                {sending && (
                  <div style={{ position: 'absolute', inset: 0, zIndex: 30, display: 'grid', placeItems: 'center', background: '#000a', backdropFilter: 'blur(3px)' }}>
                    <div style={{ textAlign: 'center', color: 'var(--text-primary)', fontSize: 13 }}>
                      <span style={{ width: 26, height: 26, border: '2px solid #ffffff33', borderTopColor: '#fff', borderRadius: '50%', display: 'inline-block', marginBottom: 12, animation: 'ws-spin 0.9s linear infinite' }} />
                      <br />正在按指令生成修改…
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </main>

        <aside className="ws-inspector" aria-label="页面检查器">
          <div className="ws-inspector-head">
            <strong className="ws-inspector-title">页面检查器</strong>
            <span className="ws-mono ws-inspector-pos">第 {activeIndex + 1} / {pages.length} 页</span>
            <button type="button" className="ws-icon-btn" onClick={() => setInspectorOpen(v => !v)} aria-expanded={inspectorOpen} title="折叠 / 展开检查器（⌘B）"><ChevronRight size={16} /></button>
          </div>
          <div className="ws-inspector-body">
              {/* 逐处修改指令列表 */}
              {active.annotations.length > 0 && (
                <div className="ws-panel" style={{ padding: 14, marginTop: 14 }}>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Wand2 size={13} /> 逐处修改指令（编号与图中标记一一对应）
                  </div>
                  <div style={{ display: 'grid', gap: 8 }}>
                    {active.annotations.map((a, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span className="ws-badge-mark">{a.number}</span>
                        <span style={{ fontSize: 11, color: 'var(--text-secondary)', width: 44, flexShrink: 0 }}>
                          {a.kind === 'scribble' ? (a.width + 'px 涂抹') : '框选'}
                        </span>
                        <input
                          className="ws-input"
                          style={{ flex: 1 }}
                          placeholder={a.number + ' 号区域要改什么？例如：把这里的标题改成蓝色'}
                          value={a.instruction}
                          disabled={sending}
                          onChange={e => setAnnotationInstruction(i, e.target.value)}
                        />
                        <button className="ws-button ws-ghost" style={{ padding: '0 8px' }} disabled={sending} onClick={() => removeAnnotation(i)} title="删除该处标记">
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {/* 整体指令 + 发送 */}
              <div className="ws-panel" style={{ padding: 14, marginTop: 14, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <input
                  className="ws-input"
                  style={{ flex: 1, minWidth: 240 }}
                  placeholder={active.annotations.length ? '选区统一修改要求（可选）：仅作用于已涂抹/框选区域' : '整页修改指令（可选）：未标记区域将保持原样'}
                  value={active.instruction}
                  disabled={sending || !active.imageUrl}
                  onChange={e => setInstruction(e.target.value)}
                />
                {deck && activeSlideStatus === 'failed' && (
                  <button className="ws-button ws-ghost" onClick={() => void handleRegenCurrent()} title="重新生成当前页面">
                    <RefreshCw size={14} /> 重新生成当前页{perSlideCost > 0 ? ` · ${perSlideCost} 点` : ''}
                  </button>
                )}
                <button
                  className="ws-button ws-primary"
                  disabled={sending || !active.imageUrl || !active.annotations.length || !hasInstruction}
                  onClick={() => void sendEdit()}
                  title={active.imageUrl ? '只修改涂抹/框选区域，未选中内容保持原样' : '页面生成后可修改'}
                >
                  <Wand2 size={14} /> {sending ? '生成中…' : '发送修改'}
                </button>
                <span style={{ fontSize: 11, color: 'var(--text-secondary)', width: '100%' }}>
                  {active.annotations.length ? '已启用局部编辑：仅修改透明遮罩对应的选区，其他内容保持原图。' : '请先涂抹或框选选区，再填写修改要求。'}
                </span>
                {editError && <span style={{ fontSize: 11, color: 'var(--danger-text)', width: '100%' }}>{editError}</span>}
                {editNotice && <span style={{ fontSize: 11, color: 'var(--text-secondary)', width: '100%' }}>{editNotice}</span>}
          </div>
            </div>
        </aside>

        <footer className="ws-statusbar" aria-label="任务状态">
          <span className="ws-status-item"><span className="ws-status-label">页面</span><b className="ws-mono">{activeIndex + 1} / {pages.length || '—'}</b></span>
          <span className="ws-status-item"><span className="ws-status-label">生成</span><b className="ws-mono">{deck ? doneCount + ' / ' + totalSlides : '—'}</b>{failedCount > 0 ? <em className="ws-status-danger">失败 {failedCount}</em> : null}</span>
          {deck?.running && concurrency > 0 ? <span className="ws-status-item"><span className="ws-status-label">并发</span><b className="ws-mono">{concurrency} 线程</b></span> : null}
          {deck ? <span className="ws-status-item"><span className="ws-status-label">已消耗</span><b className="ws-mono">{spentCredits} 点</b>{refundedCredits > 0 ? <em className="ws-status-refund">已退回 {refundedCredits} 点</em> : null}</span> : null}
          <span className="ws-status-item"><span className="ws-status-label">缩放</span><b className="ws-mono">{Math.round(view.scale * 100)}%</b></span>
          <button type="button" className="ws-button ws-ghost ws-status-toggle" onClick={() => setInspectorOpen(v => !v)} aria-expanded={inspectorOpen}>{inspectorOpen ? '收起检查器' : '展开检查器'}</button>
        </footer>
      </div>
      {authOpen && (
        <UserAuthModal
          onClose={() => setAuthOpen(false)}
          onSuccess={() => setAuthOpen(false)}
        />
      )}
      {deleteTarget && deck ? <DeleteConfirmation title={deleteTarget === 'slide' ? `删除第 ${activeIndex + 1} 页？` : `删除“${deck.title || '当前文稿'}”？`} message={deleteTarget === 'slide' ? '页面将同步从 PPT 工作台和个人中心作品中移除。删除最后一页时会移除整套作品。' : '作品将从工作台和个人中心同步移除，未完成页面的预扣点数会退回。'} busy={deleting} onCancel={() => setDeleteTarget(null)} onConfirm={() => void confirmDelete()} /> : null}
    </div>
  );
};
