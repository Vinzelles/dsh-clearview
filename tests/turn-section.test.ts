import './support/dom.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReaderActionsContext, type ReaderActions } from '../src/client/reader-context.ts';
import { TurnSection } from '../src/client/TurnSection.tsx';
import { assistantNode, chatNode, chatOf, reasoning, settledTool, text, toolCall, turnLocation } from './support/chat-fixture.ts';
import { sessionHook } from './support/session.ts';

function renderTurn(nodes: ReturnType<typeof chatNode>[], turn: ReturnType<typeof turnLocation> | undefined, options: { selected?: string[]; expanded?: Record<string, boolean>; groupTurn?: number | null; actions?: Partial<ReaderActions>; pending?: unknown } = {}) {
  const chat = chatOf(nodes, turn ? [turn] : []);
  const group = { key: 'turn:1', turn: options.groupTurn === undefined ? 1 : options.groupTurn, keys: nodes.map(node => node.key) };
  const props = {
    useSession: sessionHook(chat, {}, options.pending),
    useStore: (selector: (state: unknown) => unknown) => selector({ expanded: options.expanded ?? {}, motion: true, collapseThinking: true }),
    actions: { setExpanded: () => {}, setMotion: () => {}, setCollapseThinking: () => {} },
    renderSlotChain: (_n: string, _o: unknown, value: { fallback: unknown }) => value.fallback,
    loadImage: async () => 'blob:x',
    contextT: (key: string) => key,
    group, pinnedKeys: [], selectedProcessKeys: options.selected ?? [], rewindHidden: new Set(), rewindSpans: [],
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

test('a completed turn collapses its process and keeps the answer in place', () => {
  const { turn, nodes, second } = completedTurn();
  const html = renderTurn(nodes, turn);
  assert.match(html, /data-reader-turn="1" data-reader-turn-state="closed" data-reader-turn-result="completed"/);
  assert.match(html, /data-reader-disclosure="true" data-expanded="false"/);
  assert.match(html, /已完成[\s\S]*用时 16 分 39 秒/);
  assert.match(html, new RegExp(`<article[^>]*data-reader-answer="true"[^>]*data-reader-key="${second.key}"`));
  assert.doesNotMatch(html, /我先检查一下/);
});

test('a live text selection inside the panel keeps a completed turn open', () => {
  const { turn, nodes } = completedTurn();
  const html = renderTurn(nodes, turn, { selected: ['turn:1'] });
  assert.match(html, /data-expanded="true"/);
  assert.match(html, /我先检查一下/);
});

test('a running turn stays open and names its current activity', () => {
  const turn = turnLocation({ status: 'open', start: 0, steps: [1] });
  const user = chatNode('user', { content: [{ type: 'text', text: '修构建' }] }, turn);
  const live = assistantNode(turn, 1, [reasoning('构建报错是因为')], 'running');
  const html = renderTurn([user, live], turn);
  assert.match(html, /data-status="running"/);
  assert.match(html, /data-expanded="true"/);
  assert.match(html, /正在思考/);
});

test('a window that starts mid-turn stays open and neutral', () => {
  const turn = turnLocation({ status: 'unknown', steps: [4] });
  const node = assistantNode(turn, 4, [reasoning('继续'), text('部分说明'), toolCall('c9', 'read')]);
  const tool = chatNode('tool-call', { root: settledTool('c9', 'read', { path: 'a.ts' }) }, turn, 4);
  const html = renderTurn([node, tool], turn);
  assert.match(html, /data-status="unknown"/);
  assert.match(html, /data-expanded="true"/);
  assert.match(html, /执行过程/);
});

test('a turn interrupted on a tool has no answer and stays open', () => {
  const turn = turnLocation({ status: 'closed', reason: 'aborted', steps: [1] });
  const user = chatNode('user', { content: [{ type: 'text', text: '写文件' }] }, turn);
  const only = assistantNode(turn, 1, [text('准备写入'), toolCall('c1', 'write', { path: 'a.ts' })], 'interrupted');
  const started = chatNode('tool-call', { root: { callId: 'c1', name: 'write', phase: 'start', argsRaw: '{"path":"a.ts"}', turn: 1, step: 1, time: 0, subCalls: [] } }, turn, 1);
  const html = renderTurn([user, only, started], turn);
  assert.match(html, /data-status="interrupted"/);
  assert.match(html, /data-expanded="true"/);
  assert.doesNotMatch(html, /data-reader-answer/);
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

test('a steering input admitted mid-turn keeps its rewind seat inside the panel', () => {
  const turn = turnLocation({ status: 'open', start: 0, steps: [1, 2] });
  const user = chatNode('user', { content: [{ type: 'text', text: '开始' }] }, turn);
  const first = assistantNode(turn, 1, [reasoning('先做第一步')]);
  const steering = chatNode('steering', { content: [{ type: 'text', text: '换个思路' }] }, turn, 2);
  const second = assistantNode(turn, 2, [reasoning('好的，换思路')], 'running');
  const html = renderTurn([user, first, steering, second], turn);
  assert.match(html, new RegExp(`<div[^>]*data-reader-input="steering"[^>]*data-reader-anchor="true"[^>]*data-reader-key="${steering.key}"[^>]*><p[^>]*>补充消息</p>`));
  assert.match(html, /data-reader-process="true"[\s\S]*data-reader-input="steering"/);
});

test('tool images render below the panel, ahead of the answer', () => {
  const turn = turnLocation({ status: 'closed', reason: 'completed', start: 0, end: 5_000, steps: [1, 2], closingStep: 2 });
  const user = chatNode('user', { content: [{ type: 'text', text: '截图' }] }, turn);
  const first = assistantNode(turn, 1, [toolCall('c1', 'bash', { command: 'shot' })]);
  const image = { type: 'image', attachment: { id: 'a1', mime: 'image/png' } };
  const tool = chatNode('tool-call', { root: settledTool('c1', 'bash', { command: 'shot' }, { content: [{ type: 'text', text: 'ok' }, image] }) }, turn, 1);
  const second = assistantNode(turn, 2, [text('完成')]);
  const html = renderTurn([user, first, tool, second], turn);
  const media = html.indexOf('data-reader-tool-media');
  assert.ok(media > html.indexOf('data-reader-panel'), 'media follows the panel');
  assert.ok(media < html.indexOf('data-reader-answer'), 'media precedes the answer');
});

test('closing-reply file mentions are resolved once per turn and closing seq', () => {
  const { turn, nodes } = completedTurn();
  const calls: unknown[][] = [];
  renderTurn(nodes, turn, { actions: { fileMentions: (...args) => { calls.push(args); return undefined; } } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]![1], 900);
});

const EXPANDED = /data-reader-disclosure="true" data-expanded="true"/;
const COLLAPSED = /data-reader-disclosure="true" data-expanded="false"/;

test('an errored turn keeps its panel expanded', () => {
  const turn = turnLocation({ status: 'closed', reason: 'error', steps: [1] });
  const user = chatNode('user', { content: [{ type: 'text', text: '跑一下' }] }, turn);
  const step = assistantNode(turn, 1, [reasoning('先试试'), toolCall('c1', 'bash', { command: 'ls' })]);
  const tool = chatNode('tool-call', { root: settledTool('c1', 'bash', { command: 'ls' }) }, turn, 1);
  const html = renderTurn([user, step, tool], turn);
  assert.match(html, /data-reader-panel="true" data-status="error"/);
  assert.match(html, EXPANDED);
  assert.doesNotMatch(html, COLLAPSED);
});

test('a turn waiting on the user keeps its panel expanded', () => {
  const turn = turnLocation({ status: 'open', start: 0, steps: [1] });
  const user = chatNode('user', { content: [{ type: 'text', text: '改文件' }] }, turn);
  const step = assistantNode(turn, 1, [reasoning('需要确认'), toolCall('c1', 'write', { path: 'a.ts' })], 'running');
  const html = renderTurn([user, step], turn, { pending: { kind: 'question' } });
  assert.match(html, /data-reader-panel="true" data-status="waiting"/);
  assert.match(html, /等待你的操作/);
  assert.match(html, EXPANDED);
  assert.doesNotMatch(html, COLLAPSED);
});

test('a successful command output reads beside the answer while the panel stays collapsed', () => {
  const turn = turnLocation({ status: 'closed', reason: 'completed', start: 0, end: 5_000, steps: [1], closingStep: 1 });
  const user = chatNode('user', { content: [{ type: 'text', text: '/status' }] }, turn);
  const command = chatNode('command', { name: 'status', outcome: { kind: 'success', text: '## 命令输出结果' } }, turn, 1);
  const answer = assistantNode(turn, 1, [text('已处理')]);
  const html = renderTurn([user, command, answer], turn);
  assert.match(html, COLLAPSED);
  assert.doesNotMatch(html, /data-reader-process=/);
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

test('the opening is the first user input even when a context record precedes it', () => {
  const { turn, nodes } = completedTurn();
  const context = chatNode('context', { content: [] }, turn);
  const user = nodes[0]!;
  const html = renderTurn([context, ...nodes], turn);
  const seat = html.indexOf(`data-reader-anchor="true" data-reader-key="${user.key}"`);
  assert.ok(seat >= 0, 'user bubble is rendered');
  assert.ok(seat < html.indexOf('data-reader-panel'), 'user bubble sits above the panel');
  assert.doesNotMatch(html, /data-reader-input=/);
});

test('an opened earlier range stays open for the whole turn, whatever its status', () => {
  const turn = turnLocation({ status: 'closed', reason: 'aborted', steps: [1, 2] });
  const user = chatNode('user', { content: [{ type: 'text', text: '连续做' }] }, turn);
  const first = assistantNode(turn, 1, [reasoning('第一步想法'), toolCall('c1', 'bash', { command: 'ls' })]);
  const firstTool = chatNode('tool-call', { root: settledTool('c1', 'bash', { command: 'ls' }) }, turn, 1);
  const second = assistantNode(turn, 2, [reasoning('第二步想法'), toolCall('c2', 'bash', { command: 'pwd' })], 'interrupted');
  const secondTool = chatNode('tool-call', { root: settledTool('c2', 'bash', { command: 'pwd' }) }, turn, 2);
  const nodes = [user, first, firstTool, second, secondTool];
  assert.match(renderTurn(nodes, turn), /data-reader-earlier/);
  const opened = renderTurn(nodes, turn, { expanded: { 'turn:1:earlier': true } });
  assert.doesNotMatch(opened, /data-reader-earlier/);
  assert.match(opened, /data-reader-step="步骤 1"/);
});
