import { memo, useCallback, useMemo, useRef, useState } from 'react';
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-ui-conversation/client';
import {
  DisclosureRow, TextShimmer,
  IconApiOutlineRegular, IconBrowseOutlineRegular, IconCodeOutlineRegular, IconEditOutlineRegular,
  IconGlobeOutlineRegular, IconSearchOutlineRegular, IconSkillOutlineRegular, IconSparkleRegular,
} from '@deepseek-ai/dsh-client-ui-primitives';
import { Blocks } from './Blocks.js';
import { contentBlocks } from './user-content.js';
import { ProcessFragment } from './motion.js';
import { classifyTool, toolRowModel, VARIANT_TITLES } from './native/tool-call-model.js';
import { ErrorSummary, RowGlyph, RowSeparator, errorExcerpt } from './ProcessRow.js';
import { useReaderActions } from './reader-context.js';
import { activityPhase, activitySummary, executionFacts, exitCodeFromOutput } from './tool-activity.js';
import type { ToolActivityEntry, ToolCategory, ToolPhase } from './tool-activity.js';
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

export function formatDuration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} 毫秒` : `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} 秒`;
}

export function toolEndLabel(phase: ToolPhase, exitCode: number | undefined, elapsedMs: number | null): string {
  switch (phase) {
    case 'preparing': return '生成输入';
    case 'running': return '执行中';
    case 'failed': return exitCode !== undefined ? `退出码 ${exitCode}` : '失败';
    case 'interrupted': return '已中断';
    default: return elapsedMs !== null ? formatDuration(elapsedMs) : '';
  }
}

function resultText(block: ToolCallBlock | undefined): string {
  return block && 'kind' in block ? block.content.filter(item => item.type === 'text').map(item => item.text).join('\n') : '';
}

/** One tool call in the native 24px row grammar, keyed by call id from generation to result. */
export const ToolRow = memo(function ToolRow({ entry, turnClosed, onRead, depth = 0, ...render }: BlockRenderProps & {
  entry: ToolActivityEntry; turnClosed: boolean; onRead: () => void; depth?: number;
}) {
  const { motion } = useReaderActions();
  const [open, setOpen] = useState(false);
  const control = useRef<HTMLElement | null>(null);
  const toggle = useCallback(() => { onRead(); setOpen(value => !value); }, [onRead]);
  const model = useMemo(() => activitySummary(entry), [entry.block, entry.draft]);
  if (depth > 6) return <p className={css.deep}>更深的嵌套调用可在原对话查看。</p>;
  const phase = activityPhase(entry, turnClosed);
  const block = entry.block;
  const native = block ? toolRowModel(model.name, block) : null;
  const skill = model.name === 'skill';
  const Icon = skill ? IconSkillOutlineRegular : model.name === 'code' ? IconCodeOutlineRegular : ICONS[model.category];
  const title = skill ? '技能' : native?.title ?? VARIANT_TITLES[classifyTool(model.name)];
  const skillName = typeof model.args?.name === 'string' ? model.args.name.split('\n')[0] : model.raw.split('\n')[0];
  const summary = skill ? skillName : native?.summary
    ?? (classifyTool(model.name) === 'others' ? `${model.name} · ${model.target ?? model.title}` : model.target ?? model.title);
  const active = phase === 'preparing' || phase === 'running';
  const failed = phase === 'failed';
  const text = resultText(block);
  const facts = executionFacts(block);
  const exitCode = facts.exitCode ?? (failed ? exitCodeFromOutput(text, true) : undefined);
  const elapsed = block && 'kind' in block && block.callTime != null ? Math.max(0, block.time - block.callTime) : null;
  const end = toolEndLabel(phase, exitCode, elapsed);
  return <div ref={element => { control.current = element?.querySelector<HTMLElement>('[data-disclosure-row]') ?? null; }}
    className={css.tool} data-reader-tool-call={entry.callId} data-tool-phase={phase} data-tool-category={model.category} data-expanded={open}>
    <DisclosureRow icon={<RowGlyph tone={active ? 'active' : failed ? 'failed' : 'idle'} icon={<Icon size={14} />} />}
      title={title} open={open} expandable expandOnRowClick previewChevron keepContentWhenOpen onToggle={toggle}
      rowClassName={css.row} titleClassName={failed ? css.failedTitle : undefined}
      collapsedContent={<>
        <RowSeparator />
        <TextShimmer active={active && motion} className={css.summary} contentClassName={css.summaryContent}><span className={css.summaryText} title={summary}>{summary}</span></TextShimmer>
        {end && <span className={failed ? `${css.end} ${css.failedEnd}` : css.end}>{end}</span>}
      </>} />
    {failed && !open && <ErrorSummary text={errorExcerpt(native?.errorSummary ?? text)} />}
    <ProcessFragment open={open} motion={motion} onRead={onRead} returnFocusTo={control} nodeKey={`${entry.key}:detail`} framed>
      <ToolDetails entry={entry} model={model} phase={phase} {...render} />
    </ProcessFragment>
    {!!block?.subCalls.length && <div className={css.children} aria-label="子调用">{block.subCalls.map((child, index) => <ToolRow key={child.callId} {...render}
      entry={{ kind: 'tool', key: `reader-tool:${child.callId}`, callId: child.callId, step: entry.step, order: index, block: child }}
      turnClosed={turnClosed} onRead={onRead} depth={depth + 1} />)}</div>}
  </div>;
}, (previous, next) => previous.entry.callId === next.entry.callId && previous.entry.block === next.entry.block
  && previous.entry.draft === next.entry.draft && previous.entry.step === next.entry.step
  && previous.turnClosed === next.turnClosed && previous.depth === next.depth && previous.onRead === next.onRead
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
