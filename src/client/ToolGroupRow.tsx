import { Fragment, memo, useCallback, useId, useState } from 'react';
import type { ReactNode } from 'react';
import { IconFlatListOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives';
import { Line } from './Line.js';
import { CollapseBody } from './motion.js';
import type { PanelItem } from './process-steps.js';
import { groupSummary, type TranscriptEntry } from './transcript-model.js';
import css from './ToolGroupRow.module.css';

export type GroupEntry = Extract<TranscriptEntry, { kind: 'group' }>;
export type MemberOpenChange = (key: string, open: boolean) => void;

/**
 * A choice the reader made wins; with no choice the group is open while it runs.
 * `retained` keeps it open without claiming activity: a live tail has no running member
 * for the moment between two steps, and folding there would reopen it one step later.
 */
export function groupOpen(choice: boolean | null, running: boolean, retained = false): boolean {
  return choice ?? (running || retained);
}

/** Stable operation seats: a singleton stays open; groups fold their rows but never their media. */
export interface ToolGroupRowProps {
  group: GroupEntry; motion: boolean; onRead: () => void;
  retain?: boolean;
  /** The turn is open and this group is its process tail, so it never auto-folds. */
  live?: boolean;
  onCloseThoughts?: (items: readonly PanelItem[]) => void;
  renderItem: (item: PanelItem, onOpenChange?: MemberOpenChange) => ReactNode;
  renderMedia?: (item: PanelItem) => ReactNode;
}

/** Record rows subscribe to their own nodes; tool payloads and ordered seats must remain equal. */
function sameItem(a: PanelItem, b: PanelItem): boolean {
  if (a === b) return true;
  if (a.kind !== b.kind || a.key !== b.key || a.step !== b.step) return false;
  if (a.kind === 'tool' || a.kind === 'media') {
    if (b.kind !== a.kind) return false;
    return a.entry.key === b.entry.key && a.entry.callId === b.entry.callId && a.entry.step === b.entry.step
      && a.entry.order === b.entry.order && a.entry.block === b.entry.block && a.entry.draft === b.entry.draft;
  }
  if ('nodeKey' in a && 'nodeKey' in b && a.nodeKey !== b.nodeKey) return false;
  if ('start' in a && 'start' in b && a.start !== b.start) return false;
  if (a.kind === 'narration' && b.kind === 'narration' && a.answer !== b.answer) return false;
  return true;
}

export function sameToolGroupProps(a: ToolGroupRowProps, b: ToolGroupRowProps): boolean {
  if (a.motion !== b.motion || a.onRead !== b.onRead || a.renderItem !== b.renderItem || a.renderMedia !== b.renderMedia
      || a.retain !== b.retain || a.live !== b.live || a.onCloseThoughts !== b.onCloseThoughts) return false;
  if (a.group === b.group) return true;
  const left = a.group, right = b.group;
  if (left.key !== right.key || left.items.length !== right.items.length
      || left.facts.running !== right.facts.running || left.facts.failed !== right.facts.failed
      || left.facts.order.length !== right.facts.order.length) return false;
  if (!left.facts.order.every((kind, index) => kind === right.facts.order[index])) return false;
  const kinds = Object.keys(left.facts.counts) as (keyof typeof left.facts.counts)[];
  if (kinds.length !== Object.keys(right.facts.counts).length || !kinds.every(kind => left.facts.counts[kind] === right.facts.counts[kind])) return false;
  return left.items.every((item, index) => sameItem(item, right.items[index]!));
}

export function ToolGroupRowView({ group, motion, onRead, renderItem, renderMedia, retain = false, live = false, onCloseThoughts }: ToolGroupRowProps) {
  const [choice, setChoice] = useState<boolean | null>(null);
  const [openMembers, setOpenMembers] = useState<ReadonlySet<string>>(() => new Set());
  const memberOpenChange = useCallback<MemberOpenChange>((key, open) => {
    setOpenMembers(previous => {
      const next = new Set(previous);
      if (open) next.add(key); else next.delete(key);
      return next;
    });
  }, []);
  // Only current members count. An explicit group close still wins over member details and over a live tail.
  const readingMember = group.items.some(item => openMembers.has(item.key));
  const grouped = group.items.length >= 2 || group.items.some(item => item.kind === 'reasoning');
  const open = !grouped || groupOpen(choice, group.facts.running || readingMember, retain || live);
  const id = useId();
  const toggle = useCallback(() => { onRead(); if (open) onCloseThoughts?.(group.items); setChoice(!open); }, [onRead, open, onCloseThoughts, group.items]);
  const { running, failed } = group.facts;
  return <div className={css.group} data-reader-group={grouped ? group.key : undefined} data-reader-group-tools={group.items.some(item => item.kind === 'tool') || undefined}
    data-group-state={grouped ? running ? 'running' : 'settled' : undefined} data-expanded={open}>
    {grouped && <Line icon={<IconFlatListOutlineRegular size={14} />} label={groupSummary(group.facts)} tone={failed > 0 ? 'failed' : running ? 'running' : 'idle'}
      shimmer={running && motion} trailing={failed > 0 ? <span>· {failed} 次失败</span> : undefined}
      open={open} onToggle={toggle} controls={id} />}
    <div id={id} className={css.members} data-single={!grouped}>
      {group.items.map(item => <Fragment key={item.key}>
        <CollapseBody open={open} motion={motion}>{renderItem(item, memberOpenChange)}</CollapseBody>
        {renderMedia?.(item)}
      </Fragment>)}
    </div>
  </div>;
}

export const ToolGroupRow = memo(ToolGroupRowView, sameToolGroupProps);
