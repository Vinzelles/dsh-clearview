import { useCallback, useId, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { followAdvance } from './reasoning-follow.js';
import { useReaderActions } from './reader-context.js';
import css from './LiveThought.module.css';

/** Real scroll extent of the viewport (its own padding included): where following ends, and whether it overflows. */
export function scrollMetrics(port: { scrollHeight: number; clientHeight: number }): { tail: number; overflow: boolean } {
  return { tail: Math.max(0, port.scrollHeight - port.clientHeight), overflow: port.scrollHeight > port.clientHeight + 1 };
}

/** A streaming thought: a short viewport that follows the newest text until the reader takes over. */
export function LiveThought({ follow, motion, children }: { follow: boolean; motion: boolean; children: ReactNode }) {
  const { resumeSignal = 0 } = useReaderActions();
  const seenResumeSignal = useRef(resumeSignal);
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [following, setFollowing] = useState(true);
  const [scrolled, setScrolled] = useState(false);
  const [overflow, setOverflow] = useState(false);
  const viewportId = useId();
  const stopFollow = useRef<() => void>(() => {});
  const finishRef = useRef<{ cancel: () => void } | null>(null);
  const lastTop = useRef(0);
  const followSeeded = useRef(false);
  const allowed = following && follow && motion;
  // Reduced motion: no easing, the viewport jumps to the newest text.
  const jumping = following && follow && !motion;

  const pause = useCallback(() => {
    stopFollow.current();
    setFollowing(false);
  }, []);

  const hasSelection = useCallback(() => {
    const selection = document.getSelection();
    const text = content.current;
    return !!selection && !selection.isCollapsed && !!text
      && (!!selection.anchorNode && text.contains(selection.anchorNode)
        || !!selection.focusNode && text.contains(selection.focusNode)
        || (selection.rangeCount > 0 && selection.getRangeAt(0).intersectsNode(text)));
  }, []);
  const resume = useCallback(() => {
    if (hasSelection()) return;
    finishRef.current?.cancel();
    setFollowing(true);
  }, [hasSelection]);
  useLayoutEffect(() => {
    if (seenResumeSignal.current === resumeSignal) return;
    seenResumeSignal.current = resumeSignal;
    resume();
  }, [resumeSignal, resume]);

  useLayoutEffect(() => {
    const port = viewport.current;
    const text = content.current;
    if (!port || !text) return;
    if (allowed) finishRef.current?.cancel();
    let clientHeight = port.clientHeight;
    let tail = scrollMetrics(port).tail;
    let frame = 0;
    let alive = true;
    let tracking = false;
    let state = { pos: port.scrollTop, velocity: 0, lastTail: tail, lastAt: 0 };
    lastTop.current = state.pos;
    const cancel = () => { cancelAnimationFrame(frame); frame = 0; delete port.dataset.reasoningMoving; };
    const paint = (pos: number) => { port.scrollTop = pos; lastTop.current = port.scrollTop; };
    const refresh = () => {
      clientHeight = port.clientHeight;
      const metrics = scrollMetrics(port);
      tail = metrics.tail;
      setOverflow(metrics.overflow);
      if (jumping && alive && !hasSelection() && Math.abs(port.scrollTop - tail) > 1) paint(tail);
    };
    stopFollow.current = () => { finishRef.current?.cancel(); cancel(); tracking = false; };
    const canFollow = () => allowed && alive && !document.hidden && !hasSelection();
    const loop = (time: number) => {
      frame = 0;
      if (!canFollow()) { cancel(); return; }
      const next = followAdvance(state, tail, time);
      state = next;
      paint(next.pos);
      if (next.settled) { cancel(); return; }
      frame = requestAnimationFrame(loop);
    };
    const run = () => {
      if (!canFollow() || frame) return;
      if (!followSeeded.current) {
        followSeeded.current = true;
        if (tail > 1) {
          state = { pos: tail, velocity: 0, lastTail: tail, lastAt: performance.now() };
          paint(tail);
        }
      }
      tracking = true;
      state.lastAt = performance.now();
      state.lastTail = tail;
      port.dataset.reasoningMoving = 'true';
      frame = requestAnimationFrame(loop);
    };
    const onScroll = () => {
      if ((tracking || jumping || finishRef.current) && Math.abs(port.scrollTop - lastTop.current) > 1) pause();
    };
    const onWheel = () => { if (tracking || jumping || finishRef.current) pause(); };
    const onSelection = () => { if (hasSelection()) pause(); };
    const onVisibility = () => { if (!document.hidden && canFollow()) run(); };
    const observer = new ResizeObserver(() => { refresh(); if (tracking) run(); });
    observer.observe(text); observer.observe(port);
    port.addEventListener('scroll', onScroll, { passive: true });
    port.addEventListener('wheel', onWheel, { passive: true });
    port.addEventListener('touchmove', onWheel, { passive: true });
    document.addEventListener('selectionchange', onSelection);
    document.addEventListener('visibilitychange', onVisibility);
    refresh();
    if (canFollow()) run();
    return () => {
      alive = false;
      cancel();
      observer.disconnect();
      port.removeEventListener('scroll', onScroll); port.removeEventListener('wheel', onWheel); port.removeEventListener('touchmove', onWheel);
      document.removeEventListener('selectionchange', onSelection);
      document.removeEventListener('visibilitychange', onVisibility);
      stopFollow.current = () => {};
      if (!tracking) return;
      tracking = false;
      const end = tail;
      if (clientHeight > 1 && end - state.pos > 1 && port.isConnected) {
        let glideFrame = 0;
        let glideState = { ...state, lastTail: end, lastAt: performance.now() };
        const token = { cancel: () => { if (finishRef.current !== token) return; finishRef.current = null; cancelAnimationFrame(glideFrame); } };
        finishRef.current = token;
        const glide = (time: number) => {
          glideFrame = 0;
          if (finishRef.current !== token) return;
          const next = followAdvance(glideState, end, time);
          glideState = next;
          port.scrollTop = next.pos;
          lastTop.current = port.scrollTop;
          if (next.settled) { finishRef.current = null; return; }
          glideFrame = requestAnimationFrame(glide);
        };
        glideFrame = requestAnimationFrame(glide);
      }
    };
  }, [allowed, jumping, pause, hasSelection]);

  return <div className={css.live} data-reader-live-thought data-following={follow && following}>
    <div ref={viewport} id={viewportId} className={css.viewport} data-reader-reasoning-scroll role="region"
      aria-label={`思考内容${overflow ? '，可滚动阅读' : ''}`} tabIndex={overflow ? 0 : undefined} data-scrolled={scrolled}
      onScroll={() => setScrolled((viewport.current?.scrollTop ?? 0) > 0)}
      onPointerDown={pause} onFocus={pause}>
      <div ref={content} data-reader-reasoning-text>{children}</div>
    </div>
    {!following && <button type="button" className={css.resume} aria-controls={viewportId} onClick={resume}>继续跟随</button>}
  </div>;
}
