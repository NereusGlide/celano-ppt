import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { ArrowLeft, ArrowRight, Download, Image as ImageIcon, LoaderCircle, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { PrimaryNav } from '../components/PrimaryNav.js';
import { DeleteConfirmation } from '../components/DeleteConfirmation.js';
import { useAuth } from '../context/AuthContext.js';
import { deleteCanvasAsset, fetchCanvasAssets, type CanvasAsset } from '../services/canvasAssets.js';
import { forgetImageJob, getImageJobs, saveImageGeneration, setImageDraft, subscribeImageJobs, type ImageJob } from '../services/imageGeneration.js';
import { subscribeLibraryChanges } from '../shared/libraryEvents.js';
import '../styles/image.css';
import '../styles/image-results.css';

type Result = { id: string; title: string; prompt: string; url?: string; width?: number; height?: number; mimeType?: string; resolution: string; ratio: string; assetId?: string; job?: ImageJob };
const goCompose = () => { window.location.hash = '/image'; };
export const ImageResultsApp: React.FC = () => {
  const { currentUser, authReady } = useAuth();
  const [assets, setAssets] = useState<CanvasAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState('');
  const [remove, setRemove] = useState<Result | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [now, setNow] = useState(Date.now());
  const allJobs = useSyncExternalStore(subscribeImageJobs, getImageJobs);
  const jobs = allJobs.filter(job => job.userId === currentUser?.id);
  const pending = jobs.some(job => ['generating', 'saving'].includes(job.phase));
  useEffect(() => { if (!pending) return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [pending]);
  useEffect(() => {
    if (!authReady) return;
    setAssets([]); setSelected(currentUser ? sessionStorage.getItem('celano_image_selected_' + currentUser.id) || '' : '');
    if (!currentUser) { setLoading(false); return; }
    let live = true;
    const refresh = () => { void fetchCanvasAssets().then(items => { if (live) { setAssets(items.filter(item => item.kind === 'image' && item.tags.includes('文生图')).sort((a, b) => b.createdAt.localeCompare(a.createdAt))); setError(''); } }).catch(error => { if (live) setError(error.message); }).finally(() => { if (live) setLoading(false); }); };
    refresh();
    const stop = subscribeLibraryChanges(change => {
      if (change.resource !== 'asset') return;
      if (change.action === 'deleted') { setAssets(items => items.filter(item => item.id !== change.id)); setRemove(item => item?.id === change.id ? null : item); }
      else refresh();
    });
    window.addEventListener('focus', refresh);
    return () => { live = false; stop(); window.removeEventListener('focus', refresh); };
  }, [currentUser?.id, authReady]);
  const saved: Result[] = assets.map(asset => ({ id: asset.id, assetId: asset.id, title: asset.title, prompt: asset.note || asset.title, url: asset.data.dataUrl, width: asset.data.width, height: asset.data.height, mimeType: asset.data.mimeType, resolution: asset.tags.find(tag => tag === '2K' || tag === '4K') || '原图', ratio: asset.tags.find(tag => /^\d+:\d+$/.test(tag)) || '' }));
  const unsaved: Result[] = jobs.filter(job => !assets.some(asset => asset.id === job.id)).map(job => ({ id: job.id, title: job.input.prompt.slice(0, 60), prompt: job.input.prompt, url: job.image?.url, width: job.image?.width, height: job.image?.height, resolution: job.input.resolution, ratio: job.input.ratio, assetId: job.assetId, job }));
  const results = [...unsaved, ...saved];
  const active = results.find(item => item.id === selected) || results[0];
  const choose = (id: string) => { setSelected(id); if (currentUser) sessionStorage.setItem('celano_image_selected_' + currentUser.id, id); };
  const continueCreation = (result: Result) => {
    if (currentUser) setImageDraft(currentUser.id, result.job?.input || { prompt: result.prompt, resolution: result.resolution === '4K' ? '4K' : '2K', ratio: result.ratio || '1:1', reference: null });
    goCompose();
  };
  const removeResult = async () => {
    if (!remove || deleting) return;
    setDeleting(true); setError('');
    try {
      if (remove.assetId) await deleteCanvasAsset(remove.assetId);
      forgetImageJob(remove.id); setAssets(items => items.filter(item => item.id !== remove.id)); setRemove(null);
    } catch (error) { setError(error instanceof Error ? error.message : '删除失败'); }
    finally { setDeleting(false); }
  };
  const useInCanvas = (assetId: string) => { sessionStorage.setItem('celano_canvas_insert_asset', assetId); window.location.hash = '/canvas/editor'; };
  return <div className="image-app image-results-app"><PrimaryNav active="image" />
    <main className="image-results-main">
      <header className="image-results-heading"><div><button className="image-result-back" onClick={goCompose}><ArrowLeft size={15} /> 返回创作</button><p>YOUR IMAGE COLLECTION</p><h1>图片作品</h1></div><button className="image-result-new" onClick={goCompose}><Plus size={16} /> 继续生成 <ArrowRight size={15} /></button></header>
      {error ? <p className="image-results-error" role="alert">{error}</p> : null}
      {loading && !jobs.length ? <div className="image-result-empty" role="status"><LoaderCircle size={25} className="image-results-spin" /><p>正在加载图片作品…</p></div> : !currentUser ? <div className="image-result-empty"><ImageIcon size={30} /><h2>登录后查看你的图片作品</h2><button onClick={() => { window.location.hash = '/account'; }}>前往登录</button></div> : !active ? <div className="image-result-empty"><ImageIcon size={32} /><h2>还没有图片作品</h2><p>从一个描述开始，完成后图片会显示在这里。</p><button onClick={goCompose}>开始创作 <ArrowRight size={15} /></button></div> : <div className="image-results-layout">
        <aside className="image-result-rail" aria-label="图片作品列表"><div className="image-result-rail-title"><strong>我的作品</strong><span>{results.length}</span></div><div className="image-result-thumbnails">{results.map(item => <button key={item.id} aria-label={`查看作品 ${item.title}`} aria-pressed={active.id === item.id} className={active.id === item.id ? 'selected' : ''} onClick={() => choose(item.id)}><div className="image-result-thumb">{item.url ? <img src={item.url} alt="" loading="lazy" /> : item.job?.phase === 'failed' ? <ImageIcon size={22} /> : <LoaderCircle size={22} className="image-results-spin" />}</div><strong>{item.title}</strong><small>{item.job?.phase === 'generating' ? '生成中' : item.job?.phase === 'saving' ? '保存中' : item.job?.phase === 'failed' ? '失败' : item.resolution}</small></button>)}</div></aside>
        <section className="image-result-detail" aria-label="当前图片作品"><div className="image-result-detail-head"><div><h2>{active.title}</h2><span>{active.resolution}{active.ratio ? ' · ' + active.ratio : ''}{active.width && active.height ? ` · 原图 ${active.width} × ${active.height}` : ''}</span></div>{!active.job || !['generating', 'saving'].includes(active.job.phase) ? <button className="image-result-delete" aria-label="删除当前图片" onClick={() => { setError(''); setRemove(active); }}><Trash2 size={16} /></button> : null}</div>
          <div className="image-result-viewer">{active.url ? <img src={active.url} alt="生成的图片" width={active.width} height={active.height} /> : <div className="image-result-feedback" role="status">{active.job?.phase === 'failed' ? <><ImageIcon size={38} /><h2>图片生成失败</h2><p>{active.job.error}</p><button onClick={() => continueCreation(active)}>修改后重试 <RefreshCw size={15} /></button></> : <><LoaderCircle size={40} className="image-results-spin" /><h2>{active.job?.phase === 'saving' ? '正在保存作品' : '正在生成图片'}</h2><p>{active.resolution} · {active.ratio} · 已等待 {Math.max(0, Math.floor((now - (active.job?.startedAt || now)) / 1000))} 秒</p><small>完成后自动显示原图，并同步保存到个人中心。</small></>}</div>}</div>
          {active.job?.phase === 'failed' && active.url ? <div className="image-results-error" role="alert">{active.job.error}<button onClick={() => void saveImageGeneration(active.id)}>重试保存</button></div> : null}
          <div className="image-result-detail-actions">{active.url ? <a href={active.url} download={`celano-${active.id}.${active.mimeType === 'image/jpeg' ? 'jpg' : active.mimeType === 'image/webp' ? 'webp' : 'png'}`}><Download size={16} /> 下载原图</a> : null}{active.assetId ? <button onClick={() => useInCanvas(active.assetId!)}>在画布中使用 <ArrowRight size={15} /></button> : null}<button onClick={() => continueCreation(active)}>继续创作</button></div>
          <details className="image-result-prompt"><summary>创作提示词</summary><p>{active.prompt}</p></details>
        </section>
      </div>}
    </main>
    {remove ? <DeleteConfirmation title="删除这张图片？" message={error || '图片会从作品结果页和个人中心素材库同步移除。其他作品中已使用的图片保留。'} busy={deleting} onCancel={() => setRemove(null)} onConfirm={() => void removeResult()} /> : null}
  </div>;
};
