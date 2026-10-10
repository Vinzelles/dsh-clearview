import './support/dom.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render } from './support/render.ts';
import { createElement } from 'react';
import { ReaderActionsContext } from '../src/client/reader-context.ts';
import { InputBubble, RecordBody, RecordRow, TurnNotice, recordView, replyAnswerValues } from '../src/client/RecordRows.tsx';
import { Opening, labelsLine } from '../src/client/Opening.tsx';
import { chatNode, chatOf, turnLocation } from './support/chat-fixture.ts';
import { sessionHook } from './support/session.ts';

const blocks = { renderSlotChain: ((_n: string, _o: unknown, options: { fallback: unknown }) => options.fallback) as never, loadImage: async () => 'blob:x' };

test('record views name each lifecycle and its tone', () => {
  assert.deepEqual(recordView({ kind: 'model-retry', data: { current: { retryState: 'scheduled', retry: 2, failure: { code: 'RATE_LIMIT', status: 429 } } } }),
    { title: '模型请求未成功，正在等待重试', summary: '第 2 次 · RATE_LIMIT · HTTP 429', tone: 'active', showInChat: false });
  assert.equal(recordView({ kind: 'command', data: { name: 'compact', outcome: null } }).tone, 'active');
  assert.deepEqual(recordView({ kind: 'command', data: { name: 'goal', outcome: { kind: 'success', text: '已设定' } } }),
    { title: '命令执行完成', summary: '/goal · 已设定', tone: 'done', showInChat: false });
  assert.equal(recordView({ kind: 'command', data: { name: 'x', outcome: { kind: 'error' } } }).title, '命令执行失败');
  assert.equal(recordView({ kind: 'manual-compaction', data: { command: { outcome: { kind: 'error', text: '超时' } }, compaction: null } }).summary, '超时');
  assert.equal(recordView({ kind: 'manual-compaction', data: { command: { outcome: null }, compaction: { seq: 1 } } }).title, '上下文已整理');
  assert.equal(recordView({ kind: 'compaction', data: { shadowedItemCount: 12 } }).summary, '已整理 12 条记录 · 原始记录仍保留');
  assert.equal(recordView({ kind: 'question-reply', data: { questions: [{ id: 'q1', question: '用哪个框架？' }] } }).summary, '用哪个框架？');
  assert.equal(recordView({ kind: 'submitted-plan', data: { title: '重构计划', markdown: '# x' } }).title, '重构计划');
  assert.deepEqual(recordView({ kind: 'workflow-run', data: { name: '发布', status: 'running', phases: [{ members: [1, 2] }] } }),
    { title: '发布', summary: '运行中 · 2 个子会话 · 1 个阶段', tone: 'active', showInChat: true });
  assert.deepEqual(recordView({ kind: 'agent-teams', data: {} }), { title: '工具调用', summary: 'agent-teams', tone: 'idle', showInChat: true });
  assert.equal(recordView({ kind: 'unknown', data: { type: 'x/y' } }).summary, 'x/y');
});

test('reply answers list selected options then a non-blank custom answer', () => {
  const data = { answers: [{ id: 'q1', selected: ['React', 'Vue'], custom: '  都可以 ' }, { id: 'q2', selected: [] }] };
  assert.deepEqual(replyAnswerValues(data, 'q1'), ['React', 'Vue', '都可以']);
  assert.deepEqual(replyAnswerValues(data, 'q2'), []);
  assert.deepEqual(replyAnswerValues({}, 'q1'), []);
});

test('user labels list references then skills', () => {
  assert.equal(labelsLine({ referenceLabels: ['会话 A', 'README.md'], skillNames: ['design'] }), '引用 会话 A、README.md · 技能 design');
  assert.equal(labelsLine({}), '');
});

test('a scheduled trigger opens the turn as a trigger row, not a generic card', () => {
  const turn = turnLocation({ status: 'open' });
  const trigger = chatNode('turn-trigger', { source: { kind: 'schedule' }, content: [{ type: 'text', text: '每日巡检' }], time: Date.now() }, turn);
  const html = render(Opening, { useSession: sessionHook(chatOf([trigger], [turn])), nodeKey: trigger.key, ...blocks });
  assert.match(html, /data-reader-trigger="schedule"/);
  assert.match(html, /自动化任务/);
  assert.doesNotMatch(html, /工具调用/);
  // Triggers share the process line and its accessible disclosure; never a rewind seat.
  assert.match(html, /data-reader-line="true"/);
  assert.doesNotMatch(html, /展开原文|收起原文|data-reader-line-hint/);
  assert.match(html, /<button[^>]*aria-expanded="false"[^>]*aria-controls="[^"]+"/);
  assert.doesNotMatch(html, /data-reader-anchor/);
});

