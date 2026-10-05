import type { ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client';
import { createCompatSessionHook } from '../../src/client/compat/session-snapshot.ts';

/** A compat session hook over fixed fakes, shaped like the 0.2.0 standard hooks. */
export function sessionHook(chat: ChatSnapshot, session: Record<string, unknown> = {}, pending: unknown = undefined) {
  const snapshot = { sessionId: 's1', openState: 'ready', running: false, pendingSubmissions: [], hasMore: false, loadingOlder: false, openError: null, ...session };
  const pendingMap = new Map(pending === undefined ? [] : [['s1', pending]]);
  return createCompatSessionHook({
    useSession: ((selector: (value: unknown) => unknown) => selector(snapshot)) as never,
    useChat: ((selector: (value: unknown) => unknown) => selector(chat)) as never,
    useSessionPendingInteraction: ((selector: (value: unknown) => unknown) => selector(pendingMap)) as never,
    sessionId: 's1',
  });
}
