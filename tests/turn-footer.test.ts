import './support/dom.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReaderActionsContext, type ReaderActions } from '../src/client/reader-context.ts';
import { TurnFooter } from '../src/client/TurnFooter.tsx';
import { turnLocation } from './support/chat-fixture.ts';

const NOW = new Date(2026, 9, 5, 12, 0);
const footer = (actions: ReaderActions, props: Parameters<typeof TurnFooter>[0]) =>
  renderToStaticMarkup(createElement(ReaderActionsContext.Provider, { value: actions }, createElement(TurnFooter, props)));

function closedTurn(presented: unknown[] = [], tail: Record<string, unknown> = {}) {
  return turnLocation({
    status: 'closed', reason: 'completed', start: new Date(2026, 8, 24, 17, 3, 41).getTime(), end: new Date(2026, 8, 24, 17, 20, 20).getTime(),
    data: {
      'turn-tail': { closing: { step: 2, time: new Date(2026, 8, 24, 17, 20).getTime(), finalNode: { seq: 88 } }, tokenUsage: { totalTokens: 11_400_000 }, ...tail },
      deliverables: { produced: [], presented },
    },
  });
}

test('a finished turn offers copy, fork, delivered files and its meta line', () => {
  const html = footer({ motion: true, fork: async () => {}, openFile: () => {} }, {
    turn: closedTurn([{ path: 'README.md', description: '运行、构建与结构说明', seq: 20, index: 0 }, { path: 'artifacts/scene.png', seq: 21, index: 0 }]),
    answerText: '## 实际验证结果', now: NOW,
  });
  assert.match(html, /aria-label="复制回答"/);
  assert.match(html, /aria-label="从这里分支"/);
  assert.match(html, /9月24日 17:20 · 用时 16分39秒 · 用量 11.4M tok/);
  assert.match(html, /README.md[\s\S]*运行、构建与结构说明/);
  assert.match(html, /scene.png[\s\S]*artifacts\/scene.png/);
});

test('without a fork service or answer text the matching buttons are absent', () => {
  const html = footer({ motion: true }, { turn: closedTurn(), answerText: '   ', now: NOW });
  assert.doesNotMatch(html, /复制回答/);
  assert.doesNotMatch(html, /从这里分支/);
  assert.match(html, /用时 16分39秒/);
});

test('a closing reply that is no longer the transcript tail hides the fork button only', () => {
  const html = footer({ motion: true, fork: async () => {} }, { turn: closedTurn([], { branchUnavailable: true }), answerText: 'x', now: NOW });
  assert.doesNotMatch(html, /从这里分支/);
  assert.match(html, /aria-label="复制回答"/);
});

test('nothing to show renders nothing', () => {
  assert.equal(footer({ motion: true }, { turn: undefined, answerText: '', now: NOW }), '');
});

test('more than four deliveries fold the rest, and cards stay inert without an opener', () => {
  const presented = ['a', 'b', 'c', 'd', 'e'].map((name, index) => ({ path: `${name}.md`, seq: 10 + index, index: 0 }));
  const html = footer({ motion: true }, { turn: closedTurn(presented), answerText: 'x', now: NOW });
  assert.match(html, /展开其余 1 个/);
  assert.doesNotMatch(html, /e\.md/);
  assert.match(html, /<button type="button" class="card" disabled=""/);
});
