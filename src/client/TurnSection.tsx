import { Fragment, memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import type { AssistantChatData } from '@deepseek-ai/dsh-client-ui-chat/client';
import { BlockBoundary, Blocks } from './Blocks.js';
import { useChatSelector, usePendingSelector } from './compat/session-snapshot.js';
import { LiveThought } from './LiveThought.js';
import type { MarkdownFileMentions } from './markdown/render.js';
import { SystemPromptRow } from './native/SystemPromptRow.js';
import { nodeText } from './node-payloads.js';
import { Opening } from './Opening.js';
import { PlanCard } from './PlanCard.js';
import { commandOutputText, elapsedLabel, layoutTurn, panelStatus, runningLabel, statusLabel, type PanelItem } from './process-steps.js';
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
import { buildTranscript, liveThoughtKey, planStatus, type TranscriptEntry } from './transcript-model.js';
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

const ThoughtSegment = memo(function ThoughtSegment({ useSession, nodeKey, start, pinned, onRead, ...render }: SegmentProps & { onRead: () => void }) {
  const { motion } = useReaderActions();
  const { data, part } = useSegment(useSession, nodeKey, start);
  const durationMs = useMemo(() => {
    const timing = data?.finalNode?.timing;
    if (!timing || timing.stepStartTime == null) return null;
    const end = timing.firstTokenTime ?? timing.completedTime;
    return end == null ? null : Math.max(0, end - timing.stepStartTime);
  }, [data]);
  if (!data || !part) return null;
  return <ThoughtRow durationMs={durationMs} motion={motion} onRead={onRead}>
    <Blocks {...render} blocks={part.blocks} holdFormatting={pinned} startedAt={data.time} interrupted={data.status === 'interrupted'} liveText />
  </ThoughtRow>;
});

const LiveSegment = memo(function LiveSegment({ useSession, nodeKey, start, pinned, follow, ...render }: SegmentProps & { follow: boolean }) {
  const { motion } = useReaderActions();
  const { data, part } = useSegment(useSession, nodeKey, start);
  if (!data || !part) return null;
  return <LiveThought follow={follow} motion={motion}>
    <Blocks {...render} blocks={part.blocks} streaming={data.status === 'running' && data.blocks.at(-1)?.kind === 'reasoning'} holdFormatting={pinned} startedAt={data.time} liveText />
  </LiveThought>;
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
  const liveKey = useMemo(() => liveThoughtKey(entries, get, open), [entries, get, open]);
  const live = liveKey ? entries.at(-1) as Extract<TranscriptEntry, { kind: 'thought' }> : null;
  const [focusedLive, setFocusedLive] = useState<string | null>(null);
  const selectedLive = entries.filter((entry): entry is Extract<TranscriptEntry, { kind: 'thought' }> => entry.kind === 'thought' && pinnedKeys.includes(entry.key));
  const flowPinned = pinnedKeys.includes(group.key) || selectedLive.length > 0;
  // Keep the selected/focused thought's existing DOM until reading ends, even when a new step starts.
  const liveSeats = entries.filter((entry): entry is Extract<TranscriptEntry, { kind: 'thought' }> => entry.kind === 'thought'
    && (entry.key === liveKey || entry.key === focusedLive || pinnedKeys.includes(entry.key)));
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
  const counts = useMemo(() => processCounts(turn, layout.panel), [turn, layout.panel]);
  const pointerChoice = useRef<boolean | null>(null);
  const captureProcessToggle = useCallback(() => { pointerChoice.current = !processOpen; }, [processOpen]);
  const toggleProcess = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    // Focus leaves a process control before click. Preserve the intent at pointer-down;
    // keyboard/programmatic activation uses the state currently announced by the button.
    const next = event.detail > 0 ? pointerChoice.current ?? !processOpen : !processOpen;
    pointerChoice.current = null;
    setDismissReading(!next && readingProcess);
    setProcessFocused(false);
    props.actions.setExpanded(choiceKey, next);
  }, [props.actions, choiceKey, processOpen, readingProcess]);
  const now = useNow(status === 'running' || status === 'waiting');
  const liveData = live ? get(live.item.nodeKey)?.data as AssistantChatData | undefined : undefined;
  const thinking = live && typeof liveData?.time === 'number' ? formatSeconds(Math.max(0, Math.round((now - liveData.time) / 1000))) : null;
  const closingSeq = closingOf(turn)?.seq;
  // The host hands back a fresh resolver per call; keep one per turn and closing reply so the answer's Blocks stay memoised.
  const mentions = useMemo(() => status === 'done' && turn && closingSeq !== undefined ? fileMentions?.(turn, closingSeq) : undefined, [status, turn, closingSeq, fileMentions]);
  const shared = useMemo(() => ({ renderSlotChain: props.renderSlotChain, loadImage: props.loadImage }), [props.renderSlotChain, props.loadImage]);
  const noop = useCallback(() => {}, []);
  const lastAnswerKey = layout.answer.at(-1)?.key;
  const renderItem = useCallback((item: PanelItem, onOpenChange?: (key: string, open: boolean) => void): ReactNode => {
    switch (item.kind) {
      case 'tool': return <BlockBoundary><ToolRow {...shared} entry={item.entry} turnClosed={closed} onRead={noop} onOpenChange={onOpenChange} /></BlockBoundary>;
      case 'record': return <BlockBoundary><RecordRow {...shared} useSession={props.useSession} nodeKey={item.nodeKey} t={props.contextT} onRead={noop} onOpenChange={onOpenChange} turnClosed={closed} /></BlockBoundary>;
      case 'input': return <BlockBoundary><InputBubble {...shared} useSession={props.useSession} nodeKey={item.nodeKey} /></BlockBoundary>;
      case 'narration': return <BlockBoundary><BodySegment {...shared} useSession={props.useSession} nodeKey={item.nodeKey} start={item.start} answer={item.answer}
        pinned={flowPinned || pinnedKeys.includes(item.nodeKey)} fileMentions={item.answer && item.key === lastAnswerKey ? mentions : undefined} /></BlockBoundary>;
      case 'reasoning': return <BlockBoundary><ThoughtSegment {...shared} useSession={props.useSession} nodeKey={item.nodeKey} start={item.start} pinned={flowPinned} onRead={noop} /></BlockBoundary>;
      case 'media': return <BlockBoundary><ToolImages {...shared} entries={[item.entry]} /></BlockBoundary>;
      case 'output': return <BlockBoundary><CommandOutput {...shared} useSession={props.useSession} nodeKey={item.nodeKey} /></BlockBoundary>;
      case 'notice': return <BlockBoundary><TurnNotice useSession={props.useSession} nodeKey={item.nodeKey} /></BlockBoundary>;
    }
  }, [shared, props.useSession, props.contextT, closed, noop, flowPinned, pinnedKeys, mentions, lastAnswerKey]);
  const renderMedia = useCallback((item: PanelItem): ReactNode => item.kind === 'tool'
    ? <BlockBoundary><ToolImages {...shared} entries={[item.entry]} /></BlockBoundary> : null, [shared]);
  const renderEntry = (entry: TranscriptEntry): ReactNode => {
    switch (entry.kind) {
      case 'group': return <ToolGroupRow key={entry.key} group={entry} motion={motion} onRead={noop} renderItem={renderItem} renderMedia={renderMedia} />;
      case 'plan': return <BlockBoundary key={entry.key}><PlanCard key="plan" todos={entry.todos} {...planStatus(entry, closed)}>
        {entry.calls.map(call => <Fragment key={call.key}>{renderItem(call)}</Fragment>)}
      </PlanCard>{entry.calls.map(call => <Fragment key={call.key}>{renderMedia(call)}</Fragment>)}</BlockBoundary>;
      case 'input': return <div key={entry.key} className={css.input}>{renderItem(entry.item)}</div>;
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
      {entries.filter(entry => !liveSeats.some(seat => seat.key === entry.key)).map(entry => {
        const process = isProcessEntry(entry);
        const folded = process && !processOpen;
        return <div key={transcriptSeatKey(entry)} className={css.entry} data-reader-process-entry={process} data-reader-process-key={process ? group.key : undefined}
          data-folded={folded} aria-hidden={folded || undefined} {...(folded ? { inert: '' } : {})}>
          <div className={css.entryContent}>{renderEntry(entry)}</div>
        </div>;
      })}
    </div>}
    {open && <StatusLine phase={status === 'waiting' ? 'waiting' : 'running'} label={status === 'waiting' ? '等待你的操作' : runningLabel(turn, group.keys, get)}
      elapsed={elapsedLabel(turn, now, status)} thinking={thinking} motion={motion} />}
    {liveSeats.map(seat => <div key={seat.key} data-reader-live-seat data-reader-key={seat.key} data-reader-process-key={group.key}
      onFocusCapture={() => setFocusedLive(seat.key)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusedLive(null); }}>
      <BlockBoundary><LiveSegment {...shared} useSession={props.useSession} nodeKey={seat.item.nodeKey} start={seat.item.start} pinned={flowPinned} follow={seat.key === liveKey && boundary.latestStep === liveData?.step} /></BlockBoundary>
    </div>)}
    {stopped && <StatusLine phase={status === 'interrupted' ? 'interrupted' : 'error'} label={terminal ?? statusLabel(status, boundary.reason, '')} elapsed={elapsedLabel(turn, now, status)} thinking={null} motion={motion} />}
    {closed && <BlockBoundary><TurnFooter turn={turn} answerText={answerText} /></BlockBoundary>}
    {flowTail}
  </section></RevealLedgerContext.Provider>;
});
