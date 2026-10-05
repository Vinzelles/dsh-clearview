import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment';
import type { AssistantBlock } from '@deepseek-ai/dsh-client-ui-conversation/client';

/**
 * 用户消息（以及工具结果）content → 阅读页 block 的归一化。
 *
 * content 由宿主投影而来（`user/message` 事件的 `data.content`），跨内核版本
 * 只保证「核心 ContentBlock 数组」这一层：`{type:'text',text}` / `{type:'image',
 * attachment}` 是阅读页认识的两个形状，其余类型都按原样进 `other` 兜底卡片。
 *
 * 这里对入参一律按 unknown 处理并在边界上容错，原因有两条：
 *   1. 阅读页的渲染异常会被座位级 `BlockBoundary` 吞成「此内容暂时无法在阅读页
 *      显示」——用户消息整条消失，而设备报告里没有任何可诊断信息。形状漂移
 *      （content 缺席、不是数组、image 块没有 attachment）必须降级展示，不能抛。
 *   2. 旧内核的 user 节点曾把 content 直接投影为纯字符串；按文本渲染是唯一
 *      不丢内容的解释。
 */
export function contentBlocks(content: unknown): AssistantBlock[] {
  if (typeof content === 'string') return [{ kind: 'text', text: content }];
  if (!Array.isArray(content)) return content == null ? [] : [{ kind: 'other', block: content }];
  return content.map(block => {
    if (typeof block !== 'object' || block === null) return { kind: 'other', block };
    const candidate = block as { type?: unknown; text?: unknown; attachment?: unknown };
    if (candidate.type === 'text' && typeof candidate.text === 'string') return { kind: 'text', text: candidate.text };
    // 只接受带 attachmentId 的附件引用：缺字段时降级为 other（原始载荷仍可展开），
    // 而不是把 undefined 传进 ImageBlock 的渲染期解引用。
    if (candidate.type === 'image' && isAttachmentRef(candidate.attachment)) return { kind: 'image', attachment: candidate.attachment };
    return { kind: 'other', block };
  });
}

/** 附件引用是否足以交给 ImageBlock 渲染（attachmentId 是唯一的硬需求）。 */
export function isAttachmentRef(value: unknown): value is ImageAttachmentRef {
  return typeof value === 'object' && value !== null
    && typeof (value as { attachmentId?: unknown }).attachmentId === 'string'
    && (value as { attachmentId: string }).attachmentId !== '';
}

/** Blocks 的 React key：附件缺失时给一个稳定占位，避免渲染期解引用。 */
export function blockKey(block: AssistantBlock, index: number): string {
  if (block.kind !== 'image') return `${index}:${block.kind}`;
  const id = (block.attachment as { attachmentId?: unknown } | undefined)?.attachmentId;
  return `image:${typeof id === 'string' && id !== '' ? id : 'unknown'}:${index}`;
}
