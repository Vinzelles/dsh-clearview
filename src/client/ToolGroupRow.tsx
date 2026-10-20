import { Fragment, memo, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
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

/** How close to its tail a capped body sits before new members stop following it, in px. */
export const PROCESS_TAIL_SLACK = 24;

/** A capped body follows new members only while the reader has not scrolled away from the tail. */
export function followsTail(distance: number): boolean {
  return distance <= PROCESS_TAIL_SLACK;
}

/** A body is a scroll region only once its members outgrow the cap. */
export function processOverflow(scrollHeight: number, clientHeight: number): boolean {
  return scrollHeight > clientHeight + 1;
}

/** The offset that puts a capped body's newest member in view. */
export function tailOffset(scrollHeight: number, clientHeight: number): number {
  return Math.max(0, scrollHeight - clientHeight);
}

/**
 * `null` when the offset is our own follow write; otherwise whether the reader is still at the tail.
 * The reader's scroll is the only thing that releases the follow.
 */
export function followDecision(current: number, written: number, scrollHeight: number, clientHeight: number): boolean | null {
  if (Math.abs(current - written) < 1) return null;
  return followsTail(scrollHeight - current - clientHeight);
}

/**
 * One frame of tail following: the offset to write, or `null` when the body is already at its tail.
 * Members keep growing between React commits — a thought streams, the open animation expands its
 * members — so the follow runs on the frame clock instead of only when this row re-renders.
 */
export function followFrame(
  port: { scrollTop: number; scrollHeight: number; clientHeight: number },
  sticking: boolean,
): number | null {
  if (!sticking) return null;
  const offset = tailOffset(port.scrollHeight, port.clientHeight);
  return Math.abs(port.scrollTop - offset) > 1 ? offset : null;
}

/**
 * Whether the body still sits exactly where our own follow left it. A frame that finds any other
 * offset is looking at a scroll we did not write — the reader's, a scrollbar drag, or a gesture that
 * chained out of a nested viewport — and must stand down instead of pinning the tail back.
 */
export function holdsWritten(scrollTop: number, written: number): boolean {
  return Math.abs(scrollTop - written) < 1;
}

/**
 * An upward wheel step is the reader taking the body over, so the follow yields before the next
 * frame. Attribution by scroll offset alone loses that race: the frame clock re-pins the body at
 * its tail before the scroll event lands, which reads as a body that refuses to scroll at all.
 */
export function releasesFollow(deltaY: number): boolean {
  return deltaY < 0;
}

/** The keys that move a focused body up release the follow exactly like an upward wheel step. */
export function keyReleasesFollow(key: string): boolean {
  return key === 'ArrowUp' || key === 'PageUp' || key === 'Home';
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
  // A capped body keeps its newest member in view while the batch streams. A group the reader opens
  // themselves starts at its first member, and scrolling away from the tail stops the follow until
  // they scroll back down.
  const members = useRef<HTMLDivElement | null>(null);
  const sticking = useRef(true);
  const opened = useRef(open);
  const written = useRef(-1);
  const measured = useRef(-1);
  const [overflowing, setOverflowing] = useState(false);
  const overflowed = useRef(false);
  // The cap crossing is a boolean the frame clock may rediscover many times per animation; only the
  // crossing itself is a state change, so the members are not re-rendered on every measured height.
  const syncOverflow = (element: HTMLDivElement) => {
    const next = processOverflow(element.scrollHeight, element.clientHeight);
    if (next === overflowed.current) return;
    overflowed.current = next;
    setOverflowing(next);
  };
  useLayoutEffect(() => {
    const element = members.current;
    if (!element) return;
    if (opened.current !== open) {
      opened.current = open;
      sticking.current = open && (group.facts.running || live);
      if (open) {
        const offset = sticking.current ? tailOffset(element.scrollHeight, element.clientHeight) : 0;
        element.scrollTop = offset;
        written.current = offset;
      }
    } else if (open && sticking.current) {
      // Only a body still parked where our own write left it may be re-pinned: a commit landing in
      // the middle of the reader's scroll must not drag them back to the tail.
      if (holdsWritten(element.scrollTop, written.current)) {
        const offset = tailOffset(element.scrollHeight, element.clientHeight);
        if (Math.abs(element.scrollTop - offset) > 1) {
          element.scrollTop = offset;
          written.current = offset;
        }
      } else {
        sticking.current = false;
        written.current = -1;
      }
    }
    syncOverflow(element);
  });
  useEffect(() => {
    const element = members.current;
    if (!element) return;
    // Release first, attribute second. A gesture is synchronous intent, while a scroll event is
    // dispatched a frame later — by then the follow loop has already written the tail back.
    // Release only while the body can actually scroll: an upward wheel over a short body belongs to
    // the page, and releasing there would strand the follow for the rest of the batch.
    const release = () => {
      if (!processOverflow(element.scrollHeight, element.clientHeight)) return;
      sticking.current = false;
      // Forget our own offset so every later scroll is attributed to the reader, even one that
      // returns exactly to the offset we wrote last.
      written.current = -1;
    };
    // A wheel over a member's own viewport (a 128px thought) belongs to that viewport: releasing here
    // would stop the batch following with no way back, because this body never scrolls in that case.
    const owns = (target: EventTarget | null): boolean => {
      let node = target as HTMLElement | null;
      while (node && node !== element) {
        if (node.scrollHeight > node.clientHeight + 1) {
          const overflowY = getComputedStyle(node).overflowY;
          if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') return false;
        }
        node = node.parentElement;
      }
      return true;
    };
    // A scroll offset we did not write is the reader's own: follow resumes only at the tail. Adopt
    // the tail position as ours on resume, so the frame loop can keep the body there as it grows.
    const track = () => {
      const decision = followDecision(element.scrollTop, written.current, element.scrollHeight, element.clientHeight);
      if (decision === null) return;
      sticking.current = decision;
      if (decision) written.current = element.scrollTop;
    };
    const onWheel = (event: WheelEvent) => { if (releasesFollow(event.deltaY) && owns(event.target)) release(); };
    const onTouch = (event: TouchEvent) => { if (owns(event.target)) release(); };
    const onKey = (event: KeyboardEvent) => { if (keyReleasesFollow(event.key) && owns(event.target)) release(); };
    // A pointer press on the container itself is a scrollbar drag; a press on a member row is not.
    const onPointer = (event: PointerEvent) => { if (event.target === element) release(); };
    element.addEventListener('scroll', track, { passive: true });
    element.addEventListener('wheel', onWheel, { passive: true });
    element.addEventListener('touchmove', onTouch, { passive: true });
    element.addEventListener('keydown', onKey);
    element.addEventListener('pointerdown', onPointer);
    return () => {
      element.removeEventListener('scroll', track);
      element.removeEventListener('wheel', onWheel);
      element.removeEventListener('touchmove', onTouch);
      element.removeEventListener('keydown', onKey);
      element.removeEventListener('pointerdown', onPointer);
    };
  }, []);
  // The body keeps growing between commits — a thought streams and the open animation expands its
  // members — so a live batch follows its tail on the frame clock instead of only on React commits.
  const follow = group.facts.running || live;
  useEffect(() => {
    if (!open || !follow) return;
    let frame = requestAnimationFrame(function tick() {
      const element = members.current;
      if (element) {
        if (element.scrollHeight !== measured.current) {
          measured.current = element.scrollHeight;
          syncOverflow(element);
        }
        // A body that no longer sits where our own write left it was moved by something else: a
        // scrollbar drag, a key, or a wheel that chained out of a nested viewport. Stand down at once
        // instead of pinning the tail back, or the gesture visibly fails to take effect.
        if (sticking.current && !holdsWritten(element.scrollTop, written.current)) {
          sticking.current = false;
          written.current = -1;
        }
        const offset = followFrame(element, sticking.current);
        if (offset !== null) {
          element.scrollTop = offset;
          written.current = offset;
        }
      }
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [open, follow]);
  // Only a capped body is a scroll region; the summary row above it stays the reader's handle.
  const region = grouped && open && overflowing;
  const toggle = useCallback(() => { onRead(); if (open) onCloseThoughts?.(group.items); setChoice(!open); }, [onRead, open, onCloseThoughts, group.items]);
  const { running, failed } = group.facts;
  return <div className={css.group} data-reader-group={grouped ? group.key : undefined} data-reader-group-tools={group.items.some(item => item.kind === 'tool') || undefined}
    data-group-state={grouped ? running ? 'running' : 'settled' : undefined} data-expanded={open}>
    {grouped && <Line icon={<IconFlatListOutlineRegular size={14} />} label={groupSummary(group.facts)} tone={failed > 0 ? 'failed' : running ? 'running' : 'idle'}
      shimmer={running && motion} trailing={failed > 0 ? <span>· {failed} 次失败</span> : undefined}
      open={open} onToggle={toggle} controls={id} />}
    <div id={id} ref={members} className={css.members} data-single={!grouped}
      role={region ? 'region' : undefined} tabIndex={region ? 0 : undefined}
      aria-label={region ? `${groupSummary(group.facts)}，可滚动阅读` : undefined}>
      {group.items.map(item => <Fragment key={item.key}>
        <CollapseBody open={open} motion={motion}>{renderItem(item, memberOpenChange)}</CollapseBody>
        {renderMedia?.(item)}
      </Fragment>)}
    </div>
  </div>;
}

export const ToolGroupRow = memo(ToolGroupRowView, sameToolGroupProps);