test('a user opening keeps the rewind seat contract and shows its labels', () => {
  const turn = turnLocation({ status: 'open' });
  const user = chatNode('user', { content: [{ type: 'text', text: '你好' }], skillNames: ['design'] }, turn);
  const html = render(Opening, { useSession: sessionHook(chatOf([user], [turn])), nodeKey: user.key, ...blocks });
  assert.match(html, /data-reader-user-bubble/);
  assert.match(html, new RegExp(`data-reader-anchor="true"[^>]*data-reader-key="${user.key}"`));
  assert.match(html, /你好/);
  assert.match(html, /技能 design/);
});

test('rows, inputs and notices render from their nodes', () => {
  const turn = turnLocation({ status: 'closed', reason: 'error', steps: [1] });
  const failed = chatNode('command', { name: 'compact', outcome: { kind: 'error', text: '失败' } }, turn, 1);
  const steering = chatNode('steering', { content: [{ type: 'text', text: '禁止使用子代理' }] }, turn, 1);
  const error = chatNode('turn-error', { message: 'upstream 500', code: 'HTTP_500' }, turn);
  const useSession = sessionHook(chatOf([failed, steering, error], [turn]));
  const row = render(RecordRow, { useSession, nodeKey: failed.key, t: ((key: string) => key) as never, onRead: () => {}, ...blocks });
  assert.match(row, /data-record-tone="failed"/);
  assert.match(row, /data-reader-notice-tone="danger"/);
  assert.doesNotMatch(row, /data-reader-line/);
  const input = render(InputBubble, { useSession, nodeKey: steering.key, ...blocks });
  assert.match(input, /补充消息[\s\S]*禁止使用子代理/);
  const notice = render(TurnNotice, { useSession, nodeKey: error.key });
  assert.match(notice, /本轮出现错误[\s\S]*upstream 500/);
  assert.match(notice, /data-reader-notice-tone="danger"/);
  assert.doesNotMatch(notice, /data-reader-line/);
  assert.doesNotMatch(notice, /<button/);
});

const body = (kind: string, data: unknown, showInChat?: (focus: string) => void) => {
  const view = recordView({ kind, data });
  const Seat = () => createElement(ReaderActionsContext.Provider, { value: { motion: false, showInChat } }, createElement(RecordBody, { kind, data, view, nodeKey: 'n1', ...blocks }));
  return render(Seat, {});
};

test('a question reply lists selected and custom answers and marks unanswered questions', () => {
  const html = body('question-reply', {
    questions: [{ id: 'q1', question: '用哪个框架？' }, { id: 'q2', question: '要测试吗？' }],
    answers: [{ id: 'q1', selected: ['React'], custom: '也可以 Vue' }],
  });
  assert.match(html, /用哪个框架？[\s\S]*<li>React<\/li><li>也可以 Vue<\/li>/);
  assert.match(html, /要测试吗？[\s\S]*未作答/);
});

test('an unreadable question reply falls back to its model-facing text', () => {
  const data = { questions: 'broken', text: '用户选择了 React\n并补充说明' };
  assert.equal(recordView({ kind: 'question-reply', data }).summary, '用户选择了 React');
  const html = body('question-reply', data);
  assert.match(html, /replyText[^>]*>用户选择了 React\n并补充说明</);
  assert.doesNotMatch(html, /未作答/);
});

test('a submitted plan shows its title in the row and its markdown in the body', () => {
  const data = { title: '重构计划', markdown: '第一步：拆分模块' };
  const turn = turnLocation({ status: 'closed', steps: [1] });
  const plan = chatNode('submitted-plan', data, turn, 1);
  const row = render(RecordRow, { useSession: sessionHook(chatOf([plan], [turn])), nodeKey: plan.key, t: ((key: string) => key) as never, onRead: () => {}, ...blocks });
  assert.match(row, /重构计划/);
  assert.match(body('submitted-plan', data), /第一步：拆分模块/);
});

