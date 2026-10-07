import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box, Building, Building2, Brush, Check, Circle, Copy, Cpu, Droplets, Film,
  Grid3x3, Mountain, Package, PawPrint, PenTool, Presentation, Search, ShoppingBag,
  Sparkles, Type, UserRound, UtensilsCrossed, WandSparkles,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.js';
import { setImageDraft, type ImageDraft } from '../services/imageGeneration.js';
import { PROMPT_CATEGORIES, PROMPT_LIBRARY, type PromptCard } from './promptLibrary.js';
import '../styles/prompts.css';

const ICON: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  Presentation, ShoppingBag, UserRound, Package, Film, Sparkles, PenTool, Box,
  Grid3x3, Droplets, Brush, Cpu, UtensilsCrossed, PawPrint, Building2, Mountain,
  Building, Type, Circle,
};

/** 分类标签外观（用于搜索 / 无图封面 / 卡角标） */
const categoryMeta = (key: string) => PROMPT_CATEGORIES.find(c => c.key === key);

export const PromptLibraryApp: React.FC = () => {
  const { currentUser } = useAuth();
  const [activeCat, setActiveCat] = useState<string>('all');
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const navigationTimer = useRef<number | undefined>(undefined);
  const copyTimer = useRef<number | undefined>(undefined);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      window.clearTimeout(navigationTimer.current);
      window.clearTimeout(copyTimer.current);
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return PROMPT_LIBRARY.filter(item => {
      if (activeCat !== 'all' && item.category !== activeCat) return false;
      if (!q) return true;
      return item.title.toLowerCase().includes(q)
        || item.description.toLowerCase().includes(q)
        || item.prompt.toLowerCase().includes(q);
    });
  }, [activeCat, query]);

  /** 一键同款：把完整提示词写入文生图草稿，跳转文生图页即可直接生成。 */
  const makeSame = (card: PromptCard) => {
    const owner = currentUser?.id || 'guest';
    const draft: ImageDraft = {
      prompt: card.prompt,
      resolution: '2K',
      ratio: card.ratio,
      reference: null,
    };
    setImageDraft(owner, draft);
    setNotice(`已载入「${card.title}」提示词，即将前往文生图`);
    // 稍作停留让用户感知发生了什么，再跳转；文生图页会读取草稿自动回填。
    window.clearTimeout(navigationTimer.current);
    navigationTimer.current = window.setTimeout(() => { window.location.hash = '/image'; }, 220);
  };

  const copyPrompt = async (card: PromptCard) => {
    try {
      await navigator.clipboard.writeText(card.prompt);
      if (!mounted.current) return;
      setCopied(card.id);
      window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(null), 1400);
    } catch {
      if (mounted.current) setNotice('复制失败，请手动选择文本复制');
    }
  };

  const total = PROMPT_LIBRARY.length;

  return (
    <div className="prompt-lib">
      <header className="prompt-lib-hero">
        <p className="prompt-lib-eyebrow">PROMPT GALLERY</p>
        <h1>提示词导航</h1>
        <div className="prompt-lib-intro" aria-label={`精选 ${total} 组提示词，覆盖 ${PROMPT_CATEGORIES.length} 个分类`}>
          <p className="prompt-lib-summary"><strong>精选 {total} 组</strong><span>经过验证的文生图提示词</span><span>覆盖 {PROMPT_CATEGORIES.length} 个分类</span></p>
          <p className="prompt-lib-copy-note">点「一键同款」即可把完整提示词带入文生图，直接生成同款效果。</p>
        </div>
        <div className="prompt-lib-search">
          <Search size={15} />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="搜索提示词、描述或关键词…"
            aria-label="搜索提示词"
          />
        </div>
      </header>

      <nav className="prompt-lib-cats" aria-label="提示词分类">
        <button
          className={activeCat === 'all' ? 'active' : ''}
          onClick={() => setActiveCat('all')}
        >全部</button>
        {PROMPT_CATEGORIES.map(cat => {
          const Icon = ICON[cat.icon] || Sparkles;
          return (
            <button
              key={cat.key}
              className={activeCat === cat.key ? 'active' : ''}
              onClick={() => setActiveCat(cat.key)}
            >
              <Icon size={14} />
              <span>{cat.label}</span>
            </button>
          );
        })}
      </nav>

      {notice ? <div className="prompt-lib-notice" role="status">{notice}</div> : null}

      {filtered.length === 0 ? (
        <div className="prompt-lib-empty">没有匹配的提示词，换个关键词或分类试试。</div>
      ) : (
        <div className="prompt-lib-grid">
          {filtered.map(card => {
            const cat = categoryMeta(card.category);
            const CatIcon = cat ? (ICON[cat.icon] || Sparkles) : Sparkles;
            const isOpen = expanded === card.id;
            return (
              <article key={card.id} className="prompt-lib-card">
                <div
                  className="prompt-lib-thumb"
                  style={card.image ? undefined : { background: `linear-gradient(135deg, ${cat?.gradient[0] || '#1f1f1f'}, ${cat?.gradient[1] || '#2a2a2a'})` }}
                >
                  {card.image ? (
                    <img
                      src={card.image}
                      alt={card.title}
                      loading="lazy"
                      onError={e => {
                        const el = e.currentTarget;
                        el.style.display = 'none';
                        (el.parentElement as HTMLElement).classList.add('cover-fallback');
                      }}
                    />
                  ) : null}
                  <span className="prompt-lib-thumb-icon"><CatIcon size={28} /></span>
                  <span className="prompt-lib-thumb-cat">{cat?.label || ''}</span>
                  <span className="prompt-lib-thumb-ratio">{card.ratio}</span>
                </div>

                <div className="prompt-lib-body">
                  <h2 className="prompt-lib-title">{card.title}</h2>
                  <p className="prompt-lib-desc">{card.description}</p>

                  <div className={`prompt-lib-prompt ${isOpen ? 'open' : ''}`}>
                    <p>{card.prompt}</p>
                  </div>

                  <div className="prompt-lib-foot">
                    <button
                      className="prompt-lib-expand"
                      onClick={() => setExpanded(isOpen ? null : card.id)}
                      aria-expanded={isOpen}
                    >
                      {isOpen ? '收起提示词' : '查看完整提示词'}
                    </button>
                    {card.source ? <span className="prompt-lib-source" title={card.source}>CC BY 4.0</span> : null}
                    <div className="prompt-lib-actions">
                      <button
                        className="prompt-lib-copy"
                        onClick={() => void copyPrompt(card)}
                        aria-label="复制提示词"
                        title="复制提示词"
                      >
                        {copied === card.id ? <Check size={14} /> : <Copy size={14} />}
                      </button>
                      <button
                        className="prompt-lib-make"
                        onClick={() => makeSame(card)}
                      >
                        <WandSparkles size={14} />
                        一键同款
                      </button>
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <footer className="prompt-lib-footer">
        <span>部分提示词改编自 awesome-gpt-image-2 开源提示词库（CC BY 4.0），仅供学习与创作参考。</span>
      </footer>
    </div>
  );
};
