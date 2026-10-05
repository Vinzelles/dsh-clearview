/**
 * Reading-view integration with the dsh-rewind visibility contract.
 *
 * The rewind plugin keeps the full session log intact and hides the withdrawn
 * surface rows in its own DOM. This module mirrors the stable machine channel
 * published by dsh-rewind (`hiddenSeqsOf`), so the Reader can hide exactly the
 * same rows without depending on the rewind plugin's bundle at runtime.
 *
 * Do not change the span arithmetic here independently: keep it aligned with
 * dsh-rewind's documented contract (target seq -> marker seq, inclusive).
 */

import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-ui-chat/client';
import type { CommandNode } from '@deepseek-ai/dsh-client-ui-conversation/client';

export interface HiddenChat {
  readonly order: readonly string[];
  readonly nodes: {
    get(key: string): ChatConversationViewNode | undefined;
  };
}

export interface RewindSpan {
  start: number;
  end: number;
}

/** Extract the rewind target seq from a `/rewind` command's structured args. */
export function targetSeqOfArgs(args: string | null | undefined): number | undefined {
  if (args === undefined || args === null) return undefined;
  const match = args.match(/@(\d+)/);
  return match !== null ? Number(match[1]) : undefined;
}

function isPreviewCommand(command: CommandNode): boolean {
  return (command.args ?? '').includes('preview');
}

function isCandidateCommand(command: CommandNode): boolean {
  return (command.args ?? '').includes('__candidates');
}

/** One hidden interval per successful executed rewind, kept separate on purpose. */
export function rewindSpansOf(snap: HiddenChat): RewindSpan[] {
  const spans: RewindSpan[] = [];
  for (const key of snap.order) {
    const node = snap.nodes.get(key);
    if (!node || node.kind !== 'command') continue;
    const command = node.data as CommandNode;
    if (command.name !== 'rewind') continue;
    if (isPreviewCommand(command) || isCandidateCommand(command)) continue;
    if (command.outcome?.kind !== 'success') continue;
    const marker = command.outcome.sourceEventSeq;
    if (marker === undefined) continue;
    const target = targetSeqOfArgs(command.args);
    if (target !== undefined) spans.push({ start: target, end: marker });
  }
  return spans;
}

/** Snapshot seqs that must not appear in the reading view after a rewind. */
export function hiddenSeqsOf(snap: HiddenChat): Set<number> {
  const hidden = new Set<number>();
  const spans = rewindSpansOf(snap);
  for (const key of snap.order) {
    const node = snap.nodes.get(key);
    if (!node || node.kind !== 'command') continue;
    const command = node.data as CommandNode;
    if (command.name !== 'rewind') continue;
    if (isPreviewCommand(command) || isCandidateCommand(command)) {
      hidden.add(command.seq);
      continue;
    }
    if (command.outcome?.kind === 'success' && command.outcome.sourceEventSeq !== undefined) {
      hidden.add(command.seq);
    }
  }
  for (const key of snap.order) {
    const node = snap.nodes.get(key);
    if (!node) continue;
    const anchor = node.anchorSeq;
    if (spans.some(span => anchor >= span.start && anchor <= span.end)) {
      hidden.add(anchor);
    }
  }
  return hidden;
}
