import { useEffect, useRef } from 'react';

/** 可聚焦元素选择器：排除 disabled 与 tabindex="-1"。 */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * 对话框焦点管理。
 *
 * 解决四个必须做对的细节：
 *  1. 打开时把焦点移入对话框（否则读屏用户不知道弹窗出现了，键盘用户 Tab 会跑到背后的页面）
 *  2. Tab / Shift+Tab 在对话框内循环，不会漏到背景内容
 *  3. 焦点被鼠标或脚本移到外部时拉回来
 *  4. 关闭时把焦点归还给触发它的元素（否则焦点会掉到 body，键盘用户丢失位置）
 *
 * @param active  对话框是否处于打开状态
 * @param onEscape Esc 键回调（不传则不处理 Esc）
 */
export function useFocusTrap<T extends HTMLElement>(active: boolean, onEscape?: () => void) {
  const containerRef = useRef<T>(null);
  // 用 ref 保存回调，避免调用方每次渲染都重建 effect（否则焦点会被反复重置）
  const escapeRef = useRef(onEscape);
  escapeRef.current = onEscape;

  useEffect(() => {
    if (!active) return;
    const node = containerRef.current;
    if (!node) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusables = (): HTMLElement[] =>
      Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        el => el.offsetWidth > 0 || el.offsetHeight > 0 || el === document.activeElement,
      );

    // 初始焦点：优先 [data-autofocus]，其次第一个可聚焦元素，最后容器本身
    const initial = node.querySelector<HTMLElement>('[data-autofocus]') || focusables()[0] || node;
    // 容器可能不可聚焦，补一个 tabindex 保证焦点有落点
    if (initial === node && !node.hasAttribute('tabindex')) node.setAttribute('tabindex', '-1');
    initial.focus({ preventScroll: true });

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        escapeRef.current?.();
        return;
      }
      if (event.key !== 'Tab') return;

      const items = focusables();
      if (!items.length) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const current = document.activeElement as HTMLElement | null;

      if (!event.shiftKey && current === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && (current === first || !node.contains(current))) {
        event.preventDefault();
        last.focus();
      }
    };

    const handleFocusIn = (event: FocusEvent): void => {
      if (!node.contains(event.target as Node)) {
        (focusables()[0] || node).focus({ preventScroll: true });
      }
    };

    node.addEventListener('keydown', handleKeyDown);
    document.addEventListener('focusin', handleFocusIn);

    // 锁定背景滚动，避免弹窗打开时底层页面跟着滚动
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      node.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('focusin', handleFocusIn);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus?.({ preventScroll: true });
    };
  }, [active]);

  return containerRef;
}
