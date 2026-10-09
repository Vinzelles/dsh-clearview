import './support/dom.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { UserBubble, UserBubbleView } from '../src/client/UserBubble.tsx';

test('bubble carries the anchor attributes, the label first, and starts unclamped on the server', () => {
  const html = renderToStaticMarkup(createElement(UserBubble, { label: '补充消息', small: true, data: { 'data-reader-anchor': true, 'data-reader-key': 'k1' } }, '再快一点'));
  assert.match(html, /data-reader-user-bubble[^>]*data-small="true"/);
  assert.match(html, /data-reader-anchor="true"[^>]*data-reader-key="k1"|data-reader-key="k1"[^>]*data-reader-anchor="true"/);
  assert.match(html, /data-reader-user-bubble[^>]*>\s*<p[^>]*>补充消息<\/p>/);
  assert.doesNotMatch(html, /展开全文/);
});

test('the expand toggle sits outside the seat element so copying never includes it', () => {
  for (const open of [false, true]) {
    const html = renderToStaticMarkup(createElement(UserBubbleView, { clamped: true, open, onToggle: () => {}, small: false, data: { 'data-reader-anchor': true, 'data-reader-key': 'k1' } }, '很长的消息'));
    const seat = /<div class="bubble"[^>]*data-reader-anchor[\s\S]*?<\/div><\/div>/.exec(html)?.[0] ?? '';
    assert.match(seat, /很长的消息/);
    assert.doesNotMatch(seat, /展开全文|收起|<button/);
    assert.match(html, open ? /<\/div><button[^>]*>收起<\/button>/ : /<\/div><button[^>]*>展开全文<\/button>/);
  }
});
