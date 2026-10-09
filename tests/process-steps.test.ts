import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boundaryOf } from '../src/client/projection.ts';
import {
  elapsedLabel, layoutTurn, panelStatus, runningLabel, statusLabel, type PanelItem,
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

test('a mid-turn window with unknown status keeps earlier text as narration and trailing text as the answer', () => {
  const turn = turnLocation({ status: 'unknown', steps: [4, 5] });
  const first = assistantNode(turn, 4, [text('先看一下'), toolCall('c1', 'bash')]);
  const second = assistantNode(turn, 5, [text('结论')]);
  const layout = layoutTurn([nodeEntry(first), toolEntry('c1', 4), nodeEntry(second)], getter(first, second), boundaryOf(turn));
  assert.equal(boundaryOf(turn).status, 'unknown');
  assert.deepEqual(kinds(layout.panel), ['narration', 'tool']);
  assert.deepEqual(layout.answer.map(segment => segment.nodeKey), [second.key]);
  assert.equal(layout.panel.length + layout.answer.length, 3);
});

test('panel status is unknown for a turn whose status is unknown', () => {
  assert.equal(panelStatus(boundaryOf(turnLocation({ status: 'unknown' })), 0), 'unknown');
  assert.equal(panelStatus(boundaryOf(turnLocation({ status: 'unknown' })), 2), 'unknown');
});

test('a successful command with text is listed as an output; failures and empty results are not', () => {
  const turn = turnLocation({ status: 'closed', reason: 'completed', steps: [1], closingStep: 1 });
  const ok = chatNode('command', { outcome: { kind: 'success', text: '结果' } }, turn, 1);
  const empty = chatNode('command', { outcome: { kind: 'success', text: ' ' } }, turn, 1);
  const failed = chatNode('command', { outcome: { kind: 'error', text: '坏了' } }, turn, 1);
  const layout = layoutTurn([ok, empty, failed].map(nodeEntry), getter(ok, empty, failed), boundaryOf(turn));
  assert.deepEqual(layout.outputs, [ok.key]);
  assert.equal(layout.panel.length, 3);
});
