import './support/dom.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReaderActionsContext, type ReaderActions } from '../src/client/reader-context.ts';
import { TurnSection } from '../src/client/TurnSection.tsx';
import { assistantNode, chatNode, chatOf, reasoning, settledTool, text, toolCall, turnLocation } from './support/chat-fixture.ts';
import { sessionHook } from './support/session.ts';

function renderTurn(nodes: ReturnType<typeof chatNode>[], turn: ReturnType<typeof turnLocation> | undefined, options: { expanded?: Record<string, boolean>; groupTurn?: number | null; pinnedKeys?: string[]; actions?: Partial<ReaderActions>; pending?: unknown } = {}) {
  const chat = chatOf(nodes, turn ? [turn] : []);
  const group = { key: 'turn:1', turn: options.groupTurn === undefined ? 1 : options.groupTurn, keys: nodes.map(node => node.key) };
  const props = {
    sessionId: 'test-session',
    useSession: sessionHook(chat, {}, options.pending),
    useStore: (selector: (state: unknown) => unknown) => selector({ expanded: options.expanded ?? {}, motion: true }),
    actions: { setExpanded: () => {}, setMotion: () => {} },
    renderSlotChain: (_n: string, _o: unknown, value: { fallback: unknown }) => value.fallback,
    loadImage: async () => 'blob:x',
    contextT: (key: string) => key,
    group, pinnedKeys: options.pinnedKeys ?? [], rewindHidden: new Set(), rewindSpans: [],
  };
  const original = console.error;
  console.error = (...args: unknown[]) => { if (!String(args[0]).includes('useLayoutEffect')) original(...args); };
  try {
    return renderToStaticMarkup(createElement(ReaderActionsContext.Provider, { value: { motion: true, ...options.actions } }, createElement(TurnSection, props as never)));
  } finally { console.error = original; }
}

function completedTurn() {
  const turn = turnLocation({ status: 'closed', reason: 'completed', start: 0, end: 999_000, steps: [1, 2], closingStep: 2 });
  const user = chatNode('user', { content: [{ type: 'text', text: '做一个场景' }] }, turn);
  const first = assistantNode(turn, 1, [reasoning('先看工作区'), text('我先检查一下。'), toolCall('c1', 'bash', { command: 'ls' })]);
  const tool = chatNode('tool-call', { root: settledTool('c1', 'bash', { command: 'ls' }) }, turn, 1);
  const second = assistantNode(turn, 2, [text('## 实际验证结果')]);
  return { turn, nodes: [user, first, tool, second], second };
}

test('a completed turn folds its process without discarding it and keeps the answer visible', () => {
  const { turn, nodes, second } = completedTurn();
  const html = renderTurn(nodes, turn);
  assert.match(html, /data-reader-turn="1" data-reader-turn-state="closed" data-reader-turn-result="completed"/);
  assert.match(html, /我先检查一下。/);
  assert.match(html, /data-reader-flow/);
  assert.match(html, new RegExp(`<article[^>]*data-reader-answer="true"[^>]*data-reader-key="${second.key}"`));
  assert.match(html, /data-reader-turn-disclosure="true"[^>]*aria-expanded="false"/);
  assert.match(html, /data-reader-process-entry="true"[^>]*data-folded="true"/);
  const answerAt = html.indexOf('data-reader-answer="true"');
  const seatAt = html.lastIndexOf('data-reader-process-entry=', answerAt);
  assert.match(html.slice(seatAt, answerAt), /data-reader-process-entry="false"[^>]*data-folded="false"/);
  for (const retired of ['data-reader-panel', 'data-reader-process=', 'data-reader-earlier', 'data-reader-cluster', '前 \\d+ 步', '毫秒']) {
    assert.doesNotMatch(html, new RegExp(retired), retired);
  }
  assert.doesNotMatch(html, /data-reader-status-line/);
});

test('the saved completed-process choice keeps its contents expanded', () => {
  const { turn, nodes } = completedTurn();
  const html = renderTurn(nodes, turn, { expanded: { 'process:test-session:turn:1': true } });
  assert.match(html, /data-reader-turn-disclosure="true"[^>]*aria-expanded="true"/);
  assert.doesNotMatch(html, /data-folded="true"/);
  assert.match(html, /aria-label="[^"]*收起过程"/);
  assert.doesNotMatch(html, />收起过程</);
});

