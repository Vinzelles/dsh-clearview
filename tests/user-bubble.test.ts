import './support/dom.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { UserBubble, UserBubbleView } from '../src/client/UserBubble.tsx';

test('bubble carries the anchor attributes, the label first, and starts unclamped on the server', () => {
  const html = renderToStaticMarkup(createElement(UserBubble, { label: '补充消息', small: true, data: { 'data-reader-anchor': true, 'data-reader-key': 'k1' } }, '再快一点'));
  assert.match(html, /data-reader-user-bubble[^>]*data-small="true"/);
  assert.match(html, /data-reader-anchor="true"[^>]*data-reader-key="k1"|data-reader-key="k1"[^>]*data-reader-anchor="true"/);
  assert.match(html, /data-reader-user-bubble[^>]*>\s*<p[^>]*>补充消息<\/p>/);
  assert.doesNotMatch(html, /展开全文/);
});

test('the bubble disclosure is an accessible icon controlling its full message', () => {
  for (const open of [false, true]) {
    const html = renderToStaticMarkup(createElement(UserBubbleView, { clamped: true, open, onToggle: () => {}, small: false, data: { 'data-reader-anchor': true, 'data-reader-key': 'k1' } }, '很长的消息'));
    assert.match(html, /很长的消息/);
    assert.match(html, /data-reader-user-surface="true"/);
    assert.match(html, new RegExp(`data-reader-bubble-toggle="true" aria-label="${open ? '收起全文' : '展开全文'}"[^>]*aria-expanded="${open}"`));
    const controls = /aria-controls="([^"]+)"/.exec(html)?.[1];
    assert.ok(controls);
    assert.ok(html.includes(`id="${controls}" class="text" data-reader-user-text="true"`));
    const control = /<button[^>]*data-reader-bubble-toggle[^>]*>([\s\S]*?)<\/button>/.exec(html)?.[1] ?? '';
    assert.match(control, /^<svg[^>]*aria-hidden="true"/);
    assert.doesNotMatch(control, /展开全文|收起/);
  }
});


test('initial clamp measurement waits for RO, still reacts to content/fonts and cleans up; absent RO keeps its fallback', () => {
  const internals = (React as any).__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;
  const previousDispatcher = internals.ReactCurrentDispatcher.current;
  const previousObserver = globalThis.ResizeObserver;
  const doc = document as any, previousFonts = doc.fonts;
  const listeners = new Map<string, () => void>();
  let callback: (() => void) | undefined, reads = 0, disconnected = 0, height = 300;
  const states: unknown[] = [];
  const effects: (() => (() => void) | void)[] = [];
  let cursor = 0;
  const node = { get scrollHeight() { reads++; return height; }, get clientHeight() { reads++; return 144; }, firstElementChild: {} };
  class Observer { constructor(fn: () => void) { callback = fn; } observe() {} disconnect() { disconnected++; } }
  try {
    globalThis.ResizeObserver = Observer as any;
    doc.fonts = { addEventListener: (name: string, fn: () => void) => listeners.set(name, fn), removeEventListener: (name: string) => listeners.delete(name) };
    internals.ReactCurrentDispatcher.current = {
      useRef: () => ({ current: node }),
      useState(initial: unknown) { const index = cursor++; states[index] = initial; return [initial, (value: unknown) => { states[index] = value; }]; },
      useLayoutEffect: (fn: () => (() => void) | void) => effects.push(fn),
    };
    UserBubble({ children: 'long content' });
    const cleanup = effects[0]();
    assert.equal(reads, 0, 'mount commit must not force bubble geometry');
    callback!(); assert.equal(states[0], true);
    height = 40; callback!(); assert.equal(states[0], false);
    height = 350; listeners.get('loadingdone')!(); assert.equal(states[0], true);
    cleanup?.(); assert.equal(disconnected, 1); assert.equal(listeners.size, 0);
    globalThis.ResizeObserver = undefined as any; cursor = 0; effects.length = 0; reads = 0;
    UserBubble({ children: 'fallback' }); effects[0]();
    assert.equal(reads, 2); assert.equal(states[0], true, 'no-RO browsers must retain clamp detection');
  } finally {
    internals.ReactCurrentDispatcher.current = previousDispatcher;
    globalThis.ResizeObserver = previousObserver; doc.fonts = previousFonts;
  }
});
