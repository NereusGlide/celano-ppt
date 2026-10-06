import React, { useEffect, useId, useRef } from 'react';
import { LoaderCircle, Trash2 } from 'lucide-react';
import '../styles/delete-confirmation.css';

export function DeleteConfirmation({ title, message, busy = false, onCancel, onConfirm }: { title: string; message: string; busy?: boolean; onCancel: () => void; onConfirm: () => void }) {
  const id = useId();
  const panel = useRef<HTMLElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    cancel.current?.focus();
    return () => previous?.focus();
  }, []);
  return <div className="delete-confirm-backdrop" onClick={() => { if (!busy) onCancel(); }}>
    <section ref={panel} className="delete-confirm-panel" role="dialog" aria-modal="true" aria-labelledby={id} onClick={event => event.stopPropagation()} onKeyDown={event => {
      if (event.key === 'Escape' && !busy) onCancel();
      if (event.key === 'Tab') {
        const buttons = [...(panel.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || [])];
        const target = event.shiftKey ? buttons.at(-1) : buttons[0];
        if (document.activeElement === (event.shiftKey ? buttons[0] : buttons.at(-1))) { event.preventDefault(); target?.focus(); }
      }
    }}>
      <div className="delete-confirm-icon"><Trash2 size={22} /></div>
      <h2 id={id}>{title}</h2><p>{message}</p>
      <div className="delete-confirm-actions"><button ref={cancel} disabled={busy} onClick={onCancel}>取消</button><button className="delete-confirm-danger" disabled={busy} onClick={onConfirm}>{busy ? <LoaderCircle size={15} className="delete-confirm-spin" /> : <Trash2 size={15} />}{busy ? '删除中…' : '确认删除'}</button></div>
    </section>
  </div>;
}
