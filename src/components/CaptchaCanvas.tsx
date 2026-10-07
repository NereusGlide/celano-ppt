import React, { useCallback, useEffect, useRef, useState } from 'react';
import { RotateCw } from 'lucide-react';

interface CaptchaCanvasProps {
  onCodeChange: (code: string) => void;
  width?: number;
  height?: number;
  refreshText?: string;
}

/** 字符池剔除易混淆字符（0/O、1/I/l） */
const CHAR_POOL = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

/**
 * 自绘 4 位图形验证码 Canvas。
 * 来自 celano-ai-studio 参考项目；样式改为项目自定义 CSS（cxauth-captcha-*）。
 */
export const CaptchaCanvas: React.FC<CaptchaCanvasProps> = ({
  onCodeChange,
  width = 120,
  height = 42,
  refreshText = '点击刷新',
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isRotating, setIsRotating] = useState(false);
  const rotateTimer = useRef<number | null>(null);

  const generateRandomCode = useCallback((): string => {
    let result = '';
    for (let i = 0; i < 4; i++) {
      result += CHAR_POOL.charAt(Math.floor(Math.random() * CHAR_POOL.length));
    }
    return result;
  }, []);

  const drawCaptcha = useCallback((code: string) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);

    // 深色渐变底，匹配暗色 JiMeng 风格
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, '#1E2330');
    gradient.addColorStop(1, '#111520');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, width - 1, height - 1);

    // 随机噪点
    for (let i = 0; i < 35; i++) {
      ctx.fillStyle = `rgba(${Math.floor(Math.random() * 150 + 100)}, ${Math.floor(
        Math.random() * 150 + 100,
      )}, ${Math.floor(Math.random() * 255)}, 0.25)`;
      ctx.beginPath();
      ctx.arc(Math.random() * width, Math.random() * height, Math.random() * 1.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // 干扰波浪线
    for (let i = 0; i < 3; i++) {
      ctx.strokeStyle = `rgba(${Math.floor(Math.random() * 100 + 120)}, ${Math.floor(
        Math.random() * 120 + 100,
      )}, 255, 0.35)`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(0, Math.random() * height);
      ctx.bezierCurveTo(
        width * 0.25,
        Math.random() * height,
        width * 0.75,
        Math.random() * height,
        width,
        Math.random() * height,
      );
      ctx.stroke();
    }

    // 逐字符渲染：随机角度 / 颜色 / 位置
    const charSpacing = width / 4.6;
    code.split('').forEach((char, index) => {
      ctx.save();
      const x = 16 + index * charSpacing;
      const y = height / 2 + (Math.random() * 6 - 3);
      ctx.translate(x, y);
      ctx.rotate((Math.random() * 36 - 18) * (Math.PI / 180));
      const colors = ['#60A5FA', '#818CF8', '#A78BFA', '#34D399', '#F472B6', '#38BDF8'];
      ctx.fillStyle = colors[Math.floor(Math.random() * colors.length)];
      ctx.font = 'bold 22px "Geist Mono", "JetBrains Mono", monospace';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
      ctx.shadowBlur = 4;
      ctx.fillText(char, 0, 0);
      ctx.restore();
    });
  }, [width, height]);

  const refreshCaptcha = useCallback(() => {
    setIsRotating(true);
    const newCode = generateRandomCode();
    drawCaptcha(newCode);
    onCodeChange(newCode);
    if (rotateTimer.current) window.clearTimeout(rotateTimer.current);
    rotateTimer.current = window.setTimeout(() => setIsRotating(false), 400);
  }, [generateRandomCode, drawCaptcha, onCodeChange]);

  useEffect(() => {
    const initialCode = generateRandomCode();
    drawCaptcha(initialCode);
    onCodeChange(initialCode);
    return () => { if (rotateTimer.current) window.clearTimeout(rotateTimer.current); };
    // 仅挂载时执行一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <span className="cxauth-captcha">
      <button
        type="button"
        className="cxauth-captcha-canvas"
        onClick={refreshCaptcha}
        title={refreshText}
        aria-label={refreshText}
      >
        <canvas ref={canvasRef} width={width} height={height} />
        <span className="cxauth-captcha-veil" aria-hidden="true">
          <RotateCw size={14} />
        </span>
      </button>
      <button
        type="button"
        className="cxauth-captcha-refresh"
        onClick={refreshCaptcha}
        title={refreshText}
        aria-label={refreshText}
      >
        <RotateCw size={14} className={isRotating ? 'cxauth-spin' : undefined} />
      </button>
    </span>
  );
};
