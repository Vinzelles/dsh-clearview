import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmtCompactTokens, footerTextForTurn, normalizeSnapshot } from '../src/client/compat/turn-metrics-footer.ts';

function chatSnapshot(turns: Map<number, unknown>): Record<string, unknown> {
  return { order: [], nodes: { get: () => undefined, values: () => [] }, timeline: { turnOrder: [1], turns } };
}

function closedTurn(tail: unknown, start = 1000, end = 1793000): unknown {
  return { status: 'closed', start: { time: start }, end: { time: end }, data: new Map([['turn-tail', tail]]) };
}

test('snapshot normalization accepts the 0.1.1 embedded shape with top-level turn timings', () => {
  const turns = new Map();
  const timings = new Map([[1, { startTime: 0, endTime: 65000 }]]);
  const view = normalizeSnapshot({ chat: chatSnapshot(turns), turnTimings: timings, pending: [] });
  assert.ok(view);
  assert.equal(view.chat.timeline.turns, turns);
  assert.equal(view.turnTimings, timings);
});

test('snapshot normalization accepts the 0.1.2 flat chat shape with legacy turn timings', () => {
  const turns = new Map();
  const timings = new Map([[1, { startTime: 0, endTime: 65000 }]]);
  const view = normalizeSnapshot({ ...chatSnapshot(turns), legacy: { turnTimings: timings } });
  assert.ok(view);
  assert.equal(view.chat.timeline.turns, turns);
  assert.equal(view.turnTimings, timings);
});

test('snapshot normalization rejects session slices and garbage', () => {
  assert.equal(normalizeSnapshot(null), null);
  assert.equal(normalizeSnapshot('snap'), null);
  assert.equal(normalizeSnapshot({}), null);
  // 0.1.2 瘦身后的 session 切片：既无内嵌 chat 也无顶层 nodes。
  assert.equal(normalizeSnapshot({ sessionId: 's', openState: 'ready' }), null);
  assert.equal(normalizeSnapshot({ nodes: { get: () => undefined } }), null);
  assert.equal(normalizeSnapshot({ timeline: { turns: new Map() } }), null);
});

test('the footer renders clock, duration, usage, ttft and speed in native order (0.1.2 tokenUsage)', () => {
  const turns = new Map([[1, closedTurn({
    closing: { time: Date.now() },
    ttftMs: 1200,
    tokensPerSecond: 45.4,
    tokenUsage: { totalTokens: 9400000, uncachedInputTokens: 3, outputTokens: 4 },
  })]]);
  const view = normalizeSnapshot(chatSnapshot(turns));
  assert.ok(view);
  const text = footerTextForTurn(view!, 1);
  assert.ok(text);
  assert.ok(text!.includes('用时 29分52秒'), text!);
  assert.ok(text!.includes('用量 9.4M tok'), text!);
  assert.ok(text!.includes('首 token 1.2秒'), text!);
  assert.ok(text!.includes('45 tok/s'), text!);
  const order = ['用时 29分52秒', '用量 9.4M tok', '首 token 1.2秒', '45 tok/s'].map(part => text!.indexOf(part));
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'parts must stay in the documented order');
});

test('0.1.1 tails without tokenUsage render without the usage part', () => {
  const turns = new Map([[1, closedTurn({ closing: { time: Date.now() }, ttftMs: 900 })]]);
  const view = normalizeSnapshot(chatSnapshot(turns));
  const text = footerTextForTurn(view!, 1);
  assert.ok(text);
  assert.ok(!text!.includes('用量'), text!);
  assert.ok(text!.includes('首 token 0.9秒'), text!);
});

test('session turn timings take precedence over the turn start/end fallback', () => {
  const turns = new Map([[1, closedTurn({ closing: { time: Date.now() } })]]);
  const view = normalizeSnapshot({
    ...chatSnapshot(turns),
    legacy: { turnTimings: new Map([[1, { startTime: 0, endTime: 65000 }]]) },
  });
  const text = footerTextForTurn(view!, 1);
  assert.ok(text);
  assert.ok(text!.includes('用时 1分05秒'), text!);
});

test('a turn without enough evidence renders no footer', () => {
  const turns = new Map([[1, closedTurn({ closing: { time: Date.now() } }, Number.NaN, Number.NaN)]]);
  const view = normalizeSnapshot(chatSnapshot(turns));
  assert.equal(footerTextForTurn(view!, 1), null);
  const missing = normalizeSnapshot(chatSnapshot(new Map()));
  assert.equal(footerTextForTurn(missing!, 1), null);
});

test('compact token counts mirror the native formatting', () => {
  assert.equal(fmtCompactTokens(940), '940');
  assert.equal(fmtCompactTokens(1234), '1.2K');
  assert.equal(fmtCompactTokens(123456), '123K');
  assert.equal(fmtCompactTokens(99999), '100K');
  assert.equal(fmtCompactTokens(9400000), '9.4M');
});
