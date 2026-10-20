import { Fragment, memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import type { AssistantChatData } from '@deepseek-ai/dsh-client-ui-chat/client';
import { BlockBoundary, Blocks } from './Blocks.js';
import { useChatSelector, usePendingSelector } from './compat/session-snapshot.js';
import type { MarkdownFileMentions } from './markdown/render.js';
import { SystemPromptRow } from './native/SystemPromptRow.js';
import { nodeText } from './node-payloads.js';
import { Opening } from './Opening.js';
import { PlanCard } from './PlanCard.js';
import { commandOutputText, elapsedLabel, elapsedTimeLabel, layoutTurn, panelStatus, runningLabel, statusLabel, type PanelItem, type ReasoningItem } from './process-steps.js';
import { assistantSegments, boundaryOf, terminalLabel, type ReaderGroup } from './projection.js';
import { useReaderActions } from './reader-context.js';
import { createGroupSelector } from './reader-selection.js';
import { InputBubble, RecordRow, TurnNotice } from './RecordRows.js';
import type { RewindSpan } from './rewind-hidden.js';
import { StatusLine } from './StatusLine.js';
import { RevealLedgerContext, type RevealLedger } from './streaming.js';
import { ThoughtRow } from './ThoughtRow.js';
import { activitySummary, readerFlow } from './tool-activity.js';
import { ToolGroupRow } from './ToolGroupRow.js';
import { ToolImages, ToolRow } from './ToolRow.js';
import { buildTranscript, liveThoughtKey, planStatus, transcriptThoughts, type TranscriptEntry } from './transcript-model.js';
import { TurnFooter } from './TurnFooter.js';
import { TurnDisclosure } from './TurnDisclosure.js';
import { isProcessEntry, processCounts, transcriptSeatKey, turnProcessOpen } from './turn-process.js';
import { closingOf } from './turn-meta.js';
import { formatSeconds } from './turn-activity.js';
import type { BlockRenderProps, ReaderProps } from './types.js';
import css from './TurnSection.module.css';

const OPENING_KINDS = new Set(['user', 'turn-trigger', 'command-input']);
const EMPTY_BLOCKS: AssistantChatData['blocks'] = [];

type SegmentProps = BlockRenderProps & Pick<ReaderProps, 'useSession'> & { nodeKey: string; start: number; pinned: boolean };

function useSegment(useSession: ReaderProps['useSession'], nodeKey: string, start: number) {
  const node = useChatSelector(useSession, chat => chat.nodes.get(nodeKey));
  const data = node && node.visibility !== 'hidden' && node.kind === 'assistant-step' ? node.data as AssistantChatData : undefined;
  const blocks = data?.blocks ?? EMPTY_BLOCKS;
  const parts = useMemo(() => assistantSegments(blocks), [blocks]);
  const index = parts.findIndex(part => part.start === start);
  return { data, part: index >= 0 ? parts[index] : undefined, last: index === parts.length - 1 };
}

/** The answer zone and the panel's narration show the same body segment under one reveal identity. */
const revealKeyOf = (nodeKey: string, start: number) => `${nodeKey}:${start}`;

const ThoughtSegment = memo(function ThoughtSegment({ useSession, nodeKey, start, pinned, onRead, followStep, active = false, retain = false, held = false, liveStatus, onReleased, onManualReadChange, onFocusChange, onHoverChange, ...render }: SegmentProps & {
  onRead: () => void; followStep: number | null; active?: boolean; retain?: boolean; held?: boolean; liveStatus?: ReactNode;
  onReleased?: (key: string) => void; onManualReadChange?: (key: string, reading: boolean) => void;
  onFocusChange?: (key: string, focused: boolean) => void; onHoverChange?: (key: string, hovered: boolean) => void;
}) {
  const { motion } = useReaderActions();
  const thoughtKey = `${nodeKey}:${start}`;
  const released = useCallback(() => onReleased?.(thoughtKey), [onReleased, thoughtKey]);
  const manualRead = useCallback((reading: boolean) => onManualReadChange?.(thoughtKey, reading), [onManualReadChange, thoughtKey]);
  const { data, part } = useSegment(useSession, nodeKey, start);
  const durationMs = useMemo(() => {
    const timing = data?.finalNode?.timing;
    if (!timing || timing.stepStartTime == null) return null;
    const end = timing.firstTokenTime ?? timing.completedTime;
    return end == null ? null : Math.max(0, end - timing.stepStartTime);
  }, [data]);
  if (!data || !part) return null;
  const seat = active || held || retain;
  return <div data-reader-live-seat={active || held || undefined} data-reader-key={thoughtKey}
    onFocusCapture={seat ? () => onFocusChange?.(thoughtKey, true) : undefined}
    onBlurCapture={seat ? event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onFocusChange?.(thoughtKey, false); } : undefined}
    onMouseEnter={seat ? () => onHoverChange?.(thoughtKey, true) : undefined} onMouseLeave={() => onHoverChange?.(thoughtKey, false)}>
    <ThoughtRow durationMs={durationMs} motion={motion} onRead={onRead} follow={data.step === followStep && !pinned}
      active={active} retain={retain} held={held} liveStatus={liveStatus} onReleased={released} onManualReadChange={manualRead}>
      <Blocks {...render} blocks={part.blocks} streaming={active && data.status === 'running' && data.blocks.at(-1)?.kind === 'reasoning'} holdFormatting={pinned} startedAt={data.time} interrupted={data.status === 'interrupted'} liveText />
    </ThoughtRow>
  </div>;
});

