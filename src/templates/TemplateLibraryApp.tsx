import React, { useEffect, useState } from 'react';
import { ArrowRight, X } from 'lucide-react';
import { PrimaryNav } from '../components/PrimaryNav.js';
import { pptStyleTemplates, pptTemplateSeries, TEMPLATE_SELECTION_KEY } from './catalog.js';
import '../styles/templates.css';

export const TemplateLibraryApp: React.FC = () => {
  const [preview, setPreview] = useState<string | null>(null);
  const previewSeries = pptTemplateSeries.find(item => item.id === preview);
  const previewImages = pptStyleTemplates.filter(item => item.seriesId === preview);
  useEffect(() => {
    if (!preview) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setPreview(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [preview]);
  const useSeries = (id: string) => {
    sessionStorage.setItem(TEMPLATE_SELECTION_KEY, id);
    window.location.hash = '/ppt';
  };
  return <div className="celano-home-app"><PrimaryNav active="templates" />
    <main className="template-main celano-feature-main">
      <p className="celano-eyebrow">PPT STYLE LIBRARY</p><h1>模版库</h1>
      <p className="template-intro">每个系列是一套完整模版。选择后，按原始模版深度参考版式、字体、配色与图像风格，内容替换为你的主题。</p>
      <div className="template-series"><strong>全部系列</strong><span>{pptTemplateSeries.length} 套模版</span></div>
      <section className="template-grid" aria-label="PPT 模版系列">
        {pptTemplateSeries.map(series => <article className="template-card" key={series.id}>
          <button className="template-preview" onClick={() => setPreview(series.id)} aria-label={`预览${series.name}整套模版`}><img src={`/templates/${series.id}/01.jpg`} alt={series.name} loading="lazy" /></button>
          <div className="template-card-info"><div><h2>{series.name}</h2><p>完整系列 · {series.count} 张风格参考</p></div><button onClick={() => useSeries(series.id)}>使用此系列 <ArrowRight size={14} /></button></div>
        </article>)}
      </section>
    </main>
    {previewSeries ? <div className="template-overlay" onClick={() => setPreview(null)}><div className="template-dialog template-series-dialog" role="dialog" aria-modal="true" aria-label={`${previewSeries.name}整套预览`} onClick={event => event.stopPropagation()}>
      <div className="template-dialog-head"><div><h2>{previewSeries.name}</h2><p>整套 {previewSeries.count} 张参考图</p></div><button onClick={() => setPreview(null)} aria-label="关闭预览"><X size={20} /></button></div>
      <div className="template-series-images">{previewImages.map(item => <img key={item.id} src={item.url} alt={item.name} width={640} height={360} loading="lazy" />)}</div>
      <button className="template-use" onClick={() => useSeries(previewSeries.id)}>使用此系列 <ArrowRight size={15} /></button>
    </div></div> : null}
  </div>;
};
