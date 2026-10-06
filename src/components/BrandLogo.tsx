import React from 'react';

/**
 * 品牌视觉资产：完整 logo lockup（金属「A」图形 + 「CELANO」字标一体）。
 *
 * 素材 public/brand/logo-official.png 为官方原图（1672×941）等比缩小 75% 的版本，
 * 未做裁剪或任何图形改动；原图四周为透明留白，图形主体位于 (287,410)-(1447,544)。
 * 组件通过 background-position 仅对图形区域取景，保证各页面版式紧凑。
 *
 * favicon 等方形图标场景使用图形标单独版本（见 public/favicon.svg 等）。
 */

// 官方原图画布与图形主体区域（原图像素坐标）
const CANVAS = { w: 1672, h: 941 };
const ART = { x: 287, y: 410, w: 1160, h: 134 };

export const BrandLogo: React.FC<{ height?: number; className?: string; style?: React.CSSProperties }> = ({ height = 20, className, style }) => (
  <span
    className={className ? `brand-logo-mark ${className}` : 'brand-logo-mark'}
    role="img"
    aria-label="CELANO"
    style={{
      display: 'block',
      flexShrink: 0,
      // 尺寸与取景全部由 --blh（显示高度）推导；移动端可由 CSS 覆盖 --blh（需 !important）
      width: `calc(var(--blh) * ${(ART.w / ART.h).toFixed(5)})`,
      height: 'var(--blh)',
      backgroundImage: 'url(/brand/logo-official.png)',
      backgroundRepeat: 'no-repeat',
      backgroundSize: `calc(var(--blh) * ${(CANVAS.w / ART.h).toFixed(5)}) calc(var(--blh) * ${(CANVAS.h / ART.h).toFixed(5)})`,
      backgroundPosition: `calc(var(--blh) * ${(-ART.x / ART.h).toFixed(5)}) calc(var(--blh) * ${(-ART.y / ART.h).toFixed(5)})`,
      ['--blh' as string]: `${height}px`,
      ...style,
    } as React.CSSProperties}
  />
);
