import React from 'react';

/**
 * 未匹配路由的兜底页面。
 *
 * 此前的行为是：任何未知地址都静默渲染成首页。这会造成两个问题：
 *  1. 搜索引擎把不存在的地址判定为 soft-404，稀释整站质量分；
 *  2. 用户输错地址或点开失效链接时，看到的是首页，误以为跳转失败。
 * 现在给出明确反馈并提供返回入口。
 */
export const NotFoundApp: React.FC = () => {
  const goHome = (): void => {
    if ((window.location.pathname.replace(/\/+$/, '') || '/') === '/') {
      window.location.hash = '/';
    } else {
      window.history.pushState({}, '', '/#/');
      window.dispatchEvent(new Event('hashchange'));
    }
  };

  return (
    <div className="celano-notfound">
      <div className="celano-notfound-card">
        <p className="celano-notfound-code" aria-hidden="true">404</p>
        <h1>没有找到这个页面</h1>
        <p>地址可能输错了，或者这个链接已经失效。</p>
        <div className="celano-notfound-actions">
          <button type="button" className="celano-notfound-primary" onClick={goHome}>返回首页</button>
          <a className="celano-notfound-ghost" href="/#/templates">浏览模版库</a>
        </div>
      </div>
    </div>
  );
};
