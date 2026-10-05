import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cachedSnapshot, registerReaderSnapshot } from '../src/client/compat/reader-root.ts';

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
