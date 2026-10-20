import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PanelItem } from '../src/client/process-steps.ts';
import { buildTranscript, groupSummary, liveThoughtKey } from '../src/client/transcript-model.ts';
import { elapsedTimeLabel } from '../src/client/process-steps.ts';
import { assistantNode, chatNode, reasoning, settledTool, text, toolEntry, turnLocation } from './support/chat-fixture.ts';

const turn = turnLocation({ steps: [1, 2] });
const tool = (id: string): PanelItem => ({ kind: 'tool', key: `reader-tool:${id}`, step: 1, entry: toolEntry(id, 1, settledTool(id, 'bash')) });
const think = (key: string): PanelItem => ({ kind: 'reasoning', key, nodeKey: key, start: 0, step: 1 });
const none = () => undefined;

test('the independent live clock preserves elapsed formatting and rejects unavailable/backward timing', () => {
  assert.equal(elapsedTimeLabel(1000, 10000, true), '9 秒');
  assert.equal(elapsedTimeLabel(1000, 62000, true), '1 分 1 秒');
  assert.equal(elapsedTimeLabel(1000, 62000, false), '用时 1 分 1 秒');
  assert.equal(elapsedTimeLabel(undefined, 10000, true), null);
  assert.equal(elapsedTimeLabel(1000, undefined, false), null);
  assert.equal(elapsedTimeLabel(1000, 500, true), null);
});

test('thoughts before, between and after operations remain inside the same ordered process group', () => {
  const items = [think('a'), tool('one'), think('b'), tool('two'), think('c')];
  const before = JSON.stringify(items);
  const entries = buildTranscript(items, none, true);
  assert.equal(entries.length, 1);
  const group = entries[0]!;
  assert.equal(group.kind, 'group');
  if (group.kind !== 'group') throw Error('process group required');
  assert.deepEqual(group.items, items);
  assert.equal(groupSummary(group.facts), '思考，运行了 2 条命令');
  assert.equal(JSON.stringify(items), before);
});

test('a thought-only process grows under the same group key when tools arrive', () => {
  const item = think('thought:0');
  const first = buildTranscript([item], none, false)[0]!;
  const next = buildTranscript([item, tool('one')], none, false)[0]!;
  assert.equal(first.kind, 'group');
  assert.equal(first.key, next.key);
  assert.equal(first.key, 'group:thought:0');
});

test('narration, supplementary input and retry notices remain chronological group boundaries', () => {
  const retry = chatNode('model-retry', {}, turn, 1);
  const boundaries: PanelItem[] = [
    { kind: 'narration', key: 'body', nodeKey: 'body', start: 0, step: 1 },
    { kind: 'input', key: 'user', nodeKey: 'user', step: 1 },
    { kind: 'record', key: retry.key, nodeKey: retry.key, step: 1 },
  ];
  for (const boundary of boundaries) {
    const entries = buildTranscript([think('before'), tool('one'), boundary, think('after'), tool('two')], key => key === retry.key ? retry : undefined, true);
    assert.deepEqual(entries.map(entry => entry.kind), ['group', boundary.kind === 'record' ? 'item' : boundary.kind, 'group']);
    assert.equal(entries[1]!.key, boundary.key);
  }
});

test('the trailing live thought keeps its identity inside a group and marks only current reasoning as running', () => {
  const activeTurn = turnLocation({ status: 'open', steps: [1] });
  const node = assistantNode(activeTurn, 1, [text('说明'), reasoning('最新思考')], 'running');
  const item: PanelItem = { kind: 'reasoning', key: `${node.key}:1`, nodeKey: node.key, start: 1, step: 1 };
  const get = (key: string) => key === node.key ? node : undefined;
  const entries = buildTranscript([tool('one'), item], get, false);
  assert.equal(entries.length, 1);
  assert.equal(liveThoughtKey(entries, get, true), item.key);
  assert.equal(entries[0]!.kind === 'group' && entries[0]!.facts.running, true);
  assert.equal(liveThoughtKey(buildTranscript([item, tool('two')], get, false), get, true), null);
  assert.equal(liveThoughtKey(entries, get, false), null);
});
