import { memo, useCallback, useMemo, useState } from 'react';
import type { ComponentType } from 'react';
import type { ContextMessageNode } from '@deepseek-ai/dsh-client-ui-conversation/client';
import {
  DisclosureRow, JsonTree, StateDot,
  IconApiOutlineRegular, IconCompactOutlineRegular, IconFlatListOutlineRegular, IconPlanOutlineRegular,
  IconQuestionOutlineRegular, IconRefreshOutlineRegular, IconSparkleRegular,
} from '@deepseek-ai/dsh-client-ui-primitives';
import { Blocks } from './Blocks.js';
import { useChatSelector } from './compat/session-snapshot.js';
import { CollapseBody } from './motion.js';
import { ContextInjectionRow } from './native/ContextInjectionRow.js';
import { JSON_TREE_LABELS } from './native/primitive-labels.js';
import { SystemPromptRow } from './native/SystemPromptRow.js';
import { nodeText, workflowRunSummary, workflowStatusLabel } from './node-payloads.js';
import { Inset, RowGlyph, RowSeparator } from './ProcessRow.js';
import { useReaderActions } from './reader-context.js';
import { contentBlocks } from './user-content.js';
import type { BlockRenderProps, ReaderProps } from './types.js';
import css from './RecordRows.module.css';

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export type RecordTone = 'idle' | 'active' | 'done' | 'failed';
export interface RecordView { title: string; summary: string; tone: RecordTone; showInChat: boolean }

/** Title, one-line summary and tone of a process record; every payload is read defensively. */
export function recordView(node: { kind: string; data: unknown }): RecordView {
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
      return { title: '已回答问题', summary: typeof first?.question === 'string' ? first.question : '', tone: 'done', showInChat: false };
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

function RecordBody({ kind, data, view, nodeKey, ...render }: BlockRenderProps & { kind: string; data: unknown; view: RecordView; nodeKey: string }) {
  const { showInChat } = useReaderActions();
  const chatLink = view.showInChat && showInChat
    ? <button type="button" className={css.chatLink} onClick={() => showInChat(nodeKey)} data-reader-show-in-chat>在对话中查看</button>
    : null;
  if (kind === 'question-reply') {
    const questions = Array.isArray(record(data)?.questions) ? (record(data)!.questions as unknown[]).map(record).filter(Boolean) as Record<string, unknown>[] : [];
    return <div className={css.qa}>{questions.map(question => {
      const id = typeof question.id === 'string' ? question.id : '';
      const values = replyAnswerValues(data, id);
      return <div key={id}>
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

/** One process record in the native row grammar; context and prompt rows keep their native presentation. */
export const RecordRow = memo(function RecordRow({ useSession, nodeKey, t, onRead, ...render }: BlockRenderProps & Pick<ReaderProps, 'useSession'> & {
  nodeKey: string; t: ReaderProps['contextT']; onRead: () => void;
}) {
  const node = useChatSelector(useSession, chat => chat.nodes.get(nodeKey));
  const { motion } = useReaderActions();
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => { onRead(); setOpen(value => !value); }, [onRead]);
  if (!node || node.visibility === 'hidden') return null;
  if (node.kind === 'context') return <ContextInjectionRow {...(node.data as ContextMessageNode)} t={t} />;
  if (node.kind === 'system-prompt') {
    const text = nodeText(node.data);
    return text ? <SystemPromptRow text={text} /> : null;
  }
  const view = recordView(node);
  const Icon = ICONS[node.kind] ?? IconSparkleRegular;
  return <div className={css.record} data-reader-record-kind={node.kind} data-record-tone={view.tone}>
    <DisclosureRow icon={<RowGlyph tone={view.tone === 'active' ? 'active' : view.tone === 'failed' ? 'failed' : 'idle'} icon={<Icon size={14} />} />}
      title={view.title} open={open} expandable expandOnRowClick previewChevron keepContentWhenOpen onToggle={toggle} rowClassName={css.row}
      titleClassName={view.tone === 'failed' ? css.failedTitle : view.tone === 'done' ? css.doneTitle : undefined}
      collapsedContent={view.summary ? <><RowSeparator /><span className={css.summary} title={view.summary}>{view.summary}</span></> : undefined} />
    <CollapseBody open={open} motion={motion}><Inset><RecordBody kind={node.kind} data={node.data} view={view} nodeKey={nodeKey} {...render} /></Inset></CollapseBody>
  </div>;
});

/** A human input admitted mid-turn, shown at its chronological position inside the panel. */
export const InputBubble = memo(function InputBubble({ useSession, nodeKey, ...render }: BlockRenderProps & Pick<ReaderProps, 'useSession'> & { nodeKey: string }) {
  const node = useChatSelector(useSession, chat => chat.nodes.get(nodeKey));
  if (!node || node.visibility === 'hidden') return null;
  const label = node.kind === 'steering' ? '补充消息' : node.kind === 'command-input' ? '命令输入' : '用户消息';
  const blocks = node.kind === 'command-input' ? [{ kind: 'text' as const, text: nodeText(node.data) ?? '' }] : contentBlocks(record(node.data)?.content);
  return <div className={css.input} data-reader-input={node.kind} data-reader-key={nodeKey}>
    <div className={css.bubble}><p className={css.inputMeta}>{label}</p><Blocks {...render} blocks={blocks} source="user" /></div>
  </div>;
});

/** Turn-level failure or output-cap notice, kept beside the answer. */
export const TurnNotice = memo(function TurnNotice({ useSession, nodeKey }: Pick<ReaderProps, 'useSession'> & { nodeKey: string }) {
  const node = useChatSelector(useSession, chat => chat.nodes.get(nodeKey));
  if (!node || node.visibility === 'hidden') return null;
  if (node.kind === 'turn-max-tokens') return <div className={css.notice} role="status" data-reader-notice="max-tokens">
    <StateDot state="warning" /><span className={css.noticeTitle} data-tone="warning">已到达输出长度限制</span>
    <span className={css.noticeText}>回答可能尚未完整，已生成的内容仍保留。</span>
  </div>;
  const data = record(node.data);
  const message = typeof data?.message === 'string' ? data.message : '';
  const code = typeof data?.code === 'string' ? data.code : '';
  return <div className={css.notice} role="alert" data-reader-notice="error">
    <StateDot state="error" /><span className={css.noticeTitle} data-tone="error">本轮出现错误</span>
    {message && <span className={css.noticeText}>{message}</span>}
    {code && <code className={css.noticeCode}>{code}</code>}
  </div>;
});
