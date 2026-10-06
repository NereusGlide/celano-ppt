import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, ChevronLeft, ChevronRight, Download, Maximize2, X } from 'lucide-react';
import { detailedTutorials, type TutorialAsset } from './detailedTutorials.js';
import '../styles/tutorials.css';

const tutorials: TutorialAsset[] = [
  { id: 'ppt', title: 'PPT 生成', description: '从主题规划到整套文稿', route: '/ppt', keywords: '页数 画质 消耗 积分 点数 规划 提示词 工作台',
    steps: [{ title: '输入主题', text: '说明主题、受众和用途，按需补充参考资料。' }, { title: '选择页数与画质', text: '填写 1–100 页，选择 2K 或 4K，查看总消耗。' }, { title: '确认消耗', text: '核对确认框，确认后提交后台生成任务。' }, { title: '工作台查看', text: '查看缩略图与进度，完成后可修改、演示和下载 PPTX。' }] },
  { id: 'image', title: '文生图创作', description: '一张图片的完整创作流程', route: '/image', keywords: '图片 海报 比例 画质 下载 保存 结果',
    steps: [{ title: '描述画面', text: '写明画面主题、用途和需要准确呈现的文字。' }, { title: '选择画质与比例', text: '选择 2K / 4K 和画面比例，按需上传参考图。' }, { title: '确认生成', text: '核对点数后提交，进入独立的图片作品页。' }, { title: '预览与保存', text: '等待生成并保存，可下载或放入画布继续编辑。' }] },
  { id: 'canvas', title: '画布局部修改', description: '标记区域，保留原图结构', route: '/canvas', keywords: '智能画布 涂抹 框选 蒙版 修改 删除 区域',
    steps: [{ title: '选中原图', text: '在画布中选中图片，打开涂抹编辑工具。' }, { title: '标记修改区域', text: '使用涂抹或框选标记需要改动的位置。' }, { title: '写清修改要求', text: '说明改动，并确认本次修改的点数消耗。' }, { title: '检查修改结果', text: '核对局部变化，未标记部分要求保持原样；结果不应保留蓝色标记。' }] },
  { id: 'reference', title: '参考资料与视觉风格', description: '内容依据、风格系列与品牌标识', route: '/ppt', keywords: '附件 文件 上传 PDF DOCX PPTX XLSX Word Excel 模版 模板 Logo 品牌',
    steps: [{ title: '上传参考资料', text: '正文支持 PDF、DOCX、PPTX、XLSX 和文本，单文件最多 8MB。' }, { title: '选择风格系列', text: '选择模版系列，或上传最多 3 张风格参考图。' }, { title: '添加品牌 Logo', text: '上传清晰的品牌图形，检查素材卡片与文件状态。' }, { title: '结合主题生成', text: '内容资料参与规划，风格图与 Logo 提供视觉参考。' }] },
  { id: 'works', title: '作品保存与管理', description: '个人中心统一查看和管理', route: '/account', keywords: '作品库 个人中心 账号 资产 素材 同步 下载 删除 编辑',
    steps: [{ title: '生成完成', text: '等待任务完成并保存，确认提交时登录的账号。' }, { title: '进入个人中心', text: '打开顶部“个人中心”，查看账号作品与素材。' }, { title: '查看与继续编辑', text: 'PPT 在“我的作品”，图片与文本在“画布素材”。' }, { title: '下载或删除', text: '保存需要的内容再删除，相关作品列表同步更新。' }] },
];
type Tutorial = TutorialAsset;
const allTutorials = tutorials.flatMap(tutorial => [tutorial, ...(detailedTutorials[tutorial.id] || [])]);