test('an open turn ends with the status line and renders live thinking exactly once, below it', () => {
  const turn = turnLocation({ status: 'open', start: 0, steps: [1] });
  const user = chatNode('user', { content: [{ type: 'text', text: '继续' }] }, turn);
  const step = assistantNode(turn, 1, [text('先看一下。'), reasoning('But the 围脊 boxes')], 'running');
  const html = renderTurn([user, step], turn);
  assert.equal(html.match(/data-reader-live-thought/g)?.length, 1);
  assert.equal(html.match(/But the 围脊 boxes/g)?.length, 1);
  assert.match(html, /data-reader-status-line[^>]*data-phase="running"[\s\S]*data-reader-live-thought/);
  assert.match(html, /思考中…/);
});

test('an interrupted turn shows a red status line and keeps everything', () => {
  const turn = turnLocation({ status: 'closed', reason: 'interrupted', start: 0, end: 5_000, steps: [1], closingStep: null });
  const step = assistantNode(turn, 1, [text('写到一半'), toolCall('c1', 'bash', { command: 'ls' })], 'interrupted');
  const html = renderTurn([chatNode('user', { content: [{ type: 'text', text: 'x' }] }, turn), step], turn);
  assert.match(html, /data-reader-status-line[^>]*data-phase="interrupted"/);
  assert.match(html, /写到一半/);
});

test('a long turn keeps every narration paragraph', () => {
  const turn = turnLocation({ status: 'closed', reason: 'completed', start: 0, end: 9_000, steps: [1, 2, 3, 4, 5, 6], closingStep: 6 });
  const nodes = [chatNode('user', { content: [{ type: 'text', text: 'go' }] }, turn)];
  for (let step = 1; step <= 5; step++) {
    nodes.push(assistantNode(turn, step, [text(`第 ${step} 段说明`), toolCall(`a${step}`, 'bash', { command: 'ls' }), toolCall(`b${step}`, 'read', { path: 'x' })]));
    nodes.push(chatNode('tool-call', { root: settledTool(`a${step}`, 'bash', { command: 'ls' }) }, turn, step));
    nodes.push(chatNode('tool-call', { root: settledTool(`b${step}`, 'read', { path: 'x' }) }, turn, step));
  }
  nodes.push(assistantNode(turn, 6, [text('最终回答')]));
  const html = renderTurn(nodes, turn);
  for (let step = 1; step <= 5; step++) assert.match(html, new RegExp(`第 ${step} 段说明`));
  assert.equal(html.match(/data-reader-group=/g)?.length, 5);
});

test('a turn waiting on the user says so in the status line', () => {
  const turn = turnLocation({ status: 'open', start: 0, steps: [1] });
  const user = chatNode('user', { content: [{ type: 'text', text: '改文件' }] }, turn);
  const step = assistantNode(turn, 1, [text('需要确认'), toolCall('c1', 'write', { path: 'a.ts' })], 'running');
  const html = renderTurn([user, step], turn, { pending: { kind: 'question' } });
  assert.match(html, /data-reader-status-line[^>]*data-phase="waiting"/);
  assert.match(html, /等待你的操作/);
});

test('an errored turn shows a red status line', () => {
  const turn = turnLocation({ status: 'closed', reason: 'error', steps: [1] });
  const step = assistantNode(turn, 1, [text('先试试'), toolCall('c1', 'bash', { command: 'ls' })]);
  const tool = chatNode('tool-call', { root: settledTool('c1', 'bash', { command: 'ls' }) }, turn, 1);
  const html = renderTurn([chatNode('user', { content: [{ type: 'text', text: '跑一下' }] }, turn), step, tool], turn);
  assert.match(html, /data-reader-status-line[^>]*data-phase="error"/);
});

test('the flow carries the attributes text-selection pinning reads, and a pinned turn still renders its narration', () => {
  const { turn, nodes } = completedTurn();
  const html = renderTurn(nodes, turn);
  assert.match(html, /<div[^>]*data-reader-flow="true"[^>]*data-reader-process-key="turn:1"/);
  const pinned = renderTurn(nodes, turn, { pinnedKeys: ['turn:1'] });
  assert.match(pinned, /data-reader-process-key="turn:1"/);
  assert.match(pinned, /我先检查一下。/);
});

