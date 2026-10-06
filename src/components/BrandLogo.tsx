import React from 'react';

/**
 * 品牌视觉资产（与 favicon / 应用图标同源）：
 * BrandLogo：完整 logo lockup（金属「A」图形 + 「CELANO」字标一体）。
 * 素材 public/brand/logo-full.png 为透明底 PNG，直接置于深色场上方；
 * favicon 等方形图标场景使用图形标单独版本。
 */

const LOCKUP_RATIO = 588 / 144;

export const BrandLogo: React.FC<{ height?: number; className?: string; style?: React.CSSProperties }> = ({ height = 20, className, style }) => (
  <img
    src="/brand/logo-full.png"
    alt="CELANO"
    width={Math.round(height * LOCKUP_RATIO)}
    height={height}
    className={className}
    style={{ display: 'block', flexShrink: 0, ...style }}
    draggable={false}
  />
);
