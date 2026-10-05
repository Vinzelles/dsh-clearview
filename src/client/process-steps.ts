import type { AssistantChatData, ChatConversationViewNode, ToolChatData } from '@deepseek-ai/dsh-client-ui-chat/client';
import type { TurnLocation } from '@deepseek-ai/dsh-client-ui-conversation/client';
import { assistantSegments, hasVisibleBody, type TurnBoundary } from './projection.js';
import { activityPhase, activitySummary, preparingLabel, type ReaderFlowEntry, type ToolActivityEntry, type ToolCategory } from './tool-activity.js';

/** One chronological row of a turn's process panel. */
export type PanelItem =
  | { kind: 'reasoning' | 'narration'; key: string; nodeKey: string; start: number; step: number | null }
  | { kind: 'tool'; key: string; entry: ToolActivityEntry; step: number | null }
  | { kind: 'record' | 'input'; key: string; nodeKey: string; step: number | null };

export interface AnswerSegment { key: string; nodeKey: string; start: number }
export interface TurnLayout { panel: PanelItem[]; answer: AnswerSegment[]; notices: string[]; media: ToolActivityEntry[] }

type Getter = (key: string) => ChatConversationViewNode | undefined;

const NOTICE_KINDS = new Set(['turn-error', 'turn-max-tokens']);
const SKIPPED_KINDS = new Set(['turn-process', 'turn-tail', 'tool-call']);
const INPUT_KINDS = new Set(['user', 'steering', 'command-input']);
const PROCESS_KINDS = new Set<PanelItem['kind']>(['reasoning', 'tool', 'record']);

function stepOf(node: ChatConversationViewNode): number | null {
  return node.location.kind === 'step' ? node.location.step.step : null;
}

function carriesMedia(block: ToolActivityEntry['block']): boolean {
  if (!block || !('kind' in block)) return false;
  return block.content.some(item => item.type !== 'text') || block.subCalls.some(child => carriesMedia(child));
}

/**
 * Route one turn's flow into the process panel, the answer zone, turn-level
 * notices and tool media. A completed turn answers with its closing step (and
 * keeps media bodies visible); any other turn treats body text as the answer
 * only while no process row follows it.
 */
export function layoutTurn(flow: readonly ReaderFlowEntry[], get: Getter, boundary: TurnBoundary): TurnLayout {
  const panel: PanelItem[] = [];
  const notices: string[] = [];
  const media: ToolActivityEntry[] = [];
  const bodies: { item: PanelItem & { kind: 'narration' }; position: number; media: boolean }[] = [];
  for (const entry of flow) {
    if (entry.kind === 'tool') {
      panel.push({ kind: 'tool', key: entry.key, entry, step: entry.step > 0 ? entry.step : null });
      if (carriesMedia(entry.block)) media.push(entry);
      continue;
    }
    const node = get(entry.nodeKey);
    if (!node || node.visibility === 'hidden' || SKIPPED_KINDS.has(node.kind)) continue;
    if (NOTICE_KINDS.has(node.kind)) { notices.push(entry.nodeKey); continue; }
    const step = stepOf(node);
    if (node.kind === 'assistant-step') {
      for (const segment of assistantSegments((node.data as AssistantChatData).blocks)) {
        const key = `${entry.nodeKey}:${segment.start}`;
        if (segment.kind === 'reasoning') {
          if (segment.blocks.some(block => block.kind === 'reasoning' && block.text.trim() !== '')) {
            panel.push({ kind: 'reasoning', key, nodeKey: entry.nodeKey, start: segment.start, step });
          }
          continue;
        }
        if (!hasVisibleBody(segment.blocks)) continue;
        const item = { kind: 'narration' as const, key, nodeKey: entry.nodeKey, start: segment.start, step };
        bodies.push({ item, position: panel.length, media: segment.blocks.some(block => block.kind === 'image' || block.kind === 'other') });
        panel.push(item);
      }
      continue;
    }
    panel.push({ kind: INPUT_KINDS.has(node.kind) ? 'input' : 'record', key: entry.key, nodeKey: entry.nodeKey, step });
  }
  const completed = boundary.status === 'closed' && boundary.reason === 'completed' && boundary.closingStep !== null;
  const answerKeys = new Set<string>();
  for (const body of bodies) {
    const isAnswer = completed
      ? body.media || (body.item.step !== null && body.item.step >= boundary.closingStep!)
      : !panel.slice(body.position + 1).some(item => PROCESS_KINDS.has(item.kind));
    if (isAnswer) answerKeys.add(body.item.key);
  }
  return {
    panel: panel.filter(item => !answerKeys.has(item.key)),
    answer: bodies.filter(body => answerKeys.has(body.item.key)).map(({ item }) => ({ key: item.key, nodeKey: item.nodeKey, start: item.start })),
    notices,
    media,
  };
}

