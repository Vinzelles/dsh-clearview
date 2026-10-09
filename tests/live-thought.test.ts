import './support/dom.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
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
