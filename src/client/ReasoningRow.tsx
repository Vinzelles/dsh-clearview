import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  StateDot, TextShimmer,
  IconFullscreenOutlineRegular, IconPauseOutlineRegular, IconPlayOutlineRegular, IconThinkOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives';
import { CollapseBody } from './motion.js';
import { followAdvance } from './reasoning-follow.js';
import { MOTION } from './motion-tokens.js';
import { RowSeparator } from './ProcessRow.js';
import css from './ReasoningRow.module.css';

export function formatThinkingSeconds(seconds: number): string {
  if (seconds < 1) return '不到 1 秒';
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes} 分 ${rest} 秒` : `${minutes} 分钟`;
}

/** First sentence of the first line, for the collapsed row. Never rewrites the text. */
export function reasoningPreview(text: string, limit = 80): string {
  const first = text.trim().split(/\n+/)[0] ?? '';
  const sentence = /^(.+?[。！？!?])/.exec(first)?.[1] ?? first;
  const value = sentence.trim();
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}

/** Real scroll extent of the viewport (its own padding included): where following ends, and whether it overflows. */
export function scrollMetrics(port: { scrollHeight: number; clientHeight: number }): { tail: number; overflow: boolean } {
  return { tail: Math.max(0, port.scrollHeight - port.clientHeight), overflow: port.scrollHeight > port.clientHeight + 1 };
}

export interface ReasoningRowProps {
  children: ReactNode;
  step: number;
  /** This segment is still streaming. */
  live: boolean;
  /** The turn is open and this is its latest step: eligible for auto-follow. */
  follow: boolean;
  motion: boolean;
  selected: boolean;
  onRead: () => void;
  /** 折叠思考 on: live thinking is a single row too (settled thinking is always one). */
  compact: boolean;
  durationMs: number | null;
  startedAt: number | null;
  charCount: number;
  preview: string;
}

export function ReasoningRow({ children, step, live, follow, motion, selected, onRead, compact, durationMs, startedAt, charCount, preview }: ReasoningRowProps) {
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const viewportId = useId();
  const [manual, setManual] = useState<'open' | 'closed' | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [following, setFollowing] = useState(true);
  const [overflow, setOverflow] = useState(false);
  const [edges, setEdges] = useState('none');
  const [now, setNow] = useState(() => Date.now());
  const [frozenSeconds, setFrozenSeconds] = useState<number | null>(null);
  const lastLiveSeconds = useRef<number | null>(null);
  const previousLive = useRef(false);
  const lastHeight = useRef(0);
  const resize = useRef<Animation | null>(null);
  const previousExpanded = useRef(expanded);
  const stopFollow = useRef<() => void>(() => {});
  const finishRef = useRef<{ cancel: () => void } | null>(null);
  const lastTop = useRef(0);
  const followSeeded = useRef(false);
  // Settled thinking is a single row until it is opened; live thinking shows its inset unless 折叠思考 is on.
  const open = manual === null ? live && !compact : manual === 'open';
  const inflated = open && expanded;
  const allowed = open && following && follow && motion && !selected;

  useEffect(() => {
    if (!live || startedAt == null) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [live, startedAt]);

  useEffect(() => {
    if (live) { setFrozenSeconds(null); previousLive.current = true; return; }
    if (previousLive.current && lastLiveSeconds.current != null) setFrozenSeconds(lastLiveSeconds.current);
    previousLive.current = false;
  }, [live]);

  const pause = useCallback(() => {
    stopFollow.current();
    setFollowing(false);
    onRead();
  }, [onRead]);

  useLayoutEffect(() => {
    if (!selected) return;
    stopFollow.current();
    setFollowing(false);
  }, [selected]);

  useLayoutEffect(() => {
    const port = viewport.current;
    const host = port?.closest<HTMLElement>('[data-conversation-scroll]');
    if (!port || !host) return;
    const fit = () => {
      const composer = parseFloat(getComputedStyle(host).getPropertyValue('--dsh-composer-height')) || 152;
      const available = Math.max(120, host.clientHeight - composer - 64);
      port.style.setProperty('--reason-reading-height', `${available}px`);
    };
    fit();
    const observer = new ResizeObserver(fit); observer.observe(host);
    const attributes = new MutationObserver(fit);
    attributes.observe(host, { attributes: true, attributeFilter: ['style'] });
    return () => { observer.disconnect(); attributes.disconnect(); };
  }, [expanded, open]);

  useLayoutEffect(() => {
    if (!open && expanded) setExpanded(false);
  }, [open, expanded]);

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
    const hasSelection = () => {
      const selection = document.getSelection();
      return !!selection && !selection.isCollapsed && !!selection.anchorNode && text.contains(selection.anchorNode);
    };
    const cancel = () => { cancelAnimationFrame(frame); frame = 0; delete port.dataset.reasoningMoving; };
    const paint = (pos: number) => { port.scrollTop = pos; lastTop.current = port.scrollTop; };
    const edgesFor = (pos: number, end: number) => {
      const top = pos > 1;
      const bottom = end - pos > 1;
      const next = top ? bottom ? 'both' : 'top' : bottom ? 'bottom' : 'none';
      setEdges(value => value === next ? value : next);
    };
    const refresh = (recordHeight = true) => {
      clientHeight = port.clientHeight;
      const metrics = scrollMetrics(port);
      tail = metrics.tail;
      setOverflow(metrics.overflow);
      edgesFor(tracking ? state.pos : port.scrollTop, tail);
      if (recordHeight && !resize.current) lastHeight.current = clientHeight;
    };
    stopFollow.current = () => { finishRef.current?.cancel(); cancel(); tracking = false; };
    const canFollow = () => allowed && alive && !document.hidden && !hasSelection();
    const loop = (time: number) => {
      frame = 0;
      if (!canFollow()) { cancel(); return; }
      const next = followAdvance(state, tail, time);
      state = next;
      paint(next.pos);
      edgesFor(next.pos, tail);
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
      if ((tracking || finishRef.current) && Math.abs(port.scrollTop - lastTop.current) > 1) pause();
      else if (!tracking && !finishRef.current) edgesFor(port.scrollTop, tail);
    };
    const onWheel = () => { if (tracking || finishRef.current) pause(); };
    const onSelection = () => { if (hasSelection()) pause(); };
    const onVisibility = () => { if (!document.hidden && canFollow()) run(); };
    const observer = new ResizeObserver(() => { refresh(); if (tracking) run(); });
    observer.observe(text); observer.observe(port);
    port.addEventListener('scroll', onScroll, { passive: true });
    port.addEventListener('wheel', onWheel, { passive: true });
    document.addEventListener('selectionchange', onSelection);
    document.addEventListener('visibilitychange', onVisibility);
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
          edgesFor(next.pos, end);
          if (next.settled) { finishRef.current = null; return; }
          glideFrame = requestAnimationFrame(glide);
        };
        glideFrame = requestAnimationFrame(glide);
      }
    };
  }, [allowed, pause, open]);

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
    if (!changed || !motion || from < 1 || Math.abs(target - from) < 1) { lastHeight.current = target; return; }
    port.style.maxHeight = 'none';
    const animation = port.animate([{ height: `${from}px` }, { height: `${target}px` }], { duration: MOTION.size, easing: MOTION.ease, fill: 'both' });
    resize.current = animation;
    animation.onfinish = () => {
      if (resize.current !== animation) return;
      resize.current = null; animation.cancel();
      port.style.maxHeight = ''; port.style.height = '';
      lastHeight.current = port.clientHeight;
    };
  }, [expanded, motion, selected]);
  useEffect(() => () => resize.current?.cancel(), []);

  if (live && startedAt != null) lastLiveSeconds.current = Math.max(1, Math.floor((now - startedAt) / 1000));
  const liveSeconds = live && startedAt != null ? lastLiveSeconds.current : null;
  const summarySeconds = liveSeconds ?? frozenSeconds ?? (durationMs != null ? Math.max(0, Math.round(durationMs / 1000)) : null);
  const title = live ? '思考中' : summarySeconds !== null ? `思考了 ${formatThinkingSeconds(summarySeconds)}` : '思考';
  const toggle = () => {
    onRead();
    if (open) { setManual('closed'); setExpanded(false); } else setManual('open');
  };

  return <div className={css.reasoning} data-reader-reasoning data-reader-anchor>
    <button type="button" className={css.row} aria-expanded={open} aria-controls={viewportId} onClick={toggle} data-reader-reasoning-row>
      <span className={css.icon} aria-hidden="true">{live ? <StateDot state="ongoing" size={12} /> : <IconThinkOutlineRegular size={14} />}</span>
      <TextShimmer active={live && motion} className={css.title}>{title}</TextShimmer>
      {!open && preview && <><RowSeparator /><span className={css.preview}>{preview}</span></>}
      <span className={css.end}>{liveSeconds !== null ? `已 ${liveSeconds} 秒` : `${charCount} 字`}</span>
    </button>
    <CollapseBody open={open} motion={motion}><div className={css.inset} data-reader-reasoning-card data-live={live || undefined}
      data-expanded={inflated || undefined} data-following={allowed} data-overflow={overflow}>
      <div ref={viewport} id={viewportId} className={css.viewport} data-edges={edges} data-reader-reasoning-scroll role="region"
        aria-label={`步骤 ${step} 的思考${overflow ? '，可滚动阅读' : ''}`} tabIndex={overflow ? 0 : undefined}
        onPointerDown={pause} onFocus={pause}>
        <div ref={content} className={css.text} data-reader-reasoning-text>{children}</div>
      </div>
      {(overflow || expanded) && <div className={css.controls}>
        {follow && motion && <button type="button" className={css.control} disabled={selected}
          aria-label={following ? '暂停自动跟随思考' : '继续跟随最新思考'} title={selected ? '取消文字选择后可继续跟随' : following ? '暂停跟随' : '跟随最新'}
          onClick={() => { if (following) pause(); else { onRead(); setFollowing(true); } }}>
          {following ? <IconPauseOutlineRegular size={12} /> : <IconPlayOutlineRegular size={12} />}
        </button>}
        <button type="button" className={css.control} aria-expanded={expanded} aria-controls={viewportId}
          aria-label={expanded ? '收起完整思考' : '展开阅读完整思考'} title={expanded ? '收起' : '展开阅读'}
          onClick={() => { onRead(); setExpanded(value => !value); }}>
          <IconFullscreenOutlineRegular size={12} />
        </button>
      </div>}
    </div></CollapseBody>
  </div>;
}
