import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import css from './UserBubble.module.css';

/** The person's message on the right; longer than six lines it clamps behind 「展开全文」. */
export function UserBubble({ children, small = false, label, data }: { children: ReactNode; small?: boolean; label?: string; data?: Record<string, string | boolean | undefined> }) {
  const text = useRef<HTMLDivElement>(null);
  const [clamped, setClamped] = useState(false);
  const [open, setOpen] = useState(false);
  useLayoutEffect(() => {
    const node = text.current;
    if (!node || open) return;
    const check = () => setClamped(node.scrollHeight > node.clientHeight + 1);
    // CSS clips immediately. Initial RO delivery batches measurement after layout, rather
    // than forcing geometry synchronously for every bubble during the mount commit.
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(check) : null;
    if (observer) observer.observe(node);
    else check();
    // The clipped box may keep the same height while its nested content or loaded fonts change.
    if (node.firstElementChild) observer?.observe(node.firstElementChild);
    document.fonts?.addEventListener('loadingdone', check);
    return () => { observer?.disconnect(); document.fonts?.removeEventListener('loadingdone', check); };
  }, [open, children]);
  return <UserBubbleView text={text} clamped={clamped} open={open} onToggle={() => setOpen(value => !value)} small={small} label={label} data={data}>{children}</UserBubbleView>;
}

/** The bubble contains an inline disclosure; the rewind bridge places message actions below it. */
export function UserBubbleView({ children, text, clamped, open, onToggle, small, label, data }: { children: ReactNode; text?: RefObject<HTMLDivElement>; clamped: boolean; open: boolean; onToggle: () => void; small: boolean; label?: string; data?: Record<string, string | boolean | undefined> }) {
  const textId = useId();
  const expandable = clamped || open;
  const toggleLabel = open ? '收起全文' : '展开全文';
  return <div className={css.row} data-reader-user-message data-small={small} {...data}>
    <div className={css.bubble} data-reader-user-surface data-reader-user-bubble data-small={small} data-clamped={clamped && !open} data-expandable={expandable}>
      {label && <p className={css.meta}>{label}</p>}
      <div ref={text} id={textId} className={css.text} data-reader-user-text data-open={open}>{children}</div>
      {expandable && <button type="button" className={css.more} data-reader-bubble-toggle aria-label={toggleLabel} title={toggleLabel} aria-expanded={open} aria-controls={textId} onClick={onToggle}>
        <svg className={css.toggleIcon} data-open={open} width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
      </button>}
    </div>
  </div>;
}
