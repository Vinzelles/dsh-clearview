import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { AssistantChatData } from '@deepseek-ai/dsh-client-ui-chat/client';
import { BlockBoundary, Blocks } from './Blocks.js';
import { useChatSelector, usePendingSelector } from './compat/session-snapshot.js';
import type { MarkdownFileMentions } from './markdown/render.js';
import { StatusText } from './motion.js';
import { SystemPromptRow } from './native/SystemPromptRow.js';
import { nodeText } from './node-payloads.js';
import { Opening } from './Opening.js';
import { ProcessPanel } from './ProcessPanel.js';
import { commandOutputText, elapsedLabel, layoutTurn, panelCounts, panelStatus, runningLabel, statusLabel, type PanelItem } from './process-steps.js';
import { assistantSegments, boundaryOf, processChoiceKey, processExpanded, terminalLabel, type ReaderGroup, type TurnBoundary } from './projection.js';
import { ReasoningRow, reasoningPreview } from './ReasoningRow.js';
import { useReaderActions } from './reader-context.js';
import { createGroupSelector } from './reader-selection.js';
import { InputBubble, RecordRow, TurnNotice } from './RecordRows.js';
import type { RewindSpan } from './rewind-hidden.js';
import { RevealLedgerContext, type RevealLedger } from './streaming.js';
import { activityPhase, readerFlow } from './tool-activity.js';
import { ToolImages, ToolRow } from './ToolRow.js';
import { TurnFooter } from './TurnFooter.js';
import { closingOf } from './turn-meta.js';
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

const ReasoningSegment = memo(function ReasoningSegment({ useSession, nodeKey, start, pinned, boundary, panelOpen, compact, onRead, ...render }: SegmentProps & {
  boundary: TurnBoundary; panelOpen: boolean; compact: boolean; onRead: () => void;
}) {
  const { motion } = useReaderActions();
  const { data, part, last } = useSegment(useSession, nodeKey, start);
  const thinkingMs = useMemo(() => {
    const timing = data?.finalNode?.timing;
    if (!timing) return null;
    if (timing.stepStartTime != null && timing.firstTokenTime != null) return Math.max(0, timing.firstTokenTime - timing.stepStartTime);
    if (timing.stepStartTime != null && timing.completedTime != null) return Math.max(0, timing.completedTime - timing.stepStartTime);
    return null;
  }, [data]);
  if (!data || !part) return null;
  const live = data.status === 'running' && last && data.blocks.at(-1)?.kind === 'reasoning';
  const text = part.blocks.map(block => block.kind === 'reasoning' ? block.text : '').join('\n');
  return <ReasoningRow step={data.step} live={live} follow={panelOpen && boundary.status === 'open' && data.step === boundary.latestStep}
    motion={motion} selected={pinned} onRead={onRead} compact={compact} durationMs={thinkingMs} startedAt={data.time}
    charCount={text.length} preview={reasoningPreview(text)}>
    <Blocks {...render} blocks={part.blocks} streaming={live} holdFormatting={pinned} startedAt={data.time} interrupted={data.status === 'interrupted'} liveText />
  </ReasoningRow>;
});

const NarrationSegment = memo(function NarrationSegment({ useSession, nodeKey, start, pinned, ...render }: SegmentProps) {
  const { data, part } = useSegment(useSession, nodeKey, start);
  if (!data || !part) return null;
  return <div className={css.narration} data-reader-narration data-reader-key={nodeKey}>
    <Blocks {...render} blocks={part.blocks} streaming={data.status === 'running'} holdFormatting={pinned} startedAt={data.time} interrupted={data.status === 'interrupted'} liveText revealKey={revealKeyOf(nodeKey, start)} />
  </div>;
});

const AnswerSegment = memo(function AnswerSegment({ useSession, nodeKey, start, pinned, fileMentions, ...render }: SegmentProps & { fileMentions?: MarkdownFileMentions }) {
  const { data, part, last } = useSegment(useSession, nodeKey, start);
  if (!data || !part) return null;
  return <article className={css.answer} data-reader-answer data-reader-anchor data-reader-key={nodeKey} data-reader-source-start={start} data-answer-status={data.status}>
    <Blocks {...render} blocks={part.blocks} streaming={data.status === 'running'} holdFormatting={pinned} startedAt={data.time} interrupted={data.status === 'interrupted'} liveText revealKey={revealKeyOf(nodeKey, start)} fileMentions={fileMentions} />
    {last && data.status === 'interrupted' && <span className={css.stopped}>已停止</span>}
  </article>;
});

