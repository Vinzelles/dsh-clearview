import { memo, useCallback, useId, useMemo, useState } from 'react';
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-ui-conversation/client';
import {
  IconApiOutlineRegular, IconBrowseOutlineRegular, IconCodeOutlineRegular, IconEditOutlineRegular,
  IconGlobeOutlineRegular, IconSearchOutlineRegular, IconSkillOutlineRegular, IconSparkleRegular,
} from '@deepseek-ai/dsh-client-ui-primitives';
import { Blocks } from './Blocks.js';
import { contentBlocks } from './user-content.js';
import { CollapseBody } from './motion.js';
import { diffCardModel } from './native017/tool-models.mjs';
import { classifyTool, toolRowModel, VARIANT_TITLES } from './native/tool-call-model.js';
import { Line } from './Line.js';
import { useReaderActions } from './reader-context.js';
import { activityPhase, activitySummary, executionFacts, exitCodeFromOutput } from './tool-activity.js';
import type { ToolActivityEntry, ToolCategory, ToolPhase } from './tool-activity.js';
import { diffStat } from './transcript-model.js';
import { ToolDetails } from './ToolDetails.js';
import type { BlockRenderProps } from './types.js';
import css from './ToolRow.module.css';

const ICONS: Record<ToolCategory, typeof IconSparkleRegular> = {
  write: IconEditOutlineRegular,
  read: IconBrowseOutlineRegular,
  terminal: IconApiOutlineRegular,
  search: IconSearchOutlineRegular,
  web: IconGlobeOutlineRegular,
  other: IconSparkleRegular,
};

