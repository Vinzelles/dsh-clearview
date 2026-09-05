import { createContext, memo, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { MarkdownText } from './markdown/MarkdownText.js';
import { WORD_MOTION, WordTimeline } from './word-timeline.js';
import css from './Reader.module.css';

const WordScope = createContext({ enabled: false, generation: 0 });
const CODE_LABELS = { copyLabel: '复制代码', copiedLabel: '已复制' };

/** Whether a word with this birth time still needs its reveal animation now. */
function willReveal(born: number | null): boolean {
  if (born === null || document.hidden) return false;
  return Number(document.timeline.currentTime ?? performance.now()) - born < WORD_MOTION.duration;
}

function useSourceReveal(element: RefObject<HTMLElement>, born: number | null, generation: number, onSettled: (() => void) | null) {
  const scope = useContext(WordScope);
  const cancelled = useRef(false);
  useLayoutEffect(() => {
    const target = element.current;
    if (!target) return;
    target.dataset.wordState = 'settled';
    if (!scope.enabled || scope.generation !== generation) { cancelled.current = true; onSettled?.(); return; }
    if (cancelled.current || born === null || document.hidden) { onSettled?.(); return; }
    const age = Number(document.timeline.currentTime ?? performance.now()) - born;
    if (age >= WORD_MOTION.duration || typeof target.animate !== 'function') { onSettled?.(); return; }
    // The reference opacity + blur frames, applied only to this new word.
    // No color interpolation, stylesheet mutation, or whole-paragraph wipe.
    const animation = target.animate([
      { opacity: 0, filter: `blur(${WORD_MOTION.blur}px)` },
      { opacity: 1, filter: 'blur(0px)' },
    ], { duration: WORD_MOTION.duration, easing: WORD_MOTION.easing, fill: 'backwards' });
    // One absolute clock prevents newly mounted/resegmented leaves from getting
    // a fresh delay or running ahead because their layout effects ran later.
    animation.startTime = born;
    target.dataset.wordState = 'resolving';
    const finish = () => { animation.cancel(); target.dataset.wordState = 'settled'; document.removeEventListener('visibilitychange', hidden); onSettled?.(); };
    animation.onfinish = finish;
    const hidden = () => { if (document.hidden) { cancelled.current = true; finish(); } };
    document.addEventListener('visibilitychange', hidden);
    return () => { animation.cancel(); document.removeEventListener('visibilitychange', hidden); target.dataset.wordState = 'settled'; };
  }, [element, born, generation, scope.enabled, scope.generation, onSettled]);
}

function Word({ children, born, generation, offset, inline }: { children: string; born: number | null; generation: number; offset: number; inline: boolean }) {
  const element = useRef<HTMLSpanElement>(null);
  // A reveal leaf only needs its wrapper while it animates. Once settled it is
  // dropped to a plain text node: a long turn streams tens of thousands of words
  // and keeping a <span> per word made every scroll pay layout/paint for each
  // box (measured: 90k spans → 50-200ms longtasks; text → smooth). Because the
  // component itself stops rendering the span, React unmounts it cleanly — no
  // detached-node crash risk that an external DOM unwrap would carry. Only the
  // ~350ms frontier holds spans; everything behind is text.
  const [settled, setSettled] = useState(() => !willReveal(born));
  const settle = useCallback(() => setSettled(true), []);
  const onSettled = settled ? null : settle;
  useSourceReveal(element, born, generation, onSettled);
  if (settled) return <>{children}</>;
  return <span ref={element} className={inline ? css.streamInlineWord : css.streamWord} data-reader-word data-source-start={offset} data-source-birth={born ?? undefined}>{children}</span>;
}

/** A native code block enters on the same clock, without rebuilding its text. */
function MotionAtom({ children, born, generation, offset }: { children: ReactNode; born: number | null; generation: number; offset: number }) {
  const element = useRef<HTMLDivElement>(null);
  useSourceReveal(element, born, generation, null);
  return <div ref={element} className={css.streamAtom} data-reader-atom data-source-start={offset} data-source-birth={born ?? undefined}>{children}</div>;
}

/** An inline atom (an inline-code chip) reveals as one unit — chrome and text together. */
function InlineMotionAtom({ children, born, generation, offset }: { children: ReactNode; born: number | null; generation: number; offset: number }) {
  const element = useRef<HTMLSpanElement>(null);
  useSourceReveal(element, born, generation, null);
  return <span ref={element} className={css.streamInlineAtom} data-reader-atom data-source-start={offset} data-source-birth={born ?? undefined}>{children}</span>;
}

/** One paragraph of a reasoning transcript, memoized on its own text. */
const ReasonSegment = memo(function ReasonSegment({ timeline, text, offset, generation, liveFrom }: {
  timeline: WordTimeline; text: string; offset: number; generation: number; liveFrom: number;
}) {
  // Settled prefix as plain text, animated frontier as components: only
  // [liveFrom, end) can still reveal, so a long live paragraph costs the same
  // per frame as a short one. The frontier never cuts closing punctuation off
  // its word (shared birth interval) or an opening quote off its window.
  const cut = Math.max(0, Math.min(text.length, liveFrom - offset));
  const prefix = cut > 0 ? text.slice(0, cut) : '';
  const words = timeline.words(text.slice(cut), offset + cut);
  return <>{prefix}{words.map(word => word.text.trim()
    ? <Word key={word.key} born={word.born} generation={generation} offset={word.key} inline>{word.text}</Word>
    : word.text)}</>;
}, (previous, next) => previous.timeline === next.timeline
  && previous.text === next.text
  && previous.offset === next.offset
  && previous.generation === next.generation
  && previous.liveFrom === next.liveFrom);

interface ParagraphChunk { start: number; end: number; part: string }

/**
 * Append-only paragraph chunking. The full-text scan ran every frame and
 * cost O(total length); the cache only rescans from the previous boundary,
 * and settled chunks keep their exact string reference so the segment memo
 * holds and re-renders zero times.
 */
function paragraphChunks(cache: { current: { text: string; chunks: ParagraphChunk[] } }, text: string): ParagraphChunk[] {
  const previous = cache.current;
  let chunks: ParagraphChunk[];
  if (previous.chunks.length > 0 && text.startsWith(previous.text)) {
    chunks = previous.chunks.map(chunk => ({ ...chunk }));
    const last = chunks[chunks.length - 1]!;
    const boundary = text.indexOf('\n\n', Math.max(last.start, previous.text.length - 1));
    last.end = boundary === -1 ? text.length : boundary;
    last.part = text.slice(last.start, last.end);
    let i = boundary === -1 ? text.length : last.end + 2;
    while (i < text.length) {
      const next = text.indexOf('\n\n', i);
      const end = next === -1 ? text.length : next;
      chunks.push({ start: i, end, part: text.slice(i, end) });
      if (next === -1) break;
      i = end + 2;
    }
  } else {
    chunks = [];
    let i = 0;
    while (i < text.length) {
      const boundary = text.indexOf('\n\n', i);
      const end = boundary === -1 ? text.length : boundary;
      chunks.push({ start: i, end, part: text.slice(i, end) });
      i = boundary === -1 ? text.length : boundary + 2;
    }
  }
  cache.current = { text, chunks };
  return chunks;
}

/** Native Think is literal text, not Markdown. Spans never alter its bytes. */
export function MotionPlainText({ text, enabled, revision }: { text: string; enabled: boolean; revision: number }) {
  const timeline = useRef<WordTimeline>();
  timeline.current ??= new WordTimeline();
  const chunkCache = useRef<{ text: string; chunks: ParagraphChunk[] }>({ text: '', chunks: [] });
  const now = Number(document.timeline.currentTime ?? performance.now());
  timeline.current.begin(text, enabled, revision, now);
  const current = timeline.current;
  const generation = current.generation;
  const scope = useMemo(() => ({ enabled, generation }), [enabled, generation]);
  const chunks = paragraphChunks(chunkCache, text);
  if (!current.hasLiveText) return <WordScope.Provider value={scope}><div className={css.reasonPlain}>{text}</div></WordScope.Provider>;
  // Paragraph-chunk the reasoning text so memoized earlier paragraphs
  // re-render zero times; inside the live paragraph only the reveal frontier
  // becomes components (see ReasonSegment). Word keys stay global source
  // offsets (segment offset + in-segment index), so reconciliation across
  // paragraph growth is stable.
  const liveFrom = current.liveFloor(now);
  const children: ReactNode[] = [];
  chunks.forEach((chunk, index) => {
    if (index > 0) children.push('\n\n');
    children.push(<ReasonSegment key={chunk.start} timeline={current} text={chunk.part} offset={chunk.start} generation={generation}
      liveFrom={Math.max(chunk.start, Math.min(liveFrom, chunk.end))} />);
  });
  return <WordScope.Provider value={scope}><div className={css.reasonPlain}>{children}</div></WordScope.Provider>;
}

/** Native DSH Markdown semantics with a stable text-leaf animation hook. */
export function MotionMarkdown({ text, streaming, enabled, revision }: { text: string; streaming: boolean; enabled: boolean; revision: number }) {
  const timeline = useRef<WordTimeline>();
  timeline.current ??= new WordTimeline();
  timeline.current.begin(text, enabled, revision, Number(document.timeline.currentTime ?? performance.now()));
  const generation = timeline.current.generation;
  const scope = useMemo(() => ({ enabled, generation }), [enabled, generation]);
const renderText = useMemo(() => (value: string, offset: number, inline = false): ReactNode => {
    const current = timeline.current!;
    if (!current.hasLiveText) return value;
    // Same frontier as the reasoning card: settled prefix as plain text,
    // only the reveal window becomes animated components.
    const now = Number(document.timeline.currentTime ?? performance.now());
    const cut = Math.max(0, Math.min(value.length, current.liveFloor(now) - offset));
    const words = current.words(value.slice(cut), offset + cut).map(word => word.text.trim()
      ? <Word key={word.key} born={word.born} generation={current.generation} offset={word.key} inline={inline || /^\p{P}+$/u.test(word.text)}>{word.text}</Word>
      : word.text);
    return cut > 0 ? [value.slice(0, cut), ...words] : words;
  }, []);
  const renderAtom = useMemo(() => (children: ReactNode, offset: number): ReactNode => {
    const current = timeline.current!;
    return current.hasLiveText ? <MotionAtom born={current.bornAt(offset)} generation={current.generation} offset={offset}>{children}</MotionAtom> : children;
  }, []);
  const renderInlineAtom = useMemo(() => (children: ReactNode, offset: number): ReactNode => {
    const current = timeline.current!;
    return current.hasLiveText ? <InlineMotionAtom born={current.bornAt(offset)} generation={current.generation} offset={offset}>{children}</InlineMotionAtom> : children;
  }, []);
  return <WordScope.Provider value={scope}>
    <MarkdownText text={text} streaming={streaming} codeLabels={CODE_LABELS} renderText={renderText} renderAtom={renderAtom} renderInlineAtom={renderInlineAtom} />
  </WordScope.Provider>;
}
