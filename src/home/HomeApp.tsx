import { IMAGE_COST } from '../shared/imageSpecs.js';
import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, FileImage, Image as ImageIcon, Layers3, LoaderCircle, Plus, Sparkles, Trash2, Upload, WandSparkles, X } from 'lucide-react';
import { deleteAccountWork, fetchAccountSummary } from '../services/account.js';
import { DeleteConfirmation } from '../components/DeleteConfirmation.js';
import { BrandLogo } from '../components/BrandLogo.js';
import { HeroOrbitParticles } from '../components/HeroOrbitParticles.js';
import type { Presentation, User } from '../types.js';
import { CreationHeading } from '../components/CreationHeading.js';
import { PrimaryNav } from '../components/PrimaryNav.js';
import { Select } from '../components/Select.js';
import { selectedTemplateReferences } from '../templates/catalog.js';
import { referenceContext, type ReferenceParseStatus } from '../shared/referenceFiles.js';
import { subscribeLibraryChanges } from '../shared/libraryEvents.js';

type Resolution = '2K' | '4K';
type UploadedFile = { id: string; name: string; size: number; type: string; url: string; extractedText?: string; parseStatus?: ReferenceParseStatus; parseError?: string; progress?: number; parsePhase?: string };

const costs = IMAGE_COST;
const go = (route: string) => { window.location.hash = route; };

export const Nav = PrimaryNav;

function BrandPill() { return <div className="celano-brand-pill"><BrandLogo height={16} /> 青澜集团旗下 AI 产品</div>; }

function ProductCard({ icon, title, text, action, onClick }: { icon: React.ReactNode; title: string; text: string; action: string; onClick: () => void }) {
  return <button className="celano-product-card" onClick={onClick}><div className="celano-card-icon">{icon}</div><div><strong>{title}</strong><p>{text}</p></div><span className="celano-card-arrow">{action}<ArrowRight size={14} /></span></button>;
}

export const HomeApp: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [works, setWorks] = useState<Presentation[]>([]);
  const [removeWork, setRemoveWork] = useState<Presentation | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const confirmDelete = async () => {
    if (!removeWork || deleting) return;
    setDeleting(true); setDeleteError('');
    try { await deleteAccountWork(removeWork.id); setWorks(items => items.filter(item => item.id !== removeWork.id)); setRemoveWork(null); }
    catch (error) { setDeleteError(error instanceof Error ? error.message : '删除失败'); }
    finally { setDeleting(false); }
  };
  useEffect(() => {
    const controller = new AbortController();
    const refresh = () => { void fetchAccountSummary(controller.signal).then(data => { setUser(data.user); setWorks(data.presentations.slice(0, 4)); }).catch(() => undefined); };
    refresh();
    const stop = subscribeLibraryChanges(change => { if (change.resource === 'ppt') refresh(); });
    window.addEventListener('focus', refresh);
    return () => { controller.abort(); stop(); window.removeEventListener('focus', refresh); };
  }, []);
  return <div className="celano-home-app"><Nav />
    <main>
      <section className="celano-hero"><BrandPill /><p className="celano-eyebrow">CREATE WITH CLARITY</p><h1>把想法，变成<br /><em>有表现力的作品</em><HeroOrbitParticles /></h1><p className="celano-hero-copy">从一个主题开始，生成演示文稿、画面与无限画布。<br />内容由你定义，视觉交给原生模型完成。</p><div className="celano-hero-actions"><button className="celano-main-cta" onClick={() => go('/ppt')}><Plus size={18} /> 开始制作 PPT</button><button className="celano-secondary-cta" onClick={() => go('/templates')}>浏览模版库 <ArrowRight size={15} /></button></div></section>
      <section className="celano-capability-grid" id="celano-discovery"><ProductCard icon={<Layers3 size={22} />} title="PPT 生成" text="围绕主题，生成 16:9 原生演示文稿。" action="开始创作" onClick={() => go('/ppt')} /><ProductCard icon={<ImageIcon size={22} />} title="文生图" text="把描述直接变成画面，保留创意自由度。" action="去生成" onClick={() => go('/image')} /><ProductCard icon={<WandSparkles size={22} />} title="智能画布" text="在无限画布上组合、连接和继续创作。" action="打开画布" onClick={() => go('/canvas')} /></section>
      <section className="celano-recent-section"><div className="celano-section-heading"><div><p className="celano-eyebrow">YOUR CREATIONS</p><h2>{user ? `${user.name || user.username} 的最近作品` : '最近作品'}</h2></div><button onClick={() => go('/account')}>打开作品库 <ArrowRight size={14} /></button></div>{works.length ? <div className="celano-work-grid">{works.map(work => <div key={work.id} className="celano-recent-work"><button className="celano-work-card" onClick={() => go('/account')}><div className="celano-work-preview">{work.slides?.[0]?.imageUrl ? <img src={work.slides[0].imageUrl} alt="" /> : <span>CELANO PPT</span>}</div><strong>{work.title || '未命名演示文稿'}</strong><small>{work.slides?.length || 0} 页 · {work.resolution || '2K'} · 16:9</small></button><button className="celano-work-remove" aria-label={`删除作品 ${work.title}`} title="删除作品" onClick={() => { setDeleteError(''); setRemoveWork(work); }}><Trash2 size={15} /></button></div>)}</div> : <div className="celano-empty-works"><FileImage size={19} /><span>完成一次创作后，作品会自动保存在你的作品库。</span><button onClick={() => go('/ppt')}>开始第一份作品 <ArrowRight size={14} /></button></div>}</section>
    </main>
    {removeWork ? <DeleteConfirmation title={`删除“${removeWork.title}”？`} message={deleteError || '作品会从首页、工作台和个人中心同步移除。'} busy={deleting} onCancel={() => setRemoveWork(null)} onConfirm={() => void confirmDelete()} /> : null}
  </div>;
};

