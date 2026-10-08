import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clusterElapsedMs, formatOperationClusterSummary, groupOperations, mergeThoughts, type FlowRow, type OperationRow, type PanelItem,
} from '../src/client/process-steps.ts';
import { assistantNode, chatNode, reasoning, settledTool, toolCall, toolEntry, turnLocation } from './support/chat-fixture.ts';

const turn = turnLocation({ steps: [1] });
const none = () => undefined;
const draftTool = (id: string, name = 'bash', args: Record<string, unknown> = {}): PanelItem =>
  ({ kind: 'tool', key: `reader-tool:${id}`, entry: toolEntry(id, 1, undefined, toolCall(id, name, args)), step: 1 });
const settled = (id: string, name = 'bash', args: Record<string, unknown> = {}, over: Record<string, unknown> = {}): PanelItem =>
  ({ kind: 'tool', key: `reader-tool:${id}`, entry: toolEntry(id, 1, settledTool(id, name, args, over)), step: 1 });
const running = (id: string, name = 'bash'): PanelItem =>
  ({ kind: 'tool', key: `reader-tool:${id}`, entry: toolEntry(id, 1, { phase: 'start', callId: id, name, argsRaw: '{}', subCalls: [] }), step: 1 });
const think: PanelItem = { kind: 'reasoning', key: 'r1', nodeKey: 'n1', start: 0, step: 1 };
const narration: PanelItem = { kind: 'narration', key: 'x1', nodeKey: 'n2', start: 0, step: 1 };
const input: PanelItem = { kind: 'input', key: 'in1', nodeKey: 'in1', step: 1 };

function record(kind: string, data: unknown) {
  const node = chatNode(kind, data, turn, 1);
  return { node, item: { kind: 'record', key: node.key, nodeKey: node.key, step: 1 } as PanelItem };
}
const lookup = (...nodes: ReturnType<typeof chatNode>[]) => { const map = new Map(nodes.map(node => [node.key, node])); return (key: string) => map.get(key); };
const cluster = (row: OperationRow | undefined) => { assert.equal(row?.kind, 'cluster'); return row as Extract<OperationRow, { kind: 'cluster' }>; };

test('summary wording follows 0.1.18 and joins parts with a full-width comma', () => {
  assert.equal(formatOperationClusterSummary({ commands: 3, tools: 5, operations: 2, failed: 0, skills: 0 }), '运行了 3 条命令，进行了 5 次工具调用，执行了 2 个操作');
  assert.equal(formatOperationClusterSummary({ commands: 1, tools: 1, operations: 0, failed: 0, skills: 0 }), '运行了 1 条命令，进行了 1 次工具调用');
  assert.equal(formatOperationClusterSummary({ commands: 0, tools: 2, operations: 2, failed: 0, skills: 0 }), '进行了 2 次工具调用，执行了 2 个操作');
  assert.equal(formatOperationClusterSummary({ commands: 1, tools: 2, operations: 0, failed: 0, skills: 1 }), '使用了 1 个技能，运行了 1 条命令，进行了 2 次工具调用');
});

test('a single operational item stays a single row', () => {
  const rows = groupOperations([settled('a')], none);
  assert.deepEqual(rows.map(row => row.kind), ['single']);
  assert.deepEqual(groupOperations([], none), []);
});

test('two or more consecutive tool calls form one cluster with counts by category', () => {
  const rows = groupOperations([settled('a', 'bash', { command: 'npm test' }), settled('b', 'read', { path: 'a.ts' }), settled('c', 'write', { path: 'b.ts' })], none);
  assert.equal(rows.length, 1);
  const group = cluster(rows[0]);
  assert.equal(group.items.length, 3);
  assert.deepEqual(group.summary, { commands: 1, tools: 3, operations: 2, failed: 0, skills: 0 });
  assert.equal(group.hasActive, false);
  assert.equal(group.hasFailed, false);
  assert.equal(formatOperationClusterSummary(group.summary), '运行了 1 条命令，进行了 3 次工具调用，执行了 2 个操作');
});

test('skill calls are counted and lead the summary', () => {
  const group = cluster(groupOperations([settled('s', 'skill', { name: 'pdf-helper' }), settled('b', 'bash', { command: 'ls' })], none)[0]);
  assert.equal(group.summary.skills, 1);
  assert.equal(formatOperationClusterSummary(group.summary), '使用了 1 个技能，运行了 1 条命令，进行了 2 次工具调用');
});

test('command and manual-compaction records join tool calls and count as commands and operations', () => {
  const command = record('command', { outcome: { kind: 'success' } });
  const compact = record('manual-compaction', { command: { outcome: { kind: 'success' } }, compaction: {} });
  const rows = groupOperations([command.item, compact.item, settled('a')], lookup(command.node, compact.node));
  assert.equal(rows.length, 1);
  assert.deepEqual(cluster(rows[0]).summary, { commands: 3, tools: 1, operations: 2, failed: 0, skills: 0 });
});

