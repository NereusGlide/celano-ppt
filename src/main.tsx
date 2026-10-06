import { IMAGE_COST } from './shared/imageSpecs.js';
import React, { lazy, Suspense, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider } from './context/AuthContext.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { NotFoundApp } from './components/NotFoundApp.js';
import { installGlobalErrorHandlers } from './services/telemetry.js';
import './index.css';
// Shared navigation and creation controls must load before any lazy route is opened.
import './styles/home.css';
import './styles/motion.css';

/**
 * 路由级代码分割。
 *
 * 11 个页面如果全部静态导入，首页访客必须下载整个后台管理系统 + 工作台编辑器 +
 * 无限画布的代码才能看到第一屏。改为按需加载后，首页只承担 HomeApp 的体积，
 * 其余页面在真正进入对应路由时才拉取。
 */
const load = <T extends Record<string, unknown>>(loader: () => Promise<T>, name: keyof T) =>
  lazy(() => loader().then(module => ({ default: module[name] as unknown as React.ComponentType })));

const HomeApp = load(() => import('./home/HomeApp.tsx'), 'HomeApp');
const PptGenerateApp = load(() => import('./home/HomeApp.tsx'), 'PptGenerateApp');
const AdminApp = load(() => import('./admin/AdminApp.tsx'), 'AdminApp');
const WorkspaceApp = load(() => import('./workspace/WorkspaceApp.tsx'), 'WorkspaceApp');
const MembershipApp = load(() => import('./membership/MembershipApp.tsx'), 'MembershipApp');
const CanvasApp = load(() => import('./canvas/CanvasApp.tsx'), 'CanvasApp');
const CanvasEditorApp = load(() => import('./canvas/CanvasApp.tsx'), 'CanvasEditorApp');
const TemplateLibraryApp = load(() => import('./templates/TemplateLibraryApp.js'), 'TemplateLibraryApp');
const ImageApp = load(() => import('./image/ImageApp.tsx'), 'ImageApp');
const ImageResultsApp = load(() => import('./image/ImageResultsApp.tsx'), 'ImageResultsApp');
const SupportApp = load(() => import('./support/SupportApp.tsx'), 'SupportApp');
const AccountCenterApp = load(() => import('./account/AccountCenterApp.tsx'), 'AccountCenterApp');

/** 分包加载期间的首屏占位，避免白屏。 */
const RouteLoading: React.FC = () => (
  <div className="celano-route-loading" role="status" aria-live="polite">
    <span className="celano-route-loading-dot" />
    <span>正在加载…</span>
  </div>
);

/** 统一的错误边界 + 懒加载占位包装，保证任何页面崩溃都不会拖垮整站。 */
function wrap(node: React.ReactNode, label: string, withAuth = true): React.ReactNode {
  return (
    <ErrorBoundary label={label}>
      <Suspense fallback={<RouteLoading />}>
        {withAuth ? <AuthProvider>{node}</AuthProvider> : node}
      </Suspense>
    </ErrorBoundary>
  );
}

// 本次管理员保留、用户数据清空后，每个浏览器仅清理一次旧作品缓存。
// 管理员登录令牌保留；后续新作品不受影响。sessionStorage 在每个标签页分别处理。
const userDataResetVersion = '2026-10-03-admin-only';
try {
  if (localStorage.getItem('celano_user_data_reset') !== userDataResetVersion) {
    for (const key of ['celano_ws_annotations', 'celano-canvas-nodes', 'slidecraft_user_id', 'celano_user_id']) localStorage.removeItem(key);
    localStorage.setItem('celano_user_data_reset', userDataResetVersion);
  }
  if (sessionStorage.getItem('celano_user_data_reset') !== userDataResetVersion) {
    for (const key of ['celano_open_deck', 'celano_active_deck', 'celano_new_topic', 'celano_new_ppt_options', 'celano_new_request_key', 'celano_ppt_style_template']) sessionStorage.removeItem(key);
    sessionStorage.setItem('celano_user_data_reset', userDataResetVersion);
  }
} catch { /* 浏览器禁用本地存储时仍可打开页面。 */ }

installGlobalErrorHandlers();

const isAdmin = /^\/admin(?:\/|$)/.test(window.location.pathname);

const PPT_RESOLUTION_COST: Record<string, number> = IMAGE_COST;

