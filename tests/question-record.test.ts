import './support/dom.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { questionHistory } from '../src/client/question-record.ts';
import { ReaderActionsContext } from '../src/client/reader-context.ts';
import { ToolRow } from '../src/client/ToolRow.tsx';
import { ToolDetails } from '../src/client/ToolDetails.tsx';
import { TurnSection } from '../src/client/TurnSection.tsx';
import { buildTranscript } from '../src/client/transcript-model.ts';
import { isProcessEntry } from '../src/client/turn-process.ts';
import { activitySummary } from '../src/client/tool-activity.ts';
import { assistantNode, chatNode, chatOf, settledTool, text, toolCall, toolEntry, turnLocation } from './support/chat-fixture.ts';
import { sessionHook } from './support/session.ts';
import { render } from './support/render.ts';

const questions = [
  { id: 'scope', header: '修复范围', question: '这次要修复哪些问题？', options: [{ label: '完整修复（推荐）', description: '同时处理输入框和折叠。' }, { label: '仅修复输入框' }] },
  { id: 'notes', question: '还有什么需要保留？', detail: '可自由补充。' },
];
const answered = (answers: unknown, input: unknown = questions, over: Record<string, unknown> = {}) => toolEntry('qa', 1,
  settledTool('qa', 'ask_user_question', { questions: input }, { content: [{ type: 'text', text: JSON.stringify({ answers }) }], ...over }));
const renderProps = { renderSlotChain: ((_n: string, _o: unknown, value: { fallback: unknown }) => value.fallback) as never, loadImage: async () => 'blob:x' };
function row(entry: ReturnType<typeof toolEntry>, turnClosed = true, inspectCall?: (id: string) => void) {
  return render(() => createElement(ReaderActionsContext.Provider, { value: { motion: false, inspectCall } }, createElement(ToolRow,
    { entry, turnClosed, onRead: () => {}, ...renderProps })), {});
}

test('answers match question IDs, preserve input order, multiple selections and verbatim custom text', () => {
  const entry = answered([{ id: 'notes', selected: [], custom: '保留动画\n和完整正文。' }, { id: 'scope', selected: ['完整修复（推荐）', '另一个选择'], custom: '  请保留原记录  ' }]);
  const before = JSON.stringify(entry);
  const model = questionHistory(entry, 'returned');
  assert.equal(model.status, '已回答 2 / 2');
  assert.deepEqual(model.questions.map(q => q.id), ['scope', 'notes']);
  assert.deepEqual(model.questions[0].selected, ['完整修复（推荐）', '另一个选择']);
  assert.equal(model.questions[0].custom, '  请保留原记录  ');
  assert.equal(model.questions[1].custom, '保留动画\n和完整正文。');
  assert.equal(model.questions[0].options[0].description, '同时处理输入框和折叠。');
  assert.equal(JSON.stringify(entry), before);
});

test('empty answers and explicit skipped items are not reported as decisions', () => {
  for (const answers of [[], questions.map(q => ({ id: q.id, selected: [], custom: ' \n ' }))]) {
    const model = questionHistory(answered(answers), 'returned');
    assert.equal(model.state, 'skipped');
    assert.equal(model.status, '未作答');
    assert.ok(model.questions.every(q => q.answerState === 'skipped'));
  }
});

test('missing and unknown answer IDs are flagged, never assigned by their position', () => {
  const model = questionHistory(answered([{ id: 'not-scope', selected: ['不能错配'] }, { id: 'notes', selected: ['正确匹配'] }]), 'returned');
  assert.equal(model.state, 'partial');
  assert.equal(model.questions[0].answerState, 'missing');
  assert.deepEqual(model.questions[0].selected, []);
  assert.deepEqual(model.questions[1].selected, ['正确匹配']);
  assert.match(model.note!, /未能匹配/);
});

test('duplicate IDs and malformed answer fields fall back honestly without fabricating selections', () => {
  for (const answers of [null, {}, [{ id: 'scope', selected: '完整修复' }], [{ id: 'scope', selected: [false] }],
    [{ id: 'scope', selected: [], custom: 123 }], [{ id: 'scope', selected: ['A'] }, { id: 'scope', selected: ['B'] }]]) {
    const model = questionHistory(answered(answers), 'returned');
    assert.equal(model.state, 'unreadable');
    assert.ok(model.questions.every(q => q.answerState === 'unavailable' && q.selected.length === 0));
  }
  for (const input of [null, [], [{ question: '没有 ID' }], [questions[0], questions[0]]]) {
    assert.equal(questionHistory(answered([], input), 'returned').status, '问题内容无法解析');
  }
});

