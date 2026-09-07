import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment';
import type { AssistantBlock, ChatSnapshot } from '@deepseek-ai/dsh-client-runtime/client';
import type { MaybeSnapshotSelectorHook, PropsLocale, PropsRenderSlots, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots';
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client';
import type { createReaderStore } from './store.js';

export interface ReaderBlockOwner {
  block: AssistantBlock;
  streaming: boolean;
  source: 'assistant' | 'user' | 'tool';
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Trusted installed renderers may opt in; unknown model payloads never execute code. */
    'dsh-clearview.block': { kind: 'chain'; scope: 'session'; owner: ReaderBlockOwner };
  }
}

export interface ReaderInjected {
  loadOlder: () => Promise<void>;
  loadImage: (attachment: ImageAttachmentRef) => Promise<{ data: Uint8Array; mediaType: string }>;
  /** 用 Host 默认程序打开文件（绝对或工作区相对路径均可）。 */
  openFile?: (path: string) => Promise<void>;
  /** 列一个目录（相对会话 cwd 或绝对路径）下的条目名集合；用于文件改动卡的存在性校准。 */
  listDirNames?: (path: string) => Promise<ReadonlySet<string>>;
}
/**
 * 0.1.2 起从 session 快照里拆出的两个标准钩子；0.1.1 缺席（undefined）。
 * compat/session-snapshot 依此做特性检测并合成旧形状，阅读页代码不直接使用。
 */
export interface ReaderCompatHooks {
  /** 0.1.2 的 ui-chat 'chat' 标准钩子（chat 快照）；0.1.1 内嵌于 useSession 快照。 */
  useChat?: MaybeSnapshotSelectorHook<ChatSnapshot>;
  /** 0.1.2 的待处理宿主交互钩子（按 sessionId 索引）；0.1.1 内嵌于 useSession 快照。 */
  useSessionPendingInteraction?: MaybeSnapshotSelectorHook<ReadonlyMap<string, unknown>>;
}
export type ReaderProps = PropsRuntime<'conversation.view'>
  & PropsLocale<'conversation'>
  & PropsRenderSlots<'dsh-clearview.block'>
  & PropsStore<ReturnType<typeof createReaderStore>>
  & ReaderInjected
  & ReaderCompatHooks;
export type BlockRenderProps = Pick<ReaderProps, 'renderSlotChain' | 'loadImage'>;
