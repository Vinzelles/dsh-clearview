import { Fragment, useCallback, useId, useState } from 'react';
import type { ReactNode } from 'react';
import { IconFlatListOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives';
import { Line } from './Line.js';
import { CollapseBody } from './motion.js';
import type { PanelItem } from './process-steps.js';
import { groupSummary, type TranscriptEntry } from './transcript-model.js';
import css from './ToolGroupRow.module.css';

export type GroupEntry = Extract<TranscriptEntry, { kind: 'group' }>;

/** A choice the reader made wins; with no choice the group is open exactly while it runs. */
export function groupOpen(choice: boolean | null, running: boolean): boolean {
  return choice ?? running;
}

/** Consecutive operations as one line; open while running, then folded unless the reader chose otherwise. */
export function ToolGroupRow({ group, motion, onRead, renderItem }: { group: GroupEntry; motion: boolean; onRead: () => void; renderItem: (item: PanelItem) => ReactNode }) {
  const [choice, setChoice] = useState<boolean | null>(null);
  const open = groupOpen(choice, group.facts.running);
  const id = useId();
  const toggle = useCallback(() => { onRead(); setChoice(!open); }, [onRead, open]);
  const { running, failed } = group.facts;
  return <div className={css.group} data-reader-group={group.key} data-group-state={running ? 'running' : 'settled'} data-expanded={open}>
    <Line icon={<IconFlatListOutlineRegular size={14} />} label={groupSummary(group.facts)} tone={failed > 0 ? 'failed' : running ? 'running' : 'idle'}
      shimmer={running && motion} trailing={failed > 0 ? `· ${failed} 次失败` : undefined} open={open} onToggle={toggle} controls={id} />
    <CollapseBody open={open} motion={motion}>
      <div id={id} className={css.members}>{group.items.map(item => <Fragment key={item.key}>{renderItem(item)}</Fragment>)}</div>
    </CollapseBody>
  </div>;
}