test('failed/interrupted calls cannot make a result-shaped payload look like a user decision', () => {
  for (const phase of ['failed', 'interrupted'] as const) {
    const model = questionHistory(answered([{ id: 'scope', selected: ['不应显示'] }]), phase);
    assert.equal(model.state, phase);
    assert.ok(model.questions.every(q => q.selected.length === 0));
    assert.doesNotMatch(JSON.stringify(model), /不应显示/);
  }
  const draft = toolEntry('pending', 1, undefined, toolCall('pending', 'ask_user_question', { questions }));
  assert.equal(questionHistory(draft, 'preparing').questions[0].answerState, 'pending');
  assert.match(row(draft, false), /等待用户回答/);
  assert.doesNotMatch(row(draft, true), /等待用户回答|已回答 \d/);
});

test('a completed question tool displays the question and answer immediately and keeps raw/inspect entry points', () => {
  const html = row(answered([{ id: 'scope', selected: ['完整修复（推荐）'] }, { id: 'notes', selected: [], custom: '保留动画。' }]), true, () => {});
  assert.match(html, /data-reader-question-record/);
  assert.match(html, /这次要修复哪些问题？/);
  assert.match(html, /用户回答/);
  assert.match(html, /完整修复（推荐）/);
  assert.match(html, /保留动画。/);
  assert.match(html, /data-reader-question-original[^>]*>.*原始记录/s);
  assert.match(html, /data-reader-inspect/);
  assert.doesNotMatch(html, /ask_user_question|&quot;answers&quot;|role="(?:radio|checkbox)"|type="(?:radio|checkbox)"|<form/);
});

test('question and custom text are rendered safely as readable text, including line breaks', () => {
  const entry = answered([{ id: 'q', selected: [], custom: '<script>alert(1)</script>\n第二行' }], [{ id: 'q', question: '<img src=x onerror=alert(1)>' }]);
  const html = row(entry);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;\n第二行/);
  assert.doesNotMatch(html, /<script>|<img src=x/);
});

test('raw question details start on original data while ordinary tools still start on the result', () => {
  const entry = answered([{ id: 'scope', selected: ['完整修复（推荐）'] }]);
  const raw = render(ToolDetails, { entry, model: activitySummary(entry), phase: 'returned', initialTab: 'raw', ...renderProps });
  assert.match(raw, /原始数据/);
  assert.match(raw, /工具输入/);
  assert.match(raw, /&quot;questions&quot;/);
  assert.match(raw, /&quot;answers/);
});

test('question calls form a grouping boundary and their receipts survive whole-turn folding', () => {
  const qa = answered([{ id: 'scope', selected: ['完整修复（推荐）'] }]);
  const entries = [toolEntry('read-a', 1, settledTool('read-a', 'read', {})), qa, toolEntry('read-b', 1, settledTool('read-b', 'read', {}))]
    .map(entry => ({ kind: 'tool' as const, key: entry.key, entry, step: 1 }));
  const transcript = buildTranscript(entries, () => undefined, true);
  assert.deepEqual(transcript.map(entry => entry.key), entries.map(entry => entry.key));
  assert.equal(transcript[1].kind, 'item');
  assert.equal(isProcessEntry(transcript[1]), false);
  assert.equal(isProcessEntry(transcript[0]), true);
});

test('a complete folded turn retains a visible question receipt alongside its final answer', () => {
  const turn = turnLocation({ steps: [1, 2], closingStep: 2 });
  const nodes = [chatNode('user', { content: [{ type: 'text', text: '请检查' }] }, turn),
    assistantNode(turn, 1, [toolCall('qa', 'ask_user_question', { questions })]),
    chatNode('tool-call', { root: answered([{ id: 'scope', selected: ['完整修复（推荐）'] }]).block }, turn, 1),
    assistantNode(turn, 2, [text('修复已完成。')])];
  const html = render(() => createElement(ReaderActionsContext.Provider, { value: { motion: false } }, createElement(TurnSection, {
    ...renderProps, sessionId: 's1', useSession: sessionHook(chatOf(nodes, [turn])),
    useStore: ((selector: (state: unknown) => unknown) => selector({ expanded: {} })) as never,
    actions: { setExpanded: () => {}, setMotion: () => {} }, contextT: (key: string) => key,
    group: { key: 'turn:1', turn: 1, keys: nodes.map(node => node.key) }, pinnedKeys: [], rewindHidden: new Set<number>(), rewindSpans: [],
  })), {});
  assert.match(html, /data-reader-process-entry="false"[^>]*data-folded="false"[^>]*>[\s\S]*data-reader-question-record/);
  assert.match(html, /修复已完成。/);
  assert.match(html, /完整修复（推荐）/);
});
