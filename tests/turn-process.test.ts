import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isProcessEntry, processCounts, transcriptSeatKey, turnProcessOpen } from '../src/client/turn-process.ts';
import type { TranscriptEntry } from '../src/client/transcript-model.ts';
import { settledTool, toolEntry, turnLocation } from './support/chat-fixture.ts';

test('only a completed unread turn folds automatically; active and interrupted work stays open', () => {
  assert.equal(turnProcessOpen(undefined, true, 'completed', false), false);
  assert.equal(turnProcessOpen(undefined, true, 'completed', true), true);
  for (const reason of ['interrupted', 'error', null]) assert.equal(turnProcessOpen(undefined, true, reason, false), true);
  assert.equal(turnProcessOpen(false, false, null, false), true, 'a resumed turn is visible even with a past closed choice');
});

test('stored choices persist, but an old closed choice cannot hide a new active reading intent', () => {
  assert.equal(turnProcessOpen(true, true, 'completed', false), true);
  assert.equal(turnProcessOpen(false, true, 'completed', true), true);
  assert.equal(turnProcessOpen(false, true, 'error', false), false);
});

test('answers and user input survive process folding; earlier narration and thinking fold', () => {
  const body = { kind: 'narration' as const, key: 'a:0', item: { kind: 'narration' as const, key: 'a:0', nodeKey: 'a', start: 0, step: 0 } };
  assert.equal(isProcessEntry(body), true);
  assert.equal(isProcessEntry({ ...body, item: { ...body.item, answer: true } }), false);
  assert.equal(isProcessEntry({ kind: 'thought', key: 't', item: { kind: 'reasoning', key: 't', nodeKey: 'a', start: 0, step: 0 } }), true);
  assert.equal(isProcessEntry({ kind: 'input', key: 'u', item: { kind: 'input', key: 'u', nodeKey: 'u', step: 0 } }), false);
  for (const kind of ['notice', 'output'] as const) assert.equal(isProcessEntry({ kind: 'item', key: kind, item: { kind, key: kind, nodeKey: kind, step: null } }), false);
});

test('a single operation and its later group use the same outer fold seat', () => {
  const item = { kind: 'tool' as const, key: 'reader-tool:c1', step: 0, entry: toolEntry('c1', 0, settledTool('c1', 'bash')) };
  const facts = { counts: { command: 1 }, order: ['command' as const], running: false, failed: 0 };
  const singleton: TranscriptEntry = { kind: 'item', key: item.key, item, facts };
  const group: TranscriptEntry = { kind: 'group', key: `group:${item.key}`, items: [item], facts };
  assert.equal(transcriptSeatKey(singleton), transcriptSeatKey(group));
});

test('summary counts keep step zero and deduplicate repeated call references', () => {
  const item = { kind: 'tool' as const, key: 'reader-tool:c1', step: 0, entry: toolEntry('c1', 0, settledTool('c1', 'bash')) };
  assert.deepEqual(processCounts(turnLocation({ steps: [0, 1] }), [item, item]), { steps: 2, tools: 1 });
  assert.deepEqual(processCounts(undefined, [item]), { steps: 1, tools: 1 });
  assert.deepEqual(processCounts(undefined, []), { steps: 0, tools: 0 });
});
