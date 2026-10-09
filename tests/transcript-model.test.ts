import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PanelItem } from '../src/client/process-steps.ts';
import { buildTranscript, diffStat, groupSummary, liveThoughtKey, parseTodos, type TranscriptEntry } from '../src/client/transcript-model.ts';
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
