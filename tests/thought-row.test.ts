import './support/dom.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { formatThinkingSeconds, thoughtLabel, ThoughtRow } from '../src/client/ThoughtRow.tsx';

test('labels', () => {
  assert.equal(thoughtLabel(41_000), '思考了 41 秒');
  assert.equal(thoughtLabel(400), '思考了不到 1 秒');
  assert.equal(thoughtLabel(125_000), '思考了 2 分 5 秒');
  assert.equal(thoughtLabel(null), '思考');
  assert.equal(formatThinkingSeconds(120), '2 分钟');
});

test('an opened latest-step thought can follow, while historical thoughts do not', () => {
  const render = (follow: boolean) => renderToStaticMarkup(createElement(ThoughtRow,
    { durationMs: null, motion: true, onRead: () => {}, initialOpen: true, follow }, 'complete reasoning'));
  assert.match(render(true), /data-following="true"/);
  assert.match(render(false), /data-following="false"/);
  assert.doesNotMatch(render(true), /data-reader-live-thought/);
});

test('closed by default, no preview or character count; opened shows the text', () => {
  const closed = renderToStaticMarkup(createElement(ThoughtRow, { durationMs: 41_000, motion: true, onRead: () => {} }, 'The user wants a scene'));
  assert.match(closed, /data-reader-reasoning/);
  assert.match(closed, /aria-expanded="false"/);
  assert.doesNotMatch(closed, /字/);
  const open = renderToStaticMarkup(createElement(ThoughtRow, { durationMs: 41_000, motion: true, onRead: () => {}, initialOpen: true }, 'The user wants a scene'));
  assert.match(open, /data-reader-reasoning-text[\s\S]*The user wants a scene/);
  assert.match(open, /data-reader-reasoning-scroll/);
  assert.doesNotMatch(open, /data-reader-live-thought/);
});
