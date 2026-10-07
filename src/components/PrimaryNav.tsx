import React, { useState } from 'react';
import { BrandLogo } from './BrandLogo.js';
import { useAuth } from '../context/AuthContext.js';
import { UserAuthModal } from './UserAuthModal.js';
import { membershipView } from '../shared/membership.js';

export type PrimaryNavRoute = 'image' | 'ppt' | 'canvas' | 'prompts' | 'support';

/** 全部创作页共用的主导航；页面专属操作通过 trailing 插槽放在右侧。 */
export const PrimaryNav: React.FC<{ active?: PrimaryNavRoute; trailing?: React.ReactNode }> = ({ active, trailing }) => {
  const { currentUser } = useAuth();
  const membership = membershipView(currentUser);
  const [authOpen, setAuthOpen] = useState(false);
  const go = (route: string) => { window.location.hash = route; };
  return <>
    <header className="celano-home-topbar">
      <button className="celano-home-brand" onClick={() => go('/')} aria-label="返回首页"><span className="celano-brand-mark"><BrandLogo height={24} /></span></button>
      <nav className="celano-home-nav" aria-label="主导航">
        <button className={active === 'ppt' ? 'active' : ''} onClick={() => go('/ppt')}>PPT 生成</button>
        <button className={active === 'image' ? 'active' : ''} onClick={() => go('/image')}>文生图</button>
        <button className={active === 'canvas' ? 'active' : ''} onClick={() => go('/canvas')}>智能画布</button>
        <span className="celano-nav-sep" aria-hidden="true" />
        <button className={active === 'prompts' ? 'active' : ''} onClick={() => go('/prompts')}>提示词库</button>
        <button className={active === 'support' ? 'active' : ''} onClick={() => go('/support')}>技术支持</button>
      </nav>
      <div className="celano-home-actions">{trailing}<button className="celano-points" onClick={() => go(currentUser && membership.active ? '/account' : '/membership')}>{currentUser ? membership.name : '开通会员'}</button><button className="celano-account" onClick={() => currentUser ? go('/account') : setAuthOpen(true)}>个人中心</button>{currentUser ? null : <><button className="celano-auth-link" onClick={() => setAuthOpen(true)}>登录</button><button className="celano-register-link" onClick={() => setAuthOpen(true)}>注册</button></>}<button className="celano-nav-cta" onClick={() => go('/ppt')}>开始创作</button></div>
    </header>
    {authOpen ? <UserAuthModal onClose={() => setAuthOpen(false)} /> : null}
  </>;
};
