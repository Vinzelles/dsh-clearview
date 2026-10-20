import { useCallback, useId, useState } from 'react';
import type { ContextMessageNode } from '@deepseek-ai/dsh-client-ui-conversation/client';
import type { ChatViewSlotProps } from '@deepseek-ai/dsh-client-ui-chat/client';
import { IconBrowseOutline16 } from '../icons017.js';
import { ReferenceIcon } from './ReferenceIcon.js';
import { contextBody } from './ContextBody.js';
import { Line } from '../Line.js';
import { CollapseBody } from '../motion.js';
import { useReaderActions } from '../reader-context.js';
import css from './ContextInjectionRow.module.css';

/** Props for the logged non-user message presentation. */
export interface ContextInjectionRowProps {
  content: ContextMessageNode['content']
  source: ContextMessageNode['source']
  /** Role and producer name projected from the durable source. */
  producer: ContextMessageNode['producer']
  /** Producer-declared information form; null renders the opaque body. */
  form: ContextMessageNode['form']
  /** The owning view's locale seat, passed down as a plain prop. */
  t: ChatViewSlotProps['t']
}

/**
 * Render logged context as one reader transcript row.
 *
 * The header names the role the context plays and, beside it, the producer the
 * durable source identifies, so a reader can tell an injected skill catalog
 * from a workspace instruction file or a recalled session without expanding.
 * It is the same `Line` the thoughts, operations and records beside it use:
 * one 32px band with a shared 16px icon/chevron slot, the process text size and
 * the shared hover/open surfaces, so a logged context row no longer reads as a
 * smaller host disclosure wedged between the process rows. The expanded body
 * follows the producer-declared form inside the shared detail surface; an
 * absent or unknown form renders the opaque body.
 * @param props - Durable content, its projected producer role/name and form, and the locale seat.
 * @returns A collapsed context row with a bounded, form-specific body.
 */
export function ContextInjectionRow({ content, source, producer, form, t }: ContextInjectionRowProps) {
  const [open, setOpen] = useState(false);
  const { motion } = useReaderActions();
  const id = useId();
  // Resolved rather than declared: a form whose fields are unreadable renders
  // the opaque body, and the marker must say what the row actually shows.
  const { rendered, summary, body } = contextBody(form, { content, source, t });
  const toggle = useCallback(() => { setOpen(value => !value); }, []);

  return <div className={css.root}>
    <Line
      icon={producer.role === 'recall'
        ? <span data-context-recall-icon><ReferenceIcon kind="session" size={14} /></span>
        : <IconBrowseOutline16 size={14} />}
      /* One inline sentence: the role, the producer it came from, then the
         account the form resolves. The dot is drawn rather than typed so it
         keeps the process rows' separator shape at any font substitution, and
         it is aria-hidden so the accessible name stays the readable parts. */
      label={<>
        {t(producer.role === 'recall' ? 'message.contextRecall' : 'message.contextInjection')}
        {producer.label !== null && <>
          <span className={css.sep} aria-hidden="true" />
          <span className={css.source} title={producer.label} data-context-source>{producer.label}</span>
        </>}
        {summary !== null && <>
          <span className={css.sep} aria-hidden="true" />
          <span className={css.summary} data-context-summary>{summary}</span>
        </>}
      </>}
      open={open}
      onToggle={toggle}
      controls={id}
    />
    <CollapseBody open={open} motion={motion}>
      <div id={id} className={css.detail} data-context-injection-body data-context-form={rendered ?? undefined}>
        {body}
      </div>
    </CollapseBody>
  </div>;
}
