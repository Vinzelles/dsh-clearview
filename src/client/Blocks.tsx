import { Component, Fragment, memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment';
import type { AssistantBlock } from '@deepseek-ai/dsh-client-ui-conversation/client';
import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives';
import { JsonBlockL } from './native/labeled-blocks.js';
import type { BlockRenderProps, ReaderBlockOwner } from './types.js';
import { useStreamingText } from './streaming.js';
import { blockKey, isAttachmentRef } from './user-content.js';
import { MotionMarkdown, MotionPlainText } from './word-motion.js';
import css from './Reader.module.css';

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

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

export const ImageBlock = memo(function ImageBlock({ attachment, loadImage }: {
  attachment: ImageAttachmentRef; loadImage: BlockRenderProps['loadImage'];
}) {
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
    let owned: string | null = null;
    const timeout = setTimeout(() => { if (active) { setError(true); active = false; } }, 20000);
    setError(false); setDecoded(false); setUrl(null);
    void loadImage(reference).then(result => {
      if (!active) return;
      clearTimeout(timeout);
      if (!IMAGE_TYPES.has(result.mediaType)) throw new Error('Unsupported image media type');
      const bytes = Uint8Array.from(result.data);
      owned = URL.createObjectURL(new Blob([bytes.buffer], { type: result.mediaType }));
      setUrl(owned);
    }).catch(() => { clearTimeout(timeout); if (active) setError(true); });
    return () => { active = false; clearTimeout(timeout); if (owned) URL.revokeObjectURL(owned); };
  }, [usable, reference, attempt, loadImage]);
  const width = positive(reference?.width) ?? 4;
  const height = positive(reference?.height) ?? 3;
  return <figure className={css.imageFigure} data-reader-image data-image-state={error ? 'error' : decoded ? 'ready' : 'loading'}>
    <div className={css.imageFrame} style={{ aspectRatio: `${width} / ${height}` }}>
      {!error && url && <button ref={opener} type="button" className={css.imageOpen} aria-label={`放大图片${reference?.name ? `：${reference.name}` : ''}`} onClick={() => dialog.current?.showModal()}>
        <img src={url} alt={reference?.name ?? '会话图片'} width={width} height={height} onLoad={() => setDecoded(true)} onError={() => setError(true)} data-ready={decoded} />
      </button>}
      {(!decoded || error) && <div className={css.imagePlaceholder}>
        <span>{error ? '图片未能加载' : '正在加载图片'}</span>
        {error && usable && <button type="button" className={css.textButton} onClick={() => setAttempt(value => value + 1)}>重试</button>}
      </div>}
    </div>
    {reference?.name && <figcaption>{reference.name}</figcaption>}
    <dialog ref={dialog} className={css.imageDialog} aria-label="图片预览" onClose={() => opener.current?.focus()} onClick={event => { if (event.target === dialog.current) dialog.current?.close(); }}>
      <button type="button" autoFocus className={css.dialogClose} aria-label="关闭图片预览" onClick={() => dialog.current?.close()}>×</button>
      {url && <img src={url} alt={reference?.name ?? '会话图片'} />}
    </dialog>
  </figure>;
});

type TextPresentation = { startedAt?: number; interrupted?: boolean; liveText?: boolean };

function ReadingMarkdown({ text, streaming, holdFormatting, startedAt, interrupted = false, liveText = false, kind = 'body' }: { text: string; streaming: boolean; holdFormatting: boolean; kind?: 'body' | 'reasoning' } & TextPresentation) {
  const root = useRef<HTMLDivElement>(null);
  const presentation = useStreamingText(text, streaming, { startedAt, interrupted: interrupted || !liveText, selected: holdFormatting });
  // Native Markdown changes block keys for its full final parse. Keep the last
  // committed mode while this answer is selected, then finish formatting on
  // deselection. Business status and the source text still update normally.
  const committedMode = useRef(streaming);
  const effectiveMode = holdFormatting ? committedMode.current : presentation.formatStreaming;
  useLayoutEffect(() => { committedMode.current = effectiveMode; }, [effectiveMode]);
  return <div ref={root} className={css.readingText} data-reader-text data-reader-text-kind={kind} data-received-length={text.length} data-shown-length={presentation.text.length}
    data-presentation-pending={presentation.pending || undefined} data-motion-style="opacity-blur" data-ud-motion="reader-text-arrival" data-ud-motion-type="reveal" data-ud-motion-no-flash="true">
    <MotionMarkdown text={presentation.text} streaming={effectiveMode} enabled={liveText && presentation.reveal && effectiveMode} revision={presentation.revision} />
  </div>;
}

