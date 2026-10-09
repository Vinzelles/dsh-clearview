import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PanelItem } from '../src/client/process-steps.ts';
import { buildTranscript, diffStat, groupSummary, liveThoughtKey, parseTodos, planStatus, isOperational, type PlanEntry, type TranscriptEntry } from '../src/client/transcript-model.ts';
import { assistantNode, chatNode, reasoning, settledTool, text, toolCall, toolEntry, turnLocation } from './support/chat-fixture.ts';

const turn = turnLocation({ steps: [1] });
const none = () => undefined;
const tool = (id: string, name: string, args: Record<string, unknown> = {}, over: Record<string, unknown> = {}): PanelItem =>
  ({ kind: 'tool', key: `reader-tool:${id}`, entry: toolEntry(id, 1, settledTool(id, name, args, over)), step: 1 });
const live = (id: string, name = 'bash'): PanelItem =>
  ({ kind: 'tool', key: `reader-tool:${id}`, entry: toolEntry(id, 1, { phase: 'start', callId: id, name, argsRaw: '{}', subCalls: [] }), step: 1 });
const draft = (id: string, name: string, args: Record<string, unknown>): PanelItem =>
  ({ kind: 'tool', key: `reader-tool:${id}`, entry: toolEntry(id, 1, undefined, toolCall(id, name, args)), step: 1 });
const say = (key: string): PanelItem => ({ kind: 'narration', key, nodeKey: key, start: 0, step: 1 });
const think = (key: string): PanelItem => ({ kind: 'reasoning', key, nodeKey: key, start: 0, step: 1 });
const kinds = (entries: TranscriptEntry[]) => entries.map(entry => entry.kind);

test('an empty todo array is a valid replacement, distinct from missing or malformed payloads', () => {
  assert.deepEqual(parseTodos('{"todos":[]}'), []);
  for (const raw of ['{}', '{"todos":null}', '{"todos":{}}', '{"todos":[null]}']) {
    assert.equal(parseTodos(raw), null);
  }
});

const checklist = (content: string) => ({ todos: [{ content, status: 'pending' }] });
function onlyPlan(items: PanelItem[], closed = true): PlanEntry {
  const plans = buildTranscript(items, none, closed).filter((entry): entry is PlanEntry => entry.kind === 'plan');
  assert.equal(plans.length, 1);
  return plans[0]!;
}

test('a successful empty update clears the existing card without dropping ordered history or changing the first key', () => {
  const saved = tool('saved', 'todo_write', checklist('旧条目'));
  const failed = tool('failed', 'todo_write', checklist('失败条目'), { isError: true });
  const cleared = tool('clear', 'todo_write', { todos: [] }, { content: [{ type: 'text', text: 'Updated todo list: 0 pending, 0 in progress, 0 completed.' }] });
  const items = [say('before'), saved, say('middle'), failed, cleared, say('after')];
  const before = JSON.stringify(items);
  const entries = buildTranscript(items, none, true);
  assert.deepEqual(kinds(entries), ['narration', 'plan', 'narration', 'narration']);
  const plan = onlyPlan(items);
  assert.equal(plan.key, saved.key);
  assert.equal(plan.item, cleared);
  assert.equal(plan.successfulCall, cleared);
  assert.deepEqual(plan.todos, []);
  assert.deepEqual(planStatus(plan, true), { tone: 'idle', detail: '计划已清空' });
  assert.equal(plan.calls.length, 3);
  [saved, failed, cleared].forEach((call, index) => assert.equal(plan.calls[index], call));
  assert.equal(JSON.stringify(items), before);
});

test('failed or unfinished empty updates retain the successful nonempty checklist', () => {
  const saved = tool('saved', 'todo_write', checklist('已保存'));
  for (const [call, closed, tone] of [
    [tool('failed-clear', 'todo_write', { todos: [] }, { isError: true }), true, 'failed'],
    [draft('preparing-clear', 'todo_write', { todos: [] }), false, 'running'],
    [{ ...live('running-clear', 'todo_write'), entry: toolEntry('running-clear', 1, { phase: 'start', callId: 'running-clear', name: 'todo_write', argsRaw: '{"todos":[]}', subCalls: [] }) }, false, 'running'],
    [draft('interrupted-clear', 'todo_write', { todos: [] }), true, 'interrupted'],
  ] as const) {
    const plan = onlyPlan([saved, call], closed);
    assert.equal(plan.successfulCall, saved);
    assert.deepEqual(plan.todos, checklist('已保存').todos);
    assert.equal(plan.item, call);
    assert.equal(plan.calls[1], call);
    assert.equal(planStatus(plan, closed).tone, tone);
    assert.doesNotMatch(planStatus(plan, closed).detail, /已清空/);
  }
});

