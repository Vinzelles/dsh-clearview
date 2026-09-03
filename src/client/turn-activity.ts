import type { AssistantChatData } from '@deepseek-ai/dsh-client-ui-conversation/client';
import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-runtime/client';

export type ActivityPhase =
  | 'thinking' | 'output' | 'tool' | 'waiting' | 'processing' | 'idle';

export interface TurnActivity { phase: ActivityPhase; key: string; since: number | null }

export interface TurnSnapshot {
  status?: 'open' | 'closed' | 'unknown';
  steps?: readonly { step: number; data: Map<string, unknown> }[];
}

interface AssistantStepRef { step: number; data: AssistantChatData }

function latestAssistant(turn: TurnSnapshot): AssistantStepRef | null {
  for (let i = (turn.steps?.length ?? 0) - 1; i >= 0; i--) {
    const s = turn.steps![i];
    const data = s.data.get('assistant-step') as AssistantChatData | undefined;
    if (data) return { step: s.step, data };
  }
  return null;
}

export function turnPhaseOf(turn: TurnSnapshot | undefined, pending: number): ActivityPhase {
  if (!turn || turn.status !== 'open') return 'idle';
  if (pending > 0) return 'waiting';
  const current = latestAssistant(turn);
  if (!current) return 'processing';
  const last = current.data.blocks.at(-1);
  // status === 'running' gates only tool-calls: a finished (settled) tool must
  // not open a new "using tool" phase, while reasoning/text may stay visible
  // at the tail of an already-settled open turn.
  if (current.data.status === 'running' && last?.kind === 'tool-call') return 'tool';
  if (last?.kind === 'reasoning') return 'thinking';
  if (last?.kind === 'text') return 'output';
  return 'processing';
}

export function latestOpenTurn(
  turn: TurnSnapshot | undefined,
  pending: number,
  _chat: readonly ChatConversationViewNode[],
): TurnActivity & { turn: TurnSnapshot; step: number } | null {
  const phase = turnPhaseOf(turn, pending);
  if (phase === 'idle') return null;
  const current = latestAssistant(turn!);
  const step = current?.step ?? 0;
  const last = current?.data.blocks.at(-1);
  const since = current
    ? (last?.kind === 'tool-call'
        ? (last as { callTime?: number }).callTime ?? current.data.time
        : current.data.time)
    : null;
  return { turn: turn!, step, phase, since, key: phaseKeyOf(turn!, step, since) };
}

export function activityLabel(phase: ActivityPhase): string {
  switch (phase) {
    case 'thinking': return '正在思考';
    case 'output': return '正在输出';
    case 'tool': return '正在使用工具';
    case 'waiting': return '等待你的操作';
    case 'processing': return '正在处理';
    case 'idle': return '';
  }
}

export function phaseKeyOf(turn: TurnSnapshot, step: number, _since: number | null): string {
  // Phase identity: turn status + step + the latest block's kind. Timing
  // changes (since) intentionally do not reset the bar's seconds — only a
  // phase/step change does.
  const latest = (turn.steps ?? []).find(s => s.step === step);
  const data = latest?.data.get('assistant-step') as AssistantChatData | undefined;
  const kind = data?.blocks.at(-1)?.kind ?? 'none';
  return `${turn.status ?? 'open'}:${step}:${kind}`;
}

export function formatSeconds(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 1) return '不到 1 秒';
  if (s < 60) return `${s} 秒`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return rest ? `${m} 分 ${rest} 秒` : `${m} 分钟`;
}