test('a lone command record is a single row; other records and inputs are not operational', () => {
  const command = record('command', { outcome: { kind: 'success' } });
  const plan = record('submitted-plan', { title: 'p' });
  const get = lookup(command.node, plan.node);
  assert.deepEqual(groupOperations([command.item], get).map(row => row.kind), ['single']);
  assert.deepEqual(groupOperations([settled('a'), plan.item, settled('b')], get).map(row => row.kind), ['single', 'single', 'single']);
  assert.deepEqual(groupOperations([settled('a'), input, settled('b')], get).map(row => row.kind), ['single', 'single', 'single']);
});

test('reasoning and narration break a cluster; each side clusters on its own', () => {
  const rows = groupOperations([settled('a'), settled('b'), think, settled('c'), settled('d'), settled('e'), narration, settled('f')], none);
  assert.deepEqual(rows.map(row => row.kind), ['cluster', 'single', 'cluster', 'single', 'single']);
  assert.equal(cluster(rows[0]).items.length, 2);
  assert.equal(cluster(rows[2]).items.length, 3);
});

test('clusters ignore step boundaries: consecutive tools from different steps merge', () => {
  const later: PanelItem = { ...settled('b'), step: 2 } as PanelItem;
  assert.equal(cluster(groupOperations([settled('a'), later], none)[0]).items.length, 2);
});

test('the cluster key is stable: it follows its first member, not the size', () => {
  const two = cluster(groupOperations([settled('a'), settled('b')], none)[0]);
  const three = cluster(groupOperations([settled('a'), settled('b'), settled('c')], none)[0]);
  assert.equal(two.key, 'cluster:reader-tool:a');
  assert.equal(three.key, two.key);
});

test('a preparing or running call makes the cluster active; a closed turn settles it', () => {
  assert.equal(cluster(groupOperations([settled('a'), draftTool('b')], none)[0]).hasActive, true);
  assert.equal(cluster(groupOperations([settled('a'), running('b')], none)[0]).hasActive, true);
  assert.equal(cluster(groupOperations([settled('a'), running('b')], none, true)[0]).hasActive, false);
  const live = record('command', { name: 'x' });
  assert.equal(cluster(groupOperations([settled('a'), live.item], lookup(live.node))[0]).hasActive, true);
  assert.equal(cluster(groupOperations([settled('a'), live.item], lookup(live.node), true)[0]).hasActive, false);
});

test('failed tools and failed command records count as failures', () => {
  const failedCommand = record('command', { outcome: { kind: 'error' } });
  const group = cluster(groupOperations([settled('a', 'bash', {}, { isError: true }), settled('b'), failedCommand.item], lookup(failedCommand.node))[0]);
  assert.equal(group.hasFailed, true);
  assert.equal(group.summary.failed, 2);
  assert.equal(cluster(groupOperations([settled('a'), settled('b')], none)[0]).hasFailed, false);
});

test('cluster elapsed runs from the first call start to the last call end, and is unknown while anything is unsettled', () => {
  assert.equal(clusterElapsedMs([settled('a', 'bash', {}, { callTime: 1000, time: 2000 }), settled('b', 'bash', {}, { callTime: 3000, time: 6500 })]), 5500);
  assert.equal(clusterElapsedMs([settled('a'), running('b')]), null);
  assert.equal(clusterElapsedMs([settled('a', 'bash', {}, { callTime: undefined })]), null);
});

// --- a settled thought followed by exactly one settled, healthy operation reads as one row ---

function thought(status: 'running' | 'settled' | 'interrupted' = 'settled', tail: 'reasoning' | 'tool' = 'reasoning') {
  const blocks = tail === 'tool' ? [reasoning('先看一下。'), toolCall('c9', 'bash')] : [reasoning('先看一下。')];
  const node = assistantNode(turn, 1, blocks, status);
  const item: PanelItem = { kind: 'reasoning', key: `${node.key}:0`, nodeKey: node.key, start: 0, step: 1 };
  return { node, item };
}
const merge = (items: PanelItem[], get: (key: string) => ReturnType<typeof chatNode> | undefined, closed = false): FlowRow[] =>
  mergeThoughts(groupOperations(items, get, closed), get, closed);
const merged = (row: FlowRow | undefined) => { assert.equal(row?.kind, 'thought'); return row as Extract<FlowRow, { kind: 'thought' }>; };