async function uploadFile(endpoint: string, file: File, field = 'file') {
  const form = new FormData(); form.append(field, file);
  const controller = new AbortController();
  // 超时按体积动态计算：基础 120s + 按 300KB/s 预留传输时间，上限 600s（照顾慢速跨境/代理链路）
  const timeoutMs = Math.min(600_000, Math.max(120_000, 60_000 + Math.ceil(file.size / (300 * 1024)) * 1000));
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(endpoint, { method: 'POST', body: form, credentials: 'same-origin', signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('上传超时，请重试；若正在使用代理/VPN，建议关闭或更换网络后重试');
    throw new Error('网络异常，请检查网络连接后重试');
  } finally {
    clearTimeout(timer);
  }
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.success) throw new Error(result?.error || '上传失败');
  return result;
}

function FileChip({ file, onRemove }: { file: UploadedFile; onRemove: () => void }) {
  const state = file.parseStatus === 'pending' ? ` · 分析中${file.progress ? ` ${file.progress}%` : '…'}` : file.parseStatus === 'ready' ? ' · 正文已读取' : file.parseStatus === 'failed' || file.parseStatus === 'unsupported' ? ' · 正文未读取' : '';
  return <div className="celano-file-chip">{file.type.startsWith('image/') ? <img src={file.url} alt="" /> : file.parseStatus === 'pending' ? <LoaderCircle size={16} className="celano-spin" /> : <FileImage size={16} />}<span title={file.parseError || (file.parseStatus === 'pending' && file.parsePhase ? `${file.parsePhase}（${file.progress ?? 0}%）` : file.name)}>{file.name}{state}</span><button onClick={onRemove} aria-label={`删除 ${file.name}`}><X size={13} /></button></div>;
}

