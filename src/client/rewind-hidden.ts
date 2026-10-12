/**
 * Reading-view integration with the dsh-rewind visibility contract.
 *
 * The rewind plugin keeps the full session log intact and hides the withdrawn
 * surface rows in its own DOM. This module mirrors the stable machine channel
 * published by dsh-rewind (`hiddenSeqsOf`), so the Reader can hide exactly the
 * same rows without depending on the rewind plugin's bundle at runtime.
 *
 * Both engine names must be recognized: current `rewind-plugin` and legacy
 * `rewind`. Keep the span and withdrawn-turn rules aligned with dsh-rewind
 * 0.15.3 (target seq -> marker seq, inclusive).
 */

import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-ui-chat/client';
import type { CommandNode } from '@deepseek-ai/dsh-client-ui-conversation/client';

export interface HiddenChat {
  readonly order: readonly string[];
  readonly nodes: {
    get(key: string): ChatConversationViewNode | undefined;
  };
  readonly locations?: {
    getTurn(turn: number): readonly string[];
  };
}

export interface RewindSpan {
  start: number;
  end: number;
}

const ENGINE_COMMANDS = new Set(['rewind-plugin', 'rewind']);

function isRewindCommand(command: CommandNode): boolean {
  return command.name !== null && ENGINE_COMMANDS.has(command.name);
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
    if (!isRewindCommand(command)) continue;
    if (isPreviewCommand(command) || isCandidateCommand(command)) continue;
    if (command.outcome?.kind !== 'success') continue;
    const marker = command.outcome.sourceEventSeq;
    if (marker === undefined) continue;
    const target = targetSeqOfArgs(command.args);
    if (target !== undefined) spans.push({ start: target, end: marker });
  }
  return spans;
}

/** Match rewind's conservative cleanup of turn summaries outside the cut. */
function addWithdrawnTurnChrome(snap: HiddenChat, spans: readonly RewindSpan[], hidden: Set<number>): void {
  const locations = snap.locations;
  if (!locations || spans.length === 0) return;
  const inSpan = (seq: number) => spans.some(span => seq >= span.start && seq <= span.end);
  let liveAnchors: Map<number, string[]> | undefined;
  for (const key of snap.order) {
    const chrome = snap.nodes.get(key);
    if (!chrome || chrome.kind !== 'turn-process') continue;
    const located = chrome.location.kind === 'turn' || chrome.location.kind === 'step' ? chrome.location.turn : undefined;
    if (!located?.start) continue;
    const keys = locations.getTurn(located.turn);
    if (keys.length === 0) continue;
    if (!keys.every(memberKey => {
      const member = snap.nodes.get(memberKey);
      return !!member && (member.key === chrome.key || inSpan(member.anchorSeq));
    })) continue;
    if (!liveAnchors) {
      liveAnchors = new Map();
      for (const liveKey of snap.order) {
        const node = snap.nodes.get(liveKey);
        if (!node || inSpan(node.anchorSeq)) continue;
        const holders = liveAnchors.get(node.anchorSeq) ?? [];
        holders.push(node.key);
        liveAnchors.set(node.anchorSeq, holders);
      }
    }
    if (liveAnchors.get(chrome.anchorSeq)?.some(holder => holder !== chrome.key)) continue;
    hidden.add(chrome.anchorSeq);
  }
}

/** Snapshot seqs that must not appear in the reading view after a rewind. */
export function hiddenSeqsOf(snap: HiddenChat): Set<number> {
  const hidden = new Set<number>();
  const spans = rewindSpansOf(snap);
  for (const key of snap.order) {
    const node = snap.nodes.get(key);
    if (!node || node.kind !== 'command') continue;
    const command = node.data as CommandNode;
    if (!isRewindCommand(command)) continue;
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
  // A native turn-process node can be anchored before its first user message.
  // Hide that chrome only when every indexed row was withdrawn, and never
  // hide an anchor shared with a still-visible row. Older snapshots may lack
  // the turn index: retain the chrome rather than guessing from turn numbers.
  try {
    addWithdrawnTurnChrome(snap, spans, hidden);
  } catch {
    // Optional/lazy turn indexes may not be ready. Keep the already computed
    // withdrawal span, as the rewind client does, rather than breaking Reader.
  }
  return hidden;
}