test('a settled thought followed by one settled tool call merges with it', () => {
  const t = thought();
  const rows = merge([t.item, settled('a')], lookup(t.node));
  assert.equal(rows.length, 1);
  assert.equal(merged(rows[0]).reasoning, t.item);
  assert.equal(merged(rows[0]).operation.key, 'reader-tool:a');
});

test('a settled thought also merges with one healthy command or manual-compaction record', () => {
  const t = thought();
  const command = record('command', { outcome: { kind: 'success' } });
  const compact = record('manual-compaction', { command: { outcome: { kind: 'success' } }, compaction: {} });
  assert.equal(merged(merge([t.item, command.item], lookup(t.node, command.node))[0]).operation, command.item);
  assert.equal(merged(merge([t.item, compact.item], lookup(t.node, compact.node))[0]).operation, compact.item);
});

test('a thought of an interrupted or settled step merges; rows after the pair are untouched', () => {
  const t = thought('interrupted');
  const rows = merge([t.item, settled('a'), narration, settled('b')], lookup(t.node), true);
  assert.deepEqual(rows.map(row => row.kind), ['thought', 'single', 'single']);
});

test('no merge while the tool is preparing or running, or after it failed or was interrupted', () => {
  const t = thought();
  for (const op of [draftTool('a'), running('a')]) assert.deepEqual(merge([t.item, op], lookup(t.node)).map(row => row.kind), ['single', 'single']);
  assert.deepEqual(merge([t.item, settled('a', 'bash', {}, { isError: true })], lookup(t.node)).map(row => row.kind), ['single', 'single']);
  assert.deepEqual(merge([t.item, running('a')], lookup(t.node), true).map(row => row.kind), ['single', 'single']);
});

test('no merge for a running or failed command record', () => {
  const t = thought();
  const live = record('command', { name: 'x' });
  const failed = record('command', { outcome: { kind: 'error' } });
  assert.deepEqual(merge([t.item, live.item], lookup(t.node, live.node)).map(row => row.kind), ['single', 'single']);
  assert.deepEqual(merge([t.item, failed.item], lookup(t.node, failed.node)).map(row => row.kind), ['single', 'single']);
});

test('no merge for live thinking, even when a settled tool follows', () => {
  const live = thought('running');
  assert.deepEqual(merge([live.item, settled('a')], lookup(live.node)).map(row => row.kind), ['single', 'single']);
  // The step is still running but this thought is already followed by a tool call: it is settled.
  const done = thought('running', 'tool');
  assert.equal(merge([done.item, settled('a')], lookup(done.node))[0]!.kind, 'thought');
});

test('no merge when a cluster follows, when anything sits between, or for a non-operational record', () => {
  const t = thought();
  assert.deepEqual(merge([t.item, settled('a'), settled('b')], lookup(t.node)).map(row => row.kind), ['single', 'cluster']);
  assert.deepEqual(merge([t.item, narration, settled('a')], lookup(t.node)).map(row => row.kind), ['single', 'single', 'single']);
  assert.deepEqual(merge([t.item, input, settled('a')], lookup(t.node)).map(row => row.kind), ['single', 'single', 'single']);
  const plan = record('submitted-plan', { title: 'p' });
  assert.deepEqual(merge([t.item, plan.item], lookup(t.node, plan.node)).map(row => row.kind), ['single', 'single']);
});

test('a thought whose node is missing is not merged (it would hide the tool row)', () => {
  const t = thought();
  assert.deepEqual(merge([t.item, settled('a')], none).map(row => row.kind), ['single', 'single']);
});

test('only reasoning pairs: a lone tool, narration before a tool and two thoughts stay as they are', () => {
  const t = thought();
  const u = thought();
  assert.deepEqual(merge([settled('a')], none).map(row => row.kind), ['single']);
  assert.deepEqual(merge([narration, settled('a')], none).map(row => row.kind), ['single', 'single']);
  assert.deepEqual(merge([t.item, u.item, settled('a')], lookup(t.node, u.node)).map(row => row.kind), ['single', 'thought']);
});

test('a call the reader has opened is never folded into the thought row, even once it has settled', () => {
  const t = thought();
  const items = [t.item, settled('a')];
  const opened = new Set(['reader-tool:a']);
  assert.deepEqual(mergeThoughts(groupOperations(items, lookup(t.node)), lookup(t.node), false, opened).map(row => row.kind), ['single', 'single']);
  assert.equal(mergeThoughts(groupOperations(items, lookup(t.node)), lookup(t.node), false, new Set(['reader-tool:other']))[0]!.kind, 'thought');
  const command = record('command', { outcome: { kind: 'success' } });
  const get = lookup(t.node, command.node);
  assert.deepEqual(mergeThoughts(groupOperations([t.item, command.item], get), get, false, new Set([command.item.key])).map(row => row.kind), ['single', 'single']);
});
