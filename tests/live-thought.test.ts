import './support/dom.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LiveThought, scrollMetrics } from '../src/client/LiveThought.tsx';

test('scroll metrics are unchanged', () => {
  assert.deepEqual(scrollMetrics({ scrollHeight: 300, clientHeight: 100 }), { tail: 200, overflow: true });
  assert.deepEqual(scrollMetrics({ scrollHeight: 100, clientHeight: 100 }), { tail: 0, overflow: false });
});

test('renders a following viewport with the text and no resume button', () => {
  const html = renderToStaticMarkup(createElement(LiveThought, { follow: true, motion: true }, 'Hmm, the 围脊 boxes'));
  assert.match(html, /data-reader-live-thought[^>]*data-following="true"/);
  assert.match(html, /data-reader-reasoning-scroll[\s\S]*Hmm, the 围脊 boxes/);
  assert.doesNotMatch(html, /继续跟随/);
});

test('reduced motion keeps following (no resume button) and the viewport is a named region', () => {
  const html = renderToStaticMarkup(createElement(LiveThought, { follow: true, motion: false }, 'text'));
  assert.match(html, /data-reader-live-thought[^>]*data-following="true"/);
  assert.doesNotMatch(html, /继续跟随/);
  assert.match(html, /role="region"/);
  assert.match(html, /aria-label="思考内容"/);
});

// A deterministic hook/effect driver supplies the two owned DOM refs and scroll events.
// It exercises the real component's callbacks, effect cleanup and context updates.
function thoughtInteraction(motion = false) {
  const internals = (React as any).__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;
  const slots: any[] = [];
  let cursor = 0;
  let signal = 0;
  let follow = true;
  let selected = false;
  let effects: (() => void)[] = [];
  const listeners = new Map<string, () => void>();
  const text = { contains: (node: unknown) => node === text };
  const port = {
    scrollTop: 0, scrollHeight: 300, clientHeight: 100, dataset: {}, isConnected: true,
    addEventListener: (name: string, callback: () => void) => listeners.set(name, callback),
    removeEventListener: (name: string) => listeners.delete(name),
  };
  const dispatcher = {
    useContext: () => ({ motion, resumeSignal: signal }),
    useRef(initial: unknown) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useState(initial: unknown) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], (next: unknown) => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }];
    },
    useId: () => 'thought-detail',
    useCallback(callback: unknown, deps: unknown[]) {
      const i = cursor++;
      if (!slots[i] || !deps.every((dep, index) => Object.is(dep, slots[i].deps[index]))) slots[i] = { callback, deps };
      return slots[i].callback;
    },
    useLayoutEffect(effect: () => void | (() => void), deps: unknown[]) {
      const i = cursor++;
      const old = slots[i];
      if (old && deps.every((dep, index) => Object.is(dep, old.deps[index]))) return;
      effects.push(() => { old?.cleanup?.(); slots[i] = { deps, cleanup: effect() }; });
    },
  };
  const frames = new Map<number, FrameRequestCallback>();
  let frameId = 0;
  let time = performance.now();
  const oldFrame = globalThis.requestAnimationFrame;
  const oldCancel = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = callback => { frames.set(++frameId, callback); return frameId; };
  globalThis.cancelAnimationFrame = id => { frames.delete(id); };
  const oldSelection = document.getSelection;
  const oldObserver = globalThis.ResizeObserver;
  document.getSelection = (() => selected ? { isCollapsed: false, anchorNode: text, focusNode: text, rangeCount: 0 } : null) as never;
  globalThis.ResizeObserver = class { observe() {} disconnect() {} } as never;
  const render = () => {
    cursor = 0; effects = [];
    const previous = internals.ReactCurrentDispatcher.current;
    internals.ReactCurrentDispatcher.current = dispatcher;
    let row;
    try { row = LiveThought({ follow, motion, children: 'streaming thought' }); }
    finally { internals.ReactCurrentDispatcher.current = previous; }
    const viewport = row.props.children[0];
    viewport.ref.current = port;
    viewport.props.children.ref.current = text;
    effects.forEach(effect => effect());
    return { following: row.props['data-following'], pause: viewport.props.onPointerDown, focus: viewport.props.onFocus, resume: row.props.children[1]?.props?.onClick };
  };
  return {
    render, port, listeners,
    tick: () => {
      time += 16;
      const callbacks = [...frames.values()]; frames.clear();
      callbacks.forEach(callback => callback(time));
    },
    pendingFrames: () => frames.size,
    select: (value: boolean) => { selected = value; },
    signal: () => { signal++; render(); return render(); },
    follow: (value: boolean) => { follow = value; return render(); },
    dispose: () => {
      for (const slot of slots) slot?.cleanup?.();
      globalThis.requestAnimationFrame = oldFrame;
      globalThis.cancelAnimationFrame = oldCancel;
      document.getSelection = oldSelection;
      globalThis.ResizeObserver = oldObserver;
    },
  };
}

test('page resume signal restores a locally paused thought and reduced-motion tail following', () => {
  const thought = thoughtInteraction();
  try {
    thought.render().pause();
    assert.equal(thought.render().following, false);
    thought.port.scrollTop = 25;
    assert.equal(thought.signal().following, true);
    assert.equal(thought.port.scrollTop, 200);
    thought.render().focus();
    assert.equal(thought.render().following, false, 'same context generation does not undo new reading intent');
    assert.equal(thought.signal().following, true, 'a second explicit request resumes again');
    assert.equal(thought.follow(false).following, false, 'external follow permission is still required');
  } finally { thought.dispose(); }
});

test('both resume controls respect an active selection and selection release alone does not resume', () => {
  const thought = thoughtInteraction();
  try {
    thought.render().pause();
    thought.render();
    thought.port.scrollTop = 30;
    thought.select(true);
    assert.equal(thought.signal().following, false);
    thought.render().resume();
    assert.equal(thought.render().following, false);
    assert.equal(thought.port.scrollTop, 30);
    thought.select(false);
    assert.equal(thought.render().following, false);
    thought.render().resume();
    assert.equal(thought.render().following, true);
    assert.equal(thought.port.scrollTop, 200);
  } finally { thought.dispose(); }
});

test('animated follow pauses on wheel, resumes on a new generation and cancels its frames on cleanup', () => {
  const thought = thoughtInteraction(true);
  try {
    thought.render();
    thought.listeners.get('wheel')!();
    assert.equal(thought.render().following, false);
    assert.equal(thought.pendingFrames(), 0);
    thought.port.scrollTop = 20;
    assert.equal(thought.signal().following, true);
    assert.equal(thought.pendingFrames(), 1);
    for (let i = 0; i < 120; i++) thought.tick();
    assert.ok(thought.port.scrollTop > 199, 'the resumed animation reaches the latest text');
    thought.render().pause();
    assert.equal(thought.render().following, false);
    assert.equal(thought.pendingFrames(), 0);
  } finally { thought.dispose(); }
  assert.equal(thought.pendingFrames(), 0);
});