test('a turn of unknown status shows neither the running nor a red status line', () => {
  const turn = turnLocation({ status: 'unknown', steps: [4] });
  const html = renderTurn([assistantNode(turn, 4, [text('部分说明'), toolCall('c9', 'read')])], turn);
  assert.doesNotMatch(html, /data-reader-status-line/);
  assert.match(html, /部分说明/);
});

test('an aborted turn without an answer ends with a red status line', () => {
  const turn = turnLocation({ status: 'closed', reason: 'aborted', steps: [1] });
  const step = assistantNode(turn, 1, [text('准备写入'), toolCall('c1', 'write', { path: 'a.ts' })], 'interrupted');
  const started = chatNode('tool-call', { root: { callId: 'c1', name: 'write', phase: 'start', argsRaw: '{"path":"a.ts"}', turn: 1, step: 1, time: 0, subCalls: [] } }, turn, 1);
  const html = renderTurn([chatNode('user', { content: [{ type: 'text', text: '写文件' }] }, turn), step, started], turn);
  assert.match(html, /data-reader-status-line[^>]*data-phase="interrupted"/);
  assert.doesNotMatch(html, /data-reader-answer/);
  assert.match(html, /准备写入/);
});

test('a scheduled trigger opens its turn without a generic card', () => {
  const turn = turnLocation({ status: 'closed', reason: 'completed', steps: [1], closingStep: 1 });
  const trigger = chatNode('turn-trigger', { source: { kind: 'schedule' }, content: [{ type: 'text', text: '巡检' }], time: 0 }, turn);
  const answer = assistantNode(turn, 1, [text('一切正常')]);
  const html = renderTurn([trigger, answer], turn);
  assert.match(html, /data-reader-trigger="schedule"/);
  assert.doesNotMatch(html, /工具调用/);
  assert.match(html, /一切正常/);
});

test('a steering input admitted mid-turn keeps its rewind seat inside the flow', () => {
  const turn = turnLocation({ status: 'open', start: 0, steps: [1, 2] });
  const user = chatNode('user', { content: [{ type: 'text', text: '开始' }] }, turn);
  const first = assistantNode(turn, 1, [reasoning('先做第一步')]);
  const steering = chatNode('steering', { content: [{ type: 'text', text: '换个思路' }] }, turn, 2);
  const second = assistantNode(turn, 2, [reasoning('好的，换思路')], 'running');
  const html = renderTurn([user, first, steering, second], turn);
  assert.match(html, new RegExp(`<div[^>]*data-reader-input="steering"[^>]*data-reader-anchor="true"[^>]*data-reader-key="${steering.key}"[^>]*><div[^>]*data-reader-user-bubble[^>]*><p[^>]*>补充消息</p>`));
  assert.match(html, /data-reader-flow[\s\S]*data-reader-input="steering"/);
});

test('tool images render below the flow, ahead of the answer', () => {
  const turn = turnLocation({ status: 'closed', reason: 'completed', start: 0, end: 5_000, steps: [1, 2], closingStep: 2 });
  const user = chatNode('user', { content: [{ type: 'text', text: '截图' }] }, turn);
  const first = assistantNode(turn, 1, [toolCall('c1', 'bash', { command: 'shot' })]);
  const image = { type: 'image', attachment: { id: 'a1', mime: 'image/png' } };
  const tool = chatNode('tool-call', { root: settledTool('c1', 'bash', { command: 'shot' }, { content: [{ type: 'text', text: 'ok' }, image] }) }, turn, 1);
  const second = assistantNode(turn, 2, [text('完成')]);
  const html = renderTurn([user, first, tool, second], turn);
  const media = html.indexOf('data-reader-tool-media');
  assert.ok(media > html.indexOf('data-reader-flow'), 'media follows the flow');
  assert.ok(media < html.indexOf('data-reader-answer'), 'media precedes the answer');
});

