import type { TurnLocation } from '@deepseek-ai/dsh-client-ui-conversation/client';
import type { PanelItem } from './process-steps.js';
import type { TranscriptEntry } from './transcript-model.js';
import { toolIdentity } from './tool-activity.js';

/** Keep a singleton's seat when it grows into an operation group. */
export function transcriptSeatKey(entry: TranscriptEntry): string {
  return entry.kind === 'item' && entry.facts ? `group:${entry.key}` : entry.key;
}

/** User inputs, answers and terminal notices remain readable when the process folds. */
export function isProcessEntry(entry: TranscriptEntry): boolean {
  if (entry.kind === 'input') return false;
  if (entry.kind === 'narration') return !entry.item.answer;
  if (entry.kind === 'item' && ['notice', 'output', 'media'].includes(entry.item.kind)) return false;
  if (entry.kind === 'item' && entry.item.kind === 'tool' && toolIdentity(entry.item.entry).name === 'ask_user_question') return false;
  return true;
}

export function turnProcessOpen(choice: boolean | undefined, closed: boolean, reason: string | null, reading: boolean): boolean {
  if (!closed) return true;
  if (reading) return true;
  return choice ?? (reason !== 'completed');
}

export function processCounts(turn: TurnLocation | undefined, items: readonly PanelItem[]): { steps: number; tools: number } {
  const steps = new Set(turn?.steps.map(step => step.step) ?? items.flatMap(item => item.step === null ? [] : [item.step]));
  const tools = new Set(items.flatMap(item => item.kind === 'tool' ? [item.entry.callId] : []));
  return { steps: steps.size, tools: tools.size };
}
