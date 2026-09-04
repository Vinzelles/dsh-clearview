import type { AssistantBlock, ChatConversationViewNode, ToolCallBlock, TurnLocation } from '@deepseek-ai/dsh-client-runtime/client';
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client';
import type { ReaderGroup } from './projection.js';
import type { RewindSpan } from './rewind-hidden.js';

export type ToolDraft = Extract<AssistantBlock, { kind: 'tool-call' }>;
export type ToolPhase = 'preparing' | 'running' | 'returned' | 'succeeded' | 'failed' | 'interrupted';
export type ToolCategory = 'write' | 'read' | 'terminal' | 'search' | 'web' | 'other';
export interface ToolActivityEntry {
  kind: 'tool'; key: string; callId: string; step: number; order: number;
  draft?: ToolDraft; block?: ToolCallBlock;
}
export type ReaderFlowEntry = ToolActivityEntry | { kind: 'node'; key: string; nodeKey: string; order: number };

/** Public Step data includes tool-only model output before a chat node exists. */
export function readerFlow(
  group: ReaderGroup,
  turn: TurnLocation | undefined,
  get: (key: string) => ChatConversationViewNode | undefined,
  rewind?: { hidden: ReadonlySet<number>; spans: readonly RewindSpan[] },
): ReaderFlowEntry[] {
  const flow: ReaderFlowEntry[] = [];
  const calls = new Map<string, ToolActivityEntry>();
  const assistantOrder = new Map<number, number>();
  const stepHidden = (step: TurnLocation['steps'][number]): boolean => {
    if (!rewind || rewind.spans.length === 0) return false;
    const start = step.start?.seq;
    const end = step.end?.seq;
    return rewind.spans.some(span =>
      (start !== undefined && start >= span.start && start <= span.end)
      || (end !== undefined && end >= span.start && end <= span.end)
    );
  };
  for (const key of group.keys) {
    const node = get(key);
    if (!node || node.visibility === 'hidden') continue;
    if (rewind?.hidden.has(node.anchorSeq)) continue;
    const step = node.location.kind === 'step' ? node.location.step.step : 0;
    if (node.kind === 'tool-call') {
      const block = (node.data as { root: ToolCallBlock }).root;
      calls.set(block.callId, { kind: 'tool', key: `reader-tool:${block.callId}`, callId: block.callId, step, block, order: node.anchorSeq });
    } else {
      flow.push({ kind: 'node', key, nodeKey: key, order: node.anchorSeq });
      if (node.kind === 'assistant-step') assistantOrder.set(step, node.anchorSeq);
    }
  }
  for (const step of turn?.steps ?? []) {
    if (stepHidden(step)) continue;
    const data = step.data.get('assistant-step');
    let index = 0;
    for (const draft of data?.blocks ?? []) {
      if (draft.kind !== 'tool-call' || !draft.callId) continue;
      const previous = calls.get(draft.callId);
      calls.set(draft.callId, previous ? { ...previous, draft } : {
        kind: 'tool', key: `reader-tool:${draft.callId}`, callId: draft.callId, step: step.step, draft,
        order: (assistantOrder.get(step.step) ?? step.start?.seq ?? 0) + .01 + index++ / 10000,
      });
    }
  }
  flow.push(...calls.values());
  return flow.sort((left, right) => left.order - right.order);
}

export function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
export function stringValue(record: Record<string, unknown> | null, ...keys: string[]): string | undefined {
  for (const key of keys) if (typeof record?.[key] === 'string' && record[key]) return record[key] as string;
  return undefined;
}

/** Read only top-level JSON string values, including an unfinished final string.
 * This never executes input or mistakes escaped/nested content for a path field. */
export function inputFields(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try { return objectValue(JSON.parse(raw)) ?? {}; } catch { /* an in-flight argument is normally incomplete */ }
  const fields: Record<string, unknown> = Object.create(null);
  const prefix = raw.slice(0, 262144);
  let depth = 0;
  let key: string | undefined;
  for (let index = 0; index < prefix.length; index++) {
    const char = prefix[index];
    if (char === '{' || char === '[') { depth++; continue; }
    if (char === '}' || char === ']') { depth--; continue; }
    if (char !== '"') continue;
    const start = index;
    let closed = false;
    for (index++; index < prefix.length; index++) {
      if (prefix[index] === '\\') { index++; continue; }
      if (prefix[index] === '"') { closed = true; break; }
    }
    if (depth !== 1) continue;
    const token = prefix.slice(start, closed ? index + 1 : prefix.length);
    let value: string;
    try { value = JSON.parse(token); } catch {
      if (closed) continue;
      // Strip only an unfinished trailing escape/unicode escape, not content.
      let body = token.slice(1);
      const unicode = /(?<!\\)(?:\\\\)*\\u[\da-f]{0,3}$/i.exec(body);
      if (unicode) body = body.slice(0, unicode.index) + unicode[0].replace(/\\u[\da-f]{0,3}$/i, '');
      let slashes = 0; for (let end = body.length - 1; end >= 0 && body[end] === '\\'; end--) slashes++;
      if (slashes % 2) body = body.slice(0, -1);
      try { value = JSON.parse(`"${body}"`); } catch { continue; }
    }
    if (closed && /^\s*:/.test(prefix.slice(index + 1))) key = value;
    else if (key !== undefined) { fields[key] = value; key = undefined; }
  }
  return fields;
}

