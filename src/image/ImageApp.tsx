import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowRight, Image as ImageIcon, LoaderCircle, Sparkles, Upload, X } from 'lucide-react';
import { CreationHeading } from '../components/CreationHeading.js';
import { PrimaryNav } from '../components/PrimaryNav.js';
import { UserAuthModal } from '../components/UserAuthModal.js';
import { useAuth } from '../context/AuthContext.js';
import { IMAGE_COST, IMAGE_SIZE_PRESETS, type ImageResolution } from '../shared/imageSpecs.js';
import { getImageDraft, getImageJobs, setImageDraft, startImageGeneration, subscribeImageJobs, type ImageDraft } from '../services/imageGeneration.js';
import '../styles/image.css';

export const ImageApp: React.FC = () => {
  const { currentUser, authReady } = useAuth();
  const owner = currentUser?.id || 'guest';
  const [draft, setDraft] = useState<{ owner: string; input: ImageDraft }>(() => ({ owner, input: getImageDraft(owner) }));
  const [notice, setNotice] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const jobs = useSyncExternalStore(subscribeImageJobs, getImageJobs);
  const busy = jobs.some(job => job.userId === currentUser?.id && ['generating', 'saving'].includes(job.phase));
  useEffect(() => { setDraft(previous => { const saved = getImageDraft(owner); return { owner, input: (saved.prompt || previous.owner !== 'guest') ? saved : previous.input }; }); }, [owner]);
  useEffect(() => { if (draft.owner === owner) setImageDraft(owner, draft.input); }, [draft, owner]);
  const { prompt, ratio, resolution, reference } = draft.input;
  const set = (patch: Partial<ImageDraft>) => { setDraft(previous => ({ ...previous, input: { ...previous.input, ...patch } })); setNotice(''); };
  const cost = reference ? 2 : IMAGE_COST[resolution];
  const generate = () => {
    if (!currentUser) { setConfirm(false); setAuthOpen(true); return; }
    const id = startImageGeneration(currentUser.id, draft.input);
    sessionStorage.setItem('celano_image_selected_' + currentUser.id, id);
    window.location.hash = '/image/results';
  };
  return <div className="image-app">
    <PrimaryNav active="image" />
    <main className="image-main celano-feature-main">
      <CreationHeading eyebrow="IMAGE CREATION" title="把想象，直接生成画面。" description="围绕主题描述画面，剩下的构图、排版与视觉风格交给原生模型完成。" />
      <section className="image-card celano-compose-card">
        <textarea className="celano-composer-input" value={prompt} disabled={!authReady || busy} onChange={event => set({ prompt: event.target.value })} placeholder="描述你想生成的画面，例如：一张具有电影质感的城市夜景海报……" rows={5} />
        <div className="image-options celano-composer-toolbar">
          <label className="celano-composer-control">画质<select disabled={busy} value={resolution} onChange={event => set({ resolution: event.target.value as ImageResolution })}><option>2K</option><option>4K</option></select></label>
          <label className="celano-composer-control">比例<select disabled={busy} value={ratio} onChange={event => set({ ratio: event.target.value })}>{Object.keys(IMAGE_SIZE_PRESETS[resolution.toLowerCase()]).map(value => <option key={value} value={value}>{value}</option>)}</select></label>
          <button disabled={busy} className="image-upload celano-composer-control" onClick={() => input.current?.click()}><Upload size={15} /> 上传参考图</button>
          <input ref={input} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={event => { const file = event.target.files?.[0]; if (file) { if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024) setNotice('请选择 8MB 以内的 PNG、JPEG 或 WebP 图片'); else set({ reference: { name: file.name, file } }); } event.target.value = ''; }} />
          <span className="image-cost">本次消耗 {cost} 点</span>
          <button disabled={!authReady || busy || !prompt.trim()} className="image-generate celano-composer-primary" onClick={() => currentUser ? setConfirm(true) : setAuthOpen(true)}><Sparkles size={15} /> {busy ? '生成中…' : '生成图片'}</button>
        </div>
        {reference ? <div className="image-reference">{reference.name}<button disabled={busy} aria-label="移除参考图" onClick={() => set({ reference: null })}><X size={14} /></button></div> : null}
      </section>
      {notice ? <div className="image-notice" role="status">{notice}</div> : null}
      <div className="image-hint"><ImageIcon size={15} /> 确认后进入独立结果页，作品自动保存到当前账号</div>
      <button className="image-library-entry" onClick={() => { window.location.hash = '/image/results'; }}>{busy ? <LoaderCircle size={17} className="image-composer-spin" /> : <ImageIcon size={17} />}<span>{busy ? '查看正在生成的图片' : '我的图片作品'}</span><ArrowRight size={16} /></button>
    </main>
    {confirm ? <div className="image-confirm-overlay" onClick={() => setConfirm(false)}><section role="dialog" aria-modal="true" aria-labelledby="image-confirm-title" onClick={event => event.stopPropagation()}><h2 id="image-confirm-title">确认生成图片</h2><p>{resolution} 画质 · {ratio}</p><p>本次消耗 <strong>{cost} 点</strong>，是否继续生成？</p><div><button onClick={() => setConfirm(false)}>取消</button><button className="image-confirm-primary" onClick={generate}>确认生成</button></div></section></div> : null}
    {authOpen ? <UserAuthModal onClose={() => setAuthOpen(false)} onSuccess={() => setAuthOpen(false)} /> : null}
  </div>;
};
