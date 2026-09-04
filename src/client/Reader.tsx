import { Fragment, memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-runtime/client';
import type { ChatNode, ChatNodeKind } from '@deepseek-ai/dsh-client-ui-conversation/client';
import { JsonBlock, JsonTree, MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives';
import { BlockBoundary, Blocks, contentBlocks, CopyAnswer } from './Blocks.js';
import { ReasoningCard } from './ReasoningCard.js';
import { ToolActivity, ToolMedia } from './ToolActivity.js';
import { formatOperationClusterSummary, groupOperationalFlow, isMergedExecutionFailure, preparingLabel, readerFlow } from './tool-activity.js';
import type { OperationalFlowItem, ReaderFlowEntry } from './tool-activity.js';
import { formatSeconds } from './turn-activity.js';
import { useTurnActivity } from './use-turn-activity.js';
import { Disclosure, ProcessFragment, RetiringContent, StatusText, useMotionAllowed, usePinnedSelection, useReadingScroll } from './motion.js';
import { StreamMotionContext } from './streaming.js';
import { assistantSegments, boundaryOf, groupNodes, hasProcessContent, hasVisibleBody, isEarlierNarration, processChoiceKey, processExpanded, terminalLabel } from './projection.js';
import { ContextInjectionRow } from './native/ContextInjectionRow.js';
import { hiddenSeqsOf, rewindSpansOf } from './rewind-hidden.js';
import type { RewindSpan } from './rewind-hidden.js';
import type { ReaderGroup, TurnBoundary } from './projection.js';
import type { BlockRenderProps, ReaderProps } from './types.js';
import css from './Reader.module.css';

function isNode<K extends ChatNodeKind>(node: ChatConversationViewNode, kind: K): node is ChatNode<K> {
  return node.kind === kind;
}

function commandOutcomeText(node: ChatConversationViewNode): string | undefined {
  if (isNode(node, 'command')) return node.data.outcome?.text;
  if (isNode(node, 'manual-compaction')) return node.data.command.outcome?.text;
  return undefined;
}

type CommandRecordNode = ChatNode<'command'> | ChatNode<'manual-compaction'>;

function commandRecordState(node: CommandRecordNode): 'running' | 'success' | 'error' {
  const outcome = node.kind === 'command' ? node.data.outcome : node.data.command.outcome;
  return outcome == null ? 'running' : outcome.kind === 'success' ? 'success' : 'error';
}

function CommandRecord({ node }: { node: CommandRecordNode }) {
  const state = commandRecordState(node);
  const outcomeText = commandOutcomeText(node);
  const label = state === 'running' ? '执行中…' : state === 'success' ? '已完成' : '失败';
  return (
    <div className={css.commandRecord} data-reader-command-record data-command-state={state}>
      <div className={css.commandRecordStatus}>
        <span className={css.commandRecordDot} data-state={state} aria-hidden />
        <span className={css.commandRecordLabel}>{label}</span>
        {outcomeText && <span className={css.commandRecordSummary} title={outcomeText}>{outcomeText}</span>}
      </div>
      {isNode(node, 'manual-compaction') && (
        <div className={css.commandRecordCompaction} data-reader-compaction-record>
          <strong>{node.data.compaction ? '上下文已整理' : '正在整理上下文…'}</strong>
          {node.data.compaction && <span>原始记录仍保留。</span>}
        </div>
      )}
      <JsonBlock label="命令记录" payload={node.data} />
    </div>
  );
}

function CompactionRecord({ node }: { node: ChatNode<'compaction'> }) {
  return (
    <div className={css.compactionRecord} data-reader-compaction-record>
      <div className={css.compactionRecordHeader}>
        <strong className={css.compactionRecordTitle}>上下文已整理</strong>
        <span className={css.compactionRecordMeta}>原始记录仍保留。</span>
      </div>
      <JsonBlock label="压缩记录" payload={node.data} />
    </div>
  );
}

function NoticeCard({ title, meta, hint = '展开查看详情', tone = 'error', children }: {
  title: ReactNode; meta?: ReactNode; hint?: string; tone?: 'error' | 'info'; children?: ReactNode;
}) {
  const card = tone === 'error' ? css.errorCard : css.noticeCard;
  const titleClass = tone === 'error' ? css.errorCardTitle : css.noticeCardTitle;
  const bodyClass = tone === 'error' ? css.errorCardBody : css.noticeCardBody;
  return <details className={card} data-tone={tone} data-reader-expandable-notice role={tone === 'error' ? 'alert' : 'status'}>
    <summary>
      <span className={titleClass}>{title}</span>
      {meta && <span className={css.errorCardMeta}>{meta}</span>}
      <span className={css.errorCardHint}>{hint}</span>
    </summary>
    <div className={bodyClass}>{children}</div>
  </details>;
}

function Switch({ label, checked, onChange, title }: {
  label: string; checked: boolean; onChange: () => void; title?: string;
}) {
  return (
    <button type="button" className={css.switchButton} role="switch" aria-checked={checked} onClick={onChange} title={title}>
      <span className={css.switchLabel} data-checked={checked}>{label}</span>
    </button>
  );
}

type SeatProps = BlockRenderProps & Pick<ReaderProps, 'useSession'> & {
  nodeKey: string; boundary: TurnBoundary; pinned?: boolean; processOpen?: boolean;
};

const ProcessNode = memo(function ProcessNode({ useSession, t, nodeKey, open, motion, onRead, returnFocusTo }: Pick<ReaderProps, 'useSession' | 't'> & {
  nodeKey: string; open: boolean; motion: boolean; onRead: () => void; returnFocusTo: RefObject<HTMLButtonElement>;
}) {
  const node = useSession(snapshot => snapshot.chat.nodes.get(nodeKey));
  if (!node || node.visibility === 'hidden') return null;
  let content: ReactNode = null;
  if (isNode(node, 'context')) content = <ContextInjectionRow {...node.data} t={t} />;
  else if (isNode(node, 'model-retry')) {
    const current = node.data.current;
    const retryTitle = current.retryState === 'scheduled'
      ? '模型请求未成功，正在等待重试'
      : current.retryState === 'started' ? '模型请求正在重试'
      : '模型重试记录';
    const retryMeta = `第 ${current.retry} 次 · ${current.failure.code}${current.failure.status != null ? ` · HTTP ${current.failure.status}` : ''}`;
    content = <NoticeCard title={retryTitle} meta={retryMeta} hint="展开查看重试记录">
      <JsonTree data={node.data.attempts as unknown as object | unknown[]} label="模型重试记录" expandTopLevel={false} />
    </NoticeCard>;
  } else if (isNode(node, 'compaction')) {
    content = <CompactionRecord node={node} />;
  } else if (isNode(node, 'command') || isNode(node, 'manual-compaction')) {
    const outcomeText = commandOutcomeText(node);
    const failed = isNode(node, 'command')
      ? node.data.outcome?.kind === 'error'
      : node.data.command.outcome?.kind === 'error';
    const label = isNode(node, 'command') ? '命令执行失败' : '上下文压缩失败';
    if (failed) {
      content = <NoticeCard title={label} meta={outcomeText} hint="展开查看完整记录">
        <JsonBlock label="命令记录" payload={node.data} />
      </NoticeCard>;
    } else {
      content = <CommandRecord node={node} />;
    }
  }
  return content && <ProcessFragment open={open} motion={motion} onRead={onRead} returnFocusTo={returnFocusTo} nodeKey={nodeKey} framed>{content}</ProcessFragment>;
});

const AssistantNode = memo(function AssistantNode({ useSession, nodeKey, boundary, processOpen = false, pinned = false, motion, collapseThinking = false, onRead, returnFocusTo, ...render }: SeatProps & {
  motion: boolean; collapseThinking?: boolean; onRead: () => void; returnFocusTo: RefObject<HTMLButtonElement>;
}) {
  const node = useSession(snapshot => snapshot.chat.nodes.get(nodeKey));
  if (!node || node.visibility === 'hidden' || !isNode(node, 'assistant-step')) return null;
  const data = node.data;
  const thinkingMs = useMemo(() => {
    const timing = data.finalNode?.timing;
    if (!timing) return null;
    if (timing.stepStartTime != null && timing.firstTokenTime != null) return Math.max(0, timing.firstTokenTime - timing.stepStartTime);
    if (timing.stepStartTime != null && timing.completedTime != null) return Math.max(0, timing.completedTime - timing.stepStartTime);
    return null;
  }, [data]);
  // Memoize the segment split on the node's own blocks identity. During
  // streaming the turn boundary changes every chunk, re-rendering every
  // AssistantNode in the open turn; without this memo each re-render hands
  // Blocks a fresh array, defeats its memo, and re-segments the FULL text of
  // every settled step (the reasoning path has no inner cache) — an
  // O(turn-size) storm per chunk. Settled nodes keep a stable data.blocks, so
  // their children now bail out entirely.
  const parts = useMemo(() => assistantSegments(data.blocks), [data.blocks]);
  const earlier = isEarlierNarration(data, boundary);
  const body = useMemo(() => data.blocks.filter(block => block.kind !== 'reasoning' && block.kind !== 'tool-call'), [data.blocks]);
  return <>{parts.map((part, index) => part.kind === 'reasoning'
    ? (() => {
      const charCount = part.blocks.reduce((sum, block) => sum + (block.kind === 'reasoning' ? block.text.length : 0), 0);
      const liveReasoning = data.status === 'running' && index === parts.length - 1 && data.blocks.at(-1)?.kind === 'reasoning';
      return (
        <ProcessFragment key={part.start} open={processOpen} motion={motion} onRead={onRead} returnFocusTo={returnFocusTo} nodeKey={nodeKey} framed>
          <ReasoningCard step={data.step} active={processOpen && boundary.status === 'open' && data.step === boundary.latestStep} running={liveReasoning} motion={motion} selected={pinned} onRead={onRead}
            collapsible={collapseThinking} durationMs={thinkingMs} startedAt={data.time} charCount={charCount}>
            <Blocks {...render} blocks={part.blocks} streaming={liveReasoning}
              holdFormatting={pinned} startedAt={data.time} interrupted={data.status === 'interrupted'} liveText />
          </ReasoningCard>
        </ProcessFragment>
      );
    })()
    : hasVisibleBody(part.blocks) && <RetiringContent key={part.start} visible={pinned || processOpen || !earlier}>
      <article className={css.answer} data-reader-answer data-reader-anchor data-reader-key={nodeKey} data-reader-source-start={part.start} data-answer-status={data.status} data-answer-phase={earlier ? 'process' : 'body'}>
        <Blocks {...render} blocks={part.blocks} streaming={data.status === 'running'} holdFormatting={pinned} startedAt={data.time} interrupted={data.status === 'interrupted'} liveText />
        {index === parts.length - 1 && data.status === 'interrupted' && <span className={css.stopped}>已停止</span>}
        {index === parts.length - 1 && !earlier && data.status !== 'running' && boundary.status === 'closed' && <CopyAnswer blocks={body} />}
      </article>
    </RetiringContent>)}</>;
});

const MainNode = memo(function MainNode({ useSession, nodeKey, boundary, pinned, processOpen = false, ...render }: SeatProps) {
  const node = useSession(snapshot => snapshot.chat.nodes.get(nodeKey));
  if (!node || node.visibility === 'hidden') return null;
  if (isNode(node, 'user') || isNode(node, 'steering')) return <div className={css.user} data-reader-anchor data-reader-key={nodeKey}>
    {node.kind === 'steering' && <p className={css.meta}>补充消息</p>}
    <Blocks {...render} blocks={contentBlocks(node.data.content)} source="user" />
  </div>;
  if (isNode(node, 'assistant-step')) return null;
  if (isNode(node, 'tool-call')) return <ToolMedia {...render} block={node.data.root} />;
  if (isNode(node, 'turn-error')) return <NoticeCard title="本轮出现错误" meta={node.data.code}>
    <p>{node.data.message}</p>
    {node.data.code && <code>{node.data.code}</code>}
  </NoticeCard>;
  if (isNode(node, 'turn-max-tokens')) return <NoticeCard title="已到达输出长度限制，回答可能尚未完整" tone="info" hint="查看说明">
    <p>输出达到本轮长度限制，内容可能尚未完整；已生成的内容仍保留。</p>
  </NoticeCard>;
  if (isNode(node, 'model-retry')) {
    // Model-retry records are process detail, not final answer content: they
    // belong inside the foldable process area and must not remain visible
    // after the turn completes and the process collapses.
    return null;
  }
  if (isNode(node, 'command')) {
    // Failures are presented as the expandable command-error card inside the
    // process; suppress the old top-level banner so they are not duplicated.
    if (node.data.outcome?.kind === 'error') return null;
    return node.data.outcome?.text ? <MarkdownText text={node.data.outcome.text} /> : null;
  }
  if (isNode(node, 'manual-compaction')) {
    // The compact/command lifecycle is one card inside the process area; no
    // separate top-level hint is needed.
    return null;
  }
  if (node.kind === 'compaction') {
    // The compaction marker lives inside the process card too.
    return null;
  }
  if (node.kind === 'context' || node.kind === 'turn-tail') return null;
  return <div className={css.unknown} data-reader-anchor>
    <p>此记录类型暂未接入阅读页：{node.kind}</p>
    <JsonBlock label="查看原始记录" payload={node.data} />
  </div>;
});

function GroupStatus({ group, useSession, motion }: Pick<ReaderProps, 'useSession'> & { group: ReaderGroup; motion: boolean }) {
  const text = useSession(snapshot => {
    const turn = group.turn === null ? undefined : snapshot.chat.timeline.turns.get(group.turn);
    if (turn?.status === 'closed') {
      if (turn.end?.data.reason.kind !== 'completed') return '执行过程';
      const elapsed = turn.start && turn.end ? Math.max(0, Math.round((turn.end.time - turn.start.time) / 1000)) : null;
      return elapsed === null ? '执行过程' : elapsed < 60 ? `用时 ${elapsed} 秒` : `用时 ${Math.floor(elapsed / 60)} 分 ${elapsed % 60} 秒`;
    }
    if (turn?.status !== 'open') return '执行过程';
    if (snapshot.pending.length) return '等待你的操作';
    const current = turn.steps.at(-1)?.data.get('assistant-step');
    const last = current?.blocks.at(-1);
    if (current?.status === 'running' && last?.kind === 'tool-call') return preparingLabel(last.name);
    for (let index = group.keys.length - 1; index >= 0; index--) {
      const node = snapshot.chat.nodes.get(group.keys[index]);
      if (!node) continue;
      if (isNode(node, 'tool-call') && !('kind' in node.data.root)) return '正在使用工具';
      if (isNode(node, 'assistant-step') && node.data.status === 'running') {
        const last = node.data.blocks.at(-1);
        return last?.kind === 'reasoning' ? '正在思考' : last?.kind === 'text' ? '正在输出' : '正在准备回复';
      }
    }
    return '正在处理';
  });
  const busy = useSession(snapshot => group.turn !== null && snapshot.chat.timeline.turns.get(group.turn)?.status === 'open' && snapshot.pending.length === 0);
  return <StatusText text={text} motion={motion} shimmer={busy} />;
}

function OperationalClusterBlock({
  cluster,
  expanded,
  onToggle,
  shared,
  t,
  boundary,
  pinnedKeys,
  motion,
  collapseThinking,
  pinProcess,
  processButton,
}: {
  cluster: Extract<OperationalFlowItem, { kind: 'cluster' }>;
  expanded: boolean;
  onToggle: () => void;
  shared: BlockRenderProps & Pick<ReaderProps, 'useSession'>;
  t: ReaderProps['t'];
  boundary: TurnBoundary;
  pinnedKeys: readonly string[];
  motion: boolean;
  collapseThinking: boolean;
  pinProcess: () => void;
  processButton: RefObject<HTMLButtonElement>;
}) {
  const summaryText = formatOperationClusterSummary(cluster.summary);
  return (
    <div className={css.clusterBlock} data-operational-cluster={cluster.key} data-expanded={expanded} data-active={cluster.hasActive ? 'true' : undefined}>
      <button
        type="button"
        className={css.clusterHeader}
        aria-expanded={expanded}
        onClick={onToggle}
      >
        <span className={css.clusterHeaderLeft}>
          <span className={css.clusterIcon}>
            <svg
              className={css.chevron}
              data-open={expanded}
              viewBox="0 0 16 16"
              width="12"
              height="12"
              aria-hidden="true"
            >
              <path d="m6 4 4 4-4 4" />
            </svg>
          </span>
          <span className={css.clusterSummary}>{summaryText}</span>
          {cluster.hasFailed && <span className={css.clusterFailure}>· {cluster.summary.failed} 个失败</span>}
        </span>
        <span className={css.clusterHeaderRight}>
          <span className={css.clusterHint}>{expanded ? '收起详情' : '展开查看详细'}</span>
        </span>
      </button>
      {expanded && (
        <div className={css.clusterBody}>
          {cluster.items.map((item: ReaderFlowEntry) =>
            item.kind === 'node' ? (
              <Fragment key={item.key}>
                <BlockBoundary>
                  <ProcessNode
                    useSession={shared.useSession}
                    t={t}
                    nodeKey={item.nodeKey}
                    open={expanded}
                    motion={motion}
                    onRead={pinProcess}
                    returnFocusTo={processButton}
                  />
                </BlockBoundary>
                <BlockBoundary>
                  <AssistantNode
                    {...shared}
                    boundary={boundary}
                    nodeKey={item.nodeKey}
                    pinned={pinnedKeys.includes(item.nodeKey)}
                    processOpen={expanded}
                    motion={motion}
                    collapseThinking={collapseThinking}
                    onRead={pinProcess}
                    returnFocusTo={processButton}
                  />
                </BlockBoundary>
                <BlockBoundary>
                  <MainNode
                    {...shared}
                    boundary={boundary}
                    nodeKey={item.nodeKey}
                    pinned={pinnedKeys.includes(item.nodeKey)}
                    processOpen={expanded}
                  />
                </BlockBoundary>
              </Fragment>
            ) : (
              <Fragment key={item.key}>
                {!isMergedExecutionFailure(item, boundary.status === 'closed') && (
                  <BlockBoundary>
                    <ProcessFragment
                      open={expanded}
                      motion={motion}
                      onRead={pinProcess}
                      returnFocusTo={processButton}
                      nodeKey={item.key}
                      framed
                    >
                      <ToolActivity
                        {...shared}
                        entry={item}
                        motion={motion}
                        turnClosed={boundary.status === 'closed'}
                        onRead={pinProcess}
                      />
                    </ProcessFragment>
                  </BlockBoundary>
                )}
                {item.block && (
                  <BlockBoundary>
                    <ToolMedia {...shared} block={item.block} open={expanded} />
                  </BlockBoundary>
                )}
              </Fragment>
            )
          )}
        </div>
      )}
    </div>
  );
}

const TurnGroup = memo(function TurnGroup({ group, motion, pinnedKeys, selectedProcessKeys, rewindHidden, rewindSpans, ...props }: ReaderProps & { group: ReaderGroup; motion: boolean; pinnedKeys: readonly string[]; selectedProcessKeys: readonly string[]; rewindHidden: ReadonlySet<number>; rewindSpans: readonly RewindSpan[] }) {
  const chat = props.useSession(snapshot => snapshot.chat);
  const turn = props.useSession(snapshot => group.turn === null ? undefined : snapshot.chat.timeline.turns.get(group.turn));
  const boundary = useMemo(() => boundaryOf(turn), [turn]);
  const choiceKey = processChoiceKey(group.key, boundary);
  const expansionChoice = props.useStore(state => state.expanded[choiceKey]);
  const collapseThinking = props.useStore(state => state.collapseThinking ?? false);
  const flowId = useId();
  const processButton = useRef<HTMLButtonElement>(null);
  const setExpanded = useCallback((value: boolean) => props.actions.setExpanded(choiceKey, value), [props.actions, choiceKey]);
  const pinProcess = useCallback(() => setExpanded(true), [setExpanded]);
  const firstKind = props.useSession(snapshot => snapshot.chat.nodes.get(group.keys[0])?.kind);
  const startsWithUser = firstKind === 'user';
  const mainKeys = startsWithUser ? group.keys.slice(1) : group.keys;
  const flow = useMemo(() => readerFlow({ ...group, keys: mainKeys }, turn, key => chat.nodes.get(key), { hidden: rewindHidden, spans: rewindSpans }), [chat, group, mainKeys, turn, rewindHidden, rewindSpans]);
  const groupedFlow = useMemo(() => groupOperationalFlow(flow, key => chat.nodes.get(key)), [flow, chat]);
  const [clusterExpanded, setClusterExpanded] = useState<Record<string, boolean>>({});
  const toggleCluster = useCallback((clusterKey: string) => {
    setClusterExpanded(prev => ({ ...prev, [clusterKey]: !prev[clusterKey] }));
  }, []);
  const hasProcess = flow.some(item => item.kind === 'tool' || hasProcessContent(chat.nodes.get(item.nodeKey), boundary));
  // Only a real, still-active text selection delays folding. Merely clicking,
  // focusing or scrolling the live card does not create a permanent override.
  const holdingSelection = flow.some(item => selectedProcessKeys.includes(item.key));
  const expanded = holdingSelection || processExpanded(expansionChoice, boundary);
  const shared = { useSession: props.useSession, renderSlotChain: props.renderSlotChain, loadImage: props.loadImage };
  const terminal = terminalLabel(boundary.reason);
  const showTerminal = terminal && boundary.reason !== 'error' && boundary.reason !== 'max-tokens';
  return <section className={css.turn} data-reader-turn={group.turn ?? 'unresolved'} data-reader-turn-state={boundary.status} data-reader-turn-result={boundary.reason ?? undefined}>
    {startsWithUser && <BlockBoundary><MainNode {...shared} boundary={boundary} nodeKey={group.keys[0]} /></BlockBoundary>}
    {hasProcess && <Disclosure open={expanded} onChange={setExpanded} controls={flowId} buttonRef={processButton}
      label={<GroupStatus group={group} useSession={props.useSession} motion={motion} />} status={turn?.steps.length ? `${turn.steps.length} 个步骤` : undefined} />}
    {!hasProcess && boundary.status === 'open' && <div className={css.disclosure} data-reader-status-only>
      <GroupStatus group={group} useSession={props.useSession} motion={motion} />
    </div>}
    <div id={flowId} className={css.mainFlow} data-reader-flow>
      {groupedFlow.map(entry => {
        if (entry.kind === 'cluster') {
          const isClusterOpen = clusterExpanded[entry.key] ?? false;
          return (
            <ProcessFragment
              key={entry.key}
              open={expanded}
              motion={motion}
              onRead={pinProcess}
              returnFocusTo={processButton}
              nodeKey={entry.key}
              framed
            >
              <OperationalClusterBlock
                cluster={entry}
                expanded={isClusterOpen}
                onToggle={() => toggleCluster(entry.key)}
                shared={shared}
                t={props.t}
                boundary={boundary}
                pinnedKeys={pinnedKeys}
                motion={motion}
                collapseThinking={collapseThinking}
                pinProcess={pinProcess}
                processButton={processButton}
              />
            </ProcessFragment>
          );
        }
        const item = entry.item;
        return item.kind === 'node' ? (
          <Fragment key={item.key}>
            <BlockBoundary><ProcessNode useSession={props.useSession} t={props.t} nodeKey={item.nodeKey} open={expanded} motion={motion} onRead={pinProcess} returnFocusTo={processButton} /></BlockBoundary>
            <BlockBoundary><AssistantNode {...shared} boundary={boundary} nodeKey={item.nodeKey} pinned={pinnedKeys.includes(item.nodeKey)} processOpen={expanded} motion={motion} collapseThinking={collapseThinking} onRead={pinProcess} returnFocusTo={processButton} /></BlockBoundary>
            <BlockBoundary><MainNode {...shared} boundary={boundary} nodeKey={item.nodeKey} pinned={pinnedKeys.includes(item.nodeKey)} processOpen={expanded} /></BlockBoundary>
          </Fragment>
        ) : (
          <Fragment key={item.key}>
            {!isMergedExecutionFailure(item, boundary.status === 'closed') && <BlockBoundary><ProcessFragment open={expanded} motion={motion} onRead={pinProcess} returnFocusTo={processButton} nodeKey={item.key} framed>
              <ToolActivity {...shared} entry={item} motion={motion} turnClosed={boundary.status === 'closed'} onRead={pinProcess} />
            </ProcessFragment></BlockBoundary>}
            {item.block && <BlockBoundary><ToolMedia {...shared} block={item.block} open={expanded} /></BlockBoundary>}
          </Fragment>
        );
      })}
    </div>
    {showTerminal && <div className={css.notice} data-reader-terminal>{terminal}</div>}
  </section>;
});

export function Reader(props: ReaderProps) {
  const root = useRef<HTMLDivElement>(null);
  const activatedAt = useRef(Date.now());
  const order = props.useSession(snapshot => snapshot.chat.order);
  const nodes = props.useSession(snapshot => snapshot.chat.nodes);
  const timeline = props.useSession(snapshot => snapshot.chat.timeline);
  const rewindToken = props.useSession(snapshot => {
    let token = '';
    const chat = snapshot.chat;
    for (const key of chat.order) {
      const node = chat.nodes.get(key);
      if (!node || node.kind !== 'command') continue;
      const command = node.data as { name?: string; seq?: number; args?: string | null; outcome?: { kind?: string; sourceEventSeq?: number } | null };
      if (command.name !== 'rewind') continue;
      token += `${command.seq}:${command.args ?? ''}:${command.outcome?.kind ?? ''}:${command.outcome?.sourceEventSeq ?? ''};`;
    }
    return token;
  });
  const pending = props.useSession(snapshot => snapshot.pending);
  const openError = props.useSession(snapshot => snapshot.openError);
  const loading = props.useSession(snapshot => snapshot.openState === 'loading');
  const hasMore = props.useSession(snapshot => snapshot.hasMore);
  const loadingOlder = props.useSession(snapshot => snapshot.loadingOlder);
  const motionPreference = props.useStore(state => state.motion);
  const collapseThinking = props.useStore(state => state.collapseThinking ?? false);
  const motion = useMotionAllowed(motionPreference);
  const activity = useTurnActivity(props.useSession);
  const streamMotion = useMemo(() => ({ enabled: motion, activatedAt: activatedAt.current }), [motion]);
  const rewindHidden = useMemo(() => {
    return rewindToken ? hiddenSeqsOf({ order, nodes }) : new Set<number>();
  }, [rewindToken, order, nodes]);
  const rewindSpans = useMemo(() => {
    return rewindToken ? rewindSpansOf({ order, nodes }) : [];
  }, [rewindToken, order, nodes]);
  const visibleOrder = useMemo(() => order.filter(key => {
    const node = nodes.get(key);
    return !!node && !rewindHidden.has(node.anchorSeq);
  }), [order, nodes, rewindHidden]);
  const groups = useMemo(() => groupNodes(visibleOrder, key => nodes.get(key)), [visibleOrder, nodes, timeline]);
  const scroll = useReadingScroll(root, motion);
  // The activity bar floats above the sticky composer. Sticky alone cannot
  // lift it when the transcript is shorter than the scrollport (no overflow,
  // nothing to stick against): the column must fill the scrollport so
  // margin-top:auto can push the bar to the screen bottom. Measure host
  // height minus the composer (a live CSS variable the host maintains on
  // the scroller) minus our own vertical padding.
  useEffect(() => {
    const content = root.current;
    if (!content) return;
    const host = content.closest<HTMLElement>('[data-conversation-scroll]');
    if (!host) return;
    const fit = () => {
      const composer = parseFloat(getComputedStyle(host).getPropertyValue('--dsh-composer-height')) || 152;
      const own = getComputedStyle(content);
      const padding = (parseFloat(own.paddingTop) || 0) + (parseFloat(own.paddingBottom) || 0);
      content.style.setProperty('--reader-flow-min-height', `${Math.max(0, host.clientHeight - composer - padding)}px`);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(host);
    // The host writes --dsh-composer-height onto the scroller's style attr.
    const attributes = new MutationObserver(fit);
    attributes.observe(host, { attributes: true, attributeFilter: ['style'] });
    return () => { observer.disconnect(); attributes.disconnect(); };
  }, []);
  const latestUserKey = useMemo(() => {
    for (let index = visibleOrder.length - 1; index >= 0; index--) {
      const node = nodes.get(visibleOrder[index]);
      if (node && (node.kind === 'user' || node.kind === 'steering')) return visibleOrder[index];
    }
    return null;
  }, [visibleOrder, nodes]);
  const seenUserKeys = useRef(new Set<string>());
  const previousLatestUserKey = useRef<string | null>(null);
  useEffect(() => {
    const previous = previousLatestUserKey.current;
    const latest = latestUserKey;
    if (latest && previous && latest !== previous && !seenUserKeys.current.has(latest)) {
      const previousIndex = visibleOrder.indexOf(previous);
      const latestIndex = visibleOrder.indexOf(latest);
      // Only a user message appended after the previous latest user message
      // should force the viewport to the bottom; loading older history adds
      // older keys before the current latest and must not yank the reader.
      if (previousIndex >= 0 && latestIndex > previousIndex) scroll.jump();
    }
    if (latest) seenUserKeys.current.add(latest);
    previousLatestUserKey.current = latest;
  }, [latestUserKey]);
  const pinnedKeys = usePinnedSelection(root);
  const selectedProcessKeys = usePinnedSelection(root, '[data-reader-process]');
  const [historyError, setHistoryError] = useState(false);
  return <StreamMotionContext.Provider value={streamMotion}><div ref={root} className={css.root} data-dsh-clearview="0.1.6" data-motion={motion ? 'on' : 'off'}>
    <div className={css.column}>
      <div className={css.toolbar} data-ud-check="reader-toolbar">
        <Switch label={`折叠思考${collapseThinking ? '开' : '关'}`} checked={collapseThinking} onChange={() => props.actions.setCollapseThinking(!collapseThinking)}
          title="开启后，每段思考默认折叠为“思考了 N 秒”，可单独展开阅读；关闭后恢复为始终可见的思考卡片。" />
        <Switch label={`动效${motionPreference ? '开' : '关'}`} checked={motionPreference} onChange={() => props.actions.setMotion(!motionPreference)}
          title="新到文字柔和显现，过程平滑展开；关闭后立即完整显示，自动遵循系统减少动态效果设置。" />
      </div>
      {hasMore && <button type="button" className={css.historyButton} disabled={loadingOlder} onClick={async () => {
        setHistoryError(false);
        try { await props.loadOlder(); } catch { setHistoryError(true); }
      }}>{loadingOlder ? '正在加载更早记录' : '加载更早记录'}</button>}
      {historyError && <div className={css.notice}>历史记录加载失败，可再次尝试；现有内容未改变。</div>}
      {openError && <div className={css.error} role="alert">会话暂时无法读取：{openError.message}</div>}
      {loading && groups.length === 0 && <p className={css.empty} role="status">正在读取会话…</p>}
      {groups.map(group => <TurnGroup key={group.key} {...props} group={group} motion={motion} pinnedKeys={pinnedKeys} selectedProcessKeys={selectedProcessKeys} rewindHidden={rewindHidden} rewindSpans={rewindSpans} />)}
      {pending.length > 0 && <div className={css.attention} role="alert" data-reader-attention>
        <strong>{pending.some(item => item.kind === 'question') ? '需要你回答一个问题' : '需要你的确认'}</strong>
        <span>请在下方原生操作区处理。此提示不会收进执行过程。</span>
      </div>}
      {activity.key && (
        <div className={css.activityBar} data-detached={scroll.detached ? 'true' : undefined}
          data-phase={activity.phase} data-ud-check="reader-activity-bar" role="status">
          <span className={css.activityText} data-reader-activity-label>{activity.label}</span>
          {activity.seconds !== null && (
            <span className={css.activityTimer} data-reader-activity-timer aria-hidden="true">{formatSeconds(activity.seconds)}</span>
          )}
          <button type="button" className={css.activityJump} aria-label="回到最新" title="回到最新" onClick={scroll.jump}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M8 3v10m-4-4 4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        </div>
      )}
      {scroll.detached && !activity.key && <div className={css.jumpDock}><button type="button" className={css.jump} onClick={scroll.jump} aria-label="回到最新" title="回到最新">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M8 3v10m-4-4 4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button></div>}
    </div>
  </div></StreamMotionContext.Provider>;
}