test('a cleared checklist stays empty after rejected updates and can later be repopulated under the same first key', () => {
  const first = tool('first-empty', 'todo_write', { todos: [] });
  const failed = tool('failed', 'todo_write', checklist('不能恢复'), { isError: true });
  const malformed = tool('malformed', 'todo_write', { unexpected: true });
  const afterFailure = onlyPlan([first, failed]);
  assert.deepEqual(afterFailure.todos, []);
  assert.equal(afterFailure.successfulCall, first);
  assert.equal(planStatus(afterFailure, true).tone, 'failed');
  const afterMalformed = onlyPlan([first, failed, malformed]);
  assert.deepEqual(afterMalformed.todos, []);
  assert.equal(afterMalformed.successfulCall, first);
  assert.match(planStatus(afterMalformed, true).detail, /无法解析/);
  const saved = tool('repopulated', 'todo_write', checklist('新条目'));
  const plan = onlyPlan([first, failed, malformed, saved]);
  assert.equal(plan.key, failed.key, 'the first nonempty call establishes the stable card key');
  assert.equal(plan.successfulCall, saved);
  assert.deepEqual(plan.todos, checklist('新条目').todos);
  assert.deepEqual(plan.calls.map(call => call.key), [failed, malformed, saved].map(call => call.key));
});

test('plan updates keep the first key and position, all source calls, and the latest successful checklist', () => {
  const first = tool('p1', 'todo_write', checklist('旧清单'));
  const second = tool('p2', 'todo_write', checklist('新清单'), { content: [{ type: 'text', text: 'saved exactly' }] });
  const items = [say('before'), first, tool('a', 'bash'), tool('b', 'read'), say('middle'), second, think('after')];
  const snapshot = JSON.stringify(items);
  const entries = buildTranscript(items, none, true);
  assert.deepEqual(kinds(entries), ['narration', 'plan', 'group', 'narration', 'thought']);
  const plan = onlyPlan(items);
  assert.equal(plan.key, first.key);
  assert.equal(onlyPlan([first]).key, plan.key, 'append does not change the React identity');
  assert.equal(plan.item, second);
  assert.equal(plan.successfulCall, second);
  assert.deepEqual(plan.todos, checklist('新清单').todos);
  assert.equal(plan.calls[0], first);
  assert.equal(plan.calls[1], second);
  assert.equal(JSON.stringify(items), snapshot, 'source args/results and items are not rewritten');
  assert.equal(planStatus(plan, true).tone, 'idle');
});

test('failed, interrupted, preparing and running updates retain the last successful checklist and expose their state', () => {
  const saved = tool('saved', 'todo_write', checklist('已保存'));
  const updates = [
    { call: tool('failed', 'todo_write', checklist('未保存'), { isError: true }), closed: true, tone: 'failed', label: '失败' },
    { call: draft('interrupted', 'todo_write', checklist('未保存')), closed: true, tone: 'interrupted', label: '中断' },
    { call: draft('preparing', 'todo_write', checklist('未保存')), closed: false, tone: 'running', label: '正在生成' },
    { call: live('running', 'todo_write'), closed: false, tone: 'running', label: '正在更新' },
  ];
  for (const { call, closed, tone, label } of updates) {
    const plan = onlyPlan([saved, call], closed);
    assert.deepEqual(plan.todos, checklist('已保存').todos);
    assert.equal(plan.successfulCall, saved);
    assert.equal(plan.item, call);
    assert.equal(plan.calls[1], call);
    const status = planStatus(plan, closed);
    assert.equal(status.tone, tone);
    assert.ok(status.detail.includes(label));
    assert.ok(status.detail.includes('上次成功清单'));
  }
});

