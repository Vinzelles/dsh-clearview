import type { SessionPendingInteraction } from '@deepseek-ai/dsh-client-ui-session/client';
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment';
import type { AssistantBlock, TurnLocation } from '@deepseek-ai/dsh-client-ui-conversation/client';
import type { ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client';
import type { ChatViewSlotProps } from '@deepseek-ai/dsh-client-ui-chat/client';
import type { IJobs } from '@deepseek-ai/dsh-api-job-controller/client';
import type { MaybeSnapshotSelectorHook, PropsLocale, PropsRenderSlots, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots';
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client';
import type { MarkdownFileMentions } from './markdown/render.js';
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
  jobsSource: IJobs['state'];
  watchJobs: () => () => void;
  contextT: ChatViewSlotProps['t'];
  loadOlder: () => Promise<void>;
  /** 可直接显示的图片 URL（会话图片缓存优先，缺失时退回自持 blob URL）。 */
  loadImage: (attachment: ImageAttachmentRef) => Promise<string>;
  /** 打开文件：右侧栏预览优先，缺失时退回 Host 默认程序。 */
  openFile?: (path: string) => Promise<void>;
  /** 列一个目录（相对会话 cwd 或绝对路径）下的条目名集合；用于文件改动卡的存在性校准。 */
  listDirNames?: (path: string) => Promise<ReadonlySet<string>>;
  /** 从某个事件序号分支出新会话并打开它。 */
  fork?: (atSeq: number) => Promise<void>;
  /** 收尾正文的文件名链接解析器（ui-deliverables 提供）。 */
  fileMentions?: (turn: TurnLocation, seq: number) => MarkdownFileMentions | undefined;
  /** 正文里写的图片目标（工作区路径/相对路径）解析成可直接显示的 URL；宿主缺席时保持纯文字降级。 */
  mediaUrl?: (url: string) => string | undefined;
}
/**
 * 0.1.2 起从 session 快照里拆出的两个标准钩子；0.1.1 缺席（undefined）。
 * compat/session-snapshot 依此做特性检测并合成旧形状，阅读页代码不直接使用。
 */
export interface ReaderCompatHooks {
  /** 0.1.2 的 ui-chat 'chat' 标准钩子（chat 快照）；0.1.1 内嵌于 useSession 快照。 */
  useChat?: MaybeSnapshotSelectorHook<ChatSnapshot>;
  /** 0.1.2 的待处理宿主交互钩子（按 sessionId 索引）；0.1.1 内嵌于 useSession 快照。 */
  useSessionPendingInteraction?: MaybeSnapshotSelectorHook<ReadonlyMap<string, SessionPendingInteraction>>;
}
export type ReaderProps = PropsRuntime<'conversation.view'>
  & PropsLocale<'conversation'>
  & PropsRenderSlots<'dsh-clearview.block'>
  & PropsStore<ReturnType<typeof createReaderStore>>
  & ReaderInjected
  & ReaderCompatHooks;
export type BlockRenderProps = Pick<ReaderProps, 'renderSlotChain' | 'loadImage' | 'mediaUrl'>;
