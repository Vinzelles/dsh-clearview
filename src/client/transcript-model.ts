import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-ui-chat/client';
import type { PanelItem, ReasoningItem } from './process-steps.js';
import { activityPhase, activitySummary, objectValue } from './tool-activity.js';

type Getter = (key: string) => ChatConversationViewNode | undefined;
export type GroupKind = 'command' | 'read' | 'write' | 'edit' | 'search' | 'web' | 'skill' | 'tool' | 'operation';
export interface GroupFacts { counts: Partial<Record<GroupKind, number>>; order: GroupKind[]; running: boolean; failed: number }
export interface PlanTodo { content: string; status: 'pending' | 'in_progress' | 'completed' }
type ToolItem = Extract<PanelItem, { kind: 'tool' }>;
// PanelItem declares record and input as one variant (kind: 'record' | 'input'), so Extract on 'input' alone would be never.
export type InputItem = Extract<PanelItem, { kind: 'record' | 'input' }>;
export type TranscriptEntry =
  | { kind: 'narration'; key: string; item: Extract<PanelItem, { kind: 'narration' }> }
  | { kind: 'thought'; key: string; item: ReasoningItem }
  | { kind: 'input'; key: string; item: InputItem }
  | { kind: 'plan'; key: string; item: ToolItem; todos: PlanTodo[] }
  | { kind: 'item'; key: string; item: PanelItem }
  | { kind: 'group'; key: string; items: PanelItem[]; facts: GroupFacts };

const STANDALONE_TOOLS = new Set(['todo_write', 'dispatch']);
const STATUSES = new Set(['pending', 'in_progress', 'completed']);
const WORDS: Record<GroupKind, (count: number) => string> = {
  command: n => `运行了 ${n} 条命令`, read: n => `读取了 ${n} 个文件`, write: n => `写入了 ${n} 个文件`, edit: n => `编辑了 ${n} 个文件`,
  search: n => `搜索了 ${n} 次`, web: n => `访问了 ${n} 次网页`, skill: n => `使用了 ${n} 个技能`, tool: n => `调用了 ${n} 次工具`, operation: n => `执行了 ${n} 个操作`,
};

export function parseTodos(argsRaw: string): PlanTodo[] | null {
  let parsed: unknown;
  try { parsed = JSON.parse(argsRaw); } catch { return null; }
  const list = objectValue(parsed)?.todos;
  if (!Array.isArray(list) || list.length === 0) return null;
  const todos: PlanTodo[] = [];
  for (const raw of list) {
    const item = objectValue(raw);
    if (typeof item?.content !== 'string' || typeof item.status !== 'string' || !STATUSES.has(item.status)) return null;
    todos.push({ content: item.content, status: item.status as PlanTodo['status'] });
  }
  return todos;
}

export function diffStat(oldText: string | null, newText: string): { added: number; removed: number } {
  const before = oldText === null || oldText === '' ? [] : oldText.replace(/\n$/, '').split('\n');
  const after = newText === '' ? [] : newText.replace(/\n$/, '').split('\n');
  let head = 0;
  while (head < before.length && head < after.length && before[head] === after[head]) head++;
  let tail = 0;
  while (tail < before.length - head && tail < after.length - head && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail++;
  return { added: after.length - head - tail, removed: before.length - head - tail };
}

function toolKind(item: ToolItem): GroupKind {
  const facts = activitySummary(item.entry);
  if (facts.name === 'skill') return 'skill';
  switch (facts.category) {
    case 'terminal': return 'command';
    case 'read': return 'read';
    case 'search': return 'search';
    case 'web': return 'web';
    case 'write': return facts.name === 'write' || (facts.name === 'str_replace_editor' && facts.args.command === 'create') ? 'write' : 'edit';
    default: return 'tool';
  }
}

function recordData(node: ChatConversationViewNode) {
  return node.data as { outcome?: { kind?: string } | null; compaction?: unknown; command?: { outcome?: { kind?: string } | null } | null } | null;
}

export function isOperational(item: PanelItem, get: Getter): boolean {
  if (item.kind === 'tool') return !STANDALONE_TOOLS.has(activitySummary(item.entry).name);
  if (item.kind !== 'record') return false;
  const kind = get(item.nodeKey)?.kind;
  return kind === 'command' || kind === 'manual-compaction';
}

function factsOf(items: readonly PanelItem[], get: Getter, turnClosed: boolean): GroupFacts {
  const facts: GroupFacts = { counts: {}, order: [], running: false, failed: 0 };
  const count = (kind: GroupKind) => {
    if (!(kind in facts.counts)) facts.order.push(kind);
    facts.counts[kind] = (facts.counts[kind] ?? 0) + 1;
  };
  for (const item of items) {
    if (item.kind === 'tool') {
      count(toolKind(item));
      const phase = activityPhase(item.entry, turnClosed);
      if (phase === 'preparing' || phase === 'running') facts.running = true;
      if (phase === 'failed') facts.failed++;
      continue;
    }
    const node = item.kind === 'record' ? get(item.nodeKey) : undefined;
    if (!node) continue;
    const data = recordData(node);
    if (node.kind === 'command') {
      count('command');
      if (data?.outcome?.kind === 'error') facts.failed++;
      if (!turnClosed && data?.outcome == null) facts.running = true;
    } else {
      count('operation');
      if (data?.command?.outcome?.kind === 'error') facts.failed++;
      if (!turnClosed && data?.command?.outcome == null && data?.compaction == null) facts.running = true;
    }
  }
  return facts;
}

export function groupSummary(facts: GroupFacts): string {
  return facts.order.map(kind => WORDS[kind](facts.counts[kind]!)).join('，');
}

export function buildTranscript(items: readonly PanelItem[], get: Getter, turnClosed: boolean): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];
  let run: PanelItem[] = [];
  const flush = () => {
    if (run.length === 1) entries.push({ kind: 'item', key: run[0]!.key, item: run[0]! });
    else if (run.length > 1) entries.push({ kind: 'group', key: `group:${run[0]!.key}`, items: run, facts: factsOf(run, get, turnClosed) });
    run = [];
  };
  for (const item of items) {
    if (isOperational(item, get)) { run.push(item); continue; }
    flush();
    if (item.kind === 'narration') entries.push({ kind: 'narration', key: item.key, item });
    else if (item.kind === 'reasoning') entries.push({ kind: 'thought', key: item.key, item });
    else if (item.kind === 'input') entries.push({ kind: 'input', key: item.key, item });
    else if (item.kind === 'tool' && activitySummary(item.entry).name === 'todo_write') {
      const todos = parseTodos(activitySummary(item.entry).raw);
      entries.push(todos ? { kind: 'plan', key: item.key, item, todos } : { kind: 'item', key: item.key, item });
    } else entries.push({ kind: 'item', key: item.key, item });
  }
  flush();
  return entries;
}
