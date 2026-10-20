import { useCallback, useId, useState } from 'react';
import { IconBrowseOutline16 } from '../icons017.js';
import { Line } from '../Line.js';
import { CollapseBody } from '../motion.js';
import { useReaderActions } from '../reader-context.js';
import css from './SystemPromptRow.module.css';

/** Model-facing prompt text stays bounded at the disclosure, like the context bodies. */
const MAX_CHARS = 20_000;

/**
 * One complete model-facing system prompt as a collapsed reader row whose
 * expanded body keeps the text's real line breaks. It shares the context row's
 * grammar — the 32px Line header, then the shared detail surface — so the
 * reader's rows stay one visual system; it stays in the always-visible flow
 * above the answer, outside the reader's process fold, matching native
 * placement semantics.
 * @param props - The complete prompt text of one request.
 * @returns The system prompt disclosure row.
 */
export function SystemPromptRow({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const { motion } = useReaderActions();
  const id = useId();
  const toggle = useCallback(() => { setOpen(value => !value); }, []);
  const bounded = text.length > MAX_CHARS
    ? `${text.slice(0, MAX_CHARS)}\n…（已截断，共 ${text.length} 字符）`
    : text;
  return <div className={css.root}>
    <Line icon={<IconBrowseOutline16 size={14} />} label="系统提示词" open={open} onToggle={toggle} controls={id} />
    <CollapseBody open={open} motion={motion}>
      <div id={id} className={css.detail} data-system-prompt-body>
        <pre className={css.text}>{bounded}</pre>
      </div>
    </CollapseBody>
  </div>;
}
