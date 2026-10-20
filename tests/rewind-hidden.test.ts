import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AssistantBlock, ChatConversationViewNode } from '@deepseek-ai/dsh-client-runtime/client';
import { hiddenSeqsOf, rewindSpansOf, targetSeqOfArgs } from '../src/client/rewind-hidden.ts';
import type { HiddenChat } from '../src/client/rewind-hidden.ts';
import { readerFlow } from '../src/client/tool-activity.ts';

function node(key: string, kind: string, seq: number): ChatConversationViewNode {
  return {
    key,
    kind,
    target: 'chat',
    data: kind === 'command' ? { seq, name: 'rewind', args: '', outcome: null } : { seq },
    anchorSeq: seq,
    visibility: 'visible',
    location: { kind: 'unresolved' },
  } as unknown as ChatConversationViewNode;
}

function chat(rows: ChatConversationViewNode[]): HiddenChat {
  const map = new Map(rows.map(row => [row.key, row]));
  return { order: rows.map(row => row.key), nodes: { get: key => map.get(key) } };
}

test('targetSeqOfArgs reads the machine channel without parsing human copy', () => {
  assert.equal(targetSeqOfArgs('@8 chat'), 8);
  assert.equal(targetSeqOfArgs('preview @8 both'), 8);
  assert.equal(targetSeqOfArgs('__candidates'), undefined);
  assert.equal(targetSeqOfArgs(null), undefined);
});

test('internal rewind probes and successful rewind command rows are hidden', () => {
  const rows = [
    node('u1', 'user', 1),
    node('p', 'command', 2),
    node('c', 'command', 3),
    node('r', 'command', 4),
  ];
  rows[1].data = { seq: 2, name: 'rewind', args: 'preview @1 both', outcome: { kind: 'success', text: '' } };
  rows[2].data = { seq: 3, name: 'rewind', args: '__candidates', outcome: { kind: 'success', text: '' } };
  rows[3].data = { seq: 4, name: 'rewind', args: '@1 both', outcome: { kind: 'success', text: '', sourceEventSeq: 6 } };
  const hidden = hiddenSeqsOf(chat(rows));
  assert.ok(hidden.has(2));
  assert.ok(hidden.has(3));
  assert.ok(hidden.has(4));
});

test('a rewind hides the withdrawn surface span, target inclusive, and keeps later traffic', () => {
  const rows = [
    node('before', 'user', 1),
    node('target', 'user', 2),
    node('assistant', 'assistant-step', 3),
    node('tool', 'tool-call', 4),
    node('marker', 'command', 5),
    node('after', 'user', 6),
  ];
  rows[4].data = { seq: 5, name: 'rewind', args: '@2 both', outcome: { kind: 'success', text: '', sourceEventSeq: 5 } };
  const hidden = hiddenSeqsOf(chat(rows));
  for (const seq of [2, 3, 4, 5]) assert.ok(hidden.has(seq), `expected ${seq} hidden`);
  assert.ok(!hidden.has(1));
  assert.ok(!hidden.has(6));
});

test('multiple rewinds keep separate spans and do not hide traffic between them', () => {
  const rows = [
    node('u1', 'user', 1),
    node('u2', 'user', 2),
    node('a2', 'assistant-step', 3),
    node('rewind2', 'command', 4),
    node('u3', 'user', 5),
    node('a3', 'assistant-step', 6),
    node('rewind3', 'command', 7),
    node('u4', 'user', 8),
  ];
  rows[3].data = { seq: 4, name: 'rewind', args: '@2 both', outcome: { kind: 'success', text: '', sourceEventSeq: 4 } };
  rows[6].data = { seq: 7, name: 'rewind', args: '@5 both', outcome: { kind: 'success', text: '', sourceEventSeq: 7 } };
  const spans = rewindSpansOf(chat(rows));
  assert.deepEqual(spans, [{ start: 2, end: 4 }, { start: 5, end: 7 }]);
  const hidden = hiddenSeqsOf(chat(rows));
  assert.ok(hidden.has(2) && hidden.has(3) && hidden.has(4));
  assert.ok(hidden.has(5) && hidden.has(6) && hidden.has(7));
  assert.ok(!hidden.has(1));
  assert.ok(!hidden.has(8));
});

test('the current rewind-plugin engine hides the entire cut and its internal probes', () => {
  const rows = [node('before', 'user', 260), node('target', 'user', 268),
    node('assistant', 'assistant-step', 269), node('retry', 'model-request-retry', 270),
    node('error', 'turn-error', 271), node('preview', 'command', 272),
    node('execute', 'command', 273), node('after', 'user', 275)];
  rows[5].data = { seq: 272, name: 'rewind-plugin', args: 'preview @268 chat', outcome: { kind: 'success', text: 'translated preview' } };
  rows[6].data = { seq: 273, name: 'rewind-plugin', args: '@268 chat', outcome: { kind: 'success', text: 'translated result', sourceEventSeq: 274 } };
  assert.deepEqual(rewindSpansOf(chat(rows)), [{ start: 268, end: 274 }]);
  assert.deepEqual([...hiddenSeqsOf(chat(rows))].sort((a, b) => a - b), [268, 269, 270, 271, 272, 273]);
});

