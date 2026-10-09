/**
 * kimi 外壳 + 项目功能 · 主壳（本地测试用）
 *
 * 顶部导航布局：顶部一条横向栏（logo + 导航项 + 会员/登录），
 * 页面内容在下方全宽展示。仅深色主题。
 *
 * 顶部栏（右上角）对齐 kimi 首页布局，并接入会员体系：
 *   未登录：开通会员 · 登录
 *   已登录：会员名/开通会员 · 个人中心
 *
 * 会员页与个人中心同属本外壳的页面，共用同一套 Logo、顶部导航、
 * 按钮与设计令牌，避免出现第二套视觉语言。
 */
import React, { Suspense, lazy, useState } from 'react';
import {
  Home, Presentation, Image as ImageIcon, Workflow,
  HelpCircle, Crown, LibraryBig,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.js';
import { membershipView } from '../shared/membership.js';
import { avatarUrl } from '../shared/avatar.js';
import { UserAuthModal } from '../components/UserAuthModal.js';
import '../styles/kimi-fonts.css';
import '../styles/kimi.css';
import '../styles/kimi-shell.css';

const HomeApp = lazy(() => import('../home/HomeApp.js').then(m => ({ default: m.HomeApp })));
const PptGenerateApp = lazy(() => import('../home/HomeApp.js').then(m => ({ default: m.PptGenerateApp })));
const ImageApp = lazy(() => import('../image/ImageApp.js').then(m => ({ default: m.ImageApp })));
const ImageResultsApp = lazy(() => import('../image/ImageResultsApp.js').then(m => ({ default: m.ImageResultsApp })));
const WorkspaceApp = lazy(() => import('../workspace/WorkspaceApp.js').then(m => ({ default: m.WorkspaceApp })));
const CanvasApp = lazy(() => import('../canvas/CanvasApp.js').then(m => ({ default: m.CanvasApp })));
const SupportApp = lazy(() => import('../support/SupportApp.js').then(m => ({ default: m.SupportApp })));
const PromptLibraryApp = lazy(() => import('../prompts/PromptLibraryApp.js').then(m => ({ default: m.PromptLibraryApp })));
const MembershipApp = lazy(() => import('../membership/MembershipApp.js').then(m => ({ default: m.MembershipApp })));
const AccountCenterApp = lazy(() => import('../account/AccountCenterApp.js').then(m => ({ default: m.AccountCenterApp })));

type PageKey = 'home' | 'ppt' | 'workspace' | 'image' | 'image-results' | 'canvas' | 'prompts' | 'support' | 'membership' | 'account';

const NAV: { key: PageKey; label: string; icon: React.ComponentType<{ size?: number; className?: string }> }[] = [
  { key: 'home', label: '首页', icon: Home },
  { key: 'ppt', label: 'PPT 生成', icon: Presentation },
  { key: 'image', label: '文生图', icon: ImageIcon },
  { key: 'canvas', label: '智能画布', icon: Workflow },
  { key: 'prompts', label: '提示词库', icon: LibraryBig },
  { key: 'support', label: '技术支持', icon: HelpCircle },
];

/** 每个页面在地址栏对应的路径，保证深链可直达。 */
const PAGE_PATH: Record<PageKey, string> = {
  home: '/', ppt: '/ppt', workspace: '/workspace', image: '/image', 'image-results': '/image/results', canvas: '/canvas',
  prompts: '/prompts',
  support: '/support', membership: '/membership', account: '/account',
};

export const KimiShellApp: React.FC<{ initialPage?: PageKey }> = ({ initialPage = 'home' }) => {
  const { currentUser } = useAuth();
  const membership = membershipView(currentUser);
  const [page, setPage] = useState<PageKey>(initialPage);
  const [authOpen, setAuthOpen] = useState(false);

  // 会员按钮文案：未登录 → 开通会员；已登录 → 当前版本（免费版或会员等级名）
  const membershipLabel = !currentUser ? '开通会员' : membership.name;

  // 壳内切页：写入历史记录（浏览器后退可回到上一页），但不派发 hashchange，
  // 避免整壳重新挂载；后退时由 main.tsx 的 hashchange / popstate 统一接管渲染。
  const switchPage = (key: PageKey) => {
    setPage(key);
    const path = PAGE_PATH[key];
    window.history.pushState({ celanoPage: key }, '', path === '/' ? '#/' : `#${path}`);
    window.dispatchEvent(new Event('celano-shell-route'));
  };

  return (
    <div className="kimi-app kimi-shell" data-theme="dark">
      <main className="kimi-main">
        <header className="kimi-topbar kimi-topnav">
          <button className="kimi-topnav-brand" type="button" aria-label="返回首页" onClick={() => switchPage('home')}>
            <img src="/brand/celano-wordmark-white.png" alt="CELANO" className="kimi-brand-wordmark" />
          </button>
          <nav className="kimi-topnav-nav" aria-label="主导航">
            {NAV.map(item => {
              const Icon = item.icon;
              const active = page === item.key || (page === 'image-results' && item.key === 'image') || (page === 'workspace' && item.key === 'ppt');
              return (
                <button
                  key={item.key}
                  type="button"
                  className="kimi-nav-item"
                  aria-current={active ? 'page' : undefined}
                  aria-label={item.label}
                  title={item.label}
                  onClick={() => switchPage(item.key)}
                >
                  <Icon size={16} className="kimi-nav-icon" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
          <button
            className="kimi-btn-quiet"
            type="button"
            aria-current={page === 'membership' ? 'page' : undefined}
            onClick={() => switchPage(currentUser && membership.active ? 'account' : 'membership')}
          >
            <Crown size={14} />
            <span>{membershipLabel}</span>
          </button>
          {currentUser ? (
            <button
              className="kimi-account-chip"
              type="button"
              title="个人中心"
              aria-current={page === 'account' ? 'page' : undefined}
              onClick={() => switchPage('account')}
            >
              <img className="kimi-account-avatar" src={avatarUrl(currentUser)} alt="" />
              <span className="kimi-account-name">{currentUser.username}</span>
              <span className="kimi-account-credits">{currentUser.credits ?? 0} 点</span>
            </button>
          ) : (
            <button className="kimi-btn-outline" type="button" onClick={() => setAuthOpen(true)}>登录</button>
          )}
        </header>

        <div className={`kimi-stage kimi-shell-stage${page === 'workspace' ? ' kimi-workspace-stage' : ''}`}>
          <Suspense fallback={<div className="kimi-shell-loading" role="status">正在加载页面…</div>}>
            {page === 'home' ? <HomeApp /> : null}
            {page === 'ppt' ? <PptGenerateApp /> : null}
            {page === 'workspace' ? <WorkspaceApp /> : null}
            {page === 'image' ? <ImageApp /> : null}
            {page === 'image-results' ? <ImageResultsApp /> : null}
            {page === 'canvas' ? <CanvasApp /> : null}
            {page === 'prompts' ? <PromptLibraryApp /> : null}
            {page === 'support' ? <SupportApp /> : null}
            {page === 'membership' ? <MembershipApp /> : null}
            {page === 'account' ? <AccountCenterApp /> : null}
          </Suspense>
        </div>
      </main>

      {authOpen ? <UserAuthModal onClose={() => setAuthOpen(false)} /> : null}
    </div>
  );
};
