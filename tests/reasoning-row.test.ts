import './support/dom.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { render } from './support/render.ts';
import { ReasoningRow, formatThinkingSeconds, reasoningPreview, scrollMetrics } from '../src/client/ReasoningRow.tsx';

const base = { step: 3, follow: true, motion: true, selected: false, onRead: () => {}, durationMs: 6000, startedAt: null, charCount: 120, preview: '先看工作区。', children: createElement('span', null, '原文') };

test('thinking seconds read naturally', () => {
  assert.equal(formatThinkingSeconds(0), '不到 1 秒');
  assert.equal(formatThinkingSeconds(42), '42 秒');
  assert.equal(formatThinkingSeconds(120), '2 分钟');
  assert.equal(formatThinkingSeconds(135), '2 分 15 秒');
});

test('the preview is the first sentence of the first line', () => {
  assert.equal(reasoningPreview('  我会先查看工作区。然后搭建场景。\n第二行'), '我会先查看工作区。');
  assert.equal(reasoningPreview('no terminator here'), 'no terminator here');
  assert.equal(reasoningPreview('a'.repeat(100)).length, 80);
});

test('live thinking spins, sweeps its title and shows the live inset', () => {
  const html = render(ReasoningRow, { ...base, live: true, compact: false });
  assert.match(html, /data-stub="StateDot" data-state="ongoing"/);
  assert.match(html, /data-stub="TextShimmer" data-active="true"[^>]*>思考中/);
  assert.match(html, /data-live="true"/);
  assert.match(html, /data-reader-reasoning-text[^>]*><span>原文<\/span>/);
});

test('with 折叠思考 on, live thinking is also a single row: spinner and title, no inset', () => {
  const html = render(ReasoningRow, { ...base, live: true, compact: true });
  assert.match(html, /data-stub="StateDot" data-state="ongoing"/);
  assert.match(html, /data-stub="TextShimmer" data-active="true"[^>]*>思考中/);
  assert.doesNotMatch(html, /data-reader-reasoning-card|data-reader-reasoning-text/);
});

test('settled thinking is always a single row with its duration and preview, in either mode', () => {
  for (const compact of [true, false]) {
    const html = render(ReasoningRow, { ...base, live: false, compact });
    assert.match(html, /思考了 6 秒/, `compact=${compact}`);
    assert.match(html, /先看工作区。/, `compact=${compact}`);
    assert.doesNotMatch(html, /data-reader-reasoning-card|data-preview|data-reader-reasoning-text/, `compact=${compact}`);
    assert.match(html, /aria-expanded="false"/, `compact=${compact}`);
  }
});

test('follow metrics use the real scroll extent, padding included', () => {
  // 8px top + 8px bottom padding live inside the scroll extent: 100px of text in a 128px port is 116px, no overflow.
  assert.deepEqual(scrollMetrics({ scrollHeight: 116, clientHeight: 128 }), { tail: 0, overflow: false });
  assert.deepEqual(scrollMetrics({ scrollHeight: 129, clientHeight: 128 }), { tail: 1, overflow: false });
  assert.deepEqual(scrollMetrics({ scrollHeight: 300, clientHeight: 128 }), { tail: 172, overflow: true });
});