test('an initial failed or unfinished call never claims its proposed checklist was saved', () => {
  for (const [call, closed, tone] of [
    [tool('failed', 'todo_write', checklist('仅提议'), { isError: true }), true, 'failed'],
    [draft('draft', 'todo_write', checklist('仅提议')), false, 'running'],
    [draft('stopped', 'todo_write', checklist('仅提议')), true, 'interrupted'],
  ] as const) {
    const plan = onlyPlan([call], closed);
    assert.deepEqual(plan.todos, []);
    assert.equal(plan.successfulCall, null);
    assert.equal(plan.calls[0], call);
    assert.equal(planStatus(plan, closed).tone, tone);
    assert.match(planStatus(plan, closed).detail, /尚无成功清单/);
  }
});

test('malformed updates stay inspectable without replacing the successful checklist', () => {
  const saved = tool('saved', 'todo_write', checklist('已保存'));
  const malformed = tool('bad', 'todo_write', { todos: [{ content: 'bad', status: 'unknown' }] });
  const plan = onlyPlan([saved, malformed]);
  assert.equal(plan.calls[1], malformed);
  assert.equal(plan.successfulCall, saved);
  assert.deepEqual(plan.todos, checklist('已保存').todos);
  assert.match(planStatus(plan, true).detail, /无法解析.*上次成功清单/);
  assert.deepEqual(kinds(buildTranscript([malformed, draft('bad2', 'todo_write', {})], none, false)), ['item', 'item']);
});

test('a later parseable update leaves earlier malformed calls at their original seats', () => {
  const first = draft('first', 'todo_write', {});
  const saved = tool('saved', 'todo_write', checklist('成功'));
  const plan = onlyPlan([first, say('between'), saved]);
  assert.equal(plan.key, saved.key);
  assert.deepEqual(plan.calls, [saved]);
  const entries = buildTranscript([first, say('between'), saved], none, true);
  assert.deepEqual(kinds(entries), ['item', 'narration', 'plan']);
  assert.equal(entries[0]!.kind === 'item' && entries[0]!.item, first);
  assert.equal(entries[0]!.key, first.key);
  assert.equal(plan.successfulCall, saved);
  const otherTurn = onlyPlan([tool('other', 'todo_write', checklist('另一轮'))]);
  assert.equal(otherTurn.calls.length, 1, 'no plan state leaks between turns');
});

test('an initial successful empty call keeps its source seat when a later nonempty card is established', () => {
  const empty = tool('first-empty', 'todo_write', { todos: [] });
  const [fallback] = buildTranscript([empty], none, true);
  assert.equal(fallback!.kind, 'item');
  assert.equal(fallback!.item, empty);
  const nonempty = tool('nonempty', 'todo_write', checklist('新计划'));
  const clear = tool('clear-again', 'todo_write', { todos: [] });
  const items = [empty, say('between'), nonempty, say('after'), clear];
  const entries = buildTranscript(items, none, true);
  assert.deepEqual(kinds(entries), ['item', 'narration', 'plan', 'narration']);
  const plan = onlyPlan(items);
  assert.equal(plan.key, nonempty.key);
  assert.equal(onlyPlan([empty, nonempty]).key, plan.key);
  assert.equal(plan.item, clear);
  assert.equal(plan.successfulCall, clear);
  assert.deepEqual(plan.todos, []);
  assert.deepEqual(plan.calls.map(call => call.key), [nonempty.key, clear.key]);
  assert.equal(plan.calls[0], nonempty);
  assert.equal(entries.filter(entry => entry.kind === 'item' && entry.item === empty).length, 1, 'earlier empty seat must stay mounted, outside later history');
});

test('the same call promotes from a malformed item to a plan without changing its source key', () => {
  const malformed = draft('same', 'todo_write', {});
  const parsed = draft('same', 'todo_write', checklist('流式计划'));
  const [before] = buildTranscript([malformed], none, false);
  const [after] = buildTranscript([parsed], none, false);
  assert.equal(before!.kind, 'item');
  assert.equal(after!.kind, 'plan');
  assert.equal(before!.key, after!.key);
  assert.equal(after!.kind === 'plan' && after!.calls[0], parsed);
});

