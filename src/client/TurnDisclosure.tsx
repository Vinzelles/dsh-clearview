import type { MouseEvent } from 'react';
import css from './TurnDisclosure.module.css';

export function TurnDisclosure({ label, elapsed, steps, tools, open, onToggle, onPointerDown, controls, danger = false }: {
  label: string; elapsed: string | null; steps: number; tools: number; open: boolean;
  onToggle: (event: MouseEvent<HTMLButtonElement>) => void; onPointerDown: () => void; controls: string; danger?: boolean;
}) {
  const meta = [elapsed, steps > 0 ? `${steps} 步` : null, tools > 0 ? `${tools} 次工具调用` : null].filter(Boolean).join(' · ');
  return <button type="button" className={css.row} data-reader-turn-disclosure data-danger={danger || undefined}
    aria-expanded={open} aria-controls={controls} onPointerDown={onPointerDown} onClick={onToggle}>
    <svg className={css.chevron} data-open={open} width="14" height="14" viewBox="0 0 12 12" aria-hidden="true"><path d="M4.5 2.5 8 6l-3.5 3.5" /></svg>
    <span className={css.dot} aria-hidden="true" />
    <span className={css.label}>{label}</span>
    <span className={css.meta} title={meta}>{meta}</span>
    <span className={css.hint}>{open ? '收起过程' : '展开过程'}</span>
  </button>;
}
