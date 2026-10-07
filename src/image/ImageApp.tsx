import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowRight, Image as ImageIcon, LoaderCircle, Sparkles, Upload, WandSparkles, X } from 'lucide-react';
import { CreationHeading } from '../components/CreationHeading.js';
import { PrimaryNav } from '../components/PrimaryNav.js';
import { Select } from '../components/Select.js';
import { UserAuthModal } from '../components/UserAuthModal.js';
import { useAuth } from '../context/AuthContext.js';
import { optimizeImagePrompt } from '../services/api.js';
import { IMAGE_SIZE_PRESETS, type ImageResolution } from '../shared/imageSpecs.js';
import { memberImageCost, remainingFreeDaily } from '../shared/membership.js';
import { getImageDraft, getImageJobs, setImageDraft, startImageGeneration, subscribeImageJobs, type ImageDraft } from '../services/imageGeneration.js';
import '../styles/image.css';

export const ImageApp: React.FC = () => {
  const { currentUser, authReady } = useAuth();
  const owner = currentUser?.id || 'guest';
  const [draft, setDraft] = useState<{ owner: string; input: ImageDraft }>(() => ({ owner, input: getImageDraft(owner) }));
  const [notice, setNotice] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const jobs = useSyncExternalStore(subscribeImageJobs, getImageJobs);
  const busy = jobs.some(job => job.userId === currentUser?.id && ['generating', 'saving'].includes(job.phase));
  useEffect(() => { setDraft(previous => { const saved = getImageDraft(owner); return { owner, input: (saved.prompt || previous.owner !== 'guest') ? saved : previous.input }; }); }, [owner]);
  useEffect(() => { if (draft.owner === owner) setImageDraft(owner, draft.input); }, [draft, owner]);
  const { prompt, ratio, resolution, reference } = draft.input;
  const set = (patch: Partial<ImageDraft>) => { setDraft(previous => ({ ...previous, input: { ...previous.input, ...patch } })); setNotice(''); };
  // 图生图（上传参考图）与文生图同分辨率同价；会员折扣已在 memberImageCost 内体现。
  const cost = memberImageCost(currentUser, resolution);
  const freeLeft = resolution === '2K' && !reference ? remainingFreeDaily(currentUser) : 0;
  const generate = () => {
    if (!currentUser) { setConfirm(false); setAuthOpen(true); return; }
    const id = startImageGeneration(currentUser.id, draft.input);
    sessionStorage.setItem('celano_image_selected_' + currentUser.id, id);
    window.location.hash = '/image/results';
  };
  /** 提示词优化：与 PPT 页 / 画布一致的交互 —— 结果回填输入框，不扣点。 */
  const optimize = async () => {
    if (!prompt.trim() || optimizing || busy) return;
    setOptimizing(true); setNotice('');
    try {
      const result = await optimizeImagePrompt(prompt);
      set({ prompt: String(result.prompt || prompt) });
      setNotice('画面描述已优化，可继续调整或直接生成');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '优化失败');
    } finally {
      setOptimizing(false);
    }
  };
  return <div className="image-app">
    <PrimaryNav active="image" />
    <main className="image-main celano-feature-main">
      <CreationHeading title="把想象，直接生成画面。" description="围绕主题描述画面，剩下的构图、排版与视觉风格交给原生模型完成。" />
      <section className="image-card celano-compose-card">
        <textarea className="celano-composer-input" value={prompt} disabled={!authReady || busy} onChange={event => set({ prompt: event.target.value })} placeholder="描述你想生成的画面，例如：一张具有电影质感的城市夜景海报……" rows={5} />
        <div className="image-options celano-composer-toolbar">
          <label className="celano-composer-control">画质<Select value={resolution} disabled={busy} ariaLabel="画质" onChange={v => set({ resolution: v as ImageResolution })} options={[{ label: '2K', value: '2K' }, { label: '4K', value: '4K' }]} /></label>
          <label className="celano-composer-control">比例<Select value={ratio} disabled={busy} ariaLabel="比例" onChange={v => set({ ratio: v })} options={Object.keys(IMAGE_SIZE_PRESETS[resolution.toLowerCase()]).map(v => ({ label: v, value: v }))} /></label>
          <button disabled={busy} className="image-upload celano-composer-control" onClick={() => input.current?.click()}><Upload size={15} /> 上传参考图</button>
          <input ref={input} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={event => { const file = event.target.files?.[0]; if (file) { if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024) setNotice('请选择 8MB 以内的 PNG、JPEG 或 WebP 图片'); else set({ reference: { name: file.name, file } }); } event.target.value = ''; }} />
          <span className="image-cost">{freeLeft > 0 && !reference ? `今日免费额度剩余 ${freeLeft} 张 · 超出后 ${cost} 点/张` : `本次消耗 ${cost} 点`}</span>
          <button disabled={!authReady || busy || optimizing || !prompt.trim()} className="celano-optimize-button celano-composer-control" onClick={() => currentUser ? void optimize() : setAuthOpen(true)} title="把画面描述优化得更清晰、更可指挥">{optimizing ? <LoaderCircle size={16} className="image-composer-spin" /> : <WandSparkles size={16} />} {optimizing ? '优化中' : '优化'}</button>
          <button disabled={!authReady || busy || !prompt.trim()} className="image-generate celano-composer-primary" onClick={() => currentUser ? setConfirm(true) : setAuthOpen(true)}><Sparkles size={15} /> {busy ? '生成中…' : '生成图片'}</button>
        </div>
        {reference ? <div className="image-reference">{reference.name}<button disabled={busy} aria-label="移除参考图" onClick={() => set({ reference: null })}><X size={14} /></button></div> : null}
      </section>
      {notice ? <div className="image-notice" role="status">{notice}</div> : null}
      <div className="image-hint"><ImageIcon size={15} /> 确认后进入独立结果页，作品自动保存到当前账号</div>
      <button className="image-library-entry" onClick={() => { window.location.hash = '/image/results'; }}>{busy ? <LoaderCircle size={17} className="image-composer-spin" /> : <ImageIcon size={17} />}<span>{busy ? '查看正在生成的图片' : '我的图片作品'}</span><ArrowRight size={16} /></button>
    </main>
    {confirm ? <div className="image-confirm-overlay" onClick={() => setConfirm(false)}><section role="dialog" aria-modal="true" aria-labelledby="image-confirm-title" onClick={event => event.stopPropagation()}><h2 id="image-confirm-title">确认生成图片</h2><p>{resolution} 画质 · {ratio}{reference ? ' · 图生图' : ''}</p><p>{freeLeft > 0 && !reference ? '本次使用免费额度，不消耗点数' : `本次消耗 ${cost} 点`}，是否继续生成？</p><div><button onClick={() => setConfirm(false)}>取消</button><button className="image-confirm-primary" onClick={generate}>确认生成</button></div></section></div> : null}
    {authOpen ? <UserAuthModal onClose={() => setAuthOpen(false)} onSuccess={() => setAuthOpen(false)} /> : null}
  </div>;
};