export type PanelEntry = { kind: 'item'; item: PanelItem } | { kind: 'fold'; key: string; items: PanelItem[] };
export interface StepGroup { key: string; label: string; entries: PanelEntry[] }
export interface StepLayout { earlier: { steps: number; summary: string } | null; groups: StepGroup[] }

const FOLD_MIN = 6;
const FOLD_KEEP = 3;

export function stepLabel(first: number, last: number): string {
  // Step 0 means no row of the group knows its step (mid-turn window): no label.
  if (last === 0) return '';
  return first === last ? `步骤 ${first}` : `步骤 ${first}–${last}`;
}

/** Step-less rows (turn-level context, records) join the nearest known step. */
function effectiveSteps(items: readonly PanelItem[]): number[] {
  const result: number[] = [];
  let previous: number | null = null;
  for (let index = 0; index < items.length; index++) {
    const own = items[index]!.step;
    if (own !== null) previous = own;
    let next: number | null = null;
    if (own === null && previous === null) {
      for (let ahead = index + 1; ahead < items.length && next === null; ahead++) next = items[ahead]!.step;
    }
    result.push(own ?? previous ?? next ?? 0);
  }
  return result;
}

function foldEntries(items: readonly PanelItem[], isActive: (item: PanelItem) => boolean): PanelEntry[] {
  const entries: PanelEntry[] = [];
  let run: PanelItem[] = [];
  const flush = () => {
    if (run.length >= FOLD_MIN) {
      const head = run.slice(0, run.length - FOLD_KEEP);
      const folded = head.filter(item => !isActive(item));
      if (folded.length > 0) entries.push({ kind: 'fold', key: `fold:${folded[0]!.key}`, items: folded });
      for (const item of head) if (isActive(item)) entries.push({ kind: 'item', item });
      for (const item of run.slice(run.length - FOLD_KEEP)) entries.push({ kind: 'item', item });
    } else {
      for (const item of run) entries.push({ kind: 'item', item });
    }
    run = [];
  };
  for (const item of items) {
    if (item.kind === 'tool') { run.push(item); continue; }
    flush();
    entries.push({ kind: 'item', item });
  }
  flush();
  return entries;
}

export function groupSteps(items: readonly PanelItem[], options: { condense: boolean; isActive?: (item: PanelItem) => boolean }): StepLayout {
  const isActive = options.isActive ?? (() => false);
  const steps = effectiveSteps(items);
  const runs: { step: number; items: PanelItem[] }[] = [];
  items.forEach((item, index) => {
    const step = steps[index]!;
    const last = runs.at(-1);
    if (last && last.step === step) last.items.push(item);
    else runs.push({ step, items: [item] });
  });
  const ranges: { first: number; last: number; items: PanelItem[] }[] = [];
  let pending: { first: number; last: number; items: PanelItem[] } | null = null;
  for (const run of runs) {
    const trivial = run.items.length === 1 && run.items[0]!.kind === 'tool';
    if (trivial) {
      if (pending) { pending.last = run.step; pending.items.push(...run.items); }
      else pending = { first: run.step, last: run.step, items: [...run.items] };
      continue;
    }
    if (pending) { ranges.push(pending); pending = null; }
    ranges.push({ first: run.step, last: run.step, items: run.items });
  }
  if (pending) ranges.push(pending);
  const stepOfItem = new Map(items.map((item, index) => [item, steps[index]!]));
  const groups = ranges.map(range => ({
    key: `step:${range.first}:${range.items[0]!.key}`,
    label: stepLabel(range.first, range.last),
    entries: foldEntries(range.items, isActive),
    steps: new Set(range.items.map(item => stepOfItem.get(item)!)).size,
    items: range.items,
  }));
  const strip = ({ key, label, entries }: (typeof groups)[number]): StepGroup => ({ key, label, entries });
  if (!options.condense || groups.length < 2) return { earlier: null, groups: groups.map(strip) };
  const earlier = groups.slice(0, -1);
  return {
    earlier: { steps: earlier.reduce((sum, group) => sum + group.steps, 0), summary: categorySummary(earlier.flatMap(group => group.items)) },
    groups: [strip(groups.at(-1)!)],
  };
}

