import type { SessionPendingInteraction } from '@deepseek-ai/dsh-client-ui-session/client';
import type { SessionId } from '@deepseek-ai/dsh-session/types';
import type { UseSessionStatus } from '@deepseek-ai/dsh-client-ui-session/client';
import type { MaybeSnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots';

/** Project only this session's pending interaction; unrelated status changes
 * retain the same map and selector result at the native subscription boundary. */
export function pendingInteractionHook(useStatus: UseSessionStatus, sessionId: SessionId): MaybeSnapshotSelectorHook<ReadonlyMap<string, SessionPendingInteraction>> {
  let previous: SessionPendingInteraction | undefined;
  let snapshot: ReadonlyMap<string, SessionPendingInteraction> = new Map();
  return (selector, equal) => useStatus(status => {
    const interaction = status.get(sessionId)?.pendingInteraction;
    if (interaction !== previous) {
      previous = interaction;
      snapshot = interaction === undefined ? new Map() : new Map([[sessionId, interaction]]);
    }
    return selector(snapshot);
  }, equal);
}
