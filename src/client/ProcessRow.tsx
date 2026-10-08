import type { ReactNode } from 'react';
import { StateDot } from '@deepseek-ai/dsh-client-ui-primitives';
import css from './ProcessRow.module.css';

export type RowTone = 'idle' | 'active' | 'failed';

/** Leading glyph of a process row: its own icon, the native spinner while active, a red dot on failure. */
export function RowGlyph({ tone, icon }: { tone: RowTone; icon: ReactNode }) {
  if (tone === 'active') return <StateDot state="ongoing" size={12} />;
  if (tone === 'failed') return <StateDot state="error" />;
  return <>{icon}</>;
}

/** 2px dot between a row title and its summary; follows the shimmer highlight. */
export function RowSeparator() {
  return <span className={css.separator} aria-hidden="true" data-shimmer-decoration="" />;
}

export function Chevron({ open }: { open: boolean }) {
  return <svg className={css.chevron} data-open={open} viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="m6 4 4 4-4 4" /></svg>;
}

/** Recessed block under a row: thinking text, tool details, raw records, failure summaries. */
export function Inset({ children, tone = 'plain', className }: { children: ReactNode; tone?: 'plain' | 'error'; className?: string }) {
  const classes = [css.inset, tone === 'error' ? css.insetError : '', className ?? ''].filter(Boolean).join(' ');
  return <div className={classes} data-inset-tone={tone}>{children}</div>;
}

/** First non-empty lines of a failure, capped so a stack trace never floods the panel. */
export function errorExcerpt(text: string, lines = 3, chars = 300): string {
  const kept = text.split(/\r?\n/).map(line => line.trimEnd()).filter(line => line.trim() !== '').slice(0, lines).join('\n');
  return kept.length > chars ? `${kept.slice(0, chars - 1)}…` : kept;
}

export function ErrorSummary({ text }: { text: string }) {
  if (!text) return null;
  return <Inset tone="error"><pre className={css.errorText}>{text}</pre></Inset>;
}
