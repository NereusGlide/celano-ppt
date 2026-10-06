import React from 'react';

/**
 * 品牌 Logo：C 字母 + 品牌色圆点，与网站 favicon 同源。
 * 描边跟随 currentColor（融入各页面容器文字色），圆点固定用品牌点缀色。
 */
export const BrandLogo: React.FC<{ size?: number; className?: string }> = ({ size = 18, className }) => (
  <svg viewBox="0 0 64 64" width={size} height={size} className={className} role="img" aria-label="CELANO">
    <path
      d="M41.5 25.2c-1.9-2.6-4.8-4.1-8.3-4.1-6.4 0-10.9 4.5-10.9 10.9s4.5 10.9 10.9 10.9c3.5 0 6.4-1.5 8.3-4.1"
      fill="none"
      stroke="currentColor"
      strokeWidth="5.5"
      strokeLinecap="round"
    />
    <circle cx="46" cy="46" r="4.5" fill="var(--accent, #7AA2F7)" />
  </svg>
);
