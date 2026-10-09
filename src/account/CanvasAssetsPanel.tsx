import React, { useEffect, useRef, useState } from 'react';
import { Download, FileImage, LoaderCircle, Plus, Trash2, Type, X } from 'lucide-react';
import { useFocusTrap } from '../hooks/useFocusTrap.js';
import { deleteCanvasAsset, fetchCanvasAssets, saveCanvasAsset, type CanvasAsset } from '../services/canvasAssets.js';
import { subscribeLibraryChanges } from '../shared/libraryEvents.js';
import { useAuth } from '../context/AuthContext.js';

export function CanvasAssetsPanel() {
  const { currentUser } = useAuth();
  const [assets, setAssets] = useState<CanvasAsset[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<CanvasAsset | null>(null);
  const previewPanel = useFocusTrap<HTMLDivElement>(!!preview, () => setPreview(null));
  const [remove, setRemove] = useState<CanvasAsset | null>(null);
  const [draft, setDraft] = useState<{ title: string; content: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const load = async () => { setAssets(await fetchCanvasAssets()); };
  useEffect(() => {
    let live = true;
    const refresh = () => { fetchCanvasAssets().then(items => { if (live) { setAssets(items); setPreview(old => old && items.some(item => item.id === old.id) ? old : null); } }).catch(error => { if (live) setError(error.message); }); };
    refresh();
    const stop = subscribeLibraryChanges(change => { if (change.resource === 'asset') refresh(); });
    const focus = () => { if (!document.hidden) refresh(); };
    window.addEventListener('focus', focus);
    return () => { live = false; stop(); window.removeEventListener('focus', focus); };
  }, []);
  const perform = async (task: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await task(); await load(); } catch (error) { setError(error instanceof Error ? error.message : '素材操作失败'); }
    finally { setBusy(false); }
  };
  const upload = (files: FileList | null) => perform(async () => {
    for (const file of Array.from(files || [])) {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('请上传 PNG、JPEG 或 WebP 图片');
      const imageData = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('读取图片失败')); reader.readAsDataURL(file);
      });
      await saveCanvasAsset({ kind: 'image', title: file.name, imageData });
    }
    if (input.current) input.current.value = '';
  });
  const useAsset = (asset: CanvasAsset) => {
    sessionStorage.setItem('celano_canvas_insert_asset', asset.id);
    sessionStorage.removeItem('celano_canvas_open_mode');
    window.location.hash = '/canvas/editor';
  };
  return <section className="pc-panel pc-panel-pad">
    <div className="pc-panel-head"><div><h2>我的画布素材</h2><p>与智能画布共用，保存到当前账号</p></div><div className="pc-button-group"><button className="pc-button pc-ghost" disabled={busy} onClick={() => setDraft({ title: '', content: '' })}><Type size={14} /> 新建文本</button><button className="pc-button pc-primary" disabled={busy} onClick={() => input.current?.click()}><Plus size={14} /> 上传图片</button></div></div>
    <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={event => void upload(event.target.files)} />
    {error ? <p className="pc-notice pc-notice-error" role="alert">{error}</p> : null}
    {busy ? <p role="status"><LoaderCircle size={14} className="pc-spin" /> 正在保存素材…</p> : null}
    <div className="pc-assets-grid">{assets.map(asset => <article className="pc-asset-card" key={asset.id}>
      <button className="pc-asset-preview" onClick={() => setPreview(asset)} aria-label={'预览 ' + asset.title}>{asset.kind === 'image' ? <img src={asset.data.dataUrl} alt={asset.title} /> : <><Type size={20} /><p>{asset.data.content}</p></>}</button>
      <strong title={asset.title}>{asset.title}</strong><small>{asset.kind === 'image' ? '图片素材' : '文本素材'}</small>
      <div className="pc-button-group">{asset.tags.includes('文生图') ? <button className="pc-button pc-ghost" onClick={() => { if (currentUser) sessionStorage.setItem('celano_image_selected_' + currentUser.id, asset.id); window.location.hash = '/image/results'; }}>查看图片作品</button> : null}<button className="pc-button pc-ghost" onClick={() => useAsset(asset)}>在画布中使用</button><button className="pc-button pc-icon-button" aria-label={'删除 ' + asset.title} disabled={busy} onClick={() => setRemove(asset)}><Trash2 size={14} /></button></div>
    </article>)}</div>
    {!assets.length && !busy ? <div className="pc-empty"><FileImage size={24} /><h3>还没有画布素材</h3><p>上传图片或在画布中点击“加入我的资产”，即可在这里查看。</p></div> : null}
    {preview ? <div className="pc-asset-modal pc-asset-viewer" onClick={() => setPreview(null)}><div ref={previewPanel} role="dialog" aria-modal="true" aria-label="素材预览" className="pc-panel pc-panel-pad" onClick={event => event.stopPropagation()}><div className="pc-panel-head"><div><h2>{preview.title}</h2><p>{preview.data.width && preview.data.height ? `${preview.data.width} × ${preview.data.height}` : preview.kind === 'image' ? '原始图片' : '文本素材'}</p></div><button className="pc-button pc-icon-button" onClick={() => setPreview(null)} aria-label="关闭预览"><X size={18} /></button></div><div className={`pc-asset-viewer-stage${preview.kind === 'text' ? ' pc-asset-viewer-text' : ''}`}>{preview.kind === 'image' ? <img className="pc-asset-full-image" src={preview.data.dataUrl} alt={preview.title} /> : <pre>{preview.data.content}</pre>}</div><div className="pc-button-group pc-asset-viewer-actions">{preview.kind === 'image' && preview.data.dataUrl ? <a className="pc-button pc-primary" href={preview.data.dataUrl} download={`celano-${preview.id}.${preview.data.mimeType === 'image/jpeg' ? 'jpg' : preview.data.mimeType === 'image/webp' ? 'webp' : 'png'}`}><Download size={16} /> 下载原图</a> : null}<button className="pc-button" onClick={() => useAsset(preview)}>在画布中使用</button></div></div></div> : null}
    {remove ? <div className="pc-asset-modal" role="dialog" aria-modal="true" aria-label="删除素材"><div className="pc-panel pc-panel-pad"><h2>删除“{remove.title}”？</h2><p>素材将从个人中心和画布素材库中移除，已经放入画布的节点保留。</p><div className="pc-button-group"><button className="pc-button pc-ghost" onClick={() => setRemove(null)}>取消</button><button className="pc-button pc-primary" disabled={busy} onClick={() => void perform(async () => { await deleteCanvasAsset(remove.id); setRemove(null); })}>确认删除</button></div></div></div> : null}
    {draft ? <div className="pc-asset-modal" role="dialog" aria-modal="true" aria-label="新建文本素材"><form className="pc-panel pc-panel-pad" onSubmit={event => { event.preventDefault(); void perform(async () => { await saveCanvasAsset({ kind: 'text', title: draft.title, data: { content: draft.content } }); setDraft(null); }); }}><h2>新建文本素材</h2><label>标题<input required value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} /></label><label>内容<textarea required rows={8} value={draft.content} onChange={event => setDraft({ ...draft, content: event.target.value })} /></label><div className="pc-button-group"><button type="button" className="pc-button pc-ghost" onClick={() => setDraft(null)}>取消</button><button className="pc-button pc-primary" disabled={busy}>保存素材</button></div></form></div> : null}
  </section>;
}