const BodySegment = memo(function BodySegment({ useSession, nodeKey, start, pinned, answer = false, fileMentions, ...render }: SegmentProps & { answer?: boolean; fileMentions?: MarkdownFileMentions }) {
  const { data, part, last } = useSegment(useSession, nodeKey, start);
  if (!data || !part) return null;
  return <article className={css.prose} data-reader-answer={answer || undefined} data-reader-anchor={answer || undefined} data-reader-key={nodeKey} data-reader-source-start={start} data-answer-status={data.status}>
    <Blocks {...render} blocks={part.blocks} streaming={data.status === 'running'} holdFormatting={pinned} startedAt={data.time} interrupted={data.status === 'interrupted'} liveText revealKey={revealKeyOf(nodeKey, start)} fileMentions={fileMentions} />
    {answer && last && data.status === 'interrupted' && <span className={css.stopped}>已停止</span>}
  </article>;
});

/** A successful command result reads as Markdown at its source position. */
const CommandOutput = memo(function CommandOutput({ useSession, nodeKey, ...render }: BlockRenderProps & Pick<ReaderProps, 'useSession'> & { nodeKey: string }) {
  const node = useChatSelector(useSession, chat => chat.nodes.get(nodeKey));
  const text = node && node.visibility !== 'hidden' ? commandOutputText(node) : null;
  if (text === null) return null;
  return <div className={`${css.output} ${css.prose}`} data-reader-command-output data-reader-key={nodeKey}>
    <Blocks {...render} blocks={[{ kind: 'text', text }]} />
  </div>;
});

const PromptPreamble = memo(function PromptPreamble({ useSession, nodeKey }: Pick<ReaderProps, 'useSession'> & { nodeKey: string }) {
  const node = useChatSelector(useSession, chat => chat.nodes.get(nodeKey));
  const text = node && node.visibility !== 'hidden' ? nodeText(node.data) : null;
  return text ? <SystemPromptRow text={text} /> : null;
});

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [active]);
  return now;
}

/** A one-second clock belongs to the activity text, never to historical process renderers. */
const LiveStatusLine = memo(function LiveStatusLine({ phase, label, start, thinkingStart, motion, tail = false }: {
  phase: 'running' | 'waiting'; label: string; start: number | undefined; thinkingStart?: number; motion: boolean; tail?: boolean;
}) {
  const now = useNow(true);
  const thinking = typeof thinkingStart === 'number' ? formatSeconds(Math.max(0, Math.round((now - thinkingStart) / 1000))) : null;
  return <StatusLine phase={phase} label={label} elapsed={elapsedTimeLabel(start, now, true)} thinking={thinking} motion={motion} tail={tail} />;
});