test('media from a standalone subagent remains visible without opening its details', () => {
  const turn = turnLocation({ status: 'closed', reason: 'completed', steps: [1, 2], closingStep: 2 });
  const first = assistantNode(turn, 1, [toolCall('agent', 'dispatch', { description: '截图任务' })]);
  const image = { type: 'image', attachment: { attachmentId: 'subimage', mime: 'image/png' } };
  const child = settledTool('child', 'screenshot', {}, { content: [image] });
  const tool = chatNode('tool-call', { root: settledTool('agent', 'dispatch', { description: '截图任务' }, { subCalls: [child] }) }, turn, 1);
  const answer = assistantNode(turn, 2, [text('子任务完成')]);
  const html = renderTurn([first, tool, answer], turn);
  assert.match(html, /data-reader-tool-call="agent"[^>]*data-expanded="false"/);
  assert.match(html, /data-reader-tool-media/);
  assert.ok(html.indexOf('data-reader-tool-media') < html.indexOf('data-reader-answer'));
});

test('closing-reply file mentions are resolved once per turn and closing seq', () => {
  const { turn, nodes } = completedTurn();
  const calls: unknown[][] = [];
  renderTurn(nodes, turn, { actions: { fileMentions: (...args) => { calls.push(args); return undefined; } } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]![1], 900);
});

test('a successful command output reads beside the answer', () => {
  const turn = turnLocation({ status: 'closed', reason: 'completed', start: 0, end: 5_000, steps: [1], closingStep: 1 });
  const user = chatNode('user', { content: [{ type: 'text', text: '/status' }] }, turn);
  const command = chatNode('command', { name: 'status', outcome: { kind: 'success', text: '## 命令输出结果' } }, turn, 1);
  const answer = assistantNode(turn, 1, [text('已处理')]);
  const html = renderTurn([user, command, answer], turn);
  assert.match(html, /data-reader-command-output="true"[^>]*>[\s\S]*命令输出结果/);
});

test('a failed command keeps its text out of the answer zone', () => {
  const turn = turnLocation({ status: 'closed', reason: 'completed', start: 0, end: 5_000, steps: [1], closingStep: 1 });
  const user = chatNode('user', { content: [{ type: 'text', text: '/status' }] }, turn);
  const command = chatNode('command', { name: 'status', outcome: { kind: 'error', text: '执行失败详情' } }, turn, 1);
  const answer = assistantNode(turn, 1, [text('已处理')]);
  const html = renderTurn([user, command, answer], turn);
  assert.doesNotMatch(html, /data-reader-command-output/);
});

test('earlier media, a command result and subsequent narration remain in source order', () => {
  const turn = turnLocation({ status: 'closed', reason: 'completed', steps: [1, 2], closingStep: 2 });
  const first = assistantNode(turn, 1, [text('第一段说明'), { kind: 'image', attachment: { attachmentId: 'a1', mime: 'image/png' } }]);
  const command = chatNode('command', { name: 'status', outcome: { kind: 'success', text: '中途命令结果' } }, turn, 1);
  const later = assistantNode(turn, 1, [text('命令之后的说明'), toolCall('later', 'read', { path: 'a.ts' })]);
  const tool = chatNode('tool-call', { root: settledTool('later', 'read', { path: 'a.ts' }) }, turn, 1);
  const answer = assistantNode(turn, 2, [text('最终回答')]);
  const html = renderTurn([first, command, later, tool, answer], turn);
  const positions = ['第一段说明', 'data-reader-command-output', '命令之后的说明', 'data-reader-tool-call', 'data-reader-answer'].map(value => html.indexOf(value));
  assert.ok(positions.every((value, index) => value >= 0 && (index === 0 || value > positions[index - 1]!)), `chronological positions: ${positions}`);
});

test('plan updates reuse one card and retain failed calls and the last successful checklist', () => {
  const turn = turnLocation({ status: 'closed', reason: 'completed', steps: [1, 2, 3], closingStep: 3 });
  const saved = { todos: [{ content: '已保存任务', status: 'pending' }] };
  const rejected = { todos: [{ content: '被拒绝的新任务', status: 'completed' }] };
  const first = assistantNode(turn, 1, [toolCall('plan1', 'todo_write', saved)]);
  const ok = chatNode('tool-call', { root: settledTool('plan1', 'todo_write', saved) }, turn, 1);
  const next = assistantNode(turn, 2, [toolCall('plan2', 'todo_write', rejected)]);
  const failure = chatNode('tool-call', { root: settledTool('plan2', 'todo_write', rejected, { isError: true, content: [{ type: 'text', text: '清单验证失败' }] }) }, turn, 2);
  const answer = assistantNode(turn, 3, [text('结束')]);
  const html = renderTurn([first, ok, next, failure, answer], turn);
  assert.equal(html.match(/data-reader-plan="true"/g)?.length, 1);
  assert.match(html, /data-reader-plan="true"[^>]*data-tone="failed"/);
  assert.match(html, /计划更新失败 · 显示上次成功清单/);
  assert.match(html, /已保存任务/);
  assert.doesNotMatch(html.split('<details')[0]!, /被拒绝的新任务/, 'the rejected data is never presented as the saved checklist');
  assert.match(html, /被拒绝的新任务/, 'the original failed call remains inspectable');
  assert.match(html, /data-reader-plan-calls/);
  assert.match(html, /data-reader-tool-call="plan1"/);
  assert.match(html, /data-reader-tool-call="plan2"/);
});