const CATEGORY_LABELS: [ToolCategory, (count: number) => string][] = [
  ['read', count => `读取 ${count} 个文件`],
  ['terminal', count => `运行 ${count} 条命令`],
  ['write', count => `写入 ${count} 个文件`],
  ['search', count => `搜索 ${count} 次`],
  ['web', count => `联网 ${count} 次`],
  ['other', count => `${count} 次其他工具`],
];

export function categorySummary(items: readonly PanelItem[]): string {
  const counts = new Map<ToolCategory, number>();
  for (const item of items) {
    if (item.kind !== 'tool') continue;
    const category = activitySummary(item.entry).category;
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  return CATEGORY_LABELS.filter(([category]) => (counts.get(category) ?? 0) > 0).slice(0, 3)
    .map(([category, label]) => label(counts.get(category)!)).join(' · ');
}

export interface PanelCounts { steps: number; tools: number; failed: number }

function recordFailed(node: ChatConversationViewNode | undefined): boolean {
  if (!node) return false;
  const data = node.data as { outcome?: { kind?: string } | null; command?: { outcome?: { kind?: string } | null } };
  if (node.kind === 'command') return data.outcome?.kind === 'error';
  if (node.kind === 'manual-compaction') return data.command?.outcome?.kind === 'error';
  return false;
}

export function panelCounts(items: readonly PanelItem[], get: Getter, turnClosed: boolean): PanelCounts {
  const steps = new Set<number>();
  let tools = 0;
  let failed = 0;
  for (const item of items) {
    if (item.step !== null && item.kind !== 'input') steps.add(item.step);
    if (item.kind === 'tool') {
      tools++;
      if (activityPhase(item.entry, turnClosed) === 'failed') failed++;
    } else if (item.kind === 'record' && recordFailed(get(item.nodeKey))) failed++;
  }
  return { steps: steps.size, tools, failed };
}

export type PanelStatus = 'running' | 'waiting' | 'done' | 'interrupted' | 'error' | 'unknown';

export function panelStatus(boundary: TurnBoundary, pendingCount: number): PanelStatus {
  if (boundary.status === 'open') return pendingCount > 0 ? 'waiting' : 'running';
  if (boundary.status !== 'closed') return 'unknown';
  if (boundary.reason === 'completed') return 'done';
  if (boundary.reason === 'aborted' || boundary.reason === 'interrupted') return 'interrupted';
  return 'error';
}

export function statusLabel(status: PanelStatus, reason: string | null, running: string): string {
  switch (status) {
    case 'running': return running;
    case 'waiting': return '等待你的操作';
    case 'done': return '已完成';
    case 'interrupted': return '已中断';
    case 'error': return reason === 'max-tokens' ? '已到输出上限' : reason === 'blocked' ? '需要处理' : '出错';
    case 'unknown': return '执行过程';
  }
}

export function elapsedLabel(turn: TurnLocation | undefined, now: number, status: PanelStatus): string | null {
  const start = turn?.start?.time;
  if (typeof start !== 'number') return null;
  const live = status === 'running' || status === 'waiting';
  const end = live ? now : turn?.end?.time;
  if (typeof end !== 'number' || end < start) return null;
  const seconds = Math.round((end - start) / 1000);
  const value = seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
  return live ? value : `用时 ${value}`;
}

/** The live activity of an open turn, phrased like the native running status. */
export function runningLabel(turn: TurnLocation | undefined, keys: readonly string[], get: Getter): string {
  const current = turn?.steps.at(-1)?.data.get('assistant-step') as AssistantChatData | undefined;
  const last = current?.blocks.at(-1);
  if (current?.status === 'running' && last?.kind === 'tool-call') return preparingLabel(last.name);
  for (let index = keys.length - 1; index >= 0; index--) {
    const node = get(keys[index]!);
    if (!node) continue;
    if (node.kind === 'tool-call' && !('kind' in (node.data as ToolChatData).root)) return '正在使用工具';
    if (node.kind === 'assistant-step' && (node.data as AssistantChatData).status === 'running') {
      const tail = (node.data as AssistantChatData).blocks.at(-1);
      return tail?.kind === 'reasoning' ? '正在思考' : tail?.kind === 'text' ? '正在输出' : '正在准备回复';
    }
  }
  return '正在处理';
}