test('generic cards offer 在对话中查看 only when the host can show them', () => {
  for (const [kind, data] of [['workflow-run', { name: '发布', status: 'running', phases: [] }], ['agent-teams', {}]] as const) {
    assert.match(body(kind, data, () => {}), /data-reader-show-in-chat[^>]*>在对话中查看/);
    assert.doesNotMatch(body(kind, data), /在对话中查看/);
  }
  assert.doesNotMatch(body('command', { name: 'x', outcome: null }, () => {}), /在对话中查看/);
});

test('a steering input keeps the seat the rewind bridge reads', () => {
  const turn = turnLocation({ status: 'open', steps: [1] });
  const steering = chatNode('steering', { content: [{ type: 'text', text: '换个方案' }] }, turn, 1);
  const html = render(InputBubble, { useSession: sessionHook(chatOf([steering], [turn])), nodeKey: steering.key, ...blocks });
  // The bridge matches div[data-reader-anchor][data-reader-key] (not article) and reads a first-child <p> whose class contains "meta".
  assert.match(html, new RegExp(`data-reader-user-bubble[^>]*data-reader-input="steering"[^>]*data-reader-anchor="true"[^>]*data-reader-key="${steering.key}"[^>]*><p class="meta">补充消息</p>`));
});

test('once the turn is closed an in-flight lifecycle record settles to idle with neutral wording', () => {
  const started = { kind: 'model-retry', data: { current: { retryState: 'started', retry: 1 } } };
  const scheduled = { kind: 'model-retry', data: { current: { retryState: 'scheduled', retry: 1 } } };
  assert.equal(recordView(started).tone, 'active');
  assert.equal(recordView(started).title, '模型请求正在重试');
  for (const node of [started, scheduled]) {
    assert.deepEqual([recordView(node, true).tone, recordView(node, true).title], ['idle', '模型请求重试记录']);
  }
  assert.equal(recordView(started, true).summary, '第 1 次');
  assert.deepEqual([recordView({ kind: 'command', data: { name: 'x', outcome: null } }, true).tone, recordView({ kind: 'command', data: { name: 'x', outcome: null } }, true).title], ['idle', '命令记录']);
  assert.equal(recordView({ kind: 'manual-compaction', data: { command: { outcome: null }, compaction: null } }, true).tone, 'idle');
  assert.equal(recordView({ kind: 'workflow-run', data: { name: '发布', status: 'running', phases: [] } }, true).tone, 'idle');
  // Settled outcomes are untouched.
  assert.equal(recordView({ kind: 'command', data: { name: 'x', outcome: { kind: 'error' } } }, true).tone, 'failed');
  assert.equal(recordView({ kind: 'compaction', data: {} }, true).tone, 'done');
});

test('a retry record in a closed turn renders without an ongoing dot; in an open turn it stays active', () => {
  const closed = turnLocation({ status: 'closed', reason: 'error', steps: [1] });
  const open = turnLocation({ status: 'open', steps: [1] });
  const retry = chatNode('model-retry', { current: { retryState: 'started', retry: 1 }, attempts: [] }, closed, 1);
  const props = { nodeKey: retry.key, t: ((key: string) => key) as never, onRead: () => {}, ...blocks };
  const settled = render(RecordRow, { useSession: sessionHook(chatOf([retry], [closed])), ...props, turnClosed: true });
  assert.match(settled, /data-record-tone="idle"/);
  assert.match(settled, /模型请求重试记录/);
  assert.match(settled, /data-reader-notice-tone="warning"/);
  assert.doesNotMatch(settled, /data-reader-line/);
  assert.doesNotMatch(settled, /data-tone="running"|正在重试/);
  const live = render(RecordRow, { useSession: sessionHook(chatOf([retry], [open])), ...props, turnClosed: false });
  assert.match(live, /data-record-tone="active"/);
  assert.match(live, /data-reader-notice-tone="warning"/);
  assert.match(live, /aria-expanded="false"[^>]*aria-controls="[^"]+"/);
  assert.doesNotMatch(live, /data-reader-line/);
  assert.match(live, /模型请求正在重试/);
});
