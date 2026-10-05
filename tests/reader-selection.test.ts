import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ChatSnapshot, ChatConversationViewNode, TurnLocation } from '@deepseek-ai/dsh-client-runtime/client';
import { createReaderStructureSelector, createGroupSelector } from '../src/client/reader-selection.ts';

function node(key: string, turn: number, kind = 'assistant-step', seq = 1): ChatConversationViewNode {
  return { key, kind, anchorSeq: seq, visibility: 'visible', location: { kind: 'turn', turn: { turn } }, data: { blocks: [{ kind: 'text', text: '短内容' }] } } as unknown as ChatConversationViewNode;
}
function chat(nodes: ChatConversationViewNode[], turns = new Map<number, TurnLocation>()): ChatSnapshot {
  return { order: nodes.map(n => n.key), nodes: new Map(nodes.map(n => [n.key, n])), timeline: { turns, turnOrder: [...turns.keys()] } } as unknown as ChatSnapshot;
}

test('text-only publications retain root structure and unrelated historical groups', () => {
  const select = createReaderStructureSelector();
  const a = node('a', 1, 'user'), b = node('b', 1), c = node('c', 2, 'user'), d = node('d', 2);
  const before = select(chat([a, b, c, d]));
  const changed = { ...d, data: { blocks: [{ kind: 'text', text: '新增文本' }] } } as ChatConversationViewNode;
  assert.equal(select(chat([a, b, c, changed])), before);
  const appended = select(chat([a, b, c, changed, node('e', 2)]));
  assert.equal(appended.groups[0], before.groups[0]);
  assert.notEqual(appended.groups[1], before.groups[1]);
  assert.equal(appended.hidden, before.hidden);
  assert.equal(appended.latestUserKey, 'c');
});

test('history prepend, hidden nodes and relocation change structure without stale groups', () => {
  const select = createReaderStructureSelector();
  const a = node('a', 1, 'user'), b = node('b', 1);
  const before = select(chat([a, b]));
  const older = select(chat([node('old', 0), a, b]));
  assert.equal(older.groups[1], before.groups[0]);
  const hidden = select(chat([a, { ...b, visibility: 'hidden' } as ChatConversationViewNode]));
  assert.deepEqual(hidden.groups[0].keys, ['a']);
  assert.equal(hidden.latestUserKey, 'a');
  const moved = select(chat([a, node('b', 2)]));
  assert.equal(moved.groups.length, 2);
});

test('rewind visibility updates even when node order is unchanged', () => {
  const select = createReaderStructureSelector();
  const a = node('a', 1, 'user', 10), b = node('b', 1, 'assistant-step', 11);
  const command = { ...node('cmd', 1, 'command', 12), data: { name: 'rewind', seq: 12, args: '@10', outcome: { kind: 'pending' } } } as ChatConversationViewNode;
  const before = select(chat([a, b, command]));
  const after = select(chat([a, b, { ...command, data: { ...command.data as object, outcome: { kind: 'success', sourceEventSeq: 12 } } } as ChatConversationViewNode]));
  assert.notEqual(after, before);
  assert.deepEqual(after.visibleOrder, []);
  assert.equal(after.latestUserKey, null);
});

test('group selection ignores other turns but observes own nodes and turn completion', () => {
  const a = node('a', 1), b = node('b', 2);
  const open = { status: 'open' } as TurnLocation;
  const turns = new Map([[1, open]]);
  const select = createGroupSelector({ key: 'turn:1', turn: 1, keys: ['a'] });
  const before = select(chat([a, b], turns));
  assert.equal(select(chat([a, { ...b }], turns)), before);
  assert.notEqual(select(chat([{ ...a }, b], turns)), before);
  const closed = select(chat([a, b], new Map([[1, { status: 'closed' } as TurnLocation]])));
  assert.equal(closed.turn?.status, 'closed');
});
