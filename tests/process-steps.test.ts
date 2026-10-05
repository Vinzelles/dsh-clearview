import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boundaryOf } from '../src/client/projection.ts';
import {
  categorySummary, elapsedLabel, groupSteps, layoutTurn, panelCounts, panelStatus, runningLabel, statusLabel, type PanelItem,
} from '../src/client/process-steps.ts';
import { assistantNode, chatNode, nodeEntry, reasoning, settledTool, text, toolCall, toolEntry, turnLocation } from './support/chat-fixture.ts';

function getter(...nodes: ReturnType<typeof chatNode>[]) {
  const map = new Map(nodes.map(node => [node.key, node]));
  return (key: string) => map.get(key);
}
const kinds = (items: readonly PanelItem[]) => items.map(item => item.kind);

test('a completed turn keeps earlier narration in the panel and the closing step as the answer', () => {
  const turn = turnLocation({ status: 'closed', reason: 'completed', steps: [1, 2], closingStep: 2 });
  const first = assistantNode(turn, 1, [reasoning('先看工作区'), text('我先检查一下。'), toolCall('c1', 'bash', { command: 'ls' })]);
  const second = assistantNode(turn, 2, [reasoning('可以收尾'), text('## 结论')]);
  const layout = layoutTurn([nodeEntry(first), toolEntry('c1', 1, settledTool('c1', 'bash', { command: 'ls' })), nodeEntry(second)], getter(first, second), boundaryOf(turn));
  assert.deepEqual(kinds(layout.panel), ['reasoning', 'narration', 'tool', 'reasoning']);
  assert.deepEqual(layout.answer.map(segment => segment.nodeKey), [second.key]);
});

test('a running turn shows trailing text as the tentative answer and earlier text as narration', () => {
  const turn = turnLocation({ status: 'open', steps: [1, 2] });
  const first = assistantNode(turn, 1, [text('先检查'), toolCall('c1', 'bash')]);
  const second = assistantNode(turn, 2, [text('结论正在生成')], 'running');
  const layout = layoutTurn([nodeEntry(first), toolEntry('c1', 1), nodeEntry(second)], getter(first, second), boundaryOf(turn));
  assert.deepEqual(kinds(layout.panel), ['narration', 'tool']);
  assert.deepEqual(layout.answer.map(segment => segment.nodeKey), [second.key]);
});

test('a turn interrupted on a tool call has no answer and keeps its text as narration', () => {
  const turn = turnLocation({ status: 'closed', reason: 'aborted', steps: [1] });
  const only = assistantNode(turn, 1, [text('准备写文件'), toolCall('c1', 'write')], 'interrupted');
  const layout = layoutTurn([nodeEntry(only), toolEntry('c1', 1)], getter(only), boundaryOf(turn));
  assert.deepEqual(kinds(layout.panel), ['narration', 'tool']);
  assert.deepEqual(layout.answer, []);
});

test('notices, inputs, records and hidden or structural nodes are routed by kind', () => {
  const turn = turnLocation({ status: 'closed', reason: 'error', steps: [1] });
  const context = chatNode('context', { content: [] }, turn);
  const steering = chatNode('steering', { content: [] }, turn, 1);
  const error = chatNode('turn-error', { message: 'boom' }, turn);
  const tail = chatNode('turn-tail', {}, turn);
  const hidden = chatNode('command', {}, turn, 1, { visibility: 'hidden' });
  const plan = chatNode('submitted-plan', { title: '计划', markdown: '# 计划' }, turn, 1);
  const layout = layoutTurn([context, steering, error, tail, hidden, plan].map(nodeEntry), getter(context, steering, error, tail, hidden, plan), boundaryOf(turn));
  assert.deepEqual(kinds(layout.panel), ['record', 'input', 'record']);
  assert.deepEqual(layout.notices, [error.key]);
});

test('tools whose results carry images are also listed as media', () => {
  const turn = turnLocation({ status: 'closed', reason: 'completed', steps: [1], closingStep: 1 });
  const image = settledTool('c1', 'screenshot', {}, { content: [{ type: 'image', attachment: { attachmentId: 'a1' } }] });
  const layout = layoutTurn([toolEntry('c1', 1, image)], getter(), boundaryOf(turn));
  assert.equal(layout.media.length, 1);
  assert.equal(layout.panel.length, 1);
});

test('a media-bearing body before the closing step stays visible as answer', () => {
  const turn = turnLocation({ status: 'closed', reason: 'completed', steps: [1, 2], closingStep: 2 });
  const first = assistantNode(turn, 1, [{ kind: 'image', attachment: { attachmentId: 'a1' } }]);
  const second = assistantNode(turn, 2, [text('完成')]);
  const layout = layoutTurn([nodeEntry(first), nodeEntry(second)], getter(first, second), boundaryOf(turn));
  assert.deepEqual(layout.answer.map(segment => segment.nodeKey), [first.key, second.key]);
});

function tool(callId: string, step: number, name = 'bash'): PanelItem {
  return { kind: 'tool', key: `reader-tool:${callId}`, entry: toolEntry(callId, step, undefined, toolCall(callId, name)), step };
}
function think(step: number): PanelItem {
  return { kind: 'reasoning', key: `r:${step}`, nodeKey: `n:${step}`, start: 0, step };
}

test('steps with a single tool row merge into one range label', () => {
  const layout = groupSteps([think(1), tool('a', 1), tool('b', 2), tool('c', 3), tool('d', 4), think(5), tool('e', 5)], { condense: false });
  assert.deepEqual(layout.groups.map(group => group.label), ['步骤 1', '步骤 2–4', '步骤 5']);
  assert.equal(layout.earlier, null);
});

