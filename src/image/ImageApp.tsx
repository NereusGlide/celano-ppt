import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowRight, Image as ImageIcon, LoaderCircle, Sparkles, Upload, WandSparkles, X } from 'lucide-react';
import { UserAuthModal } from '../components/UserAuthModal.js';
import { useAuth } from '../context/AuthContext.js';
import { useFocusTrap } from '../hooks/useFocusTrap.js';
import { optimizeImagePrompt } from '../services/api.js';
import { fetchCurrentUser } from '../services/account.js';
import { IMAGE_SIZE_PRESETS, imageSizeFor, type ImageResolution } from '../shared/imageSpecs.js';
import { getMembershipCatalogVersion, isActiveMember, memberImageCost, remainingFreeDaily, subscribeMembershipCatalog } from '../shared/membership.js';
import { getImageDraft, getImageJobs, setImageDraft, startImageGeneration, subscribeImageJobs, type ImageDraft } from '../services/imageGeneration.js';
import '../styles/image.css';

export const ImageApp: React.FC = () => {
  const { currentUser, authReady, syncUser } = useAuth();
  const owner = currentUser?.id || 'guest';
  const [draft, setDraft] = useState<{ owner: string; input: ImageDraft }>(() => ({ owner, input: getImageDraft(owner) }));
  const [notice, setNotice] = useState('');
  const [confirm, setConfirm] = useState<'generate' | 'optimize' | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [referenceUrl, setReferenceUrl] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const ownerRef = useRef(owner);
  ownerRef.current = owner;
  const dialog = useFocusTrap<HTMLElement>(!!confirm, () => setConfirm(null));
  const jobs = useSyncExternalStore(subscribeImageJobs, getImageJobs);
  const busy = jobs.some(job => job.userId === currentUser?.id && ['generating', 'saving'].includes(job.phase));
  const locked = !authReady || busy || optimizing;
  useEffect(() => {
    setDraft(previous => { const saved = getImageDraft(owner); return { owner, input: (saved.prompt || saved.reference || previous.owner !== 'guest') ? saved : previous.input }; });
    setConfirm(null); setNotice('');
  }, [owner]);
  useEffect(() => { if (draft.owner === owner) setImageDraft(owner, draft.input); }, [draft, owner]);
  const { prompt, ratio, resolution, reference } = draft.input;
  useEffect(() => {
    if (!reference) { setReferenceUrl(''); return; }
    const url = URL.createObjectURL(reference.file);
    setReferenceUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [reference]);
  const set = (patch: Partial<ImageDraft>) => { setDraft(previous => ({ ...previous, input: { ...previous.input, ...patch } })); setNotice(''); };
  const catalogVersion = useSyncExternalStore(subscribeMembershipCatalog, getMembershipCatalogVersion);
  const priceReady = !isActiveMember(currentUser) || catalogVersion > 0;
  const unit = memberImageCost(currentUser, resolution);
  const freeLeft = currentUser && resolution === '2K' && !reference ? remainingFreeDaily(currentUser) : 0;
  const cost = freeLeft > 0 ? 0 : unit;
  const openConfirm = (action: 'generate' | 'optimize') => {
    if (locked || !prompt.trim()) return;
    if (!currentUser) { setAuthOpen(true); return; }
    const required = action === 'optimize' ? 1 : cost;
    if (action === 'generate' && !priceReady) { setConfirm('generate'); return; }
    if ((currentUser.credits || 0) < required) { setNotice(`点数不足：本次需要 ${required} 点，当前余额 ${currentUser.credits || 0} 点`); return; }
    setConfirm(action);
  };
  const generate = () => {
    setConfirm(null);
    if (!currentUser || locked || !prompt.trim()) return;
    const id = startImageGeneration(currentUser.id, draft.input);
    sessionStorage.setItem('celano_image_selected_' + currentUser.id, id);
    window.location.hash = '/image/results';
  };
  const optimize = async () => {
    setConfirm(null);
    if (!currentUser || locked || !prompt.trim()) return;
    const requestOwner = owner;
    setOptimizing(true); setNotice('');
    try {
      const result = await optimizeImagePrompt(prompt);
      if (ownerRef.current !== requestOwner) return;
      set({ prompt: String(result.prompt || prompt) });
      setNotice('提示词已优化');
    } catch (error) {
      if (ownerRef.current === requestOwner) setNotice(error instanceof Error ? error.message : '优化失败');
    } finally {
      setOptimizing(false);
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 10_000);
      void fetchCurrentUser(controller.signal).then(user => { if (user && user.id === requestOwner && ownerRef.current === requestOwner) syncUser(user); })
        .catch(() => { /* 会话同步失败不阻塞创作。 */ }).finally(() => window.clearTimeout(timeout));
    }
  };
  return <div className="image-app image-workbench">
    <main className="image-compose-main">
      <header className="image-workbench-heading"><div><h1>文生图工作台</h1><p>你的下一张作品，从这里开始。</p></div><button className="image-secondary" onClick={() => { window.location.hash = '/image/results'; }}><ImageIcon size={16} /> 我的图片 <ArrowRight size={16} /></button></header>
      <div className="image-compose-layout">
        <section className="image-prompt-section" aria-labelledby="image-prompt-label">
          <div className="image-section-heading"><label id="image-prompt-label" htmlFor="image-prompt">画面描述</label><span>{prompt.length} / 4000</span></div>
          <textarea id="image-prompt" maxLength={4000} value={prompt} disabled={locked} onChange={event => set({ prompt: event.target.value })} placeholder="描述主体、场景、构图和视觉风格…" rows={8} />
          <div className="image-prompt-actions"><button className="image-secondary" disabled={locked || !prompt.trim()} onClick={() => openConfirm('optimize')}>{optimizing ? <LoaderCircle size={16} className="image-composer-spin" /> : <WandSparkles size={16} />} {optimizing ? '优化中' : '优化提示词'} <span>1 点</span></button></div>
          <div className="image-section-heading"><h2>参考图</h2><span>可选</span></div>
          <input ref={input} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={event => { const file = event.target.files?.[0]; if (file) { if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024) setNotice('请选择 8MB 以内的 PNG、JPEG 或 WebP 图片'); else set({ reference: { name: file.name, file } }); } event.target.value = ''; }} />
          {reference ? <div className="image-reference-preview"><img src={referenceUrl} alt="上传的参考图" /><span>{reference.name}</span><button className="image-icon-button" title="移除参考图" aria-label="移除参考图" disabled={locked} onClick={() => set({ reference: null })}><X size={16} /></button></div> : <button className="image-reference-upload" disabled={locked} onClick={() => input.current?.click()}><Upload size={20} /><span>上传参考图<small>PNG / JPEG / WebP · 最大 8MB</small></span></button>}
        </section>
        <aside className="image-parameters" aria-label="生成参数">
          <div className="image-section-heading"><h2>生成设置</h2></div>
          <fieldset><legend>画质</legend><div className="image-quality-options">{(['2K', '4K'] as ImageResolution[]).map(value => <button key={value} disabled={locked} aria-pressed={resolution === value} onClick={() => set({ resolution: value })}><strong>{value}</strong><span>{value === '2K' ? '高清' : '超高清'}</span></button>)}</div></fieldset>
          <fieldset><legend>画面比例</legend><div className="image-ratio-options">{Object.keys(IMAGE_SIZE_PRESETS[resolution.toLowerCase()]).map(value => <button key={value} disabled={locked} aria-pressed={ratio === value} onClick={() => set({ ratio: value })}><span className="image-ratio-shape" style={{ aspectRatio: value.replace(':', ' / ') }} aria-hidden="true" />{value}</button>)}</div></fieldset>
          <dl className="image-spec-summary"><div><dt>输出尺寸</dt><dd>{imageSizeFor(resolution, ratio).replace('x', ' × ')}</dd></div><div><dt>生成方式</dt><dd>{reference ? '参考图生成' : '文生图'}</dd></div><div><dt>当前余额</dt><dd>{currentUser ? `${currentUser.credits || 0} 点` : '登录后查看'}</dd></div><div><dt>本次消耗</dt><dd className="image-cost-value">{priceReady ? `${cost} 点` : '会员报价同步中'}</dd></div></dl>
          {freeLeft > 0 ? <p className="image-free-notice">今日免费额度剩余 {freeLeft} 张 · 超出后 {unit} 点/张</p> : null}
          <button className="image-primary image-submit" disabled={locked || !prompt.trim()} onClick={() => openConfirm('generate')}><Sparkles size={16} />{busy ? '图片生成中' : '生成图片'}<ArrowRight size={16} /></button>
          {busy ? <button className="image-secondary" onClick={() => { window.location.hash = '/image/results'; }}>查看生成进度 <ArrowRight size={16} /></button> : null}
        </aside>
      </div>
      {notice ? <div className="image-notice" role="status">{notice}</div> : null}
    </main>
    {confirm ? <div className="image-confirm-overlay" onClick={() => setConfirm(null)}><section ref={dialog} role="dialog" aria-modal="true" aria-labelledby="image-confirm-title" onClick={event => event.stopPropagation()}><h2 id="image-confirm-title">{confirm === 'optimize' ? '优化提示词' : '确认生成图片'}</h2><p>{confirm === 'optimize' ? '本次优化消耗 1 点，失败自动退回。' : `${resolution} · ${ratio}${reference ? ' · 参考图生成' : ''}`}</p><p>{confirm === 'generate' ? (!priceReady ? '正在同步会员报价。' : cost === 0 ? '本次使用免费额度，不消耗点数。' : `本次消耗 ${cost} 点。`) : ''} 当前余额 {currentUser?.credits || 0} 点</p><div><button className="image-secondary" onClick={() => setConfirm(null)}>取消</button><button className="image-primary" disabled={confirm === 'generate' && !priceReady} onClick={confirm === 'optimize' ? () => void optimize() : generate}>{confirm === 'optimize' ? '确认优化' : '确认生成'}</button></div></section></div> : null}
    {authOpen ? <UserAuthModal onClose={() => setAuthOpen(false)} onSuccess={() => setAuthOpen(false)} /> : null}
  </div>;
};