/** A successful /command result reads as Markdown beside the answer; its lifecycle row stays in the panel. */
const CommandOutput = memo(function CommandOutput({ useSession, nodeKey, ...render }: BlockRenderProps & Pick<ReaderProps, 'useSession'> & { nodeKey: string }) {
  const node = useChatSelector(useSession, chat => chat.nodes.get(nodeKey));
  const text = node && node.visibility !== 'hidden' ? commandOutputText(node) : null;
  if (text === null) return null;
  return <div className={css.output} data-reader-command-output data-reader-key={nodeKey}>
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

/** One turn: opening, process panel, tool media, answer, notices, footer. */
export const TurnSection = memo(function TurnSection({ group, pinnedKeys, selectedProcessKeys, rewindHidden, rewindSpans, flowTail, ...props }: ReaderProps & {
  group: ReaderGroup; pinnedKeys: readonly string[]; selectedProcessKeys: readonly string[];
  rewindHidden: ReadonlySet<number>; rewindSpans: readonly RewindSpan[]; flowTail?: ReactNode;
}) {
  const { motion, fileMentions } = useReaderActions();
  const selectGroup = useMemo(() => createGroupSelector(group), [group]);
  const chat = useChatSelector(props.useSession, selectGroup);
  const turn = chat.turn;
  const nextBoundary = boundaryOf(turn);
  const boundary = useMemo(() => nextBoundary, [nextBoundary.status, nextBoundary.reason, nextBoundary.latestStep, nextBoundary.closingStep]);
  const pendingCount = usePendingSelector(props.useSession, pending => pending.length);
  const choiceKey = processChoiceKey(group.key, boundary);
  const expansionChoice = props.useStore(state => state.expanded[choiceKey]);
  // An opened earlier range stays open for the whole turn, so its key must not follow the turn's status.
  const earlierKey = `${group.key}:earlier`;
  const earlierOpen = props.useStore(state => state.expanded[earlierKey] ?? false);
  const compact = props.useStore(state => state.collapseThinking ?? false);
  const setOpen = useCallback((value: boolean) => props.actions.setExpanded(choiceKey, value), [props.actions, choiceKey]);
  const openEarlier = useCallback(() => props.actions.setExpanded(earlierKey, true), [props.actions, earlierKey]);
  const pinPanel = useCallback(() => setOpen(true), [setOpen]);
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
  const counts = useMemo(() => panelCounts(layout.panel, get, closed), [layout.panel, get, closed]);
  // Only a real, still-active text selection delays folding; clicking or scrolling never pins the panel.
  const open = selectedProcessKeys.includes(group.key) || processExpanded(expansionChoice, boundary);
  const now = useNow(status === 'running' || status === 'waiting');
  const label = statusLabel(status, boundary.reason, status === 'running' ? runningLabel(turn, group.keys, get) : '');
  const elapsed = elapsedLabel(turn, now, status);
  const isActive = useCallback((item: PanelItem) => item.kind === 'tool' && ['preparing', 'running'].includes(activityPhase(item.entry, closed)), [closed]);
  const panelPinned = pinnedKeys.includes(group.key);
  const closingSeq = closingOf(turn)?.seq;
  // The host hands back a fresh resolver per call; keep one per turn and closing reply so the answer's Blocks stay memoised.
  const mentions = useMemo(() => status === 'done' && turn && closingSeq !== undefined ? fileMentions?.(turn, closingSeq) : undefined, [status, turn, closingSeq, fileMentions]);
  const shared = useMemo(() => ({ renderSlotChain: props.renderSlotChain, loadImage: props.loadImage }), [props.renderSlotChain, props.loadImage]);
  const renderItem = useCallback((item: PanelItem): ReactNode => {
    switch (item.kind) {
      case 'reasoning': return <BlockBoundary><ReasoningSegment {...shared} useSession={props.useSession} nodeKey={item.nodeKey} start={item.start} pinned={panelPinned} boundary={boundary} panelOpen={open} compact={compact} onRead={pinPanel} /></BlockBoundary>;
      case 'narration': return <BlockBoundary><NarrationSegment {...shared} useSession={props.useSession} nodeKey={item.nodeKey} start={item.start} pinned={panelPinned} /></BlockBoundary>;
      case 'tool': return <BlockBoundary><ToolRow {...shared} entry={item.entry} turnClosed={closed} onRead={pinPanel} /></BlockBoundary>;
      case 'record': return <BlockBoundary><RecordRow {...shared} useSession={props.useSession} nodeKey={item.nodeKey} t={props.contextT} onRead={pinPanel} turnClosed={closed} /></BlockBoundary>;
      case 'input': return <BlockBoundary><InputBubble {...shared} useSession={props.useSession} nodeKey={item.nodeKey} /></BlockBoundary>;
    }
  }, [shared, props.useSession, props.contextT, panelPinned, boundary, open, compact, pinPanel, closed]);
  const answerBlocks = useMemo(() => layout.answer.flatMap(segment => {
    const node = get(segment.nodeKey);
    if (!node || node.kind !== 'assistant-step') return [];
    return assistantSegments((node.data as AssistantChatData).blocks).find(part => part.start === segment.start)?.blocks ?? [];
  }), [layout.answer, get]);
  const answerText = useMemo(() => answerBlocks.flatMap(block => block.kind === 'text' ? [block.text] : []).join('\n\n'), [answerBlocks]);
  const terminal = terminalLabel(boundary.reason);
  const showTerminal = terminal && boundary.reason !== 'error' && boundary.reason !== 'max-tokens';
  return <RevealLedgerContext.Provider value={revealLedger}><section className={css.turn} data-reader-turn={group.turn ?? 'unresolved'} data-reader-turn-state={boundary.status} data-reader-turn-result={boundary.reason ?? undefined}>
    {preambleKeys.map(key => <BlockBoundary key={key}><PromptPreamble useSession={props.useSession} nodeKey={key} /></BlockBoundary>)}
    {leading.opening && <BlockBoundary><Opening {...shared} useSession={props.useSession} nodeKey={leading.opening} /></BlockBoundary>}
    {layout.panel.length > 0 && <BlockBoundary><ProcessPanel panelKey={group.key} status={status} statusLabel={label} elapsed={elapsed} counts={counts}
      items={layout.panel} open={open} onOpenChange={setOpen} earlierOpen={earlierOpen} onEarlierOpen={openEarlier}
      motion={motion} isActive={isActive} renderItem={renderItem} /></BlockBoundary>}
    {layout.panel.length === 0 && boundary.status === 'open' && <div className={css.statusOnly} data-reader-status-only>
      <StatusText text={label} motion={motion} shimmer={status === 'running'} />
    </div>}
    {layout.media.length > 0 && <BlockBoundary><ToolImages {...shared} entries={layout.media} /></BlockBoundary>}
    {layout.outputs.map(key => <BlockBoundary key={key}><CommandOutput {...shared} useSession={props.useSession} nodeKey={key} /></BlockBoundary>)}
    {layout.answer.map((segment, index) => <BlockBoundary key={segment.key}>
      <AnswerSegment {...shared} useSession={props.useSession} nodeKey={segment.nodeKey} start={segment.start}
        pinned={pinnedKeys.includes(segment.nodeKey)} fileMentions={index === layout.answer.length - 1 ? mentions : undefined} />
    </BlockBoundary>)}
    {layout.notices.map(key => <BlockBoundary key={key}><TurnNotice useSession={props.useSession} nodeKey={key} /></BlockBoundary>)}
    {showTerminal && <p className={css.terminal} data-reader-terminal>{terminal}</p>}
    {closed && <BlockBoundary><TurnFooter turn={turn} answerText={answerText} /></BlockBoundary>}
    {flowTail}
  </section></RevealLedgerContext.Provider>;
});
