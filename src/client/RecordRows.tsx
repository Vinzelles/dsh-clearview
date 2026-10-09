import { memo, useCallback, useMemo, useState } from 'react';
import type { ComponentType } from 'react';
import type { ContextMessageNode } from '@deepseek-ai/dsh-client-ui-conversation/client';
import {
  JsonTree,
  IconApiOutlineRegular, IconCloseCircleFillRegular, IconCompactOutlineRegular, IconFlatListOutlineRegular, IconPlanOutlineRegular,
  IconQuestionOutlineRegular, IconRefreshOutlineRegular, IconSparkleRegular, IconWarningOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives';
import { Blocks } from './Blocks.js';
import { useChatSelector } from './compat/session-snapshot.js';
import { CollapseBody } from './motion.js';
import { ContextInjectionRow } from './native/ContextInjectionRow.js';
import { JSON_TREE_LABELS } from './native/primitive-labels.js';
import { SystemPromptRow } from './native/SystemPromptRow.js';
import { nodeText, workflowRunSummary, workflowStatusLabel } from './node-payloads.js';
import { Line } from './Line.js';
import { useReaderActions } from './reader-context.js';
import { contentBlocks } from './user-content.js';
import type { BlockRenderProps, ReaderProps } from './types.js';
import css from './RecordRows.module.css';

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export type RecordTone = 'idle' | 'active' | 'done' | 'failed';
export interface RecordView { title: string; summary: string; tone: RecordTone; showInChat: boolean }

/** Neutral titles for a lifecycle record that was still in flight when its turn closed. */
const SETTLED_TITLES: Record<string, string> = {
  'model-retry': '模型请求重试记录',
  command: '命令记录',
  'manual-compaction': '上下文整理记录',
};

/**
 * Title, one-line summary and tone of a process record; every payload is read defensively. Once the owning
 * turn is closed nothing is in flight any more, so an active record settles to idle (no spinner, no
 * present-tense wording) whatever result the turn ended with.
 */
export function recordView(node: { kind: string; data: unknown }, turnClosed = false): RecordView {
  const view = liveRecordView(node);
  if (!turnClosed || view.tone !== 'active') return view;
  return { ...view, title: SETTLED_TITLES[node.kind] ?? view.title, tone: 'idle' };
}

function liveRecordView(node: { kind: string; data: unknown }): RecordView {
  const data = record(node.data);
  switch (node.kind) {
    case 'model-retry': {
      const current = record(data?.current);
      const state = current?.retryState;
      const failure = record(current?.failure);
      const title = state === 'scheduled' ? '模型请求未成功，正在等待重试' : state === 'started' ? '模型请求正在重试' : '模型重试记录';
      const parts = [
        typeof current?.retry === 'number' ? `第 ${current.retry} 次` : null,
        typeof failure?.code === 'string' ? failure.code : null,
        typeof failure?.status === 'number' ? `HTTP ${failure.status}` : null,
      ];
      return { title, summary: parts.filter(Boolean).join(' · '), tone: state === 'scheduled' || state === 'started' ? 'active' : 'idle', showInChat: false };
    }
    case 'command': {
      const outcome = record(data?.outcome);
      const name = typeof data?.name === 'string' ? `/${data.name}` : null;
      if (!outcome) return { title: '命令执行中', summary: name ?? '', tone: 'active', showInChat: false };
      const ok = outcome.kind === 'success';
      const text = typeof outcome.text === 'string' ? outcome.text : null;
      return { title: ok ? '命令执行完成' : '命令执行失败', summary: [name, text].filter(Boolean).join(' · '), tone: ok ? 'done' : 'failed', showInChat: false };
    }
    case 'manual-compaction': {
      const outcome = record(record(data?.command)?.outcome);
      if (outcome?.kind === 'error') return { title: '上下文压缩失败', summary: typeof outcome.text === 'string' ? outcome.text : '', tone: 'failed', showInChat: false };
      if (data?.compaction != null) return { title: '上下文已整理', summary: '原始记录仍保留', tone: 'done', showInChat: false };
      return { title: '正在整理上下文', summary: '', tone: 'active', showInChat: false };
    }
    case 'compaction': {
      const count = data?.shadowedItemCount;
      return { title: '上下文已整理', summary: typeof count === 'number' ? `已整理 ${count} 条记录 · 原始记录仍保留` : '原始记录仍保留', tone: 'done', showInChat: false };
    }
    case 'question-reply': {
      const first = Array.isArray(data?.questions) ? record(data.questions[0]) : null;
      const asked = typeof first?.question === 'string' ? first.question : '';
      const fallback = typeof data?.text === 'string' ? data.text.split(/\r?\n/).map(line => line.trim()).find(Boolean) ?? '' : '';
      return { title: '已回答问题', summary: asked || fallback, tone: 'done', showInChat: false };
    }
    case 'submitted-plan':
      return { title: typeof data?.title === 'string' && data.title !== '' ? data.title : '计划', summary: '已提交计划', tone: 'idle', showInChat: false };
    case 'workflow-run': {
      const run = workflowRunSummary(node.data);
      const summary = workflowStatusLabel(run.status)
        + (run.memberCount != null ? ` · ${run.memberCount} 个子会话` : '')
        + (run.phaseCount != null ? ` · ${run.phaseCount} 个阶段` : '');
      const tone: RecordTone = run.status === 'running' ? 'active' : run.status === 'failed' ? 'failed' : run.status === 'completed' ? 'done' : 'idle';
      return { title: run.name ?? '工作流运行', summary, tone, showInChat: true };
    }
    default: {
      const kind = node.kind !== 'unknown' ? node.kind : typeof data?.type === 'string' ? data.type : '';
      return { title: '工具调用', summary: kind, tone: 'idle', showInChat: true };
    }
  }
}

/** Selected option labels followed by a non-blank custom answer, in display order. */
export function replyAnswerValues(data: unknown, id: string): string[] {
  const answers = record(data)?.answers;
  const answer = Array.isArray(answers) ? answers.map(record).find(item => item?.id === id) : undefined;
  if (!answer) return [];
  const selected = Array.isArray(answer.selected) ? answer.selected.filter((value): value is string => typeof value === 'string') : [];
  const custom = typeof answer.custom === 'string' && answer.custom.trim() !== '' ? [answer.custom.trim()] : [];
  return [...selected, ...custom];
}

const ICONS: Record<string, ComponentType<{ size?: number }>> = {
  'model-retry': IconRefreshOutlineRegular,
  command: IconApiOutlineRegular,
  'manual-compaction': IconCompactOutlineRegular,
  compaction: IconCompactOutlineRegular,
  'question-reply': IconQuestionOutlineRegular,
  'submitted-plan': IconPlanOutlineRegular,
  'workflow-run': IconFlatListOutlineRegular,
};

function RecordJson({ label, payload }: { label: string; payload: unknown }) {
  const text = useMemo(() => { try { return JSON.stringify(payload, null, 2) ?? String(payload); } catch { return String(payload); } }, [payload]);
  return <div className={css.section}><h4 className={css.label}>{label}</h4><pre className={css.raw}>{text}</pre></div>;
}

/** Expanded content of one record, by kind. */
export function RecordBody({ kind, data, view, nodeKey, ...render }: BlockRenderProps & { kind: string; data: unknown; view: RecordView; nodeKey: string }) {
  const { showInChat } = useReaderActions();
  const chatLink = view.showInChat && showInChat
    ? <button type="button" className={css.chatLink} onClick={() => showInChat(nodeKey)} data-reader-show-in-chat>在对话中查看</button>
    : null;
  if (kind === 'question-reply') {
    const raw = record(data)?.questions;
    const questions = Array.isArray(raw) ? raw.map(record).filter((item): item is Record<string, unknown> => item !== null) : [];
    if (!questions.length) {
      const text = record(data)?.text;
      return typeof text === 'string' && text !== '' ? <p className={css.replyText}>{text}</p> : <RecordJson label="原始记录" payload={data} />;
    }
    return <div className={css.qa}>{questions.map((question, index) => {
      const id = typeof question.id === 'string' ? question.id : '';
      const values = replyAnswerValues(data, id);
      return <div key={id || index}>
        <p className={css.question}>{typeof question.question === 'string' ? question.question : id}</p>
        {values.length ? <ul className={css.answers}>{values.map(value => <li key={value}>{value}</li>)}</ul> : <p className={css.skipped}>未作答</p>}
      </div>;
    })}</div>;
  }
  if (kind === 'submitted-plan') {
    const markdown = record(data)?.markdown;
    return <Blocks {...render} blocks={[{ kind: 'text', text: typeof markdown === 'string' ? markdown : '' }]} source="tool" />;
  }
  if (kind === 'model-retry') {
    return <JsonTree data={(record(data)?.attempts ?? []) as object} label="模型重试记录" expandTopLevel={false} labels={JSON_TREE_LABELS} />;
  }
  return <div className={css.section}>
    <RecordJson label={kind === 'command' || kind === 'manual-compaction' ? '命令记录' : kind === 'compaction' ? '压缩记录' : kind === 'workflow-run' ? '工作流记录' : '原始记录'} payload={data} />
    {chatLink}
  </div>;
}

/** One process record as a transcript line; context and prompt rows keep their native presentation. */
export const RecordRow = memo(function RecordRow({ useSession, nodeKey, t, onRead, onOpenChange, turnClosed = false, ...render }: BlockRenderProps & Pick<ReaderProps, 'useSession'> & {
  nodeKey: string; t: ReaderProps['contextT']; onRead: () => void; turnClosed?: boolean;
  /** Reports the reader opening or closing this row, so a settled record is not folded away under them. */
  onOpenChange?: (key: string, open: boolean) => void;
}) {
  const node = useChatSelector(useSession, chat => chat.nodes.get(nodeKey));
  const { motion } = useReaderActions();
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => { onRead(); setOpen(!open); onOpenChange?.(nodeKey, !open); }, [onRead, open, onOpenChange, nodeKey]);
  if (!node || node.visibility === 'hidden') return null;
  if (node.kind === 'context') return <ContextInjectionRow {...(node.data as ContextMessageNode)} t={t} />;
  if (node.kind === 'system-prompt') {
    const text = nodeText(node.data);
    return text ? <SystemPromptRow text={text} /> : null;
  }
  const view = recordView(node, turnClosed);
  const Icon = ICONS[node.kind] ?? IconSparkleRegular;
  return <div className={css.record} data-record-tone={view.tone}>
    <Line icon={<Icon size={14} />} label={view.title} target={view.summary} title={view.summary}
      tone={view.tone === 'failed' ? 'failed' : view.tone === 'active' ? 'running' : 'idle'} shimmer={view.tone === 'active' && motion}
      open={open} onToggle={toggle} data={{ 'data-reader-record-kind': node.kind }} />
    <CollapseBody open={open} motion={motion}><div className={css.detail}><RecordBody kind={node.kind} data={node.data} view={view} nodeKey={nodeKey} {...render} /></div></CollapseBody>
  </div>;
});

