import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { StreamBuffer } from './stream-buffer.js';
import { WORD_MOTION } from './word-timeline.js';

export const StreamMotionContext = createContext({ enabled: false, activatedAt: 0 });

/**
 * What each live text leaf of one turn has already shown, by reveal key. A body paragraph moves between the
 * answer zone and the process panel's narration when a tool row follows it; the two routes are different
 * components, so the leaf remounts. The ledger lets the remounted leaf start from the text the reader has
 * already seen instead of typing it in again.
 */
export type RevealLedger = Map<string, string>;
export const RevealLedgerContext = createContext<RevealLedger | null>(null);

/** The text a fresh buffer starts with: empty only when a live reveal begins from nothing. */
export function initialVisible(source: string, live: boolean, shown?: string): string {
  if (!live) return source;
  return shown && source.startsWith(shown) ? shown : '';
}

export function useStreamingText(source: string, streaming: boolean, options: { startedAt?: number; interrupted: boolean; selected: boolean; revealKey?: string }) {
  const { enabled, activatedAt } = useContext(StreamMotionContext);
  const ledger = useContext(RevealLedgerContext);
  const revealKey = options.revealKey;
  const fresh = (options.startedAt ?? 0) >= activatedAt;
  const buffer = useRef<StreamBuffer>();
  if (!buffer.current) buffer.current = new StreamBuffer(initialVisible(source, enabled && streaming && fresh, revealKey === undefined ? undefined : ledger?.get(revealKey)));
  const streamingNow = useRef(streaming);
  streamingNow.current = streaming;
  const [display, setDisplay] = useState(() => ({ text: buffer.current!.visible, revision: 0 }));
  const [finalizing, setFinalizing] = useState(streaming);
  const frame = useRef(0);
  const immediate = !enabled || options.interrupted || options.selected;
  const published = useRef(display);
  // Remember only while the reveal can still be replayed; a settled leaf remounts from its full source.
  const remember = useCallback(() => {
    if (!ledger || revealKey === undefined) return;
    const current = buffer.current!;
    if (streamingNow.current || current.pending) ledger.set(revealKey, current.visible);
    else ledger.delete(revealKey);
  }, [ledger, revealKey]);
  const publish = useCallback(() => {
    const current = buffer.current!;
    remember();
    if (published.current.text === current.visible && published.current.revision === current.revision) return;
    published.current = { text: current.visible, revision: current.revision };
    setDisplay(published.current);
  }, [remember]);
  const tick = useCallback((now: number) => {
    frame.current = 0;
    const current = buffer.current!;
    if (document.hidden) current.flush();
    else current.advance(now);
    publish();
    if (current.pending) frame.current = requestAnimationFrame(tick);
  }, [publish]);
  useLayoutEffect(() => {
    const current = buffer.current!;
    current.update(source, performance.now(), { immediate: immediate || document.hidden, finished: !streaming });
    // Only resets/flushes change visible text here. Appends join the existing
    // frame instead of cancelling and restarting its loop for every token.
    publish();
    if (current.pending && !frame.current) frame.current = requestAnimationFrame(tick);
    else if (!current.pending) { cancelAnimationFrame(frame.current); frame.current = 0; }
  }, [source, streaming, immediate, publish, tick]);
  useLayoutEffect(() => () => { cancelAnimationFrame(frame.current); frame.current = 0; }, []);
  useEffect(() => {
    const hidden = () => {
      if (!document.hidden) return;
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      buffer.current!.flush(); publish(); setFinalizing(false);
    };
    document.addEventListener('visibilitychange', hidden);
    return () => document.removeEventListener('visibilitychange', hidden);
  }, []);
  const pending = display.text !== source;
  useEffect(() => {
    if (streaming || pending) { setFinalizing(true); return; }
    if (immediate || document.hidden) { setFinalizing(false); return; }
    const timer = setTimeout(() => setFinalizing(false), WORD_MOTION.duration + WORD_MOTION.maxDelay);
    return () => clearTimeout(timer);
  }, [streaming, pending, immediate]);
  return { text: immediate ? source : display.text, pending: !immediate && pending, revision: display.revision, formatStreaming: streaming || (!immediate && (pending || finalizing)), reveal: enabled && !options.interrupted && !options.selected };
}
