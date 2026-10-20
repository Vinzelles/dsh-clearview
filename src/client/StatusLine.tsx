import css from './StatusLine.module.css';

export type StatusPhase = 'running' | 'waiting' | 'interrupted' | 'error';

export function statusVerb(label: string): string {
  if (label === '正在思考') return '思考中…';
  return label.startsWith('正在') ? `${label}…` : label;
}

/** A compact activity indicator, the current verb and secondary timing. */
export function StatusLine({ phase, label, elapsed, thinking, motion, tail = false }: { phase: StatusPhase; label: string; elapsed: string | null; thinking: string | null; motion: boolean; tail?: boolean }) {
  const running = phase === 'running';
  const meta = [elapsed, thinking ? `已思考 ${thinking}` : null].filter(Boolean).join(' · ');
  return <div className={css.line} data-reader-status-line data-reader-status-tail={tail || undefined} data-phase={phase} role="status">
    <span className={css.indicator} aria-hidden="true" data-spin={running && motion ? true : undefined} />
    <span className={css.verb} data-shimmer={running && motion ? true : undefined}>{statusVerb(label)}</span>
    {meta && <span className={css.meta}>{meta}</span>}
  </div>;
}
