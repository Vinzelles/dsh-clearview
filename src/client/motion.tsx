import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import clsx from 'clsx';
import css from './Reader.module.css';
import { TextShimmer } from '@deepseek-ai/dsh-client-ui-primitives';
import { MOTION } from './motion-tokens.js';
import { StreamMotionContext } from './streaming.js';
import { READING_SURFACE_GAP, readingFollowAction, readingScrollAction } from './reading-follow.js';
import { pickAnchor, recallPosition, rememberPosition } from './reading-position.js';

const EASING = MOTION.ease;

export function useMotionAllowed(enabled: boolean): boolean {
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => setReduced(query.matches);
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);
  return enabled && !reduced;
}

export function usePinnedSelection(root: RefObject<HTMLElement>, selector = '[data-reader-answer], [data-reader-process]'): readonly string[] {
  const [keys, setKeys] = useState<readonly string[]>([]);
  useEffect(() => {
    const update = () => {
      const selection = document.getSelection();
      const range = selection && !selection.isCollapsed && selection.rangeCount ? selection.getRangeAt(0) : null;
      const next = range && root.current
        ? [...new Set(Array.from(root.current.querySelectorAll<HTMLElement>(selector))
          .filter(element => range.intersectsNode(element))
          .map(element => element.dataset.readerKey ?? element.dataset.readerProcessKey!).filter(Boolean))]
        : [];
      setKeys(previous => previous.length === next.length && previous.every((key, index) => key === next[index]) ? previous : next);
    };
    document.addEventListener('selectionchange', update);
    return () => document.removeEventListener('selectionchange', update);
  }, [root, selector]);
  return keys;
}

