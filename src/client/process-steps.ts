import type { AssistantChatData, ChatConversationViewNode, ToolChatData } from '@deepseek-ai/dsh-client-ui-chat/client';
import type { TurnLocation } from '@deepseek-ai/dsh-client-ui-conversation/client';
import { assistantSegments, hasVisibleBody, type TurnBoundary } from './projection.js';
import { preparingLabel, type ReaderFlowEntry, type ToolActivityEntry } from './tool-activity.js';

/** One chronological item in a turn, including visible results at their source positions. */
export type PanelItem =
  | { kind: 'reasoning'; key: string; nodeKey: string; start: number; step: number | null }
  | { kind: 'narration'; key: string; nodeKey: string; start: number; step: number | null; answer?: boolean }
  | { kind: 'tool'; key: string; entry: ToolActivityEntry; step: number | null }
  | { kind: 'record' | 'input'; key: string; nodeKey: string; step: number | null }
  | { kind: 'media'; key: string; entry: ToolActivityEntry; step: number | null }
  | { kind: 'output' | 'notice'; key: string; nodeKey: string; step: number | null };

export type ReasoningItem = Extract<PanelItem, { kind: 'reasoning' }>;

export interface AnswerSegment { key: string; nodeKey: string; start: number }
/** `outputs` are successful /command results: their text belongs beside the answer, the row stays in the panel. */
export interface TurnLayout { transcript: PanelItem[]; panel: PanelItem[]; answer: AnswerSegment[]; notices: string[]; media: ToolActivityEntry[]; outputs: string[] }

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

/** Text of a successful command outcome; failures stay in the panel only. */
export function commandOutputText(node: ChatConversationViewNode): string | null {
  const outcome = (node.data as { outcome?: { kind?: string; text?: unknown } | null } | null)?.outcome;
  return outcome?.kind === 'success' && typeof outcome.text === 'string' && outcome.text.trim() !== '' ? outcome.text : null;
}

/** Preserve source order. Answer classification adds semantics, never relocates content. */
export function layoutTurn(flow: readonly ReaderFlowEntry[], get: Getter, boundary: TurnBoundary): TurnLayout {
  const panel: PanelItem[] = [];
  const notices: string[] = [];
  const media: ToolActivityEntry[] = [];
  const outputs: string[] = [];
  const transcript: PanelItem[] = [];
  const bodies: { item: PanelItem & { kind: 'narration' }; position: number }[] = [];
  const calls = new Map(flow.filter((entry): entry is ToolActivityEntry => entry.kind === 'tool').map(entry => [entry.callId, entry]));
  const emitted = new Set<string>();
  const appendTool = (entry: ToolActivityEntry) => {
    if (emitted.has(entry.callId)) return;
    emitted.add(entry.callId);
    const item = { kind: 'tool' as const, key: entry.key, entry, step: entry.step >= 0 ? entry.step : null };
    panel.push(item);
    transcript.push(item);
    if (carriesMedia(entry.block)) {
      media.push(entry);
    }
  };
  for (const entry of flow) {
    if (entry.kind === 'tool') {
      appendTool(entry);
      continue;
    }
    const node = get(entry.nodeKey);
    if (!node || node.visibility === 'hidden' || SKIPPED_KINDS.has(node.kind)) continue;
    const step = stepOf(node);
    if (NOTICE_KINDS.has(node.kind)) {
      notices.push(entry.nodeKey);
      transcript.push({ kind: 'notice', key: entry.key, nodeKey: entry.nodeKey, step });
      continue;
    }
    if (node.kind === 'assistant-step') {
      const blocks = (node.data as AssistantChatData).blocks;
      const segments = new Map(assistantSegments(blocks).map(segment => [segment.start, segment]));
      for (const [index, block] of blocks.entries()) {
        if (block.kind === 'tool-call') {
          const call = calls.get(block.callId);
          if (call) appendTool(call);
          else appendTool({ kind: 'tool', key: `reader-tool:${block.callId}`, callId: block.callId, step: step ?? 0, order: entry.order + (index + 1) / 10000, draft: block });
          continue;
        }
        const segment = segments.get(index);
        if (!segment) continue;
        const key = `${entry.nodeKey}:${segment.start}`;
        if (segment.kind === 'reasoning') {
          if (segment.blocks.some(block => block.kind === 'reasoning' && block.text.trim() !== '')) {
            const thought = { kind: 'reasoning' as const, key, nodeKey: entry.nodeKey, start: segment.start, step };
            panel.push(thought);
            transcript.push(thought);
          }
          continue;
        }
        if (!hasVisibleBody(segment.blocks)) continue;
        const item = { kind: 'narration' as const, key, nodeKey: entry.nodeKey, start: segment.start, step };
        bodies.push({ item, position: panel.length });
        panel.push(item);
        transcript.push(item);
      }
      continue;
    }
    const item: PanelItem = { kind: INPUT_KINDS.has(node.kind) ? 'input' : 'record', key: entry.key, nodeKey: entry.nodeKey, step };
    panel.push(item);
    transcript.push(item);
    if (node.kind === 'command' && commandOutputText(node) !== null) {
      outputs.push(entry.nodeKey);
      transcript.push({ kind: 'output', key: `${entry.key}:output`, nodeKey: entry.nodeKey, step });
    }
  }
  const completed = boundary.status === 'closed' && boundary.reason === 'completed' && boundary.closingStep !== null;
  const answerKeys = new Set<string>();
  for (const body of bodies) {
    const isAnswer = completed
      ? body.item.step !== null && body.item.step >= boundary.closingStep!
      : !panel.slice(body.position + 1).some(item => PROCESS_KINDS.has(item.kind));
    if (isAnswer) answerKeys.add(body.item.key);
  }
  return {
    transcript: transcript.map(item => item.kind === 'narration' && answerKeys.has(item.key) ? { ...item, answer: true } : item),
    panel: panel.filter(item => !answerKeys.has(item.key)),
    answer: bodies.filter(body => answerKeys.has(body.item.key)).map(({ item }) => ({ key: item.key, nodeKey: item.nodeKey, start: item.start })),
    notices,
    media,
    outputs,
  };
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
