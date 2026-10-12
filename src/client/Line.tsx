import type { ReactNode } from 'react';
import css from './Line.module.css';

export type LineTone = 'idle' | 'running' | 'failed';
export interface LineProps {
  icon: ReactNode; label: ReactNode; target?: ReactNode; trailing?: ReactNode;
  tone?: LineTone; shimmer?: boolean;
  /** Both set → the line is a disclosure button; otherwise a static row. */
  open?: boolean; onToggle?: () => void; controls?: string;
  title?: string; data?: Record<string, string | boolean | undefined>;
}

/** Shared process row: one leading slot swaps its operation icon for the disclosure arrow. */
export function Line({ icon, label, target, trailing, tone = 'idle', shimmer = false, open, onToggle, controls, title, data }: LineProps) {
  const expandable = open !== undefined && onToggle !== undefined;
  const body = <>
    <span className={css.leading} data-reader-line-leading aria-hidden="true">
      <span className={css.icon} data-reader-line-icon>{icon}</span>
      {expandable && <svg className={css.chevron} data-reader-line-chevron data-open={open} viewBox="0 0 12 12" width="12" height="12"><path d="M4.5 2.5 8 6l-3.5 3.5" /></svg>}
    </span>
    <span className={css.label} data-reader-line-label data-shimmer={shimmer || undefined}>{label}</span>
    {target !== undefined && target !== null && target !== '' && <span className={css.target} title={title}>{target}</span>}
    {trailing && <span className={css.trailing}>{trailing}</span>}
  </>;
  return <div className={css.line} data-reader-line data-tone={tone} {...data}>
    {expandable
      ? <button type="button" className={css.button} aria-expanded={open} aria-controls={controls} onClick={onToggle}>{body}</button>
      : <div className={css.button}>{body}</div>}
  </div>;
}