test('single operational items expose group facts without changing their kind or key; ordinary items have none', () => {
  for (const [call, closed, running, failed] of [
    [tool('ok', 'bash'), true, false, 0],
    [live('running'), false, true, 0],
    [tool('error', 'bash', {}, { isError: true }), true, false, 1],
  ] as const) {
    const [entry] = buildTranscript([call], none, closed);
    assert.ok(entry?.kind === 'item');
    assert.equal(entry.key, call.key);
    assert.equal(entry.item, call);
    assert.deepEqual(entry.facts, { counts: { command: 1 }, order: ['command'], running, failed });
  }
  const record = chatNode('command', { outcome: { kind: 'error' } }, turn, 1);
  const [entry] = buildTranscript([{ kind: 'record', key: record.key, nodeKey: record.key, step: 1 }], () => record, true);
  assert.ok(entry?.kind === 'item');
  assert.equal(entry.facts?.failed, 1);
  const ordinary = [tool('agent', 'dispatch'), draft('malformed', 'todo_write', {})];
  for (const entry of buildTranscript(ordinary, none, false)) {
    assert.ok(entry.kind === 'item');
    assert.equal('facts' in entry, false);
  }
});

test('future chronological media/output/notice items break groups and retain source identity and answer flags', () => {
  // The controller owns the PanelItem type extension; exercise its announced wire shapes now.
  const extra = [
    { kind: 'media', key: 'media', entry: toolEntry('media', 1), step: 1 },
    { kind: 'output', key: 'output', nodeKey: 'output', step: 1 },
    { kind: 'notice', key: 'notice', nodeKey: 'notice', step: 1 },
  ] as unknown as PanelItem[];
  for (const item of extra) {
    assert.equal(isOperational(item, none), false);
    const entries = buildTranscript([tool('a', 'bash'), item, tool('b', 'bash')], none, true);
    assert.deepEqual(kinds(entries), ['item', 'item', 'item']);
    assert.equal(entries[1]!.kind === 'item' && entries[1]!.item, item);
  }
  const answer = { ...say('answer'), answer: true };
  const entry = buildTranscript([answer], none, true)[0]!;
  assert.equal(entry.kind === 'narration' && entry.item, answer);
});

test('narration, thoughts and inputs are kept in order and break runs', () => {
  const entries = buildTranscript([say('a'), tool('1', 'bash', { command: 'ls' }), tool('2', 'read', { path: 'x' }), think('t'), tool('3', 'bash'), say('b'),
    { kind: 'input', key: 'in', nodeKey: 'in', step: 1 }, tool('4', 'write', { path: 'y' }), tool('5', 'edit', { path: 'y' })], none, true);
  assert.deepEqual(kinds(entries), ['narration', 'group', 'thought', 'item', 'narration', 'input', 'group']);
  assert.equal(entries[1]!.key, 'group:reader-tool:1');
});

test('every narration paragraph of a long turn survives', () => {
  const items: PanelItem[] = [];
  for (let index = 0; index < 30; index++) items.push(say(`s${index}`), tool(`a${index}`, 'bash'), tool(`b${index}`, 'read', { path: 'f' }), tool(`c${index}`, 'edit', { path: 'f' }));
  const entries = buildTranscript(items, none, true);
  assert.equal(entries.filter(entry => entry.kind === 'narration').length, 30);
  assert.equal(entries.filter(entry => entry.kind === 'group').length, 30);
});

test('group wording counts by kind in order of first appearance', () => {
  const [group] = buildTranscript([tool('1', 'bash', { command: 'ls' }), tool('2', 'write', { path: 'a' }), tool('3', 'write', { path: 'b' }),
    tool('4', 'edit', { path: 'a' }), tool('5', 'grep', { pattern: 'x' }), tool('6', 'skill', { name: 'pdf' }), tool('7', 'mystery'), tool('8', 'read', { path: 'a' })], none, true);
  assert.equal(group!.kind, 'group');
  if (group!.kind !== 'group') return;
  assert.equal(groupSummary(group.facts), '运行了 1 条命令，写入了 2 个文件，编辑了 1 个文件，搜索了 1 次，使用了 1 个技能，调用了 1 次工具，读取了 1 个文件');
});

test('str_replace_editor create counts as a write, other editor commands as edits', () => {
  const [group] = buildTranscript([tool('1', 'str_replace_editor', { command: 'create', path: 'a' }), tool('2', 'str_replace_editor', { command: 'str_replace', path: 'a' })], none, true);
  assert.equal(group!.kind === 'group' && groupSummary(group.facts), '写入了 1 个文件，编辑了 1 个文件');
});

