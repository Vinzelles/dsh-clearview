// Pure data builders for chat snapshots; no React, no host modules.
import type { ChatConversationViewNode, ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client';
import type { TurnLocation } from '@deepseek-ai/dsh-client-ui-conversation/client';
import type { ReaderFlowEntry, ToolActivityEntry } from '../../src/client/tool-activity.ts';

export interface TurnSpec {
  turn?: number;
  status?: 'open' | 'closed' | 'unknown';
  reason?: string;
  start?: number;
  end?: number;
  steps?: number[];
  closingStep?: number;
  closingSeq?: number;
  data?: Record<string, unknown>;
}

export function turnLocation(spec: TurnSpec = {}): TurnLocation {
  const turn = spec.turn ?? 1;
  const status = spec.status ?? 'closed';
  const data: Record<string, unknown> = { ...(spec.data ?? {}) };
  if (spec.closingStep !== undefined) {
    data['turn-tail'] ??= { turn, seq: 1000, time: spec.end ?? 0, closing: { step: spec.closingStep, time: spec.end ?? 0, finalNode: { seq: spec.closingSeq ?? 900 } }, branchUnavailable: false };
  }
  return {
    turn,
    status,
    start: spec.start === undefined ? undefined : { seq: 1, time: spec.start },
    end: status === 'closed' ? { seq: 1000, time: spec.end ?? 0, data: { reason: { kind: spec.reason ?? 'completed' } } } : undefined,
    steps: (spec.steps ?? []).map(step => ({ turn, step, start: { seq: step * 10, time: step * 1000 }, end: undefined, status: 'closed', data: new Map() })),
    data: new Map(Object.entries(data)),
  } as unknown as TurnLocation;
}

let seq = 0;
export function chatNode(kind: string, data: unknown, turn: TurnLocation, step?: number, extra: Record<string, unknown> = {}): ChatConversationViewNode {
  const anchorSeq = ++seq * 10;
  const location = step === undefined
    ? { kind: 'turn', turn }
    : { kind: 'step', turn, step: { turn: turn.turn, step, start: undefined, end: undefined, status: 'closed', data: new Map() } };
  return { key: `${kind}:${anchorSeq}`, target: 'chat', kind, data, anchorSeq, location, visibility: 'visible', ...extra } as unknown as ChatConversationViewNode;
}

export const text = (value: string) => ({ kind: 'text' as const, text: value });
export const reasoning = (value: string) => ({ kind: 'reasoning' as const, text: value });
export const toolCall = (callId: string, name: string, args: Record<string, unknown> = {}) => ({ kind: 'tool-call' as const, callId, name, argsRaw: JSON.stringify(args) });

export function assistantNode(turn: TurnLocation, step: number, blocks: readonly unknown[], status: 'running' | 'settled' | 'interrupted' = 'settled'): ChatConversationViewNode {
  return chatNode('assistant-step', { status, turn: turn.turn, step, blocks, time: step * 1000 }, turn, step);
}

export function settledTool(callId: string, name: string, args: Record<string, unknown>, over: Record<string, unknown> = {}) {
  return { kind: 'tool-result', seq: 0, time: 2500, callTime: 1000, callId, call: { name, argsRaw: JSON.stringify(args) }, content: [{ type: 'text', text: 'ok' }], isError: false, meta: {}, subCalls: [], ...over };
}

export function toolEntry(callId: string, step: number, block?: unknown, draft?: unknown): ToolActivityEntry {
  return { kind: 'tool', key: `reader-tool:${callId}`, callId, step, order: step * 10 + 5, block, draft } as unknown as ToolActivityEntry;
}

export function nodeEntry(node: ChatConversationViewNode): ReaderFlowEntry {
  return { kind: 'node', key: node.key, nodeKey: node.key, order: node.anchorSeq };
}

export function chatOf(nodes: readonly ChatConversationViewNode[], turns: readonly TurnLocation[]): ChatSnapshot {
  const byKey = new Map(nodes.map(node => [node.key, node]));
  return {
    order: nodes.map(node => node.key),
    nodes: { get: (key: string) => byKey.get(key), values: () => [...byKey.values()] },
    timeline: { turnOrder: turns.map(turn => turn.turn), turns: new Map(turns.map(turn => [turn.turn, turn])) },
  } as unknown as ChatSnapshot;
}
