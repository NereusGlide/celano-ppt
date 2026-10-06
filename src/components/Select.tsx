import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

export interface SelectOption { label: string; value: string }

/**
 * 自定义下拉：替代原生 select，避免展开菜单走系统默认白底样式。
 * 深色菜单 + 统一过渡动效，选中项用青色点缀，跨平台表现一致。
 */
export const Select: React.FC<{
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
  /** 菜单对齐方向：默认左对齐，靠近右边界时用 right 防溢出 */
  align?: 'left' | 'right';
  /** 透明触发态：用于已自带外框的容器（如 pill），只保留文字与箭头 */
  bare?: boolean;
}> = ({ value, options, onChange, disabled, className, ariaLabel, align = 'left', bare }) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDocDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);

  const current = options.find(option => option.value === value) || options[0];

  return <div ref={rootRef} className={'celano-select' + (bare ? ' bare' : '') + (open ? ' open' : '') + (disabled ? ' disabled' : '') + (className ? ' ' + className : '')}>
    <button type="button" className="celano-select-trigger" disabled={disabled}
      aria-haspopup="listbox" aria-expanded={open} aria-label={ariaLabel}
      onClick={() => setOpen(v => !v)}>
      <span className="celano-select-value">{current?.label ?? ''}</span>
      <ChevronDown size={14} className="celano-select-caret" />
    </button>
    {open ? <div className={'celano-select-menu' + (align === 'right' ? ' align-right' : '')} role="listbox">
      {options.map(option => (
        <button key={option.value} type="button" role="option" aria-selected={option.value === value}
          className={'celano-select-option' + (option.value === value ? ' active' : '')}
          onClick={() => { onChange(option.value); setOpen(false); }}>{option.label}</button>
      ))}
    </div> : null}
  </div>;
};