export const PptGenerateApp: React.FC = () => {
  const [topic, setTopic] = useState('');
  const [pageInput, setPageInput] = useState('1');
  const pages = Number(pageInput);
  const validPages = pageInput.trim() !== '' && Number.isInteger(pages) && pages >= 1 && pages <= 100;
  const [resolution, setResolution] = useState<Resolution>('2K');
  const [references, setReferences] = useState<UploadedFile[]>([]);
  const [templateReferences, setTemplateReferences] = useState<UploadedFile[]>(selectedTemplateReferences);
  const [styleReferences, setStyleReferences] = useState<UploadedFile[]>([]);
  const [logo, setLogo] = useState<{ url: string; name: string } | null>(null);
  const [notice, setNotice] = useState('');
  const [credits, setCredits] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const referenceInput = useRef<HTMLInputElement>(null);
  const styleInput = useRef<HTMLInputElement>(null);
  const logoInput = useRef<HTMLInputElement>(null);
  useEffect(() => { const controller = new AbortController(); fetchAccountSummary(controller.signal).then(data => setCredits(typeof data.user?.credits === 'number' ? data.user.credits : null)).catch(() => undefined); return () => controller.abort(); }, []);
  const total = validPages ? pages * costs[resolution] : 0;
  // 成本前置：把「本次消耗 / 单价构成 / 生成后余额」常驻在生成按钮旁，
  // 而不是只在确认弹窗里出现一次。余额未知（未登录或接口失败）时不参与判断。
  const remaining = credits === null || !validPages ? null : credits - total;
  const insufficient = remaining !== null && remaining < 0;
  const unreadReferences = references.filter(file => file.parseStatus === 'failed' || file.parseStatus === 'unsupported');
  const pendingReferences = references.filter(file => file.parseStatus === 'pending');
  const canGenerate = topic.trim().length > 0 && !uploading && !optimizing && validPages && !pendingReferences.length && !unreadReferences.length && !insufficient;
  const analyzeReference = async (file: UploadedFile, style: boolean) => {
    const setter = style ? setStyleReferences : setReferences;
    const apply = (update: Partial<UploadedFile>) => setter(prev => prev.map(item => item.id === file.id ? { ...item, ...update } : item));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 900_000);
    try {
      const response = await fetch('/api/references/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ id: file.id, poll: true }), signal: controller.signal });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.success) throw new Error(result?.error || '正文分析失败');
      // 轮询真实进度：后端按批次/页数回报百分比，完成时返回最终 file
      for (;;) {
        controller.signal.throwIfAborted();
        const progressResponse = await fetch('/api/references/progress?id=' + encodeURIComponent(file.id), { credentials: 'same-origin', signal: controller.signal });
        const progress = await progressResponse.json().catch(() => null);
        if (!progressResponse.ok || !progress?.success) throw new Error(progress?.error || '正文分析进度查询失败');
        if (progress.file) {
          apply({ extractedText: progress.file.extractedText, parseStatus: progress.file.parseStatus, parseError: progress.file.parseError, progress: undefined, parsePhase: undefined });
          setNotice(progress.file.parseStatus === 'ready' ? `「${file.name}」正文已读取，可开始生成` : `「${file.name}」${progress.file.parseError || '正文分析失败'}`);
          return;
        }
        apply({ progress: Math.max(1, Math.min(99, Math.round(progress.progress?.percent ?? 1))), parsePhase: progress.progress?.phase });
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (error) {
      apply({ parseStatus: 'failed', parseError: error instanceof Error && error.name === 'AbortError' ? '正文分析超时，请重试' : error instanceof Error ? error.message : '正文分析失败' });
    } finally {
      clearTimeout(timer);
    }
  };
  const handleReferences = async (files: FileList | null, style = false) => {
    if (!files?.length) return; setNotice(''); setUploading(true);
    const setter = style ? setStyleReferences : setReferences;
    const limit = style ? 3 : 6;
    const selected = Array.from(files).slice(0, limit);
    // 并行上传，缩短多文件上传耗时；每个文件独立返回成功或具体错误。
    const results = await Promise.all(selected.map(async (file): Promise<{ file?: UploadedFile; error?: string }> => {
      if (file.size > 100 * 1024 * 1024) return { error: `${file.name}：文件过大（单个不能超过 100MB）` };
      try {
        const result = await uploadFile('/api/upload-reference', file);
        return { file: result.file };
      } catch (error) {
        return { error: `${file.name}：${error instanceof Error ? error.message : '上传失败'}` };
      }
    }));
    let okCount = 0; let pendingCount = 0; const errors: string[] = [];
    for (const { file, error } of results) {
      if (error || !file) { errors.push(error!); continue; }
      setter(prev => [...prev, file].slice(-limit));
      okCount++;
      if (file.parseStatus === 'pending') { pendingCount++; void analyzeReference(file, style); }
    }
    const parts: string[] = [];
    if (okCount) parts.push(`已上传 ${okCount} 个文件${pendingCount ? '，正在分析正文…' : ''}`);
    if (errors.length) parts.push(errors.join('；'));
    setNotice(parts.join(' ') || '上传失败');
    setUploading(false);
    if (styleInput.current) styleInput.current.value = '';
    if (referenceInput.current) referenceInput.current.value = '';
  };
  const handleLogo = async (file: File | undefined) => { if (!file) return; setNotice(''); setUploading(true); try { const result = await uploadFile('/api/upload-logo', file); setLogo({ url: result.url, name: file.name }); } catch (error) { setNotice(error instanceof Error ? error.message : 'Logo 上传失败'); } finally { setUploading(false); if (logoInput.current) logoInput.current.value = ''; } };
  const optimize = async () => { if (!topic.trim() || optimizing || uploading) return; if (pendingReferences.length) { setNotice('参考资料正在分析正文，请稍候再优化'); return; } if (unreadReferences.length) { setNotice('参考资料正文未读取，请移除或重新上传后优化'); return; } setOptimizing(true); setNotice(''); try { const response = await fetch('/api/ppt/optimize-prompt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ prompt: topic, referencesText: referenceContext(references) }) }); const result = await response.json().catch(() => null); if (!response.ok || !result?.success) throw new Error(result?.error || '优化失败'); setTopic(String(result.prompt || result.optimizedPrompt || topic)); } catch (error) { setNotice(error instanceof Error ? error.message : '优化失败'); } finally { setOptimizing(false); } };
  const generate = async () => { if (!canGenerate) { setNotice(pendingReferences.length ? '参考资料正在分析正文，请稍候再生成' : unreadReferences.length ? '参考资料正文未读取，请移除或重新上传后生成' : insufficient ? `点数不足：本次需要 ${total} 点，当前 ${credits} 点` : '请输入主题，并选择 1–100 页'); return; } setNotice(''); try { const response = await fetch('/api/presentations/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ topic: topic.trim(), slideCount: pages, resolution, referenceContext: referenceContext(references), referenceFiles: [...[...templateReferences, ...styleReferences].map(file => ({ ...file, type: file.type || 'image/png', name: `视觉风格参考：${file.name}` })), ...references], logo: logo ? { url: logo.url, enabled: true, position: 'bottom-right', opacity: 0.8, size: 'sm' } : undefined }) }); const result = await response.json().catch(() => null); if (!response.ok) { if (result?.error !== '用户取消生成') setNotice(result?.error || '提交失败'); return; } if (!result?.queued) setNotice(result?.message || '任务已提交'); } catch (error) { setNotice(error instanceof Error ? error.message : '提交失败'); } };
  return <div className="celano-ppt-app"><Nav active="ppt" /><main className="celano-ppt-main celano-feature-main"><CreationHeading eyebrow="PPT CREATION" title="从主题开始，生成一份完整的演示。" description="16:9 原生画面，页数与画质由你选择。排版、配图与视觉风格交给模型原生构建。" />
    <section className="celano-compose-card celano-composer-card"><textarea className="celano-composer-input" value={topic} onChange={event => { setTopic(event.target.value); setNotice(''); }} placeholder="描述你想制作的演示文稿，例如：为品牌团队制作一份年度招商方案……" rows={5} aria-label="PPT 主题" /><div className="celano-compose-toolbar celano-composer-toolbar"><label className="celano-select-pill celano-composer-control"><Layers3 size={16} /><span>页数</span><input className="celano-page-count" type="number" min={1} max={100} step={1} aria-label="PPT 页数（1–100 页）" title="自定义 1–100 页" value={pageInput} onChange={event => setPageInput(event.target.value)} onBlur={() => setPageInput(String(Math.min(100, Math.max(1, Math.floor(Number(pageInput) || 1)))))} /><span>页</span></label><label className="celano-select-pill celano-composer-control"><span className="celano-resolution-icon">▣</span><span>画质</span><Select bare value={resolution} ariaLabel="画质" onChange={v => setResolution(v as Resolution)} options={[{ label: '2K', value: '2K' }, { label: '4K', value: '4K' }]} /></label><button className="celano-tool-pill celano-composer-control" onClick={() => go('/templates')}>模版库</button><button className="celano-tool-pill celano-composer-control" onClick={() => styleInput.current?.click()}><Sparkles size={16} /> 风格参考</button><button className="celano-tool-pill celano-composer-control" onClick={() => logoInput.current?.click()}><ImageIcon size={16} /> Logo 上传</button><input ref={referenceInput} hidden type="file" multiple accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.md,.markdown,.csv,.json,.png,.jpg,.jpeg,.webp" onChange={event => handleReferences(event.target.files)} /><input ref={styleInput} hidden type="file" multiple accept="image/png,image/jpeg,image/webp" onChange={event => handleReferences(event.target.files, true)} /><input ref={logoInput} hidden type="file" accept="image/png,image/jpeg,image/webp, image/svg+xml" onChange={event => handleLogo(event.target.files?.[0])} /><button className="celano-optimize-button celano-composer-control" onClick={optimize} disabled={!topic.trim() || optimizing}>{optimizing ? <LoaderCircle size={16} className="celano-spin" /> : <WandSparkles size={16} />} {optimizing ? '优化中' : '优化'}</button><button className="celano-generate-button celano-composer-primary" onClick={generate} disabled={!canGenerate}><Sparkles size={17} /> 生成{total > 0 ? ` · ${total} 点` : ''}</button></div><div className="celano-cost-line"><span>本次预计消耗 <strong className="celano-num">{total} 点</strong></span><span>{pages} 页 × {costs[resolution]} 点/页 · {resolution}</span>{remaining === null ? null : insufficient ? <span className="celano-cost-warn">点数不足：当前 {credits} 点，还差 {total - (credits || 0)} 点<button type="button" className="celano-cost-recharge" onClick={() => go('/membership')}>去充值</button></span> : <span>生成后余额 <strong className="celano-num">{remaining} 点</strong></span>}</div>{(references.length || templateReferences.length || styleReferences.length || logo) ? <div className="celano-file-list">{templateReferences.length ? <div className="celano-file-chip"><img src={templateReferences[0].url} alt="" /><span>{templateReferences[0].name.replace(/ \d+$/, '')} · 深度参考 · {templateReferences.length} 张</span><button onClick={() => setTemplateReferences([])} aria-label="移除模版系列"><X size={13} /></button></div> : null}{references.map(file => <FileChip key={file.id} file={file} onRemove={() => setReferences(items => items.filter(item => item.id !== file.id))} />)}{styleReferences.map(file => <FileChip key={`style-${file.id}`} file={file} onRemove={() => setStyleReferences(items => items.filter(item => item.id !== file.id))} />)}{logo ? <div className="celano-file-chip"><img src={logo.url} alt="" /><span title={logo.name}>{logo.name}</span><button onClick={() => setLogo(null)} aria-label="删除 Logo"><X size={13} /></button></div> : null}</div> : null}<div className="celano-compose-footer"><button className="celano-add-reference" onClick={() => referenceInput.current?.click()}><Plus size={17} /> 添加参考资料</button><span>{uploading ? '上传中，请稍候…' : pendingReferences.length ? '正在分析参考资料…' : optimizing ? (references.length ? '正在分析参考资料并优化主题…' : '正在优化主题…') : '最多 6 个参考资料、3 张风格参考图'}</span></div></section>{notice ? <div className="celano-ppt-notice" role="status">{notice}</div> : null}<p className="celano-ppt-tip"><Check size={14} /> 生成完成后会自动保存到当前账号的作品库，并进入 PPT 工作台继续编辑。</p></main></div>;
};
