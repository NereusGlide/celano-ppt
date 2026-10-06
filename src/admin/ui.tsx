import React from 'react';
import { useFocusTrap } from '../hooks/useFocusTrap.js';
import '../styles/workspace.css';

/* =========================================================
   与个人中心一致的黑白工作台视觉基件
   ========================================================= */

export const COLORS = {
  primary: '#F4F6F7',
  success: '#8A9299',
  warning: '#E8836F',
  danger: '#E8836F',
  info: '#8A9299',
  border: '#ffffff14',
  borderLight: '#ffffff0f',
  textPrimary: '#E2E5E8',
  textRegular: '#8A9299',
  textSecondary: '#8A9299',
  bg: '#0B0E10'
};

type ButtonVariant = 'primary' | 'default' | 'danger' | 'success' | 'warning' | 'text';
export const Button: React.FC<{
  children: React.ReactNode; variant?: ButtonVariant; size?: 'default' | 'small';
  disabled?: boolean; loading?: boolean; onClick?: () => void; type?: 'button' | 'submit'; title?: string;
}> = ({ children, variant = 'default', size = 'default', disabled, loading, onClick, type = 'button', title }) => {
  const variants: Record<ButtonVariant, string> = {
    primary: 'ws-primary',
    default: 'ws-ghost',
    danger: 'ws-danger',
    success: 'ws-success',
    warning: 'ws-warning',
    text: 'ws-ghost'
  };
  const sizing = size === 'small' ? ' height:32px; padding:0 10px; font-size:11px;' : '';
  return (
    <button type={type} title={title} disabled={disabled || loading} onClick={onClick}
      className={'ws-button ' + variants[variant]} style={sizing ? { height: 32, padding: '0 10px', fontSize: 11 } : undefined}>
      {loading && <span className="ws-spin" style={{ width: 12, height: 12, borderRadius: '50%', border: '2px solid currentColor', borderTopColor: 'transparent', display: 'inline-block' }} />}
      {children}
    </button>
  );
};

export const Card: React.FC<{ title?: React.ReactNode; extra?: React.ReactNode; children: React.ReactNode; bodyClass?: string }> = ({ title, extra, children, bodyClass }) => (
  <div className="ws-panel">
    {title && (
      <div className="ws-panel-head" style={{ height: 48 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: '#E2E5E8' }}>{title}</span>
        {extra}
      </div>
    )}
    <div style={{ padding: 20 }} className={bodyClass || ''}>{children}</div>
  </div>
);

export const Tag: React.FC<{ type?: 'primary' | 'success' | 'warning' | 'danger' | 'info'; children: React.ReactNode }> = ({ type = 'info', children }) => {
  const cls = { primary: 'ws-tag ws-tag-primary', success: 'ws-tag ws-tag-success', warning: 'ws-tag ws-tag-warning', danger: 'ws-tag ws-tag-danger', info: 'ws-tag' }[type];
  return <span className={cls}>{children}</span>;
};

export const TextInput: React.FC<{
  value: string; onChange: (v: string) => void; placeholder?: string; type?: string;
  className?: string; onEnter?: () => void; disabled?: boolean;
  /** 由 Field 注入，用于建立 label 与控件的程序化关联 */
  id?: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean;
}> = ({ value, onChange, placeholder, type = 'text', className, onEnter, disabled, id, 'aria-describedby': describedBy, 'aria-invalid': invalid }) => (
  <input type={type} value={value} disabled={disabled} placeholder={placeholder}
    id={id} aria-describedby={describedBy} aria-invalid={invalid}
    onChange={(e) => onChange(e.target.value)}
    onKeyDown={(e) => { if (e.key === 'Enter' && onEnter) onEnter(); }}
    className={'ws-input ' + (className || '')} />
);

export const Select: React.FC<{ value: string; onChange: (v: string) => void; options: { label: string; value: string }[]; className?: string }> = ({ value, onChange, options, className }) => (
  <select value={value} onChange={(e) => onChange(e.target.value)} className={'ws-select ' + (className || '')}>
    {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
  </select>
);

/**
 * 表单字段容器。
 * 用 useId 生成稳定 id 并注入子控件，使 <label htmlFor> 与控件真正关联：
 * 点击标签可聚焦控件，读屏软件能播报字段名；hint 也会通过 aria-describedby 关联。
 */
export const Field: React.FC<{ label: string; children: React.ReactNode; hint?: string; invalid?: boolean }> = ({ label, children, hint, invalid }) => {
  const id = React.useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const control = React.isValidElement(children)
    ? React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {
        id,
        ...(hintId ? { 'aria-describedby': hintId } : {}),
        ...(invalid ? { 'aria-invalid': true } : {}),
      })
    : children;
  return (
    <div className="ws-field" style={{ marginBottom: 16 }}>
      <label htmlFor={id}>{label}</label>
      {control}
      {hint && <small id={hintId}>{hint}</small>}
    </div>
  );
};

