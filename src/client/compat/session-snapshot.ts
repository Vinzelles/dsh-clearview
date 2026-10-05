import type { SessionPendingInteraction } from '@deepseek-ai/dsh-client-ui-session/client';
/**
 * 跨版本会话快照桥（0.1.1 ↔ 0.1.2）。
 *
 * 0.1.1：`useSession` 的快照就是 ConversationSnapshot —— `chat`（会话时间线）
 * 与 `pending`（待处理宿主交互）都内嵌其中。
 * 0.1.2：session 快照瘦身（只剩会话状态字段），`chat` 改由 ui-chat 通过标准
 * 钩子 `useChat` 提供，待处理交互由 `useSessionPendingInteraction`（按
 * sessionId 索引的 Map）提供。本模块在两种形态间合成出阅读页期待的旧形状，
 * 阅读页全部下游代码继续无感地读 `snapshot.chat` / `snapshot.pending`。
 *
 * 判定完全按「钩子是否存在」做特性检测，不探测版本号：0.1.1 没有这两个
 * 钩子（直接透传原钩子，零开销），0.1.2 合成合并快照。
 */
import { useMemo } from 'react';
import type { ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client';
import type { SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client';
type ConversationSnapshot = SessionSnapshot & { chat: ChatSnapshot; pending: readonly SessionPendingInteraction[] };
type SourceSessionSnapshot = SessionSnapshot & Partial<Pick<ConversationSnapshot, 'chat' | 'pending'>>;
import type { MaybeSnapshotSelectorHook, SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots';
import { bridgeLocaleSeat } from './locale-bridge.js';
import { pendingInteractionHook } from './pending-status.js';
import type { UseSessionStatus } from '@deepseek-ai/dsh-client-ui-session/client';
import type { SessionId } from '@deepseek-ai/dsh-session/types';

/** 与 0.1.1 ConversationSnapshot 同构的读取面（本插件实际用到的字段）。 */
export type CompatSessionSnapshot = ConversationSnapshot;

/**
 * 合成后的会话选择钩子；`__latest` 供 DOM 侧的 compat 模块（fiber 读取失败时）
 * 直接取最近一次合并快照。
 */
export type CompatSessionHook = SnapshotSelectorHook<CompatSessionSnapshot> & {
  __latest?: () => CompatSessionSnapshot | undefined;
};

export interface CompatSessionSources {
  useSession: SnapshotSelectorHook<SourceSessionSnapshot>;
  /** 0.1.2 的 ui-chat 'chat' 标准钩子；0.1.1 缺席。 */
  useChat?: MaybeSnapshotSelectorHook<ChatSnapshot>;
  /** 0.1.2 的 'sessionPendingInteraction' 标准钩子；0.1.1 缺席。 */
  useSessionPendingInteraction?: MaybeSnapshotSelectorHook<ReadonlyMap<string, SessionPendingInteraction>>;
  sessionId: string;
}

const EMPTY_PENDING: readonly SessionPendingInteraction[] = Object.freeze([]);
interface NativeSources extends CompatSessionSources {
  session?: SourceSessionSnapshot;
  chat?: ChatSnapshot;
  pendingItem?: SessionPendingInteraction;
  pendingItems: readonly SessionPendingInteraction[];
}
const nativeSources = new WeakMap<SnapshotSelectorHook<SourceSessionSnapshot>, NativeSources>();
const EMPTY_CHAT = emptyChat();
function envelopeEqual<S>(equal: (a: S, b: S) => boolean = Object.is) {
  return (a: { value: S } | undefined, b: { value: S } | undefined): boolean =>
    a === undefined || b === undefined ? Object.is(a, b) : equal(a.value, b.value);
}

/** Read one domain at the HOST subscription boundary, before React is notified.
 * The merged compatibility hook is retained for legacy callers, but hot reader
 * paths must not subscribe to whole source snapshots just to select one node. */
export function useChatSelector<S>(hook: SnapshotSelectorHook<SourceSessionSnapshot>, selector: (chat: ChatSnapshot) => S, equal?: (a: S, b: S) => boolean): S {
  const source = nativeSources.get(hook);
  if (source?.useChat) {
    const result = source.useChat(chat => { source.chat = chat; return { value: selector(chat) }; }, envelopeEqual(equal));
    if (result === undefined) { source.chat = undefined; return selector(EMPTY_CHAT); }
    return result.value;
  }
  return (source?.useSession ?? hook)(snapshot => {
    if (source) { source.session = snapshot; source.chat = snapshot.chat; }
    return selector(snapshot.chat ?? EMPTY_CHAT);
  }, equal);
}

export function useSessionSelector<S>(hook: SnapshotSelectorHook<SourceSessionSnapshot>, selector: (session: Omit<ConversationSnapshot, 'chat' | 'pending'>) => S, equal?: (a: S, b: S) => boolean): S {
  const source = nativeSources.get(hook);
  return (source?.useSession ?? hook)(session => { if (source) source.session = session; return selector(session); }, equal);
}

export function usePendingSelector<S>(hook: SnapshotSelectorHook<SourceSessionSnapshot>, selector: (pending: ConversationSnapshot['pending']) => S, equal?: (a: S, b: S) => boolean): S {
  const source = nativeSources.get(hook);
  if (!source?.useSessionPendingInteraction) return (source?.useSession ?? hook)(snapshot => {
    if (source) source.session = snapshot;
    return selector(snapshot.pending ?? EMPTY_PENDING as ConversationSnapshot['pending']);
  }, equal);
  const result = source.useSessionPendingInteraction(map => {
    const pending = map.get(source.sessionId);
    if (pending !== source.pendingItem) {
      source.pendingItem = pending;
      source.pendingItems = pending === undefined ? EMPTY_PENDING : [pending];
    }
    return { value: selector(source.pendingItems as ConversationSnapshot['pending']) };
  }, envelopeEqual(equal));
  if (result === undefined) {
    source.pendingItem = undefined; source.pendingItems = EMPTY_PENDING;
    return selector(EMPTY_PENDING as ConversationSnapshot['pending']);
  }
  return result.value;
}

/** DOM compatibility consumers read current host data without subscribing React
 * to the full snapshot, or depending on private fiber hook representations. */
export function readerSnapshot(hook: SnapshotSelectorHook<SourceSessionSnapshot>): unknown {
  const source = nativeSources.get(hook);
  return source ? { ...source.session, chat: source.chat ?? source.session?.chat } : undefined;
}

/** 0.1.2 待处理交互 Map 缺席时的空 chat 面（防御：ui-chat 未进组合时不崩）。 */
function emptyChat(): ChatSnapshot {
  const turns = new Map();
  return {
    order: [],
    nodes: { get: () => undefined, values: () => [] },
    timeline: { turnOrder: [], turns },
  } as unknown as ChatSnapshot;
}

function compatPending(
  hook: MaybeSnapshotSelectorHook<ReadonlyMap<string, SessionPendingInteraction>>,
  sessionId: string,
): readonly SessionPendingInteraction[] {
  const map = hook(m => m);
  return useMemo(() => {
    if (map === undefined) return EMPTY_PENDING;
    const interaction = map.get(sessionId);
    return interaction === undefined ? EMPTY_PENDING : [interaction];
  }, [map, sessionId]);
}

/**
 * 合成一个跨版本的会话选择钩子。返回的函数必须在组件渲染期间被无条件调用
 * （0.1.2 分支内部调用三个底层钩子，顺序恒定）。
 */
export function createCompatSessionHook(sources: CompatSessionSources): CompatSessionHook {
  const { useSession, useChat, useSessionPendingInteraction, sessionId } = sources;
  // 0.1.1：chat 与 pending 已在 session 快照里，直接透传（引用稳定，零开销）。
  if (useChat === undefined && useSessionPendingInteraction === undefined) {
    const hook: CompatSessionHook = (selector, equal) => useSession(snapshot => {
      const source = nativeSources.get(hook)!;
      source.session = snapshot; source.chat = snapshot.chat;
      return selector({ ...snapshot, chat: snapshot.chat ?? EMPTY_CHAT, pending: snapshot.pending ?? EMPTY_PENDING });
    }, equal);
    nativeSources.set(hook, { ...sources, pendingItems: EMPTY_PENDING });
    return hook;
  }
  let latest: CompatSessionSnapshot | undefined;
  const hook = ((selector: (snapshot: CompatSessionSnapshot) => unknown) => {
    const session = useSession(s => s);
    const chat = useChat !== undefined ? (useChat(c => c) ?? emptyChat()) : session.chat ?? EMPTY_CHAT;
    const pending = useSessionPendingInteraction !== undefined
      ? compatPending(useSessionPendingInteraction, sessionId)
      : (session as { pending?: readonly SessionPendingInteraction[] }).pending ?? EMPTY_PENDING;
    const merged: CompatSessionSnapshot = { ...session, chat, pending };
    latest = merged;
    return selector(merged);
  }) as CompatSessionHook;
  hook.__latest = () => latest;
  nativeSources.set(hook, { ...sources, pendingItems: EMPTY_PENDING });
  return hook;
}

/**
 * Reader 入口包装：把 0.1.2 拆分的钩子合并回 props.useSession，其余 props
 * 原样透传。钩子身份跨渲染稳定（依赖仅随框架钩子身份变化），不破坏子组件
 * 的 memo 前提。
 */
export function useCompatReaderProps<P extends {
  useSession: SnapshotSelectorHook<any>;
  useChat?: MaybeSnapshotSelectorHook<any>;
  useSessionPendingInteraction?: MaybeSnapshotSelectorHook<ReadonlyMap<string, SessionPendingInteraction>>;
  useSessionStatus?: UseSessionStatus;
  sessionId: SessionId;
  t: (key: any, params?: Record<string, unknown>) => string;
}>(props: P): P {
  const pendingHook = useMemo(() => props.useSessionStatus
    ? pendingInteractionHook(props.useSessionStatus, props.sessionId)
    : props.useSessionPendingInteraction,
  [props.useSessionStatus, props.useSessionPendingInteraction, props.sessionId]);
  const useSession = useMemo(
    () => createCompatSessionHook({
      useSession: props.useSession,
      useChat: props.useChat,
      useSessionPendingInteraction: pendingHook,
      sessionId: props.sessionId,
    }),
    [props.useSession, props.useChat, pendingHook, props.sessionId],
  );
  // `t` 同桥包装：0.1.2 把上下文注入等词典键从 'conversation' NS 迁到 'chat' NS，
  // seat 缺失回显键名时回退内置词典（locale-bridge），下游 ContextInjectionRow /
  // ContextBody 无感。
  const t = useMemo(() => bridgeLocaleSeat(props.t), [props.t]);
  return useMemo(() => ({ ...props, useSession, t }), [props, useSession, t]);
}