export function StatusText({ text, motion, shimmer = false, className }: { text: string; motion: boolean; shimmer?: boolean; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(() => !document.hidden);
  const [forcedColors, setForcedColors] = useState(() => window.matchMedia('(forced-colors: active)').matches);
  const allowed = motion && visible && !forcedColors;
  const [frame, setFrame] = useState<{
    text: string; id: number; phase: 'idle' | 'start' | 'running';
    outgoing: { text: string; id: number } | null;
  }>({ text, id: 0, phase: 'idle', outgoing: null });
  // Adjust before commit, so a new label cannot paint once before its entry state.
  // Reuse the previous incoming key: a rapid change exits from its current pose.
  if (frame.text !== text) setFrame({
    text, id: frame.id + 1, phase: allowed ? 'start' : 'idle',
    outgoing: allowed ? { text: frame.text, id: frame.id } : null,
  });
  useEffect(() => {
    const update = () => setVisible(!document.hidden);
    const query = window.matchMedia('(forced-colors: active)');
    const colors = () => setForcedColors(query.matches);
    document.addEventListener('visibilitychange', update);
    query.addEventListener('change', colors);
    return () => { document.removeEventListener('visibilitychange', update); query.removeEventListener('change', colors); };
  }, []);
  useLayoutEffect(() => {
    const id = frame.id;
    const settle = () => setFrame(current => current.id === id && current.outgoing
      ? { ...current, phase: 'idle', outgoing: null } : current);
    if (!allowed) { settle(); return; }
    if (!frame.outgoing || !ref.current) return;
    // Commit the supplied .is-enter-start pose before releasing CSS transitions.
    ref.current.getBoundingClientRect();
    let timer = 0;
    const tick = requestAnimationFrame(() => {
      setFrame(current => current.id === id ? { ...current, phase: 'running' } : current);
      timer = window.setTimeout(settle, MOTION.swap + MOTION.swapGap);
    });
    return () => { cancelAnimationFrame(tick); window.clearTimeout(timer); };
  }, [frame.id, allowed]);
  const active = shimmer && allowed;
  const swapping = allowed && frame.outgoing !== null;
  return <span className={className ? `${css.statusText} ${className}` : css.statusText} data-reader-status data-reader-busy={shimmer} data-ud-check="reader-status">
    <span className={css.think} aria-hidden="true" data-active={active} data-reader-status-phase={swapping ? frame.phase : 'idle'} data-ud-motion="reader-thinking-state">
      <span className={css.thinkSizer}>{text}</span>
      {swapping && <span key={frame.outgoing!.id} className={`${css.thinkText} ${frame.phase === 'running' ? css.isExit : ''}`}
        data-reader-status-copy="outgoing" data-text={frame.outgoing!.text}>{frame.outgoing!.text}</span>}
      <span key={frame.id} ref={ref} className={`${css.thinkText} ${swapping && frame.phase === 'start' ? css.isEnterStart : ''}`}
        data-reader-status-copy="current" data-text={text}>{active ? <TextShimmer active>{text}</TextShimmer> : text}</span>
    </span>
    <span className={css.srOnly} role="status" aria-live="polite" aria-atomic="true">{text}</span>
  </span>;
}

export function Disclosure({ open, onChange, label, status, controls, buttonRef }: {
  open: boolean; onChange: (value: boolean) => void; label: ReactNode;
  status?: string; controls: string; buttonRef: RefObject<HTMLButtonElement>;
}) {
  return <div className={css.disclosure} data-reader-disclosure data-expanded={open}>
    <button ref={buttonRef} type="button" className={css.disclosureButton} aria-label={`${open ? '收起' : '展开'}思考与过程${status ? `，${status}` : ''}`} aria-expanded={open} aria-controls={controls} onClick={() => onChange(!open)}>
      {label}
      {status && <span className={css.disclosureStatus}>{status}</span>}
      <svg className={css.chevron} data-open={open} viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="m6 4 4 4-4 4" /></svg>
    </button>
  </div>;
}

/** Supplemental details stay in source order beside their own narration. */
export function ProcessFragment({ open, motion, onRead, returnFocusTo, nodeKey, children, framed = false }: {
  open: boolean; motion: boolean; onRead: () => void; nodeKey: string;
  returnFocusTo: RefObject<HTMLElement>; children: ReactNode; framed?: boolean;
}) {
  const body = useRef<HTMLDivElement>(null);
  const running = useRef<Animation | null>(null);
  const previous = useRef(open);
  const [present, setPresent] = useState(open);
  useLayoutEffect(() => {
    const element = body.current;
    if (!element) return;
    const from = running.current ? element.getBoundingClientRect().height : previous.current ? element.scrollHeight : 0;
    running.current?.cancel();
    running.current = null;
    const changed = previous.current !== open;
    previous.current = open;
    if (open) setPresent(true);
    if (!open && element.contains(document.activeElement)) returnFocusTo.current?.focus();
    element.style.height = open ? 'auto' : '0px';
    const target = open ? element.scrollHeight : 0;
    if (!motion || !changed || Math.abs(from - target) < 1) {
      setPresent(open);
      return;
    }
    const animation = element.animate([{ height: `${from}px`, opacity: from < 1 ? 0 : 1 }, { height: `${target}px`, opacity: open ? 1 : 0 }], { duration: MOTION.size, easing: EASING, fill: 'both' });
    running.current = animation;
    animation.onfinish = () => {
      if (running.current !== animation) return;
      running.current = null;
      animation.cancel();
      setPresent(open);
    };
  }, [open, motion, returnFocusTo]);
  useEffect(() => () => { running.current?.cancel(); }, []);
  if (!open && !present) return null;
  return <div ref={body} className={css.disclosureBody} data-reader-process data-reader-process-key={nodeKey} data-ud-motion="reader-process-size"
    aria-hidden={!open} onPointerDown={() => { if (open) onRead(); }} onFocusCapture={() => { if (open) onRead(); }} {...(!open ? { inert: '' } : {})}>
    <div className={framed ? css.processFrame : css.processContents}>{children}</div>
  </div>;
}

/** Inner expand/collapse that stays mounted: same WAAPI height+opacity language as
 *  ProcessFragment, but without the reader selection markers / process framing. */
export function CollapseBody({ open, motion, children, className }: {
  open: boolean; motion: boolean; children: ReactNode; className?: string;
}) {
  const body = useRef<HTMLDivElement>(null);
  const running = useRef<Animation | null>(null);
  const previous = useRef(open);
  const [present, setPresent] = useState(open);
  useLayoutEffect(() => {
    const element = body.current;
    if (!element) return;
    const from = running.current ? element.getBoundingClientRect().height : previous.current ? element.scrollHeight : 0;
    running.current?.cancel();
    running.current = null;
    const changed = previous.current !== open;
    previous.current = open;
    if (open) setPresent(true);
    element.style.height = open ? 'auto' : '0px';
    const target = open ? element.scrollHeight : 0;
    if (!motion || !changed || Math.abs(from - target) < 1) {
      setPresent(open);
      return;
    }
    const animation = element.animate(
      [{ height: `${from}px`, opacity: from < 1 ? 0 : 1 }, { height: `${target}px`, opacity: open ? 1 : 0 }],
      { duration: MOTION.size, easing: EASING, fill: 'both' },
    );
    running.current = animation;
    animation.onfinish = () => {
      if (running.current !== animation) return;
      running.current = null;
      animation.cancel();
      setPresent(open);
    };
  }, [open, motion]);
  useEffect(() => () => { running.current?.cancel(); }, []);
  if (!open && !present) return null;
  return <div ref={body} className={clsx(className, css.collapseBody)} data-ud-motion="reader-collapse-size"
    aria-hidden={!open} {...(!open ? { inert: '' } : {})}>
    {children}
  </div>;
}

/** Mount enter for live-only surfaces (activity bar, jump pill, approval card):
 *  transform/opacity only, no unmount exit. Historical mounts render settled. */
export function MountFade({ mounted, motion, children }: {
  mounted: boolean; motion: boolean; children: (state: { entering: boolean }) => ReactNode;
}) {
  const [systemOK, setSystemOK] = useState(() => !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    && !window.matchMedia('(forced-colors: active)').matches
    && !document.hidden);
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const colors = window.matchMedia('(forced-colors: active)');
    const update = () => setSystemOK(!reduced.matches && !colors.matches && !document.hidden);
    reduced.addEventListener('change', update);
    colors.addEventListener('change', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      reduced.removeEventListener('change', update);
      colors.removeEventListener('change', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, []);
  const motionOn = motion && systemOK;
  // Live arrival only: an already-present mount renders settled (no replay);
  // a fresh mount after the first paint plays the 220ms enter.
  const [present, setPresent] = useState(mounted);
  const [entering, setEntering] = useState(false);
  const live = useRef(mounted);
  useLayoutEffect(() => {
    if (mounted === live.current) return;
    live.current = mounted;
    if (mounted) {
      setPresent(true);
      if (motionOn) setEntering(true);
    } else {
      setPresent(false);
      setEntering(false);
    }
  }, [mounted, motionOn]);
  useEffect(() => {
    if (!entering) return;
    const timer = window.setTimeout(() => setEntering(false), MOTION.swap + 40);
    return () => window.clearTimeout(timer);
  }, [entering]);
  if (!present) return null;
  if (!motionOn) return <>{children({ entering: false })}</>;
  return <>{children({ entering })}</>;
}

/** Retire only narration that was actually visible; historical rows stay folded. */
export function RetiringContent({ visible, children }: { visible: boolean; children: ReactNode }) {
  const { enabled } = useContext(StreamMotionContext);
  const root = useRef<HTMLDivElement>(null);
  const animation = useRef<Animation | null>(null);
  const [present, setPresent] = useState(visible);
  const [focusHeld, setFocusHeld] = useState(false);
  useLayoutEffect(() => {
    const element = root.current;
    if (visible) {
      animation.current?.cancel(); animation.current = null;
      setPresent(true);
      return;
    }
    if (!element) return;
    if (element.contains(document.activeElement)) { setFocusHeld(true); return; }
    if (focusHeld) return;
    const from = element.getBoundingClientRect().height;
    animation.current?.cancel(); animation.current = null;
    if (!enabled || from < 1) { setPresent(false); return; }
    const next = element.animate([{ height: `${from}px`, opacity: 1 }, { height: '0px', opacity: 0 }], { duration: MOTION.size, easing: EASING, fill: 'both' });
    animation.current = next;
    next.onfinish = () => { if (animation.current === next) { animation.current = null; next.cancel(); setPresent(false); } };
  }, [visible, enabled, focusHeld]);
  useEffect(() => () => animation.current?.cancel(), []);
  if (!visible && !present) return null;
  return <div ref={root} className={css.retiringContent} data-reader-retiring={visible ? 'visible' : 'retiring'} data-ud-motion="reader-progress-retire"
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocusHeld(false); }}>
    {children}
  </div>;
}

