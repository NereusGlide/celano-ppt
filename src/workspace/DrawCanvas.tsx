import React, { useEffect, useRef } from 'react';
import { renderAnnotations, Annotation, DrawTool, Point, DEFAULT_MARK_WIDTH } from './draw.js';

interface DrawCanvasProps {
  annotations: Annotation[];
  tool: DrawTool;
  markWidth: number;
  onCommit: (annotation: Omit<ScribbleDraft, 'number' | 'instruction'> | Omit<BoxDraft, 'number' | 'instruction'>) => void;
}

type ScribbleDraft = { kind: 'scribble'; points: Point[]; width: number; number: number; instruction: string };
type BoxDraft = { kind: 'box'; x: number; y: number; w: number; h: number; number: number; instruction: string };

/** 页面标注画布：涂抹（自定义笔刷粗细）与框选；编号由父级在提交时分配。 */
export const DrawCanvas: React.FC<DrawCanvasProps> = ({ annotations, tool, markWidth, onCommit }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const listRef = useRef<Annotation[]>(annotations);
  listRef.current = annotations;
  const currentRef = useRef<Annotation | null>(null);
  const boxStartRef = useRef<Point | null>(null);

  const repaint = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const list = currentRef.current ? [...listRef.current, currentRef.current] : listRef.current;
    renderAnnotations(ctx, list, rect.width, rect.height);
  };

  useEffect(() => {
    repaint();
    const observer = new ResizeObserver(() => repaint());
    if (canvasRef.current) observer.observe(canvasRef.current);
    return () => observer.disconnect();
  }, [annotations]);

  const posOf = (e: React.PointerEvent): Point => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height))
    };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (tool === 'pan') return;
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    try { (e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId); } catch { /* 合成事件 */ }
    const p = posOf(e);
    if (tool === 'box') {
      boxStartRef.current = p;
      currentRef.current = { kind: 'box', x: p.x, y: p.y, w: 0, h: 0, number: 0, instruction: '' };
    } else {
      currentRef.current = { kind: 'scribble', points: [p], width: markWidth || DEFAULT_MARK_WIDTH, number: 0, instruction: '' };
    }
    repaint();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = posOf(e);
    if (tool === 'box') {
      const start = boxStartRef.current;
      if (!start) return;
      currentRef.current = {
        kind: 'box',
        x: Math.min(start.x, p.x),
        y: Math.min(start.y, p.y),
        w: Math.abs(p.x - start.x),
        h: Math.abs(p.y - start.y),
        number: 0,
        instruction: ''
      };
      repaint();
      return;
    }
    if (!currentRef.current) return;
    (currentRef.current as ScribbleDraft).points.push(p);
    repaint();
  };

  const onPointerUp = () => {
    const current = currentRef.current;
    currentRef.current = null;
    boxStartRef.current = null;
    if (!current) return;
    if (current.kind === 'box') {
      if (current.w < 0.008 || current.h < 0.008) { repaint(); return; }
      onCommit({ kind: 'box', x: current.x, y: current.y, w: current.w, h: current.h });
    } else {
      if (current.points.length === 1) {
        const p = current.points[0];
        current.points.push({ x: Math.min(1, p.x + 0.001), y: p.y });
      }
      onCommit({ kind: 'scribble', points: current.points, width: current.width });
    }
    repaint();
  };

  return (
    <canvas
      ref={canvasRef}
      className="ws-draw-canvas"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      style={{
        position: 'absolute', inset: 0, width: '100%', height: '100%',
        touchAction: 'none', zIndex: 10,
        cursor: tool === 'pan' ? 'grab' : 'crosshair'
      }}
    />
  );
};