/** A human input admitted mid-turn, shown at its chronological position inside the panel. */
export const InputBubble = memo(function InputBubble({ useSession, nodeKey, ...render }: BlockRenderProps & Pick<ReaderProps, 'useSession'> & { nodeKey: string }) {
  const node = useChatSelector(useSession, chat => chat.nodes.get(nodeKey));
  if (!node || node.visibility === 'hidden') return null;
  const label = node.kind === 'steering' ? '补充消息' : '命令输入';
  const blocks = node.kind === 'command-input' ? [{ kind: 'text' as const, text: nodeText(node.data) ?? '' }] : contentBlocks(record(node.data)?.content);
  const labeled = node.kind === 'steering' || node.kind === 'command-input';
  // The seat (anchor + key, first child a .meta paragraph) is what compat/rewind-bridge reads to classify steering inputs.
  return <div className={css.input} data-reader-input={node.kind} data-reader-anchor data-reader-key={nodeKey}>
    {labeled && <p className={css.meta}>{label}</p>}
    <Blocks {...render} blocks={blocks} source="user" />
  </div>;
});

/** Turn-level failure or output-cap notice, kept beside the answer. */
export const TurnNotice = memo(function TurnNotice({ useSession, nodeKey }: Pick<ReaderProps, 'useSession'> & { nodeKey: string }) {
  const node = useChatSelector(useSession, chat => chat.nodes.get(nodeKey));
  if (!node || node.visibility === 'hidden') return null;
  if (node.kind === 'turn-max-tokens') return <Line icon={<IconWarningOutlineRegular size={14} />} label="已到达输出长度限制" target="回答可能尚未完整，已生成的内容仍保留。"
    data={{ role: 'status', 'data-reader-notice': 'max-tokens' }} />;
  const data = record(node.data);
  const message = typeof data?.message === 'string' ? data.message : '';
  const code = typeof data?.code === 'string' ? data.code : '';
  return <Line icon={<IconCloseCircleFillRegular size={14} />} label="本轮出现错误" target={message} title={message} tone="failed"
    trailing={code && <code>{code}</code>} data={{ role: 'alert', 'data-reader-notice': 'error' }} />;
});