/** Compact duration text. */
export function formatDuration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} 毫秒` : `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} 秒`;
}

export function toolTrailing(phase: ToolPhase, exitCode: number | undefined, stat: { added: number; removed: number } | null): { text: string; tone: 'idle' | 'failed' } | null {
  if (phase === 'failed') return { text: exitCode !== undefined ? `退出码 ${exitCode}` : '失败', tone: 'failed' };
  if (phase === 'interrupted') return { text: '已中断', tone: 'failed' };
  if (stat && (stat.added > 0 || stat.removed > 0) && (phase === 'succeeded' || phase === 'returned')) return { text: `+${stat.added} −${stat.removed}`, tone: 'idle' };
  return null;
}

/** Added and removed lines of a file edit, summed over its diff hunks; null when the call carries no diff. */
export function editStat(block: ToolCallBlock | undefined): { added: number; removed: number } | null {
  if (!block) return null;
  const diffs = diffCardModel(block)?.card.diffs ?? [];
  if (diffs.length === 0) return null;
  return diffs.reduce((sum: { added: number; removed: number }, hunk: { oldText: string | null; newText: string }) => {
    const stat = diffStat(hunk.oldText, hunk.newText);
    return { added: sum.added + stat.added, removed: sum.removed + stat.removed };
  }, { added: 0, removed: 0 });
}

/** The row title of a tool call: 「技能」 for skills, the native title, or the variant fallback (「工具调用」 for unknown tools). */
export function toolRowTitle(entry: ToolActivityEntry, known?: { model: ReturnType<typeof activitySummary>; native: { title: string } | null }): string {
  const model = known?.model ?? activitySummary(entry);
  if (model.name === 'skill') return '使用技能';
  if (model.name === 'str_replace_editor') {
    if (model.args.command === 'create') return '写入';
    if (model.args.command === 'view') return '读取';
    if (model.args.command === 'str_replace' || model.args.command === 'insert') return '编辑';
  }
  const native = known ? known.native : entry.block ? toolRowModel(model.name, entry.block) : null;
  return native?.title ?? VARIANT_TITLES[classifyTool(model.name)];
}

function resultText(block: ToolCallBlock | undefined): string {
  return block && 'kind' in block ? block.content.filter(item => item.type === 'text').map(item => item.text).join('\n') : '';
}

/** One tool call as a transcript line, keyed by call id from generation to result. */
export const ToolRow = memo(function ToolRow({ entry, turnClosed, onRead, onOpenChange, depth = 0, ...render }: BlockRenderProps & {
  entry: ToolActivityEntry; turnClosed: boolean; onRead: () => void; depth?: number;
  /** Reports the reader opening or closing this row, so a settled call is not folded away under them. */
  onOpenChange?: (key: string, open: boolean) => void;
}) {
  const { motion } = useReaderActions();
  const [open, setOpen] = useState(false);
  const detailId = useId();
  const toggle = useCallback(() => { onRead(); setOpen(!open); onOpenChange?.(entry.key, !open); }, [onRead, open, onOpenChange, entry.key]);
  const model = useMemo(() => activitySummary(entry), [entry.block, entry.draft]);
  if (depth > 6) return <p className={css.deep}>更深的嵌套调用可在原对话查看。</p>;
  const phase = activityPhase(entry, turnClosed);
  const block = entry.block;
  const native = block ? toolRowModel(model.name, block) : null;
  const skill = model.name === 'skill';
  const Icon = skill ? IconSkillOutlineRegular : model.name === 'code' ? IconCodeOutlineRegular : ICONS[model.category];
  const title = toolRowTitle(entry, { model, native });
  const skillName = typeof model.args?.name === 'string' ? model.args.name.split('\n')[0] : model.raw.split('\n')[0];
  const command = model.category === 'terminal' && typeof model.args.command === 'string' ? model.args.command : undefined;
  const summary = skill ? skillName : command ?? (model.name === 'str_replace_editor' ? model.target : undefined) ?? native?.summary
    ?? (classifyTool(model.name) === 'others' ? `${model.name} · ${model.target ?? model.title}` : model.target ?? model.title);
  const active = phase === 'preparing' || phase === 'running';
  const failed = phase === 'failed';
  const text = resultText(block);
  const facts = executionFacts(block);
  const exitCode = facts.exitCode ?? (failed ? exitCodeFromOutput(text, true) : undefined);
  const stat = model.category === 'write' ? editStat(block) : null;
  const end = toolTrailing(phase, exitCode, stat);
  return <div className={css.tool} data-reader-tool-call={entry.callId} data-tool-phase={phase} data-tool-category={model.category} data-expanded={open}>
    <Line icon={<Icon size={14} />} label={title} target={model.category === 'terminal' ? <code className={css.command}>{summary}</code> : summary} title={summary}
      tone={failed || phase === 'interrupted' ? 'failed' : active ? 'running' : 'idle'} shimmer={active && motion}
      trailing={end && (stat && end.tone === 'idle' ? <><span data-add>+{stat.added}</span> <span data-del>−{stat.removed}</span></> : end.text)}
      open={open} onToggle={toggle} controls={detailId} />
    <CollapseBody open={open} motion={motion}>
      <div id={detailId} className={css.detail}>
        <ToolDetails entry={entry} model={model} phase={phase} {...render} />
        {!!block?.subCalls.length && <div className={css.children} aria-label="子调用">{block.subCalls.map((child, index) => <ToolRow key={child.callId} {...render}
          entry={{ kind: 'tool', key: `reader-tool:${child.callId}`, callId: child.callId, step: entry.step, order: index, block: child }}
          turnClosed={turnClosed} onRead={onRead} depth={depth + 1} />)}</div>}
      </div>
    </CollapseBody>
  </div>;
}, (previous, next) => previous.entry.callId === next.entry.callId && previous.entry.block === next.entry.block
  && previous.entry.draft === next.entry.draft && previous.entry.step === next.entry.step
  && previous.turnClosed === next.turnClosed && previous.depth === next.depth && previous.onRead === next.onRead && previous.onOpenChange === next.onOpenChange
  && previous.renderSlotChain === next.renderSlotChain && previous.loadImage === next.loadImage);

function mediaOf(block: ToolCallBlock | undefined, depth = 0): ReturnType<typeof contentBlocks> {
  if (!block || depth > 6) return [];
  const own = 'kind' in block ? contentBlocks(block.content).filter(item => item.kind === 'image' || item.kind === 'other') : [];
  return [...own, ...block.subCalls.flatMap(child => mediaOf(child, depth + 1))];
}

/** Images and extension content returned by tools stay visible beside the answer. */
export function ToolImages({ entries, ...render }: BlockRenderProps & { entries: readonly ToolActivityEntry[] }) {
  const blocks = useMemo(() => entries.flatMap(entry => mediaOf(entry.block)), [entries]);
  if (blocks.length === 0) return null;
  return <div className={css.media} data-reader-tool-media><Blocks {...render} blocks={blocks} source="tool" /></div>;
}