function generationCost(body: any) {
  const pageCount = Math.max(1, Math.min(100, Number(body?.slideCount ?? body?.pageCount ?? body?.slides?.length) || 6));
  const resolution = String(body?.resolution || '2K').toUpperCase();
  const perPage = PPT_RESOLUTION_COST[resolution] || PPT_RESOLUTION_COST['2K'];
  return { pageCount, resolution: PPT_RESOLUTION_COST[resolution] ? resolution : '2K', perPage, total: pageCount * perPage };
}

function queuedPresentation(topic: unknown) {
  const id = 'handoff_' + Date.now().toString(36);
  const title = String(topic || '未命名演示文稿').trim().slice(0, 48) || '未命名演示文稿';
  // 生成请求桥接到工作台后返回占位对象，保持响应结构稳定。
  return { id, title, description: '', slides: [], createdAt: Date.now(), updatedAt: Date.now() };
}

/** 将首页提交的图片素材保留到正式 PPT 任务；只传 URL 会在跳转后丢失。 */
function handoffReferenceImages(body: any) {
  const items: Array<{ name: string; url: string }> = [];
  const add = (name: unknown, value: unknown) => {
    const url = typeof value === 'string' ? value : (value && typeof value === 'object' && typeof (value as any).url === 'string' ? (value as any).url : '');
    if (!url || items.some(item => item.url === url)) return;
    items.push({ name: String(name || '参考图片').slice(0, 80), url });
  };
  if (Array.isArray(body?.referenceFiles)) {
    for (const file of body.referenceFiles) {
      const type = String(file?.type || '').toLowerCase();
      if (type.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(String(file?.name || file?.url || ''))) {
        add(file?.name || '参考图片', file);
      }
    }
  }
  return items.slice(0, 18);
}

function handoffRequestKey() {
  const created = 'ppt_' + (typeof crypto?.randomUUID === 'function' ? crypto.randomUUID() : Date.now().toString(36) + '_' + Math.random().toString(36).slice(2));
  sessionStorage.setItem('celano_new_request_key', created);
  return created;
}