function ReadingReasoning({ text, streaming, holdFormatting, startedAt, interrupted = false, liveText = false }: { text: string; streaming: boolean; holdFormatting: boolean } & TextPresentation) {
  const presentation = useStreamingText(text, streaming, { startedAt, interrupted: interrupted || !liveText, selected: holdFormatting });
  return <div className={css.readingText} data-reader-text data-reader-text-kind="reasoning" data-received-length={text.length} data-shown-length={presentation.text.length}
    data-presentation-pending={presentation.pending || undefined} data-motion-style="opacity-blur" data-ud-motion="reader-text-arrival" data-ud-motion-type="reveal" data-ud-motion-no-flash="true">
    <MotionPlainText text={presentation.text} enabled={liveText && presentation.reveal} revision={presentation.revision} />
  </div>;
}

function fallback(block: AssistantBlock, streaming: boolean, source: ReaderBlockOwner['source'], loadImage: BlockRenderProps['loadImage'], holdFormatting: boolean, presentation: TextPresentation): ReactNode {
  switch (block.kind) {
    case 'text': return source === 'user' ? <UserText text={block.text} /> : <ReadingMarkdown text={block.text} streaming={streaming} holdFormatting={holdFormatting} {...presentation} />;
    case 'image': return <ImageBlock attachment={block.attachment} loadImage={loadImage} />;
    case 'reasoning': return <ReadingReasoning text={block.text} streaming={streaming} holdFormatting={holdFormatting} {...presentation} />;
    case 'tool-call': return <JsonBlockL label={`工具参数 · ${block.name}`} payload={block.argsRaw} />;
    case 'other': return <div className={css.unknown}>
      <p>此内容类型尚未接入阅读页，原始内容已保留。</p>
      <JsonBlockL label="查看原始内容" payload={block.block} />
    </div>;
  }
}

export const Blocks = memo(function Blocks({ blocks, streaming = false, source = 'assistant', holdFormatting = false, startedAt, interrupted, liveText, renderSlotChain, loadImage }: BlockRenderProps & TextPresentation & {
  blocks: readonly AssistantBlock[]; streaming?: boolean; source?: ReaderBlockOwner['source']; holdFormatting?: boolean;
}) {
  return <div className={css.blocks} data-streaming={streaming || undefined}>
    {blocks.map((block, index) => <BlockBoundary key={blockKey(block, index)}>
      <Fragment>{renderSlotChain('dsh-clearview.block', { block, streaming, source }, { fallback: fallback(block, streaming, source, loadImage, holdFormatting, { startedAt, interrupted, liveText }) })}</Fragment>
    </BlockBoundary>)}
  </div>;
});

export function CopyAnswer({ blocks }: { blocks: readonly AssistantBlock[] }) {
  const [receipt, setReceipt] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const text = blocks.filter((block): block is Extract<AssistantBlock, { kind: 'text' }> => block.kind === 'text').map(block => block.text).join('\n\n');
  if (!text.trim()) return null;
  return <div className={css.answerActions}>
    <button type="button" className={css.iconButton} aria-label="复制回答" title="复制回答" onClick={async () => {
      const accepted = await writeClipboard(text);
      setReceipt(accepted ? '已复制' : '未能复制，请手动选择文字');
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setReceipt(''), 2000);
    }}>
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><rect x="5" y="5" width="8" height="8" rx="1.5" /><path d="M3 10H2.8A.8.8 0 0 1 2 9.2V2.8a.8.8 0 0 1 .8-.8h6.4a.8.8 0 0 1 .8.8V3" /></svg>
    </button>
    <span role="status" className={css.meta}>{receipt}</span>
  </div>;
}