export function toolIdentity(entry: Pick<ToolActivityEntry, 'block' | 'draft'>) {
  const block = entry.block;
  const name = (block && ('call' in block && block.call?.name ? block.call.name : (block as any).name)) ?? entry.draft?.name ?? '工具调用';
  const raw = (block && ('call' in block && block.call?.argsRaw !== undefined ? block.call.argsRaw : (block as any).argsRaw)) ?? entry.draft?.argsRaw ?? '';
  return { name, raw };
}

export function executionFacts(block: ToolCallBlock | undefined): { exitCode?: number; signal?: string } {
  if (!block || !('kind' in block)) return {};
  const result = block.resultView?.card === 'terminal' ? block.resultView : null;
  const meta = objectValue(block.meta);
  const code = result?.exitCode ?? meta?.exitCode ?? meta?.exit_code;
  return { exitCode: typeof code === 'number' && Number.isFinite(code) ? code : undefined, signal: result?.signal ?? stringValue(meta, 'signal') };
}

export function activityPhase(entry: Pick<ToolActivityEntry, 'block' | 'draft'>, turnClosed = false): ToolPhase {
  if (!entry.block) return turnClosed ? 'interrupted' : 'preparing';
  if (!('kind' in entry.block)) return turnClosed ? 'interrupted' : 'running';
  const facts = executionFacts(entry.block);
  if (entry.block.isError || facts.signal || (facts.exitCode !== undefined && facts.exitCode !== 0)
    || entry.block.subCalls.some(block => activityPhase({ block }, turnClosed) === 'failed')) return 'failed';
  if (facts.exitCode === 0) return 'succeeded';
  return 'returned';
}

export function activitySummary(entry: Pick<ToolActivityEntry, 'block' | 'draft'>) {
  const { name, raw } = toolIdentity(entry);
  const args = inputFields(raw);
  const view = entry.block?.callView;
  const target = stringValue(args, 'file_path', 'path', 'filename', 'filePath');
  const command = view?.card === 'terminal' ? view.title : stringValue(args, 'command', 'cmd', 'script');
  const description = view?.card === 'terminal' ? view.description : stringValue(args, 'description');
  const file = target?.split(/[/\\]/).at(-1);
  const editorCommand = stringValue(args, 'command');
  const isEditor = name === 'str_replace_editor';
  const category: ToolCategory = /^(write|edit|apply_patch|patch)$/.test(name)
    || (isEditor && (editorCommand === 'str_replace' || editorCommand === 'insert' || editorCommand === 'create'))
    || view?.card === 'diff' ? 'write'
    : /^(read|read_file)$/.test(name) || (isEditor && editorCommand === 'view') ? 'read'
    : /^(bash|shell|terminal|exec_command|pwsh)$/.test(name) || view?.card === 'terminal' ? 'terminal'
    : /^(grep|glob|find|search)$/.test(name) ? 'search'
    : /^(web_search|web_fetch|web_open)$/.test(name) ? 'web' : 'other';
  const title = category === 'write' ? `${name === 'write' || (isEditor && editorCommand === 'create') ? '写入' : '修改'}${file ? ` ${file}` : name === 'apply_patch' ? '代码补丁' : '文件'}`
    : category === 'read' ? `读取${file ? ` ${file}` : '文件'}`
    : category === 'terminal' ? description || '运行命令'
    : category === 'search' ? name === 'glob' ? '查找文件' : '搜索内容'
    : category === 'web' ? name === 'web_search' ? '搜索网页' : '读取网页'
    : view?.title || name;
  return { name, raw, args, category, title, target: target ?? command ?? stringValue(args, 'query', 'pattern', 'url'), command,
    cwd: view?.card === 'terminal' ? view.cwd : stringValue(args, 'workdir', 'cwd'), content: stringValue(args, 'content', 'new_string', 'newText') };
}

export function preparingLabel(name: string): string {
  return /^(write|edit|apply_patch)$/.test(name) ? '正在生成文件内容' : /^(bash|shell|exec_command|pwsh)$/.test(name) ? '正在准备命令' : '正在准备工具输入';
}

