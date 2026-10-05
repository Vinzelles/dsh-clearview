import type { ChatSnapshot, ChatConversationViewNode } from '@deepseek-ai/dsh-client-ui-chat/client';
import type { TurnLocation } from '@deepseek-ai/dsh-client-ui-conversation/client';
import { groupNodes, type ReaderGroup } from './projection.js';
import { hiddenSeqsOf, rewindSpansOf, type RewindSpan } from './rewind-hidden.js';

const sameArray = <T>(a: readonly T[], b: readonly T[]) => a.length === b.length && a.every((value, index) => value === b[index]);

export interface ReaderStructure {
  visibleOrder: readonly string[];
  groups: readonly ReaderGroup[];
  hidden: ReadonlySet<number>;
  spans: readonly RewindSpan[];
  latestUserKey: string | null;
}

/** One scan per host publication, zero root notification for text-only changes.
 * Do not retain the node store here: idle file summaries subscribe separately
 * so preserving a structural result can never freeze their content snapshot. */
export function createReaderStructureSelector(): (chat: ChatSnapshot) => ReaderStructure {
  let previous: ReaderStructure | undefined;
  return chat => {
    const hidden = hiddenSeqsOf(chat);
    const spans = rewindSpansOf(chat);
    const visibleOrder = chat.order.filter(key => {
      const node = chat.nodes.get(key);
      return !!node && !hidden.has(node.anchorSeq);
    });
    const oldGroups = new Map(previous?.groups.map(group => [group.key, group]));
    const groups = groupNodes(visibleOrder, key => chat.nodes.get(key)).map(group => {
      const old = oldGroups.get(group.key);
      return old && old.turn === group.turn && sameArray(old.keys, group.keys) ? old : group;
    });
    let latestUserKey: string | null = null;
    for (let i = visibleOrder.length - 1; i >= 0; i--) {
      const node = chat.nodes.get(visibleOrder[i]);
      if (node?.kind === 'user' || node?.kind === 'steering') { latestUserKey = visibleOrder[i]; break; }
    }
    const sameHidden = previous && hidden.size === previous.hidden.size && [...hidden].every(seq => previous!.hidden.has(seq));
    const sameSpans = previous && spans.length === previous.spans.length && spans.every((span, i) => span.start === previous!.spans[i].start && span.end === previous!.spans[i].end);
    if (previous && sameHidden && sameSpans && latestUserKey === previous.latestUserKey && sameArray(visibleOrder, previous.visibleOrder) && sameArray(groups, previous.groups)) return previous;
    return previous = {
      visibleOrder, groups, latestUserKey,
      hidden: sameHidden ? previous!.hidden : hidden,
      spans: sameSpans ? previous!.spans : spans,
    };
  };
}

export interface GroupSnapshot {
  turn: TurnLocation | undefined;
  nodes: ReadonlyMap<string, ChatConversationViewNode | undefined>;
}

/** Historical turns only change when their own nodes or turn record change. */
export function createGroupSelector(group: ReaderGroup): (chat: ChatSnapshot) => GroupSnapshot {
  let previous: GroupSnapshot | undefined;
  return chat => {
    const turn = group.turn === null ? undefined : chat.timeline.turns.get(group.turn);
    if (previous && turn === previous.turn && group.keys.every(key => previous!.nodes.get(key) === chat.nodes.get(key))) return previous;
    return previous = { turn, nodes: new Map(group.keys.map(key => [key, chat.nodes.get(key)])) };
  };
}
