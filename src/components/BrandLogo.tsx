import React from 'react';

/**
 * 品牌视觉资产（与 favicon / 应用图标同源）：
 * - BrandLogo：金属「A」图形标（public/brand/logo-mark.png）
 * - BrandWordmark：金属「CELANO」字标（public/brand/logo-wordmark.png）
 * 素材为透明底 PNG，直接置于深色场上方。
 */

const MARK_RATIO = 295 / 256;
const WORDMARK_RATIO = 704 / 96;

export const BrandLogo: React.FC<{ height?: number; className?: string; style?: React.CSSProperties }> = ({ height = 20, className, style }) => (
  <img
    src="/brand/logo-mark.png"
    alt=""
    width={Math.round(height * MARK_RATIO)}
    height={height}
    className={className}
    style={{ display: 'block', flexShrink: 0, ...style }}
    draggable={false}
  />
);

export const BrandWordmark: React.FC<{ height?: number; className?: string; style?: React.CSSProperties }> = ({ height = 14, className, style }) => (
  <img
    src="/brand/logo-wordmark.png"
    alt="CELANO"
    width={Math.round(height * WORDMARK_RATIO)}
    height={height}
    className={className}
    style={{ display: 'block', flexShrink: 0, ...style }}
    draggable={false}
  />
);
