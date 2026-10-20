import { useId } from 'react';
import type { ReactNode } from 'react';
import { IconWarningOutlineRegular, IconCloseCircleFillRegular } from '@deepseek-ai/dsh-client-ui-primitives';
import { Chevron } from './ProcessRow.js';
import { CollapseBody } from './motion.js';
import css from './Notice.module.css';

/** Exceptional events retain their chronological position but never look like tool operations. */
export function Notice({ title, summary, tone = 'warning', open = false, onToggle, motion = false, children, data }: {
  title: string; summary?: string; tone?: 'warning' | 'danger'; open?: boolean; onToggle?: () => void;
  motion?: boolean; children?: ReactNode; data?: Record<string, string | boolean | undefined>;
}) {
  const id = useId();
  const Icon = tone === 'danger' ? IconCloseCircleFillRegular : IconWarningOutlineRegular;
  const content = <>
    <span className={css.icon} aria-hidden="true"><Icon size={16} /></span>
    <span className={css.copy}><span className={css.title}>{title}</span>{summary && <span className={css.summary}>{summary}</span>}</span>
    {onToggle && <Chevron open={open} />}
  </>;
  return <div className={css.notice} data-reader-notice-tone={tone} {...data}>
    {onToggle
      ? <button className={css.header} type="button" aria-expanded={open} aria-controls={id} onClick={onToggle}>{content}</button>
      : <div className={css.header}>{content}</div>}
    {onToggle && <CollapseBody open={open} motion={motion}><div id={id} className={css.detail}>{children}</div></CollapseBody>}
  </div>;
}
