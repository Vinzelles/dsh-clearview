import { useState } from 'react';
import { DisclosureRow, IconBrowseOutline16 } from '@deepseek-ai/dsh-client-ui-primitives';
import css from './SystemPromptRow.module.css';

/** Model-facing prompt text stays bounded at the disclosure, like the context bodies. */
const MAX_CHARS = 20_000;

/**
 * One complete model-facing system prompt as a collapsed disclosure whose
 * expanded body keeps the text's real line breaks — the reader-side twin of
 * the native 0.1.2 system-prompt row. It lives in the always-visible flow
 * above the answer, outside the reader's process fold, matching native
 * placement semantics.
 * @param props - The complete prompt text of one request.
 * @returns The system prompt disclosure row.
 */
export function SystemPromptRow({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const bounded = text.length > MAX_CHARS
    ? `${text.slice(0, MAX_CHARS)}\n…（已截断，共 ${text.length} 字符）`
    : text;
  return (
    <DisclosureRow
      className={css.root}
      icon={<IconBrowseOutline16 size={14} />}
      chevronClassName={css.chevron}
      title="系统提示词"
      open={open}
      expandable
      expandOnRowClick
      onToggle={() => { setOpen(value => !value); }}
    >
      <div className={css.body} data-system-prompt-body>
        <pre className={css.text}>{bounded}</pre>
      </div>
    </DisclosureRow>
  );
}
