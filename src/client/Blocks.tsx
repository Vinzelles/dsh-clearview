import { Component, Fragment, memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment';
import type { AssistantBlock } from '@deepseek-ai/dsh-client-ui-conversation/client';
import { JsonBlockL } from './native/labeled-blocks.js';
import type { BlockRenderProps, ReaderBlockOwner } from './types.js';
import { useStreamingText } from './streaming.js';
import { blockKey, isAttachmentRef } from './user-content.js';
import { MotionMarkdown, MotionPlainText } from './word-motion.js';
import type { MarkdownFileMentions } from './markdown/render.js';
import css from './Reader.module.css';

/** 用户消息的文本叶子。刻意不走宿主 primitives 的 MessageText：用户消息是阅读页里
 *  最容易「整条消失」的座位，而宿主展示组件的可用性与入参契约随内核版本漂移
 *  （0.1.2 起一批 primitives 由内置默认值改为必传 labels，缺失即渲染期 TypeError），
 *  这类异常会被座位级 BlockBoundary 吞成兜底文案。样式与宿主 MessageText 等价：
 *  white-space: pre-wrap + word-break: break-word，字号/行高继承气泡。 */
function UserText({ text }: { text: string }) {
  return <div className={css.userText}>{text}</div>;
}

function errorMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}

function positive(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

export class BlockBoundary extends Component<{ children: ReactNode }, { failed: boolean; reason: string }> {
  state = { failed: false, reason: '' };
  static getDerivedStateFromError(error: unknown) {
    return { failed: true, reason: errorMessage(error) };
  }
  componentDidCatch(error: unknown, info: { componentStack?: string | null }) {
    // 降级文案必须自带证据：此前边界静默吞错，设备侧只能看到「此内容暂时无法在
    // 阅读页显示」，既不知道哪个片段、也不知道什么原因。这里只记错误与组件栈，
    // 不记消息载荷；同一条错误同时落到 DOM 属性上（data-reader-block-error），
    // 便于从截图/元素检查直接读出原因。
    console.error('[dsh-clearview] 阅读页片段渲染失败，已降级为提示文案：', error, info?.componentStack ?? '');
  }
  render() {
    return this.state.failed
      ? <div className={css.notice} data-reader-block-error={this.state.reason}>此内容暂时无法在阅读页显示；原对话中的记录未受影响。</div>
      : this.props.children;
  }
}

/** `thumb` is the user-message rendering: one square, the same size for every image in every message. */
export type ImageVariant = 'full' | 'thumb';

export const ImageBlock = memo(function ImageBlock({ attachment, loadImage, variant = 'full' }: {
  attachment: ImageAttachmentRef; loadImage: BlockRenderProps['loadImage']; variant?: ImageVariant;
}) {
  const thumb = variant === 'thumb';
  // 附件引用缺失（宿主块形状漂移）或宿主没注入 loadImage 时，一律走既有占位分支：
  // 渲染期不再解引用 attachment，效果里也不再调用 undefined 的加载器——这两种情况
  // 过去都会抛异常，整条用户消息被边界吞成兜底文案。
  const reference = isAttachmentRef(attachment) ? (attachment as ImageAttachmentRef) : null;
  const usable = reference !== null && typeof loadImage === 'function';
  const [attempt, setAttempt] = useState(0);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(!usable);
  const [decoded, setDecoded] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!usable || reference === null) { setError(true); return; }
    let active = true;
    const timeout = setTimeout(() => { if (active) { setError(true); active = false; } }, 20000);
    setError(false); setDecoded(false); setUrl(null);
    void loadImage(reference).then(next => {
      if (!active) return;
      clearTimeout(timeout);
      setUrl(next);
    }).catch(() => { clearTimeout(timeout); if (active) setError(true); });
    return () => { active = false; clearTimeout(timeout); };
  }, [usable, reference, attempt, loadImage]);
  const width = positive(reference?.width) ?? 4;
  const height = positive(reference?.height) ?? 3;
  return <figure className={css.imageFigure} data-reader-image data-image-variant={variant} data-image-state={error ? 'error' : decoded ? 'ready' : 'loading'}>
    <div className={css.imageFrame} style={thumb ? undefined : { aspectRatio: `${width} / ${height}` }}>
      {!error && url && <button ref={opener} type="button" className={css.imageOpen} title={thumb ? reference?.name : undefined} aria-label={`放大图片${reference?.name ? `：${reference.name}` : ''}`} onClick={() => dialog.current?.showModal()}>
        <img src={url} alt={reference?.name ?? '会话图片'} width={width} height={height} onLoad={() => setDecoded(true)} onError={() => setError(true)} data-ready={decoded} />
      </button>}
      {(!decoded || error) && <div className={css.imagePlaceholder}>
        <span>{error ? '图片未能加载' : '正在加载图片'}</span>
        {error && usable && <button type="button" className={css.textButton} onClick={() => setAttempt(value => value + 1)}>重试</button>}
      </div>}
    </div>
    {!thumb && reference?.name && <figcaption>{reference.name}</figcaption>}
    <dialog ref={dialog} className={css.imageDialog} aria-label="图片预览" onClose={() => opener.current?.focus()} onClick={event => { if (event.target === dialog.current) dialog.current?.close(); }}>
      <button type="button" autoFocus className={css.dialogClose} aria-label="关闭图片预览" onClick={() => dialog.current?.close()}>×</button>
      {url && <img src={url} alt={reference?.name ?? '会话图片'} />}
    </dialog>
  </figure>;
});