/** One turn: opening, the transcript flow, tool media, answer, notices, status line, live thinking, footer. */
export const TurnSection = memo(function TurnSection({ group, pinnedKeys, rewindHidden, rewindSpans, flowTail, ...props }: ReaderProps & {
  group: ReaderGroup; pinnedKeys: readonly string[];
  rewindHidden: ReadonlySet<number>; rewindSpans: readonly RewindSpan[]; flowTail?: ReactNode;
}) {
  const { motion, fileMentions } = useReaderActions();
  const selectGroup = useMemo(() => createGroupSelector(group), [group]);
  const chat = useChatSelector(props.useSession, selectGroup);
  const turn = chat.turn;
  const nextBoundary = boundaryOf(turn);
  const boundary = useMemo(() => nextBoundary, [nextBoundary.status, nextBoundary.reason, nextBoundary.latestStep, nextBoundary.closingStep]);
  const pendingCount = usePendingSelector(props.useSession, pending => pending.length);
  const get = useCallback((key: string) => chat.nodes.get(key), [chat]);
  const revealLedger = useMemo<RevealLedger>(() => new Map(), []);
  // The opening is the first user / trigger / command input before any assistant or tool row; system prompts
  // above it are preambles, and every other node (context, records) keeps its normal routing.
  const leading = useMemo(() => {
    let opening: string | null = null;
    const preamble: string[] = [];
    for (const key of group.keys) {
      const node = chat.nodes.get(key);
      if (!node) continue;
      if (node.kind === 'assistant-step' || node.kind === 'tool-call') break;
      if (OPENING_KINDS.has(node.kind)) { opening = key; break; }
      if (node.kind === 'system-prompt') preamble.push(key);
    }
    if (opening === null) return { opening, preamble: [] as string[], main: group.keys };
    const taken = new Set([opening, ...preamble]);
    return { opening, preamble, main: group.keys.filter(key => !taken.has(key)) };
  }, [chat, group.keys]);
  const preambleKeys = leading.preamble;
  const mainKeys = leading.main;
  const flow = useMemo(() => readerFlow({ ...group, keys: mainKeys }, turn, get, { hidden: rewindHidden, spans: rewindSpans }), [group, mainKeys, turn, get, rewindHidden, rewindSpans]);
  const layout = useMemo(() => layoutTurn(flow, get, boundary), [flow, get, boundary]);
  const status = panelStatus(boundary, pendingCount);
  const closed = boundary.status === 'closed';
  const open = boundary.status === 'open';
  const entries = useMemo(() => buildTranscript(layout.transcript, get, closed), [layout.transcript, get, closed]);
  const thoughts = useMemo(() => transcriptThoughts(entries), [entries]);
  const liveKey = useMemo(() => liveThoughtKey(entries, get, open), [entries, get, open]);
  const live = liveKey ? thoughts.find(item => item.key === liveKey) : undefined;
  const [recentLive, setRecentLive] = useState<{ key: string | null; held: ReadonlySet<string> }>(() => ({ key: liveKey, held: new Set(liveKey ? [liveKey] : []) }));
  if (recentLive.key !== liveKey) setRecentLive(previous => ({ key: liveKey, held: liveKey ? new Set([...previous.held, liveKey]) : previous.held }));
  const [focusedLive, setFocusedLive] = useState<string | null>(null);
  const [hoveredLive, setHoveredLive] = useState<string | null>(null);
  const [manualLive, setManualLive] = useState<ReadonlySet<string>>(() => new Set());
  const manualRead = useCallback((key: string, reading: boolean) => {
    // The exit button itself receives focus before click. Removing it need not emit blur.
    if (!reading) setFocusedLive(previous => previous === key ? null : previous);
    setManualLive(previous => {
      if (previous.has(key) === reading) return previous;
      const next = new Set(previous);
      if (reading) next.add(key); else next.delete(key);
      return next;
    });
  }, []);
  const focusRead = useCallback((key: string, focused: boolean) => setFocusedLive(previous => focused ? key : previous === key ? null : previous), []);
  const hoverRead = useCallback((key: string, hovered: boolean) => setHoveredLive(previous => hovered ? key : previous === key ? null : previous), []);
  const releaseRead = useCallback((key: string) => {
    setRecentLive(previous => {
      if (!previous.held.has(key)) return previous;
      const held = new Set(previous.held); held.delete(key);
      return { ...previous, held };
    });
    manualRead(key, false);
    setHoveredLive(previous => previous === key ? null : previous);
  }, [manualRead]);
  const selectedLive = thoughts.filter(item => pinnedKeys.includes(item.key));
  const flowPinned = pinnedKeys.includes(group.key) || selectedLive.length > 0;
  // Keep the selected/focused thought's existing DOM until reading ends, even when a new step starts.
  const liveSeats = thoughts.filter(item => item.key === liveKey || recentLive.held.has(item.key)
    || item.key === focusedLive || item.key === hoveredLive || manualLive.has(item.key) || pinnedKeys.includes(item.key));
  const processId = useId();
  const choiceKey = `process:${props.sessionId}:${group.key}`;
  const processChoice = props.useStore(state => state.expanded[choiceKey]);
  const [processFocused, setProcessFocused] = useState(false);
  const selectedProcess = flowPinned || entries.some(entry => isProcessEntry(entry) && 'item' in entry
    && 'nodeKey' in entry.item && pinnedKeys.includes(entry.item.nodeKey));
  const readingProcess = selectedProcess || processFocused || liveSeats.length > 0;
  const [dismissReading, setDismissReading] = useState(false);
  useEffect(() => { if (dismissReading && (!closed || !readingProcess)) setDismissReading(false); }, [closed, readingProcess, dismissReading]);
  const processOpen = turnProcessOpen(processChoice, closed, boundary.reason, readingProcess && !dismissReading);
  const hasProcess = entries.some(isProcessEntry);
  // The tail process group of an open turn stays open: between two steps nothing is running for a
  // moment, and folding there made the same block collapse and reopen once per tool call.
  const liveProcessKey = open ? [...entries].reverse().find(isProcessEntry)?.key : undefined;
  const counts = useMemo(() => processCounts(turn, layout.panel), [turn, layout.panel]);
  const pointerChoice = useRef<boolean | null>(null);
  const captureProcessToggle = useCallback(() => { pointerChoice.current = !processOpen; }, [processOpen]);
  const toggleProcess = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    // Focus leaves a process control before click. Preserve the intent at pointer-down;
    // keyboard/programmatic activation uses the state currently announced by the button.
    const next = event.detail > 0 ? pointerChoice.current ?? !processOpen : !processOpen;
    pointerChoice.current = null;
    setDismissReading(!next && readingProcess);
    if (!next) setManualLive(new Set());
    setProcessFocused(false);
    props.actions.setExpanded(choiceKey, next);
  }, [props.actions, choiceKey, processOpen, readingProcess]);
  const now = Date.now();
  const liveData = live ? get(live.nodeKey)?.data as AssistantChatData | undefined : undefined;
  const thinkingStart = live && typeof liveData?.time === 'number' ? liveData.time : undefined;
  const closingSeq = closingOf(turn)?.seq;
  // The host hands back a fresh resolver per call; keep one per turn and closing reply so the answer's Blocks stay memoised.
  const mentions = useMemo(() => status === 'done' && turn && closingSeq !== undefined ? fileMentions?.(turn, closingSeq) : undefined, [status, turn, closingSeq, fileMentions]);
  const shared = useMemo(() => ({ renderSlotChain: props.renderSlotChain, loadImage: props.loadImage, mediaUrl: props.mediaUrl }), [props.renderSlotChain, props.loadImage, props.mediaUrl]);
  const noop = useCallback(() => {}, []);
  const lastAnswerKey = layout.answer.at(-1)?.key;
  const activeLabel = status === 'waiting' ? '等待你的操作' : runningLabel(turn, group.keys, get);
  const turnStart = turn?.start?.time;
  const liveStatus = useMemo(() => liveKey ? <LiveStatusLine phase={status === 'waiting' ? 'waiting' : 'running'}
    label={activeLabel} start={turnStart} thinkingStart={thinkingStart} motion={motion} /> : undefined,
  [liveKey, status, activeLabel, turnStart, thinkingStart, motion]);
  const closeThoughts = useCallback((items: readonly PanelItem[]) => {
    for (const item of items) if (item.kind === 'reasoning') releaseRead(item.key);
  }, [releaseRead]);
  const renderThought = useCallback((item: ReasoningItem): ReactNode => <BlockBoundary><ThoughtSegment {...shared}
    useSession={props.useSession} nodeKey={item.nodeKey} start={item.start} pinned={flowPinned} onRead={noop}
    followStep={open ? boundary.latestStep : null} active={item.key === liveKey} held={recentLive.held.has(item.key)}
    retain={item.key === focusedLive || item.key === hoveredLive || manualLive.has(item.key) || pinnedKeys.includes(item.key)}
    onReleased={releaseRead} onManualReadChange={manualRead} onFocusChange={focusRead} onHoverChange={hoverRead}
    liveStatus={item.key === liveKey ? liveStatus : undefined} /></BlockBoundary>,
  [shared, props.useSession, flowPinned, noop, open, boundary.latestStep, liveKey, recentLive.held, focusedLive, hoveredLive,
    manualLive, pinnedKeys, releaseRead, manualRead, focusRead, hoverRead, liveStatus]);
  const renderItem = useCallback((item: PanelItem, onOpenChange?: (key: string, open: boolean) => void): ReactNode => {
    switch (item.kind) {
      case 'tool': return <BlockBoundary><ToolRow {...shared} entry={item.entry} turnClosed={closed} onRead={noop} onOpenChange={onOpenChange} /></BlockBoundary>;
      case 'record': return <BlockBoundary><RecordRow {...shared} useSession={props.useSession} nodeKey={item.nodeKey} t={props.contextT} onRead={noop} onOpenChange={onOpenChange} turnClosed={closed} /></BlockBoundary>;
      case 'input': return <BlockBoundary><InputBubble {...shared} useSession={props.useSession} nodeKey={item.nodeKey} /></BlockBoundary>;
      case 'narration': return <BlockBoundary><BodySegment {...shared} useSession={props.useSession} nodeKey={item.nodeKey} start={item.start} answer={item.answer}
        pinned={flowPinned || pinnedKeys.includes(item.nodeKey)} fileMentions={item.answer && item.key === lastAnswerKey ? mentions : undefined} /></BlockBoundary>;
      case 'reasoning': return renderThought(item);
      case 'media': return <BlockBoundary><ToolImages {...shared} entries={[item.entry]} /></BlockBoundary>;
      case 'output': return <BlockBoundary><CommandOutput {...shared} useSession={props.useSession} nodeKey={item.nodeKey} /></BlockBoundary>;
      case 'notice': return <BlockBoundary><TurnNotice useSession={props.useSession} nodeKey={item.nodeKey} /></BlockBoundary>;
    }
  }, [shared, props.useSession, props.contextT, closed, noop, flowPinned, pinnedKeys, mentions, lastAnswerKey, renderThought]);
  const renderMedia = useCallback((item: PanelItem): ReactNode => item.kind === 'tool'
    ? <BlockBoundary><ToolImages {...shared} entries={[item.entry]} /></BlockBoundary> : null, [shared]);
  const renderEntry = (entry: TranscriptEntry): ReactNode => {
    switch (entry.kind) {
      case 'group': return <ToolGroupRow key={entry.key} group={entry} motion={motion} onRead={noop} renderItem={renderItem} renderMedia={renderMedia}
        live={entry.key === liveProcessKey}
        retain={entry.items.some(item => liveSeats.some(seat => seat.key === item.key))} onCloseThoughts={closeThoughts} />;
      case 'plan': return <BlockBoundary key={entry.key}><PlanCard key="plan" todos={entry.todos} {...planStatus(entry, closed)}>
        {entry.calls.map(call => <Fragment key={call.key}>{renderItem(call)}</Fragment>)}
      </PlanCard>{entry.calls.map(call => <Fragment key={call.key}>{renderMedia(call)}</Fragment>)}</BlockBoundary>;
      case 'input': return <div key={entry.key} className={css.input}>{renderItem(entry.item)}</div>;
      case 'thought': return renderThought(entry.item);
      case 'item': {
        if (entry.facts) {
          const key = `group:${entry.key}`;
          return <ToolGroupRow key={key} group={{ kind: 'group', key, items: [entry.item], facts: entry.facts }} motion={motion} onRead={noop} renderItem={renderItem} renderMedia={renderMedia} />;
        }
        if (entry.item.kind === 'tool' && activitySummary(entry.item.entry).name === 'todo_write') return <BlockBoundary key={entry.key}>
          <PlanCard key="plan" todos={[]} hasChecklist={false}>{<Fragment key={entry.item.key}>{renderItem(entry.item)}</Fragment>}</PlanCard>
          {[entry.item].map(call => <Fragment key={call.key}>{renderMedia(call)}</Fragment>)}
        </BlockBoundary>;
        return <Fragment key={entry.key}>{renderItem(entry.item)}{renderMedia(entry.item)}</Fragment>;
      }
      default: return <Fragment key={entry.key}>{renderItem(entry.item)}</Fragment>;
    }
  };
  const answerBlocks = useMemo(() => layout.answer.flatMap(segment => {
    const node = get(segment.nodeKey);
    if (!node || node.kind !== 'assistant-step') return [];
    return assistantSegments((node.data as AssistantChatData).blocks).find(part => part.start === segment.start)?.blocks ?? [];
  }), [layout.answer, get]);
  const answerText = useMemo(() => answerBlocks.flatMap(block => block.kind === 'text' ? [block.text] : []).join('\n\n'), [answerBlocks]);
  const terminal = terminalLabel(boundary.reason);
  const stopped = closed && boundary.reason !== 'completed';
  return <RevealLedgerContext.Provider value={revealLedger}><section className={css.turn} data-reader-turn={group.turn ?? 'unresolved'} data-reader-turn-state={boundary.status} data-reader-turn-result={boundary.reason ?? undefined}>
    {preambleKeys.map(key => <BlockBoundary key={key}><PromptPreamble useSession={props.useSession} nodeKey={key} /></BlockBoundary>)}
    {leading.opening && <BlockBoundary><Opening {...shared} useSession={props.useSession} nodeKey={leading.opening} /></BlockBoundary>}
    {closed && hasProcess && <TurnDisclosure label={statusLabel(status, boundary.reason, '')} elapsed={elapsedLabel(turn, now, status)}
      {...counts} open={processOpen} onToggle={toggleProcess} onPointerDown={captureProcessToggle} controls={processId} danger={status !== 'done'} />}
    {entries.length > 0 && <div id={processId} className={css.flow} data-reader-flow data-reader-process-key={group.key} data-process-open={processOpen}
      onFocusCapture={event => setProcessFocused(!!(event.target as Element).closest('[data-reader-process-entry="true"]'))}
      onBlurCapture={event => setProcessFocused(event.relatedTarget instanceof Element && event.currentTarget.contains(event.relatedTarget)
        && !!event.relatedTarget.closest('[data-reader-process-entry="true"]'))}>
      {entries.map(entry => {
        const process = isProcessEntry(entry);
        const folded = process && !processOpen;
        return <div key={transcriptSeatKey(entry)} className={css.entry} data-reader-process-entry={process} data-reader-process-key={process ? group.key : undefined}
          data-folded={folded} aria-hidden={folded || undefined} {...(folded ? { inert: '' } : {})}>
          <div className={css.entryContent}>{renderEntry(entry)}</div>
        </div>;
      })}
    </div>}
    {open && !liveKey && <LiveStatusLine tail phase={status === 'waiting' ? 'waiting' : 'running'} label={activeLabel}
      start={turnStart} motion={motion} />}
    {stopped && <StatusLine phase={status === 'interrupted' ? 'interrupted' : 'error'} label={terminal ?? statusLabel(status, boundary.reason, '')} elapsed={elapsedLabel(turn, now, status)} thinking={null} motion={motion} />}
    {closed && <BlockBoundary><TurnFooter turn={turn} answerText={answerText} /></BlockBoundary>}
    {flowTail}
  </section></RevealLedgerContext.Provider>;
});
