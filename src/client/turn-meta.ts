import type { TurnLocation } from '@deepseek-ai/dsh-client-ui-conversation/client';

const pad2 = (n: number) => (n < 10 ? '0' : '') + n;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** Turn data contributed by other plugins is read by key without importing their type merges. */
function turnData(turn: TurnLocation, key: string): unknown {
  return (turn.data as unknown as { get(key: string): unknown }).get(key);
}

/** Native clock: today HH:MM, this year 9月24日 HH:MM, otherwise with the year. */
export function fmtClock(time: number, now: Date = new Date()): string | null {
  if (typeof time !== 'number' || !Number.isFinite(time)) return null;
  const d = new Date(time);
  const clock = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()) return clock;
  const date = d.getFullYear() === now.getFullYear()
    ? `${d.getMonth() + 1}月${d.getDate()}日`
    : `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  return `${date} ${clock}`;
}

export function fmtRun(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}分${pad2(s)}秒` : `${s}秒`;
}

/** Native formatTokens: <1k raw, <1M one-decimal K, otherwise one-decimal M. */
export function fmtCompactTokens(value: number): string {
  const scaled = (v: number) => v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10);
  if (value < 1e3) return String(Math.round(value));
  if (value < 1e6) return `${scaled(value / 1e3)}K`;
  return `${scaled(value / 1e6)}M`;
}

export interface TurnClosing { seq: number; step: number; time: number }

/** The closing assistant reply recorded by turn-tail, or null without evidence. */
export function closingOf(turn: TurnLocation | undefined): TurnClosing | null {
  if (!turn) return null;
  const closing = record(record(turnData(turn, 'turn-tail'))?.closing);
  const seq = record(closing?.finalNode)?.seq;
  const step = closing?.step;
  const time = closing?.time;
  return typeof seq === 'number' && typeof step === 'number' && typeof time === 'number' ? { seq, step, time } : null;
}

export interface TurnMeta { clock: string | null; duration: string | null; usage: string | null }

export function turnMeta(turn: TurnLocation | undefined, now: Date = new Date()): TurnMeta | null {
  if (!turn || turn.status !== 'closed') return null;
  const closing = closingOf(turn);
  const clock = closing ? fmtClock(closing.time, now) : null;
  const start = turn.start?.time;
  const end = turn.end?.time;
  const duration = typeof start === 'number' && typeof end === 'number' && Number.isFinite(end - start) ? `用时 ${fmtRun(end - start)}` : null;
  const total = record(record(turnData(turn, 'turn-tail'))?.tokenUsage)?.totalTokens;
  const usage = typeof total === 'number' && Number.isFinite(total) && total > 0 ? `用量 ${fmtCompactTokens(total)} tok` : null;
  return clock || duration || usage ? { clock, duration, usage } : null;
}

export function turnMetaText(meta: TurnMeta | null): string {
  return meta ? [meta.clock, meta.duration, meta.usage].filter(Boolean).join(' · ') : '';
}

export interface PresentedFileRef { path: string; description?: string; seq: number; index: number }

/** Explicit deliveries of one turn: latest declaration per path before the closing reply, first-seen order. */
export function presentedFiles(turn: TurnLocation | undefined): PresentedFileRef[] {
  if (!turn) return [];
  const presented = record(turnData(turn, 'deliverables'))?.presented;
  if (!Array.isArray(presented)) return [];
  const limit = closingOf(turn)?.seq;
  const order: string[] = [];
  const latest = new Map<string, PresentedFileRef>();
  for (const raw of presented) {
    const item = record(raw);
    if (!item || typeof item.path !== 'string' || item.path === '' || typeof item.seq !== 'number' || typeof item.index !== 'number') continue;
    if (limit !== undefined && item.seq > limit) continue;
    if (!latest.has(item.path)) order.push(item.path);
    latest.set(item.path, {
      path: item.path,
      description: typeof item.description === 'string' && item.description !== '' ? item.description : undefined,
      seq: item.seq,
      index: item.index,
    });
  }
  return order.map(path => latest.get(path)!);
}
