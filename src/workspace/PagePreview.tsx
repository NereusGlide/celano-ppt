import React, { useEffect, useRef } from 'react';
import { renderAnnotations, Annotation } from './draw.js';

/** 侧栏缩略图：只读渲染该页的涂抹/框选标记 */
export const PagePreview: React.FC<{ annotations: Annotation[] }> = ({ annotations }) => {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const w = 160, h = 90;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    renderAnnotations(ctx, annotations, w, h);
  }, [annotations]);

  return <canvas ref={ref} style={{ width: '100%', height: '100%', display: 'block' }} />;
};