/**
 * A settled execution failure that its error card fully presents: the card
 * embeds the tool's own details layout (result / input / raw record, the same
 * toolDetails the tool row uses), so the flow suppresses the per-tool activity
 * row instead of showing the same execution in two seats (row + card). Every
 * failed tool call merges — terminal, search, file edits, web and the rest.
 */
export function isMergedExecutionFailure(entry: Pick<ToolActivityEntry, 'block' | 'draft'>, turnClosed = false): boolean {
  const block = entry.block;
  if (!block || !('kind' in block)) return false;
  return activityPhase(entry, turnClosed) === 'failed';
}

/**
 * Some execution failures carry their exit code only inside the error text
 * (e.g. `Error: grep search failed (exit 2)`, `Error: exit code: 1 (no
 * output)`) while the block's meta/resultView stays empty. Recover a
 * non-zero exit code from such text so the merged card can state the real
 * exit status instead of a clean-settle indicator. Returns undefined when
 * the text carries no usable code — the caller then falls back to a failure
 * label instead of fabricating a number.
 */
export function exitCodeFromOutput(text: string, failed: boolean): number | undefined {
  if (!failed) return undefined;
  const match = text.match(/\(exit (\d+)\)|exit code[:：]\s*(\d+)/i);
  const value = match ? Number(match[1] ?? match[2]) : NaN;
  return Number.isFinite(value) && value !== 0 ? value : undefined;
}

export interface OperationalClusterSummary {
  commands: number;
  tools: number;
  operations: number;
  failed: number;
}

export type OperationalFlowItem =
  | { kind: 'single'; item: ReaderFlowEntry }
  | { kind: 'cluster'; key: string; items: ReaderFlowEntry[]; summary: OperationalClusterSummary; hasActive: boolean; hasFailed: boolean };

export function formatOperationClusterSummary(summary: OperationalClusterSummary): string {
  const parts: string[] = [];
  if (summary.commands > 0) parts.push(`运行了 ${summary.commands} 条命令`);
  if (summary.tools > 0) parts.push(`进行了 ${summary.tools} 次工具调用`);
  if (summary.operations > 0) parts.push(`执行了 ${summary.operations} 个操作`);
  return parts.join('，');
}

export function groupOperationalFlow(
  items: readonly ReaderFlowEntry[],
  get: (key: string) => ChatConversationViewNode | undefined,
): OperationalFlowItem[] {
  const result: OperationalFlowItem[] = [];
  let currentGroup: ReaderFlowEntry[] = [];

  const flush = () => {
    if (currentGroup.length === 0) return;
    if (currentGroup.length === 1) {
      result.push({ kind: 'single', item: currentGroup[0] });
    } else {
      let commands = 0;
      let tools = 0;
      let operations = 0;
      let failed = 0;
      let hasActive = false;
      let hasFailed = false;

      for (const entry of currentGroup) {
        if (entry.kind === 'tool') {
          tools++;
          const phase = activityPhase(entry);
          if (phase === 'preparing' || phase === 'running') hasActive = true;
          if (phase === 'failed') { hasFailed = true; failed++; }

          const summary = activitySummary(entry);
          if (summary.category === 'terminal') {
            commands++;
          } else if (summary.category === 'read' || summary.category === 'write') {
            operations++;
          }
        } else if (entry.kind === 'node') {
          const node = get(entry.nodeKey);
          if (node?.kind === 'command' || node?.kind === 'manual-compaction') {
            commands++;
            operations++;
            const outcome = node.kind === 'command'
              ? (node.data as { outcome?: { kind?: string } | null }).outcome
              : (node.data as { command: { outcome?: { kind?: string } | null } }).command.outcome;
            if (outcome == null) hasActive = true;
            if (outcome?.kind === 'error') { hasFailed = true; failed++; }
          }
        }
      }

      const first = currentGroup[0]!;
      result.push({
        kind: 'cluster',
        key: `cluster:${first.kind === 'node' ? first.nodeKey : first.callId}`,
        items: currentGroup,
        summary: { commands, tools, operations, failed },
        hasActive,
        hasFailed,
      });
    }
    currentGroup = [];
  };

  for (const item of items) {
    let isOp = false;
    if (item.kind === 'tool') {
      isOp = true;
    } else if (item.kind === 'node') {
      const node = get(item.nodeKey);
      if (node?.kind === 'command' || node?.kind === 'manual-compaction') {
        isOp = true;
      }
    }

    if (isOp) {
      currentGroup.push(item);
    } else {
      flush();
      result.push({ kind: 'single', item });
    }
  }

  flush();
  return result;
}
