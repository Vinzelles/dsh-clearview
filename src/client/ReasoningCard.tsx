import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { followAdvance } from './reasoning-follow.js';
import css from './Reader.module.css';

const EASING = 'cubic-bezier(.22,1,.36,1)';

/** One real transcript: continuous native-scroll following, plain native reading whenever the user takes over. */
export function ReasoningCard({ children, step, active, motion, selected, onRead }: {
  children: ReactNode; step: number; active: boolean; motion: boolean; selected: boolean; onRead: () => void;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const controls = useId();
  const [expanded, setExpanded] = useState(false);
  const [following, setFollowing] = useState(true);
  const [overflow, setOverflow] = useState(false);
  const [edges, setEdges] = useState('none');
  const lastHeight = useRef(0);
  const resize = useRef<Animation | null>(null);
  const previousExpanded = useRef(expanded);
  const stopFollow = useRef<() => void>(() => {});
  /** End-of-stream glide in flight; user interaction cancels it at the painted position. */
  const finishRef = useRef<{ cancel: () => void } | null>(null);
  /** Last scrollTop written by the loop or the glide; a scroll event away from it is the user's. */
  const lastTop = useRef(0);
  /** Whether this card has already performed its first follow entry. */
  const followSeeded = useRef(false);
  const allowed = following && active && motion && !selected;

  const pause = useCallback(() => {
    stopFollow.current();
    setFollowing(false);
    onRead();
  }, [onRead]);

  useLayoutEffect(() => {
    // The parent's selection observer can suspend this card before its own
    // listener runs. Clearing a selection must not silently resume following.
    if (!selected) return;
    stopFollow.current();
    setFollowing(false);
  }, [selected]);

  useLayoutEffect(() => {
    const port = viewport.current;
    const host = port?.closest<HTMLElement>('[data-conversation-scroll]');
    if (!port || !host) return;
    const fit = () => {
      // Public DSH layout variable, updated by the native composer's observer.
      // Leave room for the permanent identity, footer and reading margin.
      const composer = parseFloat(getComputedStyle(host).getPropertyValue('--dsh-composer-height')) || 152;
      const heading = port.parentElement?.querySelector<HTMLElement>('[data-reader-reasoning-heading]')?.offsetHeight || 30;
      const footer = port.parentElement?.querySelector<HTMLElement>('[data-ud-check=reasoning-controls]')?.offsetHeight || 38;
      const available = Math.max(120, host.clientHeight - composer - heading - footer - 32);
      port.style.setProperty('--reason-reading-height', `${available}px`);
    };
    fit();
    const observer = new ResizeObserver(fit); observer.observe(host);
    const attributes = new MutationObserver(fit);
    attributes.observe(host, { attributes: true, attributeFilter: ['style'] });
    return () => { observer.disconnect(); attributes.disconnect(); };
  }, [expanded]);

  useLayoutEffect(() => {
    const port = viewport.current;
    const text = content.current;
    if (!port || !text) return;
    // A resuming follow takes over from the painted position, so stop a finish
    // glide that is still writing toward the end.
    if (allowed) finishRef.current?.cancel();
    // Cached metrics: the rAF loop never reads layout, so its per-frame cost
    // stays O(1) no matter how long the transcript grows. The ResizeObserver
    // refreshes these values whenever the text or the viewport changes.
    let clientHeight = port.clientHeight;
    let tail = Math.max(0, text.offsetHeight - clientHeight);
    let frame = 0;
    let alive = true;
    let tracking = false;
    let state = { pos: port.scrollTop, velocity: 0, lastTail: tail, lastAt: 0 };
    lastTop.current = state.pos;
    const hasSelection = () => {
      const selection = document.getSelection();
      return !!selection && !selection.isCollapsed && !!selection.anchorNode && text.contains(selection.anchorNode);
    };
    const cancel = () => {
      cancelAnimationFrame(frame); frame = 0;
      delete port.dataset.reasoningMoving;
    };
    const paint = (pos: number) => {
      port.scrollTop = pos;
      // Reading back is free (the write resolved layout) and keeps the
      // user-scroll detector exact when the browser clamps a stale-tail write.
      lastTop.current = port.scrollTop;
    };
    const edgesFor = (pos: number, end: number) => {
      const top = pos > 1;
      const bottom = end - pos > 1;
      const next = top ? bottom ? 'both' : 'top' : bottom ? 'bottom' : 'none';
      setEdges(value => value === next ? value : next);
    };
    const refresh = (recordHeight = true) => {
      clientHeight = port.clientHeight;
      const height = text.offsetHeight;
      tail = Math.max(0, height - clientHeight);
      const previewHeight = parseFloat(getComputedStyle(port).getPropertyValue('--reason-preview-height'));
      setOverflow(height > previewHeight + 1);
      edgesFor(tracking ? state.pos : port.scrollTop, tail);
      if (recordHeight && !resize.current) lastHeight.current = clientHeight;
    };
    stopFollow.current = () => { finishRef.current?.cancel(); cancel(); tracking = false; };
    const canFollow = () => allowed && alive && !document.hidden && !hasSelection();
    // Continuous follow: one rAF loop writes the native scroll offset per
    // frame. The controller feeds the measured growth speed forward (steady
    // streams converge to zero lag at constant speed) and closes any residual
    // gap proportionally, clamped to the live tail so a burst extends the
    // approach instead of overshooting and rolling back. Native scrolling is
    // rasterized against the viewport, not the transcript length, so long
    // thinking stays as cheap as short thinking.
    const loop = (now: number) => {
      frame = 0;
      if (!canFollow()) { cancel(); return; }
      const next = followAdvance(state, tail, now);
      state = next;
      paint(next.pos);
      edgesFor(next.pos, tail);
      if (next.settled) { cancel(); return; }
      frame = requestAnimationFrame(loop);
    };
    const run = () => {
      if (!canFollow() || frame) return;
      // A freshly mounted live card (for example when switching back to a
      // running conversation) has its native scroller at the top. If the
      // transcript already overflows, jump to the existing tail before the
      // first controller frame instead of visibly replaying the whole card
      // from the beginning — only genuinely new growth should scroll.
      if (!followSeeded.current) {
        followSeeded.current = true;
        // Only the first entry needs the no-replay seek. A card that grew
        // naturally from empty keeps the controller's smooth catch-up; a
        // freshly mounted live card starts at the existing tail instead.
        if (tail > 1) {
          state.pos = tail;
          state.velocity = 0;
          state.lastTail = tail;
          state.lastAt = performance.now();
          paint(tail);
          edgesFor(tail, tail);
        }
      }
      tracking = true;
      state.lastAt = performance.now();
      state.lastTail = tail;
      port.dataset.reasoningMoving = 'true';
      frame = requestAnimationFrame(loop);
    };
    const onScroll = () => {
      // A scroll away from the last programmatic position is the user's:
      // keyboard, scrollbar drag or an extension takes the wheel.
      if ((tracking || finishRef.current) && Math.abs(port.scrollTop - lastTop.current) > 1) pause();
      else if (!tracking && !finishRef.current) edgesFor(port.scrollTop, tail);
    };
    // The viewport is always a native scroller, so a wheel gesture scrolls by
    // itself; the loop only has to stop writing before the next frame.
    const onWheel = () => { if (tracking || finishRef.current) pause(); };
    const onSelection = () => { if (hasSelection()) pause(); };
    const onVisibility = () => { if (!document.hidden && canFollow()) run(); };
    const observer = new ResizeObserver(() => {
      refresh();
      if (tracking) run();
    });
    observer.observe(text); observer.observe(port);
    port.addEventListener('scroll', onScroll, { passive: true });
    port.addEventListener('wheel', onWheel, { passive: true });
    document.addEventListener('selectionchange', onSelection);
    document.addEventListener('visibilitychange', onVisibility);
    // Keep the previous layout height until the resize effect can sample it.
    refresh(false);
    if (canFollow()) run();
    return () => {
      alive = false;
      cancel();
      observer.disconnect();
      port.removeEventListener('scroll', onScroll); port.removeEventListener('wheel', onWheel);
      document.removeEventListener('selectionchange', onSelection);
      document.removeEventListener('visibilitychange', onVisibility);
      stopFollow.current = () => {};
      if (!tracking) return;
      tracking = false;
      // The stream ended while this card was following (a user pause, wheel
      // or selection would have stopped the loop first): keep gliding the
      // residual lag to the end with the same controller, then stop. The
      // transcript is final here, so the cached tail is the exact target.
      const end = tail;
      if (clientHeight > 1 && end - state.pos > 1) {
        let glideFrame = 0;
        let glideState = { ...state, lastTail: end, lastAt: performance.now() };
        const token = { cancel: () => { if (finishRef.current !== token) return; finishRef.current = null; cancelAnimationFrame(glideFrame); } };
        finishRef.current = token;
        const glide = (now: number) => {
          glideFrame = 0;
          if (finishRef.current !== token) return;
          const next = followAdvance(glideState, end, now);
          glideState = next;
          port.scrollTop = next.pos;
          lastTop.current = port.scrollTop;
          edgesFor(next.pos, end);
          if (next.settled) { finishRef.current = null; return; }
          glideFrame = requestAnimationFrame(glide);
        };
        glideFrame = requestAnimationFrame(glide);
      }
    };
  }, [allowed, pause]);

  useLayoutEffect(() => {
    const port = viewport.current;
    if (!port) return;
    const changed = expanded !== previousExpanded.current;
    previousExpanded.current = expanded;
    const from = resize.current ? port.clientHeight : lastHeight.current;
    resize.current?.cancel(); resize.current = null;
    port.style.maxHeight = ''; port.style.height = '';
    const target = port.clientHeight;
    // Explicit reading adjusts only the conversation, never the outer app.
    // The card is also a reader anchor so resizing cannot pin a later answer
    // in place at the expense of this card's visible heading.
    if (changed && !selected) {
      const card = port.parentElement;
      const host = port.closest<HTMLElement>('[data-conversation-scroll]');
      if (card && host) {
        const composer = parseFloat(getComputedStyle(host).getPropertyValue('--dsh-composer-height')) || 152;
        const region = host.getBoundingClientRect();
        const box = card.getBoundingClientRect();
        const top = region.top + 16;
        const bottom = region.bottom - composer - 16;
        const delta = box.top < top ? box.top - top : box.bottom > bottom ? Math.min(box.bottom - bottom, box.top - top) : 0;
        if (Math.abs(delta) > 1) host.scrollTo({ top: Math.max(0, host.scrollTop + delta), behavior: motion ? 'smooth' : 'instant' });
      }
    }
    if (!changed || !motion || from < 1 || Math.abs(target - from) < 1) {
      lastHeight.current = target;
      return;
    }
    // max-height otherwise clamps the very first collapse frame to the new cap.
    port.style.maxHeight = 'none';
    const animation = port.animate([{ height: `${from}px` }, { height: `${target}px` }], { duration: 300, easing: EASING, fill: 'both' });
    resize.current = animation;
    animation.onfinish = () => {
      if (resize.current !== animation) return;
      resize.current = null; animation.cancel();
      port.style.maxHeight = ''; port.style.height = '';
      lastHeight.current = port.clientHeight;
    };
  }, [expanded, motion, selected]);
  useEffect(() => () => resize.current?.cancel(), []);

  const toggleReading = () => {
    // Resize the same transcript without changing follow intent or position.
    // Wheel, selection and viewport focus still explicitly pause following.
    onRead();
    setExpanded(value => !value);
  };

  return <div className={css.reasonCard} data-reader-reasoning-card data-reader-anchor data-expanded={expanded} data-following={allowed} data-overflow={overflow} data-ud-motion="reader-reasoning-size">
    <div className={css.reasonHeading} data-reader-reasoning-heading data-ud-check="reasoning-identity">
      <span className={css.reasonLabel} data-reader-reasoning-label>思考</span>
      <span>步骤 {step}</span>
    </div>
    <div ref={viewport} id={controls} className={css.reasonViewport} data-reader-reasoning-scroll data-edges={edges}
      data-ud-motion="reader-reasoning-scroll" role="region" aria-label={`步骤 ${step} 的思考${overflow ? '，可滚动阅读' : ''}`}
      tabIndex={overflow ? 0 : undefined} onPointerDown={pause} onFocus={pause}>
      <div className={css.reasonTrack} data-reader-reasoning-track>
        <div ref={content} className={css.reasonText} data-reader-reasoning-text>{children}</div>
      </div>
    </div>
    {(overflow || expanded) && <div className={css.reasonFooter} data-ud-check="reasoning-controls">
      {active && motion ? <button type="button" className={css.reasonAction} disabled={selected} aria-controls={controls}
        aria-label={following ? '暂停自动跟随思考' : '继续跟随最新思考'}
        title={selected ? '取消文字选择后可继续跟随' : undefined}
        onClick={() => { if (following) pause(); else { onRead(); setFollowing(true); } }}>
        <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">{following ? <path d="M5.5 4v8m5-8v8" /> : <path d="M8 3v10m-4-4 4 4 4-4" />}</svg>
        {following ? '暂停跟随' : '跟随最新'}
      </button> : <span className={css.reasonCaption}>{expanded ? '手动阅读' : '可滚动阅读'}</span>}
      <button type="button" className={css.reasonAction} aria-expanded={expanded} aria-controls={controls}
        aria-label={expanded ? '收起完整思考' : '展开阅读完整思考'} onClick={toggleReading}>
        {expanded ? '收起' : '展开阅读'}
        <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">{expanded ? <path d="m4 10 4-4 4 4" /> : <path d="m4 6 4 4 4-4" />}</svg>
      </button>
    </div>}
  </div>;
}