type TextPresentation = { startedAt?: number; interrupted?: boolean; liveText?: boolean; revealKey?: string };

function ReadingMarkdown({ text, streaming, holdFormatting, startedAt, interrupted = false, liveText = false, revealKey, kind = 'body', fileMentions }: { text: string; streaming: boolean; holdFormatting: boolean; kind?: 'body' | 'reasoning'; fileMentions?: MarkdownFileMentions } & TextPresentation) {
  const root = useRef<HTMLDivElement>(null);
  const presentation = useStreamingText(text, streaming, { startedAt, interrupted: interrupted || !liveText, selected: holdFormatting, revealKey });
  // Native Markdown changes block keys for its full final parse. Keep the last
  // committed mode while this answer is selected, then finish formatting on
  // deselection. Business status and the source text still update normally.
  const committedMode = useRef(streaming);
  const effectiveMode = holdFormatting ? committedMode.current : presentation.formatStreaming;
  useLayoutEffect(() => { committedMode.current = effectiveMode; }, [effectiveMode]);
  return <div ref={root} className={css.readingText} data-reader-text data-reader-text-kind={kind} data-received-length={text.length} data-shown-length={presentation.text.length}
    data-presentation-pending={presentation.pending || undefined} data-motion-style="opacity-blur" data-ud-motion="reader-text-arrival" data-ud-motion-type="reveal" data-ud-motion-no-flash="true">
    <MotionMarkdown text={presentation.text} streaming={effectiveMode} enabled={liveText && presentation.reveal && effectiveMode} revision={presentation.revision} fileMentions={fileMentions} />
  </div>;
}

function ReadingReasoning({ text, streaming, holdFormatting, startedAt, interrupted = false, liveText = false }: { text: string; streaming: boolean; holdFormatting: boolean } & TextPresentation) {
  const presentation = useStreamingText(text, streaming, { startedAt, interrupted: interrupted || !liveText, selected: holdFormatting });
  return <div className={css.readingText} data-reader-text data-reader-text-kind="reasoning" data-received-length={text.length} data-shown-length={presentation.text.length}
    data-presentation-pending={presentation.pending || undefined} data-motion-style="opacity-blur" data-ud-motion="reader-text-arrival" data-ud-motion-type="reveal" data-ud-motion-no-flash="true">
    <MotionPlainText text={presentation.text} enabled={liveText && presentation.reveal} revision={presentation.revision} />
  </div>;
}

function fallback(block: AssistantBlock, streaming: boolean, source: ReaderBlockOwner['source'], loadImage: BlockRenderProps['loadImage'], holdFormatting: boolean, presentation: TextPresentation, fileMentions: MarkdownFileMentions | undefined): ReactNode {
  switch (block.kind) {
    case 'text': return source === 'user' ? <UserText text={block.text} /> : <ReadingMarkdown text={block.text} streaming={streaming} holdFormatting={holdFormatting} fileMentions={fileMentions} {...presentation} />;
    case 'image': return <ImageBlock attachment={block.attachment} loadImage={loadImage} variant={source === 'user' ? 'thumb' : 'full'} />;
    case 'reasoning': return <ReadingReasoning text={block.text} streaming={streaming} holdFormatting={holdFormatting} {...presentation} />;
    case 'tool-call': return <JsonBlockL label={`工具参数 · ${block.name}`} payload={block.argsRaw} />;
    case 'other': return <div className={css.unknown}>
      <p>此内容类型尚未接入阅读页，原始内容已保留。</p>
      <JsonBlockL label="查看原始内容" payload={block.block} />
    </div>;
  }
}

export const Blocks = memo(function Blocks({ blocks, streaming = false, source = 'assistant', holdFormatting = false, startedAt, interrupted, liveText, revealKey, renderSlotChain, loadImage, fileMentions }: BlockRenderProps & TextPresentation & {
  blocks: readonly AssistantBlock[]; streaming?: boolean; source?: ReaderBlockOwner['source']; holdFormatting?: boolean; fileMentions?: MarkdownFileMentions;
}) {
  return <div className={css.blocks} data-streaming={streaming || undefined} data-reader-blocks-source={source}>
    {blocks.map((block, index) => <BlockBoundary key={blockKey(block, index)}>
      <Fragment>{renderSlotChain('dsh-clearview.block', { block, streaming, source }, { fallback: fallback(block, streaming, source, loadImage, holdFormatting, { startedAt, interrupted, liveText, revealKey: revealKey === undefined ? undefined : `${revealKey}:${index}` }, fileMentions) })}</Fragment>
    </BlockBoundary>)}
  </div>;
});
