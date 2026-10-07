import React, { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Image, Plus, Type, Workflow } from 'lucide-react';
import { PrimaryNav } from '../components/PrimaryNav.js';
import { CreationHeading } from '../components/CreationHeading.js';
import { useAuth } from '../context/AuthContext.js';
import '../styles/canvas.css';

export const CanvasApp: React.FC = () => {
  const open = (mode: 'new' | 'recent') => {
    sessionStorage.setItem('celano_canvas_open_mode', mode);
    window.location.hash = '/canvas/editor';
  };
  return <div className="canvas-app celano-canvas-landing">
    <PrimaryNav active="canvas" />
    <main className="image-main celano-feature-main">
      <CreationHeading title="让灵感，在画布上自由生长。" description="把文本与图片放进同一张无限画布，连接创意、探索画面，随时继续你的创作。" />
      <section className="celano-canvas-entry">
        <div className="celano-canvas-preview" aria-hidden="true">
          <div className="canvas-preview-node canvas-preview-text"><Type size={18} /><span>一个新的想法</span><i /><i /></div>
          <div className="canvas-preview-link" />
          <div className="canvas-preview-node canvas-preview-image"><Image size={36} /><span>让想法成为画面</span></div>
          <span className="canvas-preview-tag"><Workflow size={14} /> 连接无限可能</span>
        </div>
        <div className="celano-canvas-entry-actions">
          <div><h2>你的无限创作空间</h2><p>文本 · 图片 · 节点插件</p></div>
          <div className="canvas-entry-buttons">
            <button className="canvas-entry-secondary" onClick={() => open('recent')}>继续编辑 <ArrowUpRight size={16} /></button>
            <button className="canvas-entry-primary" onClick={() => open('new')}><Plus size={17} /> 新建画布</button>
          </div>
        </div>
      </section>
      <p className="celano-canvas-entry-note">进入后开启全屏创作空间，素材可在个人中心统一管理。</p>
    </main>
  </div>;
};

export const CanvasEditorApp: React.FC = () => {
  const { currentUser, authReady } = useAuth();
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [mode] = useState(() => {
    const value = sessionStorage.getItem('celano_canvas_open_mode');
    sessionStorage.removeItem('celano_canvas_open_mode');
    return value === 'new' ? 'new' : 'recent';
  });
  const owner = currentUser?.id || 'guest';
  useEffect(() => {
    setReady(false);
    const receive = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== frame.current?.contentWindow) return;
      if (event.data?.type === 'celano-canvas-ready') setReady(true);
      if (event.data?.type === 'celano-canvas-exit') window.location.hash = '/canvas';
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [owner]);
  return <div className="celano-canvas-shell">
    <div className="celano-canvas-host">
      {authReady ? <iframe key={owner} ref={frame} title="智能画布" src={'/infinite-canvas/canvas?mode=' + mode + '&owner=' + encodeURIComponent(owner)} allow="clipboard-read; clipboard-write; fullscreen" /> : null}
      {!ready ? <div className="celano-canvas-loading" role="status">正在加载智能画布…</div> : null}
    </div>
  </div>;
};
