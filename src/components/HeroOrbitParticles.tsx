import { useEffect, useRef } from 'react';

/**
 * 主页标题「有表现力的作品」后方的圆形粒子轨道装饰。
 * 粒子沿同心圆轨道漂浮、中心带柔和光晕，颜色沿用品牌强调蓝紫，
 * 遵循系统「减少动态效果」偏好（此时粒子静止）。
 */
export function HeroOrbitParticles() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const size = 116;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);

    const cx = size / 2;
    const cy = size / 2;
    const trackR = size / 2 - 7;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    const particles = Array.from({ length: 44 }, (_, i) => {
      const angle = (i / 44) * Math.PI * 2 + Math.random() * 0.5;
      const radius = trackR * (0.6 + Math.random() * 0.38);
      const speed = (0.35 + Math.random() * 0.75) * (Math.random() < 0.5 ? 1 : -1);
      const r = 1 + Math.random() * 1.7;
      const alpha = 0.42 + Math.random() * 0.5;
      const hue = 214 + Math.random() * 18;
      return { angle, radius, speed, r, alpha, hue };
    });

    let raf = 0;
    let t = 0;
    let last = performance.now();

    const render = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      if (!reduced) t += dt;
      ctx.clearRect(0, 0, size, size);

      // 中心柔和光晕
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, size / 2);
      glow.addColorStop(0, 'rgba(122,162,247,0.22)');
      glow.addColorStop(0.55, 'rgba(122,162,247,0.06)');
      glow.addColorStop(1, 'rgba(122,162,247,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
      ctx.fill();

      // 最外圈细轨迹
      ctx.strokeStyle = 'rgba(150,180,220,0.12)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, trackR, 0, Math.PI * 2);
      ctx.stroke();

      // 粒子
      for (const p of particles) {
        if (!reduced) p.angle += p.speed * 0.35 * dt;
        const x = cx + Math.cos(p.angle) * p.radius;
        const y = cy + Math.sin(p.angle) * p.radius;
        const twinkle = 0.55 + 0.45 * Math.sin(t * 2.4 + p.angle * 6);
        ctx.fillStyle = `hsla(${p.hue}, 82%, 74%, ${p.alpha * twinkle})`;
        ctx.beginPath();
        ctx.arc(x, y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={ref} className="celano-hero-orbit" aria-hidden="true" />;
}