test('running and failed facts', () => {
  const [open] = buildTranscript([tool('1', 'bash'), live('2')], none, false);
  assert.equal(open!.kind === 'group' && open.facts.running, true);
  const [failed] = buildTranscript([tool('1', 'bash', {}, { isError: true }), tool('2', 'bash')], none, true);
  assert.equal(failed!.kind === 'group' && failed.facts.failed, 1);
});

test('command and manual-compaction records join groups', () => {
  const command = chatNode('command', { outcome: { kind: 'error' } }, turn, 1);
  const compact = chatNode('manual-compaction', { command: { outcome: { kind: 'success' } }, compaction: {} }, turn, 1);
  const map = new Map([[command.key, command], [compact.key, compact]]);
  const [group] = buildTranscript([{ kind: 'record', key: command.key, nodeKey: command.key, step: 1 }, { kind: 'record', key: compact.key, nodeKey: compact.key, step: 1 }, tool('1', 'bash')], key => map.get(key), true);
  assert.equal(group!.kind === 'group' && groupSummary(group.facts), '运行了 2 条命令，执行了 1 个操作');
  assert.equal(group!.kind === 'group' && group.facts.failed, 1);
});

test('other records and subagent calls stand alone', () => {
  const notice = chatNode('model-retry', {}, turn, 1);
  const entries = buildTranscript([tool('1', 'bash'), { kind: 'record', key: notice.key, nodeKey: notice.key, step: 1 }, tool('2', 'dispatch', { description: '编写植物模块' }), tool('3', 'bash')], key => key === notice.key ? notice : undefined, true);
  assert.deepEqual(kinds(entries), ['item', 'item', 'item', 'item']);
});

test('todo_write becomes a plan entry, or an item when its args do not parse', () => {
  const todos = [{ content: '搭建骨架', status: 'completed' }, { content: '屋顶引擎', status: 'in_progress' }, { content: '验证', status: 'pending' }];
  const [plan] = buildTranscript([tool('p', 'todo_write', { todos })], none, true);
  assert.equal(plan!.kind, 'plan');
  assert.deepEqual(plan!.kind === 'plan' && plan.todos.map(todo => todo.status), ['completed', 'in_progress', 'pending']);
  assert.equal(parseTodos('{"todos":[{"content":"x","status":"pend'), null);
  assert.equal(parseTodos('{"todos":[{"content":"x","status":"weird"}]}'), null);
  const [broken] = buildTranscript([draft('q', 'todo_write', {})], none, false);
  assert.equal(broken!.kind, 'item');
});

test('diffStat trims the common prefix and suffix', () => {
  assert.deepEqual(diffStat('a\nb\nc\n', 'a\nB\nc\n'), { added: 1, removed: 1 });
  assert.deepEqual(diffStat(null, 'x\ny'), { added: 2, removed: 0 });
  assert.deepEqual(diffStat('x\ny\nz', 'x\nz'), { added: 0, removed: 1 });
  assert.deepEqual(diffStat('same', 'same'), { added: 0, removed: 0 });
});

test('liveThoughtKey names the last entry only while it is the trailing reasoning of a running step in an open turn', () => {
  const open = turnLocation({ status: 'open', steps: [1] });
  const running = assistantNode(open, 1, [text('说明'), reasoning('想一想')], 'running');
  const thought = { kind: 'reasoning' as const, key: `${running.key}:1`, nodeKey: running.key, start: 1, step: 1 };
  const entries = buildTranscript([thought], none, false);
  const get = (key: string) => key === running.key ? running : undefined;
  assert.equal(liveThoughtKey(entries, get, true), thought.key);
  assert.equal(liveThoughtKey(entries, get, false), null, 'closed turn');
  const settled = assistantNode(open, 1, [text('说明'), reasoning('想一想')], 'settled');
  assert.equal(liveThoughtKey(entries, key => key === settled.key ? settled : undefined, true), null, 'settled step');
  assert.equal(liveThoughtKey([...entries, ...buildTranscript([say('b')], none, false)], get, true), null, 'thought not last');
  assert.equal(liveThoughtKey([], get, true), null);
});