test('new and legacy command names can coexist without cutting the traffic between rewinds', () => {
  const rows = [node('target-old', 'user', 10), node('old', 'command', 12),
    node('kept', 'user', 14), node('target-new', 'user', 20), node('new', 'command', 22), node('latest', 'user', 24)];
  rows[1].data = { seq: 12, name: 'rewind', args: '@10 both', outcome: { kind: 'success', sourceEventSeq: 13 } };
  rows[4].data = { seq: 22, name: 'rewind-plugin', args: '@20 chat', outcome: { kind: 'success', sourceEventSeq: 23 } };
  assert.deepEqual(rewindSpansOf(chat(rows)), [{ start: 10, end: 13 }, { start: 20, end: 23 }]);
  assert.deepEqual([...hiddenSeqsOf(chat(rows))].sort((a, b) => a - b), [10, 12, 20, 22]);
});

test('failed, pending and marker-free engine results never withdraw visible conversation rows', () => {
  for (const outcome of [null, { kind: 'pending' }, { kind: 'error', sourceEventSeq: 20 }, { kind: 'success' }]) {
    const user = node('user', 'user', 10), command = node('command', 'command', 15);
    command.data = { seq: 15, name: 'rewind-plugin', args: '@10 chat', outcome };
    assert.equal(hiddenSeqsOf(chat([user, command])).size, 0);
  }
  for (const args of ['preview @10 both', '__candidates']) {
    const probe = node('probe', 'command', 15);
    probe.data = { seq: 15, name: 'rewind-plugin', args, outcome: null };
    assert.deepEqual([...hiddenSeqsOf(chat([node('user', 'user', 10), probe]))], [15]);
  }
});

function chromeChat(remaining = false, collision = false, incomplete = false): HiddenChat {
  const chrome = { ...node('chrome', 'turn-process', 1), location: { kind: 'turn', turn: { turn: 1, start: { seq: 1 } } } } as ChatConversationViewNode;
  const user = node('user', 'user', 10), assistant = node('assistant', 'assistant-step', 11);
  const command = node('command', 'command', 15);
  command.data = { seq: 15, name: 'rewind-plugin', args: '@10 chat', outcome: { kind: 'success', sourceEventSeq: 20 } };
  const rows = [chrome, user, assistant, command];
  const keys = ['chrome', 'user', 'assistant'];
  if (remaining) { rows.push(node('retained', 'user', 5)); keys.push('retained'); }
  if (collision) rows.push(node('other-turn', 'user', 1));
  if (incomplete) keys.push('unloaded');
  return { ...chat(rows), locations: { getTurn: () => keys } } as HiddenChat;
}

test('a fully withdrawn turn loses the process summary anchored before the target', () => {
  assert.ok(hiddenSeqsOf(chromeChat()).has(1));
});

test('partial turns, unloaded rows and shared live anchors retain their process summary', () => {
  for (const snap of [chromeChat(true), chromeChat(false, true), chromeChat(false, false, true)]) {
    assert.ok(!hiddenSeqsOf(snap).has(1));
  }
});

test('older snapshots without a turn index still hide the withdrawal span', () => {
  const snap = chromeChat();
  const old: HiddenChat = { order: snap.order, nodes: snap.nodes };
  assert.ok(hiddenSeqsOf(old).has(10));
  assert.ok(!hiddenSeqsOf(old).has(1));
});

test('an unavailable optional turn index cannot break the withdrawal span', () => {
  const snap: HiddenChat = { ...chromeChat(), locations: { getTurn: () => { throw new Error('Index not ready'); } } };
  const hidden = hiddenSeqsOf(snap);
  assert.ok(hidden.has(10) && hidden.has(11));
  assert.ok(!hidden.has(1));
});


test('readerFlow drops rewound nodes and their in-flight tool drafts', () => {
  const draft: AssistantBlock = { kind: 'tool-call', callId: 'call-1', name: 'bash', argsRaw: '{}' };
  const step = {
    step: 2,
    start: { seq: 30 },
    end: { seq: 40 },
    status: 'closed',
    data: { get: () => ({ status: 'running', blocks: [draft] }) },
  } as never;
  const turn = { turn: 1, steps: [step], status: 'closed' } as never;
  const hiddenNode = node('assistant-hidden', 'assistant-step', 20);
  const group = { key: 'turn:1', turn: 1, keys: ['assistant-hidden'] };
  const flow = readerFlow(group, turn, () => hiddenNode, {
    hidden: new Set([20]),
    spans: [{ start: 10, end: 40 }],
  });
  assert.equal(flow.length, 0);
});

test('readerFlow keeps visible tool drafts outside the rewind span', () => {
  const draft: AssistantBlock = { kind: 'tool-call', callId: 'call-2', name: 'bash', argsRaw: '{}' };
  const step = {
    step: 3,
    start: { seq: 60 },
    end: { seq: 70 },
    status: 'closed',
    data: { get: () => ({ status: 'running', blocks: [draft] }) },
  } as never;
  const turn = { turn: 1, steps: [step], status: 'open' } as never;
  const group = { key: 'turn:1', turn: 1, keys: [] };
  const flow = readerFlow(group, turn, () => undefined, {
    hidden: new Set(),
    spans: [{ start: 10, end: 40 }],
  });
  assert.equal(flow.length, 1);
  if (flow[0]?.kind !== 'tool') throw new Error('expected a tool entry');
  assert.equal(flow[0].callId, 'call-2');
});
