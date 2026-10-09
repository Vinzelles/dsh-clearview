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

/** One transcript row in Claude Code grammar: chevron, icon, verb, target, trailing note. */
export function Line({ icon, label, target, trailing, tone = 'idle', shimmer = false, open, onToggle, controls, title, data }: LineProps) {
  const expandable = open !== undefined && onToggle !== undefined;
  const body = <>
    {expandable
      ? <svg className={css.chevron} data-open={open} viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M4.5 2.5 8 6l-3.5 3.5" /></svg>
      : <span className={css.chevron} data-chevron-slot aria-hidden="true" />}
    <span className={css.icon} aria-hidden="true">{icon}</span>
    <span className={css.label} data-shimmer={shimmer || undefined}>{label}</span>
    {target !== undefined && target !== null && target !== '' && <span className={css.target} title={title}>{target}</span>}
    {trailing && <span className={css.trailing}>{trailing}</span>}
  </>;
  return <div className={css.line} data-reader-line data-tone={tone} {...data}>
    {expandable
      ? <button type="button" className={css.button} aria-expanded={open} aria-controls={controls} onClick={onToggle}>{body}</button>
      : <div className={css.button}>{body}</div>}
  </div>;
}
