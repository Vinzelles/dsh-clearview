import './support/dom.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render } from './support/render.ts';
import { InputBubble, RecordRow, TurnNotice, recordView, replyAnswerValues } from '../src/client/RecordRows.tsx';
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
});

test('a user opening keeps the rewind seat contract and shows its labels', () => {
  const turn = turnLocation({ status: 'open' });
  const user = chatNode('user', { content: [{ type: 'text', text: '你好' }], skillNames: ['design'] }, turn);
  const html = render(Opening, { useSession: sessionHook(chatOf([user], [turn])), nodeKey: user.key, ...blocks });
  assert.match(html, new RegExp(`<div class="user" data-reader-anchor="true" data-reader-key="${user.key}"`));
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
  assert.match(row, /data-stub="StateDot" data-state="error"/);
  const input = render(InputBubble, { useSession, nodeKey: steering.key, ...blocks });
  assert.match(input, /补充消息[\s\S]*禁止使用子代理/);
  const notice = render(TurnNotice, { useSession, nodeKey: error.key });
  assert.match(notice, /本轮出现错误[\s\S]*upstream 500[\s\S]*HTTP_500/);
});
