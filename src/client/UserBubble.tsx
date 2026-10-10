import { useLayoutEffect, useRef, useState } from 'react';
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

/** The visual surface contains both the message seat and its toggle; only the seat is copied. */
export function UserBubbleView({ children, text, clamped, open, onToggle, small, label, data }: { children: ReactNode; text?: RefObject<HTMLDivElement>; clamped: boolean; open: boolean; onToggle: () => void; small: boolean; label?: string; data?: Record<string, string | boolean | undefined> }) {
  return <div className={css.row} data-reader-user-surface data-small={small}>
    <div className={css.bubble} data-reader-user-bubble data-small={small} data-clamped={clamped && !open} {...data}>
      {label && <p className={css.meta}>{label}</p>}
      <div ref={text} className={css.text} data-open={open}>{children}</div>
    </div>
    {(clamped || open) && <button type="button" className={css.more} data-reader-bubble-toggle aria-expanded={open} onClick={onToggle}>{open ? '收起' : '展开全文'}</button>}
  </div>;
}
