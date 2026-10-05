import { useLayoutEffect } from 'react';
import type { Context } from '@deepseek-ai/cordis';
import type { ConversationStore } from '@deepseek-ai/dsh-client-ui-conversation/client';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type { PropsRuntime, PropsStore, StoreDecl } from '@deepseek-ai/dsh-client-ui-slots';
import { ReaderEntryPolicy, readerEntryRequested } from './entry-policy.js';

// 0.1.1 的原生会话 store persist 键是 'dsh.conversation.chat'，0.1.2 收敛为
// 'dsh.conversation'。两版共有的稳定身份：persist 前缀 + setView 动作。
function isChatStore(store: StoreDecl | undefined): store is ConversationStore {
  return typeof store === 'object' && store !== null
    && typeof store.spec.persist === 'string'
    && store.spec.persist.startsWith('dsh.conversation')
    && typeof (store.spec.actions as Record<string, unknown>).setView === 'function';
}

type EntryProps = PropsRuntime<'conversation.input.dock'> & PropsStore<ConversationStore> & { policy: ReaderEntryPolicy };

function ReaderEntry({ useStore, actions, policy }: EntryProps) {
  const view = useStore(state => state.view);
  useLayoutEffect(() => {
    const next = policy.select(view);
    if (next) actions.setView(next);
  }, [view, actions, policy]);
  return null;
}

/** Reuse the native store handle; its framework-owned instance preserves drafts. */
export function installReaderEntry(ctx: Context): () => void {
  const native = ctx.slots.entriesOfSlot('conversation.session')[0]?.store;
  if (!isChatStore(native)) throw new Error('DSH Reader cannot bind the native conversation view store.');
  const policy = new ReaderEntryPolicy(readerEntryRequested(location.search), () => {
    const url = new URL(location.href);
    url.searchParams.delete('reader');
    history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);
  });
  return ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'dsh-clearview-entry',
    store: native,
    inject: () => ({ policy }),
  }, ReaderEntry);
}