test('condensing keeps only the latest step group and summarizes the rest', () => {
  const items = [think(1), tool('a', 1, 'read'), tool('b', 1, 'read'), think(2), tool('c', 2, 'bash'), think(3), tool('d', 3, 'write')];
  const layout = groupSteps(items, { condense: true });
  assert.deepEqual(layout.groups.map(group => group.label), ['步骤 3']);
  assert.deepEqual(layout.earlier, { steps: 2, summary: '读取 2 个文件 · 运行 1 条命令' });
  assert.equal(groupSteps(items.slice(0, 3), { condense: true }).earlier, null);
});

test('six or more consecutive tools fold all but the last three, keeping active calls visible', () => {
  const items = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(id => tool(id, 1));
  const [group] = groupSteps(items, { condense: false }).groups;
  assert.equal(group!.entries[0]!.kind, 'fold');
  assert.equal((group!.entries[0] as { items: PanelItem[] }).items.length, 4);
  assert.equal(group!.entries.length, 4);
  const withActive = groupSteps(items, { condense: false, isActive: item => item.key === 'reader-tool:b' }).groups[0]!;
  assert.equal((withActive.entries[0] as { items: PanelItem[] }).items.length, 3);
  assert.equal(withActive.entries.length, 5);
});

test('items without a step join the nearest step instead of creating their own group', () => {
  const record: PanelItem = { kind: 'record', key: 'ctx', nodeKey: 'ctx', step: null };
  const layout = groupSteps([record, think(1), tool('a', 1)], { condense: false });
  assert.deepEqual(layout.groups.map(group => group.label), ['步骤 1']);
});

test('category summary uses a fixed order and the first three non-zero counts', () => {
  const items = [tool('a', 1, 'web_search'), tool('b', 1, 'grep'), tool('c', 1, 'write'), tool('d', 1, 'bash'), tool('e', 1, 'read'), tool('f', 1, 'skill')];
  assert.equal(categorySummary(items), '读取 1 个文件 · 运行 1 条命令 · 写入 1 个文件');
  assert.equal(categorySummary([think(1)]), '');
});

test('panel counts distinct steps, tools and failures', () => {
  const turn = turnLocation({ steps: [1, 2] });
  const failedCommand = chatNode('command', { outcome: { kind: 'error' } }, turn, 2);
  const items: PanelItem[] = [
    think(1),
    { kind: 'tool', key: 't1', entry: toolEntry('t1', 1, settledTool('t1', 'bash', {}, { isError: true })), step: 1 },
    { kind: 'tool', key: 't2', entry: toolEntry('t2', 2, settledTool('t2', 'read', {})), step: 2 },
    { kind: 'record', key: failedCommand.key, nodeKey: failedCommand.key, step: 2 },
    { kind: 'input', key: 'in', nodeKey: 'in', step: 3 },
  ];
  assert.deepEqual(panelCounts(items, getter(failedCommand), true), { steps: 2, tools: 2, failed: 2 });
});

test('panel status follows the turn boundary; an unresolved window stays neutral', () => {
  assert.equal(panelStatus(boundaryOf(turnLocation({ status: 'open' })), 0), 'running');
  assert.equal(panelStatus(boundaryOf(turnLocation({ status: 'open' })), 1), 'waiting');
  assert.equal(panelStatus(boundaryOf(turnLocation({ reason: 'completed' })), 0), 'done');
  assert.equal(panelStatus(boundaryOf(turnLocation({ reason: 'aborted' })), 0), 'interrupted');
  assert.equal(panelStatus(boundaryOf(turnLocation({ reason: 'max-tokens' })), 0), 'error');
  assert.equal(panelStatus(boundaryOf(undefined), 0), 'unknown');
  assert.equal(statusLabel('unknown', null, ''), '执行过程');
  assert.equal(statusLabel('error', 'max-tokens', ''), '已到输出上限');
  assert.equal(statusLabel('running', null, '正在思考'), '正在思考');
});

test('elapsed label ticks while running and reads 用时 once finished', () => {
  const running = turnLocation({ status: 'open', start: 0 });
  assert.equal(elapsedLabel(running, 134_000, 'running'), '2 分 14 秒');
  const done = turnLocation({ status: 'closed', start: 0, end: 999_000 });
  assert.equal(elapsedLabel(done, 5_000_000, 'done'), '用时 16 分 39 秒');
  assert.equal(elapsedLabel(turnLocation({ status: 'open' }), 1000, 'running'), null);
});

test('running label names the current activity', () => {
  const turn = turnLocation({ status: 'open', steps: [1] });
  (turn.steps[0]!.data as unknown as Map<string, unknown>).set('assistant-step', { status: 'running', blocks: [toolCall('c1', 'bash')] });
  assert.equal(runningLabel(turn, [], () => undefined), '正在准备命令');
  const thinking = turnLocation({ status: 'open', steps: [1] });
  const node = assistantNode(thinking, 1, [reasoning('…')], 'running');
  assert.equal(runningLabel(thinking, [node.key], getter(node)), '正在思考');
  const waitingTool = chatNode('tool-call', { root: { callId: 'c2', name: 'bash', phase: 'start', argsRaw: '{}', subCalls: [] } }, thinking, 1);
  assert.equal(runningLabel(thinking, [node.key, waitingTool.key], getter(node, waitingTool)), '正在使用工具');
});
