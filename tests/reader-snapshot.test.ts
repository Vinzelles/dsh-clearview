import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cachedSnapshot, normalizeSnapshot, registerReaderSnapshot } from '../src/client/compat/reader-root.ts';

test('DOM compat reads current explicit snapshot without a fiber or TTL delay', () => {
  const root = {} as HTMLElement;
  let current = { chat: { nodes: new Map(), timeline: { turns: new Map([[1, { status: 'open' }]]) } } };
  const release = registerReaderSnapshot(root, () => current);
  assert.equal(cachedSnapshot(root)?.chat.timeline.turns.get(1).status, 'open');
  current = { chat: { nodes: new Map(), timeline: { turns: new Map([[1, { status: 'closed' }]]) } } };
  assert.equal(cachedSnapshot(root)?.chat.timeline.turns.get(1).status, 'closed');
  release();
  assert.equal(cachedSnapshot(root), null);
});

function chatSnapshot(turns: Map<number, unknown>): Record<string, unknown> {
  return { order: [], nodes: { get: () => undefined, values: () => [] }, timeline: { turnOrder: [1], turns } };
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