function TutorialPreview({ tutorial, index, onClose, onSelect }: { tutorial: Tutorial; index: number; onClose: () => void; onSelect: (index: number) => void }) {
  const id = useId();
  const dialog = useRef<HTMLElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => { if (body.current) body.current.scrollTop = 0; }, [index]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    close.current?.focus();
    return () => { document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  return createPortal(<div className="tutorial-overlay" onClick={onClose}><section ref={dialog} role="dialog" aria-modal="true" aria-labelledby={id} className="tutorial-preview" onClick={event => event.stopPropagation()} onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); onClose(); }
    if (event.key === 'ArrowLeft') { event.preventDefault(); onSelect((index + allTutorials.length - 1) % allTutorials.length); }
    if (event.key === 'ArrowRight') { event.preventDefault(); onSelect((index + 1) % allTutorials.length); }
    if (event.key === 'Tab') {
      const nodes = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button,a[href]') || []);
      if (document.activeElement === (event.shiftKey ? nodes[0] : nodes.at(-1))) { event.preventDefault(); (event.shiftKey ? nodes.at(-1) : nodes[0])?.focus(); }
    }
  }}>
    <header><div><span className="tutorial-eyebrow">{String(index + 1).padStart(2, '0')} / {String(allTutorials.length).padStart(2, '0')} · 图文教程</span><h2 id={id}>{tutorial.title}</h2></div><button ref={close} className="tutorial-icon" aria-label="关闭教程" onClick={onClose}><X size={20} /></button></header>
    <div className="tutorial-preview-body" ref={body}><img className="tutorial-full-image" src={'/tutorials/' + tutorial.id + '.png'} alt={tutorial.title + '操作示意：' + tutorial.steps.map(step => step.title).join('、')} /><ol className={"tutorial-steps" + (tutorial.steps.length === 3 ? " tutorial-steps-three" : "")}>{tutorial.steps.map((step, stepIndex) => <li key={step.title}><span>{String(stepIndex + 1).padStart(2, '0')}</span><div><h3>{step.title}</h3><p>{step.text}</p></div></li>)}</ol>{tutorial.note ? <p className="tutorial-preview-note">{tutorial.note}</p> : null}</div>
    <footer><div className="tutorial-paging"><button className="tutorial-icon" aria-label="上一篇教程" onClick={() => onSelect((index + allTutorials.length - 1) % allTutorials.length)}><ChevronLeft size={18} /></button><button className="tutorial-icon" aria-label="下一篇教程" onClick={() => onSelect((index + 1) % allTutorials.length)}><ChevronRight size={18} /></button></div><a className="tutorial-action" href={'/tutorials/' + tutorial.id + '.png'} download={'CELANO-' + tutorial.title + '.png'}><Download size={15} /> 下载教程图</a><button className="tutorial-action tutorial-start" onClick={() => { onClose(); window.location.hash = tutorial.route; }}>开始操作<ArrowRight size={15} /></button></footer>
  </section></div>, document.body);
}

function matches(tutorial: Tutorial, query: string) {
  return !query || [tutorial.title, tutorial.description, tutorial.keywords, tutorial.note || '', ...tutorial.steps.map(step => step.title + step.text)].join(' ').toLocaleLowerCase().includes(query);
}

export function countMatchingTutorials(id: string, query: string) {
  const tutorial = tutorials.find(item => item.id === id);
  return tutorial ? [tutorial, ...(detailedTutorials[id] || [])].filter(item => matches(item, query)).length : 0;
}

export function tutorialMatches(id: string, query: string) {
  return countMatchingTutorials(id, query) > 0;
}

export function TutorialGuide({ id, query = '' }: { id: string; query?: string }) {
  const [selected, setSelected] = useState<number | null>(null);
  const tutorial = tutorials.find(item => item.id === id);
  if (!tutorial) return null;
  const details = (detailedTutorials[id] || []).filter(item => matches(item, query));
  return <>
    {matches(tutorial, query) ? <div className="tutorial-guide">
      <button className="tutorial-poster" onClick={() => setSelected(allTutorials.indexOf(tutorial))} aria-label={'查看教程：' + tutorial.title}>
        <img src={'/tutorials/' + tutorial.id + '.png'} loading="lazy" decoding="async" alt={tutorial.title + '四步操作示意'} />
        <span><Maximize2 size={14} /> 放大图文教程</span>
      </button>
      <div className="tutorial-guide-copy"><p className="tutorial-eyebrow">四步完成 · {tutorial.title}</p><ol className="tutorial-guide-steps">{tutorial.steps.map((step, stepIndex) => <li key={step.title}><span>{String(stepIndex + 1).padStart(2, '0')}</span><div><h3>{step.title}</h3><p>{step.text}</p></div></li>)}</ol></div>
    </div> : null}
    {details.length ? <div className="tutorial-detail-section">
      <div className="tutorial-detail-heading"><div><h3>把操作看得更清楚</h3><p>按图操作，再核对每一步的细节。</p></div><span>{details.length} 张详解图</span></div>
      <div className="tutorial-detail-grid">{details.map(detail => <article className="tutorial-detail-card" key={detail.id}>
        <button className="tutorial-poster" onClick={() => setSelected(allTutorials.indexOf(detail))} aria-label={'查看教程：' + detail.title}><img src={'/tutorials/' + detail.id + '.png'} loading="lazy" decoding="async" alt={detail.title + '操作示意：' + detail.steps.map(step => step.title).join('、')} /><span><Maximize2 size={14} /> 查看大图</span></button>
        <div className="tutorial-detail-copy"><h4>{detail.title}</h4><p className="tutorial-detail-description">{detail.description}</p><ol>{detail.steps.map((step, stepIndex) => <li key={step.title}><span className="tutorial-detail-number" aria-hidden="true">{stepIndex + 1}</span><h5>{step.title}</h5><p>{step.text}</p></li>)}</ol>{detail.note ? <p className="tutorial-detail-note">{detail.note}</p> : null}</div>
      </article>)}</div>
    </div> : null}
    {selected !== null ? <TutorialPreview tutorial={allTutorials[selected]} index={selected} onClose={() => setSelected(null)} onSelect={setSelected} /> : null}
  </>;
}