test('the opening is the first user input even when a context record precedes it', () => {
  const { turn, nodes } = completedTurn();
  const context = chatNode('context', { content: [], form: null, source: null, producer: { role: 'injection', name: 'x' } }, turn);
  const user = nodes[0]!;
  const html = renderTurn([context, ...nodes], turn);
  const seat = html.indexOf(`data-reader-anchor="true" data-reader-key="${user.key}"`);
  assert.ok(seat >= 0, 'user bubble is rendered');
  assert.ok(seat < html.indexOf('data-reader-flow'), 'user bubble sits above the flow');
  assert.doesNotMatch(html, /data-reader-input=/);
});

test('the footer and every flow row sit inside their own BlockBoundary, never around the section', () => {
  // Server rendering has no error boundaries, so the isolation is pinned on the source shape.
  const source = readFileSync(new URL('../src/client/TurnSection.tsx', import.meta.url), 'utf8');
  assert.match(source, /<BlockBoundary><TurnFooter [^>]*\/><\/BlockBoundary>/);
  assert.doesNotMatch(source, /<BlockBoundary>\s*<section/);
  assert.match(source, /<section className=\{css\.turn\} data-reader-turn=/);
});

test('an open turn keeps its process group expanded while it is still the live tail', () => {
  // Between two steps nothing runs for a moment: the last thought has settled and every tool has returned.
  // The tail group must not fold here, or the reader watches the same block collapse and reopen per step.
  const turn = turnLocation({ status: 'open', start: 0, steps: [1] });
  const user = chatNode('user', { content: [{ type: 'text', text: '跑一批命令' }] }, turn);
  const step = assistantNode(turn, 1, [reasoning('先看工作区'), toolCall('c1', 'bash', { command: 'ls' }), toolCall('c2', 'bash', { command: 'Get-ChildItem' })]);
  const first = chatNode('tool-call', { root: settledTool('c1', 'bash', { command: 'ls' }) }, turn, 1);
  const second = chatNode('tool-call', { root: settledTool('c2', 'bash', { command: 'Get-ChildItem' }) }, turn, 1);
  const html = renderTurn([user, step, first, second], turn);
  assert.match(html, /data-reader-turn-state="open"/);
  assert.match(html, /data-reader-group="[^"]+"[^>]*data-group-state="settled"[^>]*data-expanded="true"/);
});

test('a closed turn still folds its settled process group behind the disclosure', () => {
  const { turn, nodes } = completedTurn();
  const html = renderTurn(nodes, turn);
  assert.match(html, /data-reader-group="[^"]+"[^>]*data-group-state="settled"[^>]*data-expanded="false"/);
});

test('a closed turn shows an unfinished retry record as settled, an open turn keeps it active', () => {
  const retryData = { current: { retryState: 'started', retry: 1 }, attempts: [] };
  const closedTurn = turnLocation({ status: 'closed', reason: 'error', steps: [1] });
  const closedRetry = chatNode('model-retry', retryData, closedTurn, 1);
  const closed = renderTurn([chatNode('user', { content: [{ type: 'text', text: '跑' }] }, closedTurn), closedRetry], closedTurn);
  assert.match(closed, /data-record-tone="idle"/);
  assert.doesNotMatch(closed, /data-record-tone="active"|正在重试/);
  const openTurn = turnLocation({ status: 'open', steps: [1] });
  const openRetry = chatNode('model-retry', retryData, openTurn, 1);
  const open = renderTurn([chatNode('user', { content: [{ type: 'text', text: '跑' }] }, openTurn), openRetry], openTurn);
  assert.match(open, /data-record-tone="active"/);
});
