import React from 'react';

interface CelanoLogoProps {
  className?: string;
  variant?: 'white' | 'black' | 'current';
  showSubtitle?: boolean;
}

/**
 * CELANO 字标（SVG 矢量复刻）。
 * 来自 celano-ai-studio 参考项目，样式改为项目自定义 CSS（cxauth-logo-*）。
 */
export const CelanoLogo: React.FC<CelanoLogoProps> = ({
  className = '',
  variant = 'white',
  showSubtitle = false,
}) => {
  const fillColor =
    variant === 'white' ? '#FFFFFF' : variant === 'black' ? '#000000' : 'currentColor';

  return (
    <span className={`cxauth-logo ${className}`.trim()}>
      <svg
        viewBox="0 0 680 140"
        fill={fillColor}
        xmlns="http://www.w3.org/2000/svg"
        aria-label="CELANO Logo"
      >
        <g id="CELANO_WORDMARK">
          {/* C */}
          <path d="M96 22 H44 C22 22 4 40 4 66 V74 C4 100 22 118 44 118 H96 C105 118 112 111 112 102 V96 H88 V98 C88 100 86 102 83 102 H46 C34 102 24 92 24 80 V60 C24 48 34 38 46 38 H83 C86 38 88 40 88 42 V44 H112 V38 C112 29 105 22 96 22 Z" />
          {/* E */}
          <path d="M132 22 H214 C223 22 230 29 230 38 V44 H154 V60 H210 C219 60 225 66 225 74 V76 H154 V96 H214 C223 96 230 103 230 112 V118 H132 C123 118 116 111 116 102 V38 C116 29 123 22 132 22 Z" />
          {/* L */}
          <path d="M250 22 H268 C273 22 276 25 276 30 V96 H324 C331 96 336 101 336 107 V118 H250 C241 118 234 111 234 102 V38 C234 29 241 22 250 22 Z" />
          {/* A */}
          <path d="M374 22 H396 C406 22 414 28 418 37 L448 112 C450 116 447 118 443 118 H422 C417 118 413 114 411 109 L405 92 H365 L359 109 C357 114 353 118 348 118 H327 C323 118 320 116 322 112 L352 37 C356 28 364 22 374 22 Z M372 74 H398 L385 41 Z" />
          {/* N */}
          <path d="M464 22 H482 C488 22 494 25 497 31 L543 93 V32 C543 26 547 22 553 22 H568 C574 22 578 26 578 32 V108 C578 114 572 118 566 118 H548 C542 118 536 115 533 109 L487 47 V108 C487 114 483 118 477 118 H464 C458 118 454 114 454 108 V32 C454 26 458 22 464 22 Z" />
          {/* O */}
          <path d="M634 22 H612 C590 22 572 40 572 66 V74 C572 100 590 118 612 118 H634 C656 118 674 100 674 74 V66 C674 40 656 22 634 22 Z M650 74 C650 87 641 98 628 98 H618 C605 98 596 87 596 74 V66 C596 53 605 42 618 42 H628 C641 42 650 53 650 66 V74 Z" />
        </g>
      </svg>
      {showSubtitle ? <span className="cxauth-logo-sub">AI Studio</span> : null}
    </span>
  );
};
