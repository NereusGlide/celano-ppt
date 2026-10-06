/** 页面标注模型：涂抹（自由圈记，可调笔刷粗细）与框选（矩形选区）。
 *  每处标注自动编号 1、2、3…，并携带各自的修改指令，作为图生图编辑的语义输入。 */

export type DrawTool = 'mark' | 'box' | 'pan';

export interface Point { x: number; y: number }

export interface ScribbleMark {
  kind: 'scribble';
  points: Point[];
  /** 笔刷粗细（参考 960px 基准） */
  width: number;
  /** 标注序号（1 起） */
  number: number;
  /** 该处的修改指令 */
  instruction: string;
}

export interface BoxMark {
  kind: 'box';
  x: number; y: number; w: number; h: number;
  number: number;
  instruction: string;
}

export type Annotation = ScribbleMark | BoxMark;

export const TOOL_META: Record<DrawTool, { label: string }> = {
  mark: { label: '涂抹' },
  box: { label: '框选' },
  pan: { label: '抓手' }
};

export const DEFAULT_MARK_WIDTH = 6;
export const MARK_WIDTH_MIN = 1;
export const MARK_WIDTH_MAX = 24;

/** 标记统一为醒目的珊瑚红色 */
const MARK_COLOR = '#E8836F';

export function renderAnnotations(ctx: CanvasRenderingContext2D, list: Annotation[], w: number, h: number) {
  ctx.clearRect(0, 0, w, h);
  const scale = w / 960;
  for (const a of list) {
    ctx.save();
    if (a.kind === 'scribble') {
      if (!a.points.length) { ctx.restore(); continue; }
      ctx.strokeStyle = MARK_COLOR;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = Math.max(0.5, (a.width || DEFAULT_MARK_WIDTH) * scale);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(a.points[0].x * w, a.points[0].y * h);
      for (let i = 1; i < a.points.length; i++) ctx.lineTo(a.points[i].x * w, a.points[i].y * h);
      ctx.stroke();
      if (a.number > 0) drawNumberBadge(ctx, a.number, a.points[0].x * w, a.points[0].y * h, scale);
    } else {
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(248,113,113,0.12)';
      ctx.strokeStyle = MARK_COLOR;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      const x = a.x * w, y = a.y * h, bw = a.w * w, bh = a.h * h;
      ctx.fillRect(x, y, bw, bh);
      ctx.strokeRect(x, y, bw, bh);
      if (a.number > 0) drawNumberBadge(ctx, a.number, x, y, scale);
    }
    ctx.restore();
  }
}

function drawNumberBadge(ctx: CanvasRenderingContext2D, number: number, x: number, y: number, scale: number) {
  const r = 9 * scale;
  ctx.save();
  ctx.fillStyle = MARK_COLOR;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold ' + Math.round(11 * scale) + 'px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(number), x, y + 0.5);
  ctx.restore();
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('页面图片加载失败'));
    img.src = src;
  });
}

/**
 * 构造局部编辑输入：原图保持干净，mask 的透明区域才允许模型修改。
 * OpenAI 兼容的 images/edits 约定透明区域为可编辑区域，不透明区域必须保留。
 */
export async function composeEditInput(src: string, annotations: Annotation[], w?: number, h?: number): Promise<{ image: string; mask?: string }> {
  const img = await loadImage(src);
  w = w ?? img.naturalWidth;
  h = h ?? img.naturalHeight;
  if (w !== img.naturalWidth || h !== img.naturalHeight) throw new Error('编辑输入必须保留原图像素尺寸');
  const imageCanvas = document.createElement('canvas');
  imageCanvas.width = w;
  imageCanvas.height = h;
  const imageCtx = imageCanvas.getContext('2d');
  if (!imageCtx) throw new Error('无法创建图像画布');
  imageCtx.drawImage(img, 0, 0, w, h);

  // 没有标注时不生成 mask；工作台交互层会要求先选择区域。
  if (!annotations.length) return { image: imageCanvas.toDataURL('image/png') };

  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = w;
  maskCanvas.height = h;
  const maskCtx = maskCanvas.getContext('2d');
  if (!maskCtx) throw new Error('无法创建局部编辑遮罩');
  // 白色不透明区域保留原图；透明区域交给模型重绘。
  maskCtx.fillStyle = '#fff';
  maskCtx.fillRect(0, 0, w, h);
  maskCtx.globalCompositeOperation = 'destination-out';
  for (const a of annotations) {
    if (a.kind === 'box') {
      maskCtx.fillRect(a.x * w, a.y * h, a.w * w, a.h * h);
      continue;
    }
    if (!a.points.length) continue;
    maskCtx.strokeStyle = '#000';
    maskCtx.lineWidth = Math.max(2, (a.width || DEFAULT_MARK_WIDTH) * (w / 960));
    maskCtx.lineCap = 'round';
    maskCtx.lineJoin = 'round';
    maskCtx.beginPath();
    maskCtx.moveTo(a.points[0].x * w, a.points[0].y * h);
    for (let i = 1; i < a.points.length; i++) maskCtx.lineTo(a.points[i].x * w, a.points[i].y * h);
    maskCtx.stroke();
  }
  return { image: imageCanvas.toDataURL('image/png'), mask: maskCanvas.toDataURL('image/png') };
}

/** 兼容旧调用：返回带标注预览图，仅用于需要展示标注时的场景。 */
export async function composeMarkedImage(src: string, annotations: Annotation[], w?: number, h?: number): Promise<string> {
  const img = await loadImage(src);
  w = w ?? img.naturalWidth;
  h = h ?? img.naturalHeight;
  if (w !== img.naturalWidth || h !== img.naturalHeight) throw new Error('编辑输入必须保留原图像素尺寸');
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建合成画布');
  ctx.drawImage(img, 0, 0, w, h);
  renderAnnotations(ctx, annotations, w, h);
  return canvas.toDataURL('image/png');
}

/** 把标注列表拼装成语义化修改指令（发送给大模型） */
export function buildEditPrompt(annotations: Annotation[], globalInstruction: string): string {
  const lines: string[] = [];
  lines.push('这是局部图像编辑任务：只允许修改 mask 透明区域，mask 不透明区域必须保持原图内容、位置、尺寸、字体、颜色、光影和布局不变。禁止重绘、重排或顺带优化未选中的区域。');
  const g = globalInstruction.trim();
  if (g) lines.push(annotations.length ? '对所有已标记区域共同适用的修改要求：' + g : '对整页的修改要求：' + g);
  if (annotations.length) {
    lines.push('针对 mask 透明区域的逐处修改要求（编号仅作语义辅助）：');
    for (const a of annotations) {
      const inst = a.instruction.trim() || '该区域保持原样';
      const bounds = a.kind === 'box'
        ? `x=${Math.round(a.x * 100)}%, y=${Math.round(a.y * 100)}%, w=${Math.round(a.w * 100)}%, h=${Math.round(a.h * 100)}%`
        : (() => {
          const points = a.points.length ? a.points : [{ x: 0, y: 0 }];
          const xs = points.map(p => p.x), ys = points.map(p => p.y);
          return `约 x=${Math.round(Math.min(...xs) * 100)}%-${Math.round(Math.max(...xs) * 100)}%, y=${Math.round(Math.min(...ys) * 100)}%-${Math.round(Math.max(...ys) * 100)}%`;
        })();
      lines.push(`${a.number}号区域（${a.kind === 'scribble' ? '涂抹' : '框选'}，${bounds}）：${inst}`);
    }
  }
  return lines.join('\n');
}