/** 点击生成时显示一次确认，不监听 DOM，避免与首页构建产物互相触发。 */
function confirmGeneration(body: any): Promise<boolean> {
  const existing = document.getElementById('celano-generation-confirm');
  if (existing) return Promise.resolve(false);
  const cost = generationCost(body);

  return new Promise(resolve => {
    let settled = false;
    let onKey: ((event: KeyboardEvent) => void) | undefined;
    const finish = (confirmed: boolean) => {
      if (settled) return;
      settled = true;
      if (onKey) document.removeEventListener('keydown', onKey);
      overlay.remove();
      resolve(confirmed);
    };

    const overlay = document.createElement('div');
    overlay.id = 'celano-generation-confirm';
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:2147483000', 'display:flex',
      'align-items:center', 'justify-content:center', 'padding:24px',
      'background:rgba(0,0,0,.68)', 'backdrop-filter:blur(8px)',
      'font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif'
    ].join(';');
    overlay.innerHTML = `
      <div role="dialog" aria-modal="true" aria-labelledby="celano-generation-confirm-title"
        style="width:min(420px,100%);border:1px solid rgba(255,255,255,.16);border-radius:20px;
        padding:26px;background:linear-gradient(145deg,#21262A,#0B0E10);color:#F4F6F7;
        box-shadow:0 24px 80px rgba(0,0,0,.45)">
        <div style="font-size:18px;font-weight:650;letter-spacing:.01em" id="celano-generation-confirm-title">确认生成 PPT</div>
        <div style="margin-top:8px;color:#8A9299;font-size:13px;line-height:1.6">生成任务提交后将扣除对应点数。</div>
        <div style="margin-top:20px;padding:16px;border-radius:14px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.09)">
          <div style="display:flex;justify-content:space-between;gap:16px;color:#8A9299;font-size:14px"><span>生成页数</span><strong style="color:#fff">${cost.pageCount} 页</strong></div>
          <div style="display:flex;justify-content:space-between;gap:16px;color:#8A9299;font-size:14px;margin-top:12px"><span>画质</span><strong style="color:#fff">${cost.resolution}</strong></div>
          <div style="display:flex;justify-content:space-between;gap:16px;color:#8A9299;font-size:14px;margin-top:12px"><span>每页消耗</span><strong style="color:#fff">${cost.perPage} 点</strong></div>
          <div style="height:1px;background:rgba(255,255,255,.12);margin:16px 0"></div>
          <div style="display:flex;justify-content:space-between;align-items:baseline;gap:16px"><span style="color:#E2E5E8;font-size:15px">本次预计消耗</span><strong style="color:#fff;font-size:25px">${cost.total}<small style="font-size:13px;font-weight:500;margin-left:4px;color:#8A9299">点</small></strong></div>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:22px">
          <button data-action="cancel" style="height:40px;padding:0 18px;border-radius:10px;border:1px solid rgba(255,255,255,.16);background:transparent;color:#8A9299;cursor:pointer;font-size:14px">取消</button>
          <button data-action="confirm" style="height:40px;padding:0 20px;border:0;border-radius:10px;background:#F4F6F7;color:#0B0E10;cursor:pointer;font-size:14px;font-weight:650">确认生成</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('[data-action="cancel"]')?.addEventListener('click', () => finish(false));
    overlay.querySelector('[data-action="confirm"]')?.addEventListener('click', () => finish(true));
    overlay.addEventListener('click', event => { if (event.target === overlay) finish(false); });
    onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') finish(false); };
    document.addEventListener('keydown', onKey, { once: true });
  });
}

/**
 * 首页点击「生成」时，页面会 POST /api/presentations/generate。
 * 统一拦截这次请求：确认点数 → 记录主题 → 无刷新切换到正式工作台。
 */
const originalFetch = window.fetch.bind(window);
(window as any).fetch = function (input: any, init: any) {
  const url: string = typeof input === 'string' ? input : (input && input.url) || '';
  const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
  if (url.includes('/api/presentations/generate') && method === 'POST') {
    let body: any = {};
    try {
      body = JSON.parse((init && init.body) || '{}');
    } catch { /* 忽略解析失败 */ }
    return confirmGeneration(body).then(confirmed => {
      if (!confirmed) return new Response(JSON.stringify({ success: false, error: '用户取消生成' }), { status: 409, headers: { 'Content-Type': 'application/json' } });
      if (body && body.topic) {
        const cost = generationCost(body);
        sessionStorage.setItem('celano_new_topic', String(body.topic));
        sessionStorage.setItem('celano_new_ppt_options', JSON.stringify({
          pageCount: cost.pageCount,
          resolution: cost.resolution,
          extraRequirements: body.extraRequirements || '',
          referenceContext: body.referenceContext || '',
          logo: body.logo && typeof body.logo === 'object' ? body.logo : undefined,
          referenceImages: handoffReferenceImages(body),
          requestKey: handoffRequestKey(),
        }));
      }
      window.location.hash = '#/workspace';
      return new Response(JSON.stringify({ success: true, queued: true, presentation: queuedPresentation(body.topic), jobId: 'handoff' }), { status: 202, headers: { 'Content-Type': 'application/json' } });
    }) as any;
  }
  // 审阅大纲后「开始生成」会 POST /api/presentations 创建演示文稿；同样桥接到正式工作台
  if (method === 'POST' && (url === '/api/presentations' || url.endsWith('/api/presentations'))) {
    let body: any = {};
    try {
      body = JSON.parse((init && init.body) || '{}');
    } catch { /* 忽略解析失败 */ }
    return confirmGeneration(body).then(confirmed => {
      if (!confirmed) return new Response(JSON.stringify({ success: false, error: '用户取消生成' }), { status: 409, headers: { 'Content-Type': 'application/json' } });
      const topic = body && (body.originalPrompt || body.topic);
      if (topic) {
        const cost = generationCost(body);
        sessionStorage.setItem('celano_new_topic', String(topic));
        sessionStorage.setItem('celano_new_ppt_options', JSON.stringify({
          pageCount: cost.pageCount,
          resolution: cost.resolution,
          extraRequirements: body.extraRequirements || '',
          referenceContext: body.referenceContext || '',
          logo: body.logo && typeof body.logo === 'object' ? body.logo : undefined,
          referenceImages: handoffReferenceImages(body),
          requestKey: handoffRequestKey(),
        }));
      }
      window.location.hash = '#/workspace';
      return new Response(JSON.stringify({ success: true, queued: true, presentation: queuedPresentation(topic), jobId: 'handoff' }), { status: 202, headers: { 'Content-Type': 'application/json' } });
    }) as any;
  }
  return originalFetch(input, init);
};

const rootEl = document.getElementById('root')!;
rootEl.classList.add('celano-route-root');
// 页面按路由挂载到独立容器，切换时卸载旧 React 根，防止容器冲突。
const workspaceRootEl = document.createElement('div');
workspaceRootEl.id = 'workspace-root';
workspaceRootEl.className = 'celano-route-root';
workspaceRootEl.style.minHeight = '100vh';
workspaceRootEl.style.display = 'none';
document.body.appendChild(workspaceRootEl);
const membershipRootEl = document.createElement('div');
membershipRootEl.id = 'membership-root';
membershipRootEl.className = 'celano-route-root';
membershipRootEl.style.minHeight = '100vh';
membershipRootEl.style.display = 'none';
document.body.appendChild(membershipRootEl);
const homeRootEl = document.createElement('div');
homeRootEl.id = 'home-root';
homeRootEl.className = 'celano-route-root';
homeRootEl.style.minHeight = '100vh';
homeRootEl.style.display = 'none';
document.body.appendChild(homeRootEl);
let appRoot: ReturnType<typeof createRoot> | null = null;
let mountedRoute = '';

function currentRoute() {
  const pathname = window.location.pathname.replace(/\/+$/, '') || '/';
  const hashPath = (window.location.hash.replace(/^#/, '').replace(/\/+$/, '') || '/');
  if (pathname === '/workspace' || hashPath === '/workspace') return 'workspace';
  if (pathname === '/templates' || hashPath === '/templates') return 'templates';
  if (pathname === '/ppt' || hashPath === '/ppt') return 'ppt';
  if (pathname === '/account' || hashPath === '/account') return 'account';
  if (pathname === '/membership' || hashPath === '/membership') return 'membership';
  if (pathname === '/canvas/editor' || hashPath === '/canvas/editor') return 'canvas-editor';
  if (pathname === '/canvas' || hashPath === '/canvas') return 'canvas';
  if (pathname === '/image/results' || hashPath === '/image/results') return 'image-results';
  if (pathname === '/image' || hashPath === '/image') return 'image';
  if (pathname === '/support' || hashPath === '/support') return 'support';
  // 只有根路径才是首页；其余未知地址一律走 404，
  // 避免搜索引擎把不存在的地址判定为 soft-404，也让用户知道地址确实错了。
  const atRoot = pathname === '/' && (hashPath === '/' || hashPath === '');
  return atRoot ? 'home' : 'not-found';
}

function mountRoute() {
  if (isAdmin) {
    document.body.dataset.celanoRoute = 'admin';
    rootEl.classList.remove('celano-route-enter');
    void rootEl.offsetWidth;
    rootEl.classList.add('celano-route-enter');
    if (!appRoot) appRoot = createRoot(rootEl);
    appRoot.render(<StrictMode>{wrap(<AdminApp />, 'admin', false)}</StrictMode>);
    return;
  }
  const route = currentRoute();
  if (mountedRoute === 'canvas-editor' && canvasSaving && route !== 'canvas-editor') return;
  if (route === mountedRoute) return;
  document.body.dataset.celanoRoute = route;
  // workspace、会员页和首页使用不同的容器；切换时先卸载旧 React 根，
  // 避免复用 createRoot 导致页面渲染到了上一个容器（表现为空白或黑屏）。
  appRoot?.unmount();
  appRoot = null;
  mountedRoute = route;
  const activeRoot = route === 'home' || route === 'ppt' || route === 'account' || route === 'templates' ? homeRootEl : route === 'membership' ? membershipRootEl : workspaceRootEl;
  activeRoot.classList.remove('celano-route-enter');
  void activeRoot.offsetWidth;
  activeRoot.classList.add('celano-route-enter');
  if (route === 'workspace') {
    rootEl.style.display = 'none';
    membershipRootEl.style.display = 'none';
    homeRootEl.style.display = 'none';
    workspaceRootEl.style.display = '';
    if (!appRoot) appRoot = createRoot(workspaceRootEl);
    appRoot.render(<StrictMode>{wrap(<WorkspaceApp />, 'workspace')}</StrictMode>);
  } else if (route === 'templates') {
    rootEl.style.display = 'none';
    workspaceRootEl.style.display = 'none';
    membershipRootEl.style.display = 'none';
    homeRootEl.style.display = '';
    appRoot = createRoot(homeRootEl);
    appRoot.render(<StrictMode>{wrap(<TemplateLibraryApp />, 'templates')}</StrictMode>);
  } else if (route === 'ppt') {
    rootEl.style.display = 'none';
    workspaceRootEl.style.display = 'none';
    membershipRootEl.style.display = 'none';
    homeRootEl.style.display = '';
    if (!appRoot) appRoot = createRoot(homeRootEl);
    appRoot.render(<StrictMode>{wrap(<PptGenerateApp />, 'ppt')}</StrictMode>);
  } else if (route === 'account') {
    rootEl.style.display = 'none';
    workspaceRootEl.style.display = 'none';
    membershipRootEl.style.display = 'none';
    homeRootEl.style.display = '';
    if (!appRoot) appRoot = createRoot(homeRootEl);
    appRoot.render(<StrictMode>{wrap(<AccountCenterApp />, 'account')}</StrictMode>);
  } else if (route === 'membership') {
    rootEl.style.display = 'none';
    workspaceRootEl.style.display = 'none';
    homeRootEl.style.display = 'none';
    membershipRootEl.style.display = '';
    if (!appRoot) appRoot = createRoot(membershipRootEl);
    appRoot.render(<StrictMode>{wrap(<MembershipApp />, 'membership')}</StrictMode>);
  } else if (route === 'canvas' || route === 'canvas-editor') {
    rootEl.style.display = 'none';
    membershipRootEl.style.display = 'none';
    homeRootEl.style.display = 'none';
    workspaceRootEl.style.display = '';
    if (!appRoot) appRoot = createRoot(workspaceRootEl);
    appRoot.render(<StrictMode>{wrap(route === 'canvas-editor' ? <CanvasEditorApp /> : <CanvasApp />, route)}</StrictMode>);
  } else if (route === 'image' || route === 'image-results') {
    rootEl.style.display = 'none';
    membershipRootEl.style.display = 'none';
    homeRootEl.style.display = 'none';
    workspaceRootEl.style.display = '';
    if (!appRoot) appRoot = createRoot(workspaceRootEl);
    appRoot.render(<StrictMode>{wrap(route === 'image-results' ? <ImageResultsApp /> : <ImageApp />, route)}</StrictMode>);
  } else if (route === 'support') {
    rootEl.style.display = 'none';
    membershipRootEl.style.display = 'none';
    homeRootEl.style.display = 'none';
    workspaceRootEl.style.display = '';
    if (!appRoot) appRoot = createRoot(workspaceRootEl);
    appRoot.render(<StrictMode>{wrap(<SupportApp />, 'support')}</StrictMode>);
  } else if (route === 'not-found') {
    workspaceRootEl.style.display = 'none';
    membershipRootEl.style.display = 'none';
    rootEl.style.display = 'none';
    homeRootEl.style.display = '';
    if (!appRoot) appRoot = createRoot(homeRootEl);
    appRoot.render(<StrictMode>{wrap(<NotFoundApp />, 'not-found', false)}</StrictMode>);
  } else {
    workspaceRootEl.style.display = 'none';
    membershipRootEl.style.display = 'none';
    rootEl.style.display = 'none';
    homeRootEl.style.display = '';
    if (!appRoot) appRoot = createRoot(homeRootEl);
    appRoot.render(<StrictMode>{wrap(<HomeApp />, 'home')}</StrictMode>);
  }
}

window.addEventListener('hashchange', mountRoute);
// Wait for asset uploads to finish before disposing the embedded canvas.
let canvasSaving = false;
window.addEventListener('message', event => {
  const frame = document.querySelector<HTMLIFrameElement>('.celano-canvas-host iframe');
  if (event.origin !== location.origin || event.source !== frame?.contentWindow || event.data?.type !== 'celano-canvas-saving') return;
  canvasSaving = event.data.saving === true;
  if (!canvasSaving) mountRoute();
});
// 直接访问 /workspace 时，浏览器后退触发的是 popstate 而非 hashchange；
// 同时监听两类事件，避免地址已经回到首页但仍显示工作台。
window.addEventListener('popstate', mountRoute);
mountRoute();