// DOM-only behavior: the native Session remains the sole source of business data.

/** `transition: width` needs explicit pixel values — `auto` never animates.
 *  Track one element's rendered content width so the caller can pin it as an
 *  explicit width on the animating container and let CSS interpolate between
 *  content sizes. The ref callback keeps the observer attached for the node's
 *  whole lifetime (React 18 ref callbacks cannot return cleanup functions). */
export function useContentWidth(): [(node: HTMLElement | null) => void, number | null] {
  const [width, setWidth] = useState<number | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const track = useCallback((node: HTMLElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!node) return;
    const observer = new ResizeObserver(entries => {
      const entry = entries[entries.length - 1];
      if (!entry) return;
      // Sub-pixel width reports would re-render (and re-target the width
      // transition) every frame: the pinned bar width changes the flex
      // container, the observer fires again, and the loop never settles.
      // Only a real change (>0.5px) is a new width.
      setWidth(previous => previous !== null && Math.abs(previous - entry.contentRect.width) < 0.5
        ? previous
        : entry.contentRect.width);
    });
    observer.observe(node);
    observerRef.current = observer;
  }, []);
  useEffect(() => () => observerRef.current?.disconnect(), []);
  return [track, width];
}

export function useReadingScroll(root: RefObject<HTMLElement>, motion: boolean, sessionId?: string): { detached: boolean; jump: () => void } {
  const port = useRef<HTMLElement | null>(null);
  const following = useRef(true);
  const [detached, setDetached] = useState(false);
  useLayoutEffect(() => {
    const content = root.current;
    if (!content) return;
    const scroll = content.closest<HTMLElement>('[data-conversation-scroll]') ?? content;
    port.current = scroll;
    let followFrame = 0;
    let lastFrameAt = 0;
    let lastWrittenTop: number | null = null;
    // ResizeObserver runs after layout. Cache geometry there rather than
    // asking for scrollHeight/clientHeight again in every animation frame.
    let maxTop = Math.max(0, scroll.scrollHeight - scroll.clientHeight);
    let currentTop = scroll.scrollTop;
    const measure = () => { maxTop = Math.max(0, scroll.scrollHeight - scroll.clientHeight); currentTop = scroll.scrollTop; };
    // A downward reader gesture (wheel / key / touch / scrollbar drag) that
    // is still pending. It survives scroll events that land outside the
    // bottom surface — a smooth scroll, fling or long drag emits a run of
    // events, and the one that crosses into the surface is what resumes
    // follow. An upward gesture supersedes it; settling at the surface
    // consumes it. (An upward pass that lands inside the surface gap, or a
    // scroll-anchoring event without any reader gesture, holds the current
    // intent instead of re-pinning — the snap-back bug.)
    let wantDown = false;
    let touchY: number | null = null;
    let pointerY: number | null = null;
    const selected = () => {
      const selection = document.getSelection();
      return selection && !selection.isCollapsed && selection.anchorNode && content.contains(selection.anchorNode);
    };
    const focused = () => {
      const active = document.activeElement;
      if (!active || !(active instanceof HTMLElement) || active === document.body || !content.contains(active)) return false;
      // Only a text-editing surface is a "reading guard." Incidental focus on a
      // control the reader merely clicked or keyboard-tabbbed (a disclosure, a
      // process/tool tab, the scrollable thinking card) must NOT pause follow —
      // that silent stall is what left the viewport off the bottom and surfaced
      // the jump dock at turn end with a real offset (the reader has no text
      // inputs, so in practice this rarely fires). Explicit scroll intent is
      // still captured by the wheel / key / touch / pointer handlers below.
      return active.isContentEditable
        || active.matches('textarea, input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"])');
    };
    const releaseFollow = () => {
      cancelAnimationFrame(followFrame); followFrame = 0;
      if (following.current) { following.current = false; setDetached(true); }
    };
    const onScroll = () => {
      currentTop = scroll.scrollTop;
      // Our easing frames must not be mistaken for a reader leaving the bottom.
      if (lastWrittenTop !== null && Math.abs(currentTop - lastWrittenTop) < 1) return;
      const atSurface = maxTop - currentTop < READING_SURFACE_GAP;
      const next = readingScrollAction(following.current, wantDown, atSurface);
      wantDown = next.wantDown;
      if (next.following !== following.current) {
        following.current = next.following;
        if (!next.following) releaseFollow();
      }
      // Any reader-caused scroll resyncs the pill: a detached reader who has
      // scrolled by hand is seen as reading, and a guard-hold pill clears the
      // moment the reader moves (the guard exit is the jump button itself).
      setDetached(!following.current);
    };
    const onWheel = (event: WheelEvent) => {
      // The wheel takes the scroll over from our easing frames; the down
      // gesture records intent, the up gesture leaves the bottom explicitly
      // before the position is even known.
      cancelAnimationFrame(followFrame); followFrame = 0; lastWrittenTop = null;
      if (event.deltaY < 0) { wantDown = false; releaseFollow(); }
      else if (event.deltaY > 0) wantDown = true;
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && event.target.closest('textarea,input,[contenteditable=true]')) return;
      if (['PageUp', 'Home', 'ArrowUp'].includes(event.key)) {
        cancelAnimationFrame(followFrame); followFrame = 0; lastWrittenTop = null;
        wantDown = false; releaseFollow();
        return;
      }
      // Downward keys count only when no focused control in the reader is
      // about to handle them (Space on a button toggles it, not the scroll).
      if (event.target instanceof HTMLElement && event.target.closest('button,a,select,summary,[role="button"],[role="switch"]')) return;
      if (['PageDown', 'End', 'ArrowDown', ' '].includes(event.key)) wantDown = true;
    };
    const onTouchStart = (event: TouchEvent) => { touchY = event.touches[0]?.clientY ?? null; };
    const onTouchMove = (event: TouchEvent) => {
      const y = event.touches[0]?.clientY;
      if (touchY === null || y === undefined) return;
      const dy = y - touchY;
      if (dy > 1) { wantDown = false; releaseFollow(); }
      else if (dy < -1) wantDown = true;
      touchY = y;
    };
    const onTouchEnd = () => { touchY = null; };
    // A scrollbar drag emits no wheel events at all — only scroll events. A
    // press that lands on the scroller itself is a scrollbar grab (content
    // presses target children, so selection or control clicks never count
    // as scroll gestures).
    const onPointerDown = (event: PointerEvent) => {
      if (event.target !== scroll) return;
      pointerY = event.clientY;
    };
    const onPointerMove = (event: PointerEvent) => {
      if (pointerY === null) return;
      const dy = event.clientY - pointerY;
      if (dy > 1) { wantDown = false; releaseFollow(); }
      else if (dy < -1) wantDown = true;
      pointerY = event.clientY;
    };
    const onPointerEnd = () => { pointerY = null; };
    const writeTop = (top: number) => {
      scroll.scrollTop = Math.max(0, Math.min(maxTop, top));
      currentTop = scroll.scrollTop; lastWrittenTop = currentTop;
    };
    const follow = (now: number) => {
      followFrame = 0;
      if (!following.current || selected() || focused()) return;
      const gap = maxTop - currentTop;
      const delta = Math.min(48, Math.max(1, now - lastFrameAt));
      lastFrameAt = now;
      if (!motion || Math.abs(gap) < 1.5) { writeTop(maxTop); setDetached(false); return; }
      writeTop(currentTop + gap * (1 - Math.exp(-delta / 52)));
      followFrame = requestAnimationFrame(follow);
    };
    const firstFrame = requestAnimationFrame(() => {
      measure();
      const saved = sessionId ? recallPosition(sessionId) : null;
      const anchor = saved ? content.querySelector<HTMLElement>(`[data-reader-key="${CSS.escape(saved.anchorKey)}"]`) : null;
      if (saved && anchor) {
        writeTop(currentTop + anchor.getBoundingClientRect().top - scroll.getBoundingClientRect().top - saved.offset);
        following.current = false;
        setDetached(true);
      } else if (following.current && !selected()) writeTop(maxTop);
    });
    const observer = new ResizeObserver(() => {
      measure();
      const action = readingFollowAction(
        { selected: !!selected(), focused: focused() },
        following.current,
        maxTop - currentTop,
      );
      if (action === 'follow') {
        if (!motion) writeTop(maxTop);
        else if (!followFrame) { lastFrameAt = performance.now(); followFrame = requestAnimationFrame(follow); }
      } else if (action === 'surface') {
        // A reading guard is holding follow while the reader still claims the
        // bottom. Without this the pause is silent until the reader scrolls
        // by hand — and the jump pill is the guard's only visible exit.
        setDetached(true);
      }
      // Detached stabilization is intentionally not applied here: the host
      // scroll container's native scroll anchoring already keeps the reader
      // in place during async layout/content-visibility changes, and a second
      // manual anchor adjustment is what caused sudden jumps while scrolling
      // back through completed turns.
    });
    observer.observe(content);
    if (scroll !== content) observer.observe(scroll);
    scroll.addEventListener('scroll', onScroll, { passive: true });
    scroll.addEventListener('wheel', onWheel, { passive: true });
    scroll.addEventListener('keydown', onKey);
    scroll.addEventListener('touchstart', onTouchStart, { passive: true });
    scroll.addEventListener('touchmove', onTouchMove, { passive: true });
    scroll.addEventListener('touchend', onTouchEnd, { passive: true });
    scroll.addEventListener('touchcancel', onTouchEnd, { passive: true });
    scroll.addEventListener('pointerdown', onPointerDown);
    scroll.addEventListener('pointermove', onPointerMove, { passive: true });
    scroll.addEventListener('pointerup', onPointerEnd);
    scroll.addEventListener('pointercancel', onPointerEnd);
    return () => {
      if (sessionId) {
        if (following.current) rememberPosition(sessionId, null);
        else {
          const viewportTop = scroll.getBoundingClientRect().top;
          const anchors = Array.from(content.querySelectorAll<HTMLElement>('[data-reader-key]'), element => {
            const rect = element.getBoundingClientRect();
            return { key: element.dataset.readerKey!, top: rect.top, bottom: rect.bottom };
          });
          rememberPosition(sessionId, pickAnchor(anchors, viewportTop));
        }
      }
      cancelAnimationFrame(firstFrame); cancelAnimationFrame(followFrame); observer.disconnect();
      scroll.removeEventListener('scroll', onScroll); scroll.removeEventListener('wheel', onWheel);
      scroll.removeEventListener('keydown', onKey);
      scroll.removeEventListener('touchstart', onTouchStart); scroll.removeEventListener('touchmove', onTouchMove);
      scroll.removeEventListener('touchend', onTouchEnd); scroll.removeEventListener('touchcancel', onTouchEnd);
      scroll.removeEventListener('pointerdown', onPointerDown); scroll.removeEventListener('pointermove', onPointerMove);
      scroll.removeEventListener('pointerup', onPointerEnd); scroll.removeEventListener('pointercancel', onPointerEnd);
    };
  }, [root, motion, sessionId]);
  return { detached, jump: () => {
    // "Back to latest" is an explicit resume: clear the reading guards that
    // live inside the reader, or the next content growth silently re-stalls
    // follow against them — a text selection survives a button click by
    // design, so without this the pill recursed the exact bug it promised
    // to fix. Guards owned outside the reader (composer focus, a selection
    // elsewhere) are left alone.
    const selection = document.getSelection();
    if (selection && !selection.isCollapsed && selection.anchorNode && root.current?.contains(selection.anchorNode)) selection.removeAllRanges();
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body && root.current?.contains(active)) active.blur();
    following.current = true; setDetached(false);
    port.current?.scrollTo({ top: port.current.scrollHeight, behavior: 'instant' });
  } };
}