export interface Column<T> { title: string; width?: string; align?: 'left' | 'center' | 'right'; render: (row: T, index: number) => React.ReactNode; }
export function Table<T>({ columns, data, rowKey, loading }: { columns: Column<T>[]; data: T[]; rowKey: (row: T, index: number) => string; loading?: boolean }) {
  return (
    <div className="ws-table-wrap">
      <table className="ws-table">
        <thead>
          <tr>{columns.map((c, i) => <th key={i} style={{ width: c.width, textAlign: c.align || 'left' }}>{c.title}</th>)}</tr>
        </thead>
        <tbody>
          {loading && <tr><td colSpan={columns.length} style={{ height: 80, textAlign: 'center', color: '#8A9299' }}>加载中…</td></tr>}
          {!loading && data.length === 0 && <tr><td colSpan={columns.length} style={{ height: 80, textAlign: 'center', color: '#8A9299' }}>暂无数据</td></tr>}
          {!loading && data.map((row, ri) => (
            <tr key={rowKey(row, ri)}>
              {columns.map((c, ci) => <td key={ci} style={{ textAlign: c.align || 'left' }}>{c.render(row, ri)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const Pagination: React.FC<{ page: number; pageSize: number; total: number; onPage: (p: number) => void; onPageSize?: (s: number) => void }> = ({ page, pageSize, total, onPage, onPageSize }) => {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const nums: number[] = [];
  for (let i = Math.max(1, page - 2); i <= Math.min(pages, page + 2); i++) nums.push(i);
  return (
    <div className="ws-pagination">
      <span>共 {total} 条</span>
      <div className="ws-page-controls">
        {onPageSize && (
          <select className="ws-select" style={{ height: 29 }} value={String(pageSize)} onChange={(e) => onPageSize(Number(e.target.value))}>
            {[10, 20, 50].map(n => <option key={n} value={n}>{n} 条/页</option>)}
          </select>
        )}
        <button onClick={() => onPage(page - 1)} disabled={page <= 1}>‹</button>
        {nums.map(n => <button key={n} className={n === page ? 'active' : ''} onClick={() => onPage(n)}>{n}</button>)}
        <button onClick={() => onPage(page + 1)} disabled={page >= pages}>›</button>
      </div>
    </div>
  );
};

export const Modal: React.FC<{ open: boolean; title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode; width?: string }> = ({ open, title, onClose, children, footer, width = '520px' }) => {
  // Hook 必须在条件返回之前调用；关闭时 active=false，内部会自动跳过。
  const dialogRef = useFocusTrap<HTMLDivElement>(open, onClose);
  const titleId = React.useId();
  if (!open) return null;
  return (
    <div className="ws-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        ref={dialogRef}
        className="ws-modal"
        style={{ width }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="ws-modal-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="ws-modal-close" onClick={onClose} aria-label="关闭对话框">×</button>
        </div>
        <div>{children}</div>
        {footer && <div className="ws-modal-actions">{footer}</div>}
      </div>
    </div>
  );
};

export const Alert: React.FC<{ type?: 'info' | 'success' | 'warning' | 'error'; children: React.ReactNode }> = ({ type = 'info', children }) => {
  const cls = { info: 'ws-notice', success: 'ws-notice ws-notice-success', warning: 'ws-notice ws-notice-warning', error: 'ws-notice ws-notice-error' }[type];
  return <div className={cls} role={type === 'error' ? 'alert' : 'status'}>{children}</div>;
};

export const PageHeader: React.FC<{ title: string; desc?: string; extra?: React.ReactNode }> = ({ title, desc, extra }) => (
  <div className="ws-page-head" style={{ marginBottom: 18 }}>
    <div>
      <p className="ws-eyebrow">ADMIN</p>
      <h1 style={{ fontSize: 20 }}>{title}</h1>
      {desc && <p>{desc}</p>}
    </div>
    {extra && <div className="ws-button-group">{extra}</div>}
  </div>
);
