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
import type { ChatSnapshot, ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client';
import type { MaybeSnapshotSelectorHook, SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots';
import { bridgeLocaleSeat } from './locale-bridge.js';

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
  useSession: SnapshotSelectorHook<ConversationSnapshot>;
  /** 0.1.2 的 ui-chat 'chat' 标准钩子；0.1.1 缺席。 */
  useChat?: MaybeSnapshotSelectorHook<ChatSnapshot>;
  /** 0.1.2 的 'sessionPendingInteraction' 标准钩子；0.1.1 缺席。 */
  useSessionPendingInteraction?: MaybeSnapshotSelectorHook<ReadonlyMap<string, unknown>>;
  sessionId: string;
}

const EMPTY_PENDING: readonly unknown[] = Object.freeze([]);

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
  hook: MaybeSnapshotSelectorHook<ReadonlyMap<string, unknown>>,
  sessionId: string,
): readonly unknown[] {
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
    return useSession as CompatSessionHook;
  }
  let latest: CompatSessionSnapshot | undefined;
  const hook = ((selector: (snapshot: CompatSessionSnapshot) => unknown) => {
    const session = useSession(s => s);
    const chat = useChat !== undefined ? (useChat(c => c) ?? emptyChat()) : (session as { chat?: ChatSnapshot }).chat;
    const pending = useSessionPendingInteraction !== undefined
      ? compatPending(useSessionPendingInteraction, sessionId)
      : (session as { pending?: readonly unknown[] }).pending ?? EMPTY_PENDING;
    const merged = { ...session, chat, pending } as CompatSessionSnapshot;
    latest = merged;
    return selector(merged);
  }) as CompatSessionHook;
  hook.__latest = () => latest;
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
  useSessionPendingInteraction?: MaybeSnapshotSelectorHook<ReadonlyMap<string, unknown>>;
  sessionId: string;
  t: (key: any, params?: Record<string, unknown>) => string;
}>(props: P): P {
  const useSession = useMemo(
    () => createCompatSessionHook({
      useSession: props.useSession,
      useChat: props.useChat,
      useSessionPendingInteraction: props.useSessionPendingInteraction,
      sessionId: props.sessionId,
    }),
    [props.useSession, props.useChat, props.useSessionPendingInteraction, props.sessionId],
  );
  // `t` 同桥包装：0.1.2 把上下文注入等词典键从 'conversation' NS 迁到 'chat' NS，
  // seat 缺失回显键名时回退内置词典（locale-bridge），下游 ContextInjectionRow /
  // ContextBody 无感。
  return useMemo(() => ({ ...props, useSession, t: bridgeLocaleSeat(props.t) }), [props, useSession]);
}
