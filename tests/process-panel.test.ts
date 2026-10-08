import './support/dom.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { render } from './support/render.ts';
import { ProcessPanel } from '../src/client/ProcessPanel.tsx';
import type { PanelItem } from '../src/client/process-steps.ts';
import { assistantNode, chatNode, reasoning, settledTool, toolCall, toolEntry, turnLocation } from './support/chat-fixture.ts';

const think = (step: number): PanelItem => ({ kind: 'reasoning', key: `r${step}`, nodeKey: `n${step}`, start: 0, step });
const tool = (id: string, step: number): PanelItem => ({ kind: 'tool', key: id, entry: toolEntry(id, step, undefined, toolCall(id, 'bash')), step });
const done = (id: string, step: number, over: Record<string, unknown> = {}): PanelItem =>
  ({ kind: 'tool', key: id, entry: toolEntry(id, step, settledTool(id, 'bash', { command: 'ls' }, over)), step });
const base = {
  panelKey: 'turn:1', statusLabel: '已完成', elapsed: '用时 16 分 39 秒', counts: { steps: 65, tools: 18, failed: 1 },
  onOpenChange: () => {}, earlierOpen: false, onEarlierOpen: () => {}, motion: true, get: () => undefined, turnClosed: false, onRead: () => {},
  renderItem: (item: PanelItem) => createElement('div', { 'data-item': item.key }),
  renderThought: (thought: PanelItem, operation: PanelItem) => createElement('div', { 'data-thought': thought.key, 'data-with': operation.key }),
};

test('a finished panel is one plain header row with its status, time and counts', () => {
  const html = render(ProcessPanel, { ...base, status: 'done', items: [think(1)], open: false });
  assert.match(html, /data-reader-panel="true" data-status="done"/);
  assert.match(html, /data-reader-disclosure="true" data-expanded="false"/);
  assert.match(html, /data-stub="StateDot" data-state="done"/);
  assert.match(html, /已完成[\s\S]*用时 16 分 39 秒[\s\S]*65 步[\s\S]*18 次工具[\s\S]*1 次失败/);
  assert.doesNotMatch(html, /data-reader-process=/);
});

test('a running panel condenses earlier steps and shows the latest step in full, without step labels', () => {
  const items = [think(1), tool('a', 1), think(2), tool('b', 2)];
  const html = render(ProcessPanel, { ...base, status: 'running', statusLabel: '正在思考', items, open: true, counts: { steps: 2, tools: 2, failed: 0 } });
  assert.match(html, /data-stub="StateDot" data-state="ongoing"/);
  assert.match(html, /data-reader-process="true" data-reader-process-key="turn:1"/);
  assert.match(html, /data-reader-earlier[\s\S]*前 1 步[\s\S]*运行 1 条命令/);
  assert.match(html, /data-item="b"/);
  assert.doesNotMatch(html, /data-item="a"/);
  assert.doesNotMatch(html, /步骤 \d|data-reader-step/);
  assert.doesNotMatch(html, /次失败/);
});

test('an opened earlier range renders every step', () => {
  const items = [think(1), tool('a', 1), think(2), tool('b', 2)];
  const html = render(ProcessPanel, { ...base, status: 'running', statusLabel: '正在思考', items, open: true, earlierOpen: true });
  assert.doesNotMatch(html, /data-reader-earlier/);
  assert.match(html, /data-item="a"[\s\S]*data-item="b"/);
});

test('consecutive tool calls render as one collapsed cluster row instead of a fold', () => {
  const items = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(id => done(id, 1));
  const html = render(ProcessPanel, { ...base, status: 'done', turnClosed: true, items, open: true });
  assert.match(html, /data-reader-cluster="cluster:a"/);
  assert.equal(html.match(/data-reader-cluster=/g)?.length, 1);
  assert.match(html, /运行了 7 条命令，进行了 7 次工具调用/);
  assert.match(html, /data-expanded="false"[^>]*data-reader-cluster|data-reader-cluster[^>]*data-expanded="false"/);
  assert.doesNotMatch(html, /data-item=/);
  assert.doesNotMatch(html, /data-reader-fold|\+\d+ 次工具调用/);
});

test('a single tool call and calls split by thinking are not clustered', () => {
  const lone = render(ProcessPanel, { ...base, status: 'done', turnClosed: true, items: [done('a', 1)], open: true });
  assert.doesNotMatch(lone, /data-reader-cluster/);
  assert.match(lone, /data-item="a"/);
  const split = render(ProcessPanel, { ...base, status: 'done', turnClosed: true, items: [done('a', 1), think(1), done('b', 1)], open: true });
  assert.doesNotMatch(split, /data-reader-cluster/);
  assert.match(split, /data-item="a"[\s\S]*data-item="r1"[\s\S]*data-item="b"/);
});

test('a cluster shows its total elapsed time on the right', () => {
  const items = [done('a', 1, { callTime: 1000, time: 2000 }), done('b', 1, { callTime: 3000, time: 6500 })];
  const html = render(ProcessPanel, { ...base, status: 'done', turnClosed: true, items, open: true });
  assert.match(html, /class="end">5\.5 秒</);
});

test('a running cluster spins, shimmers its header and names the active call', () => {
  const items = [done('a', 1), tool('b', 1)];
  const on = render(ProcessPanel, { ...base, status: 'running', items, open: true });
  assert.match(on, /data-reader-cluster="cluster:a"[^>]*data-cluster-state="running"/);
  assert.match(on, /data-running="true"/);
  assert.match(on, /data-stub="StateDot" data-state="ongoing"/);
  assert.match(on, /进行了 2 次工具调用/);
  assert.match(on, /正在 运行命令/);
  const off = render(ProcessPanel, { ...base, status: 'running', items, open: true, motion: false });
  assert.doesNotMatch(off, /data-running="true"/);
  assert.match(off, /正在 运行命令/);
});

test('a cluster with a failure is open by default, red, and counts its failures', () => {
  const items = [done('a', 1), done('b', 1, { isError: true, content: [{ type: 'text', text: 'Error: exit code: 2' }] })];
  const html = render(ProcessPanel, { ...base, status: 'error', statusLabel: '出错', turnClosed: true, items, open: true });
  assert.match(html, /data-cluster-state="failed"/);
  assert.match(html, /data-stub="StateDot" data-state="error"/);
  assert.match(html, /1 次失败/);
  assert.match(html, /data-item="a"[\s\S]*data-item="b"/);
});

test('cluster members render indented in order when the cluster is open', () => {
  const html = render(ProcessPanel, { ...base, status: 'error', statusLabel: '出错', turnClosed: true, open: true, items: [done('a', 1), done('b', 1, { isError: true })] });
  assert.match(html, /class="members"[^>]*><div data-item="a"><\/div><div data-item="b">/);
});

test('command records join a tool cluster', () => {
  const node = chatNode('command', { outcome: { kind: 'success' } }, turnLocation({ steps: [1] }), 1);
  const item: PanelItem = { kind: 'record', key: node.key, nodeKey: node.key, step: 1 };
  const html = render(ProcessPanel, { ...base, status: 'done', turnClosed: true, open: true, items: [item, done('a', 1)], get: (key: string) => key === node.key ? node : undefined });
  assert.match(html, /运行了 2 条命令，进行了 1 次工具调用，执行了 1 个操作/);
});

test('failed and interrupted panels carry their status, shown by the dot and text colour only', () => {
  assert.match(render(ProcessPanel, { ...base, status: 'interrupted', statusLabel: '已中断', items: [think(1)], open: true }), /data-status="interrupted"/);
  assert.match(render(ProcessPanel, { ...base, status: 'waiting', statusLabel: '等待你的操作', items: [think(1)], open: true }), /data-state="warning"/);
});

test('rows with no known step render without any step wrapper', () => {
  const html = render(ProcessPanel, { ...base, status: 'unknown', statusLabel: '执行过程', counts: { steps: 0, tools: 1, failed: 0 }, items: [tool('x', 0)], open: true });
  assert.match(html, /data-item="x"/);
  assert.doesNotMatch(html, /data-reader-step|stepLabel/);
});

test('the panel has no outer container: no background, ring, shadow, radius or status ring', () => {
  const css = readFileSync(new URL('../src/client/ProcessPanel.module.css', import.meta.url), 'utf8');
  const rule = (selector: string) => new RegExp(String.raw`(?:^|\n)${selector.replace(/[.[\]=]/g, '\\$&')}\s*\{([^}]*)\}`).exec(css)?.[1] ?? '';
  const panel = rule('.panel');
  assert.doesNotMatch(panel, /background|box-shadow|border|radius|overflow|contain/);
  assert.doesNotMatch(css, /\.panel\[data-status[^{]*\{[^}]*box-shadow/);
  assert.doesNotMatch(css, /--cv-panel-(?:bg|ring)/);
  assert.doesNotMatch(css, /--dsw-shadow-lv1/);
  assert.doesNotMatch(css, /\.tag\b/);
  assert.match(css, /\.panel\[data-status=error\][^{]*\.status[^{]*\{[^}]*state-error-primary/);
  assert.match(css, /\.panel\[data-status=waiting\][^{]*\.status[^{]*\{[^}]*state-business-primary/);
});

test('expanded content is indented to align with the header text', () => {
  const css = readFileSync(new URL('../src/client/ProcessPanel.module.css', import.meta.url), 'utf8');
  assert.match(/(?:^|\n)\.body \{([^}]*)\}/.exec(css)?.[1] ?? '', /padding[^;]*22px|margin-left: calc\(22px/);
});

test('a settled thought and the one healthy tool call after it render as one merged row; the counts are unchanged', () => {
  const turn = turnLocation({ steps: [1] });
  const node = assistantNode(turn, 1, [reasoning('先看一下。')]);
  const thought: PanelItem = { kind: 'reasoning', key: 'r1', nodeKey: node.key, start: 0, step: 1 };
  const get = (key: string) => key === node.key ? node : undefined;
  const merged = render(ProcessPanel, { ...base, status: 'done', turnClosed: true, get, items: [thought, done('a', 1)], open: true });
  assert.match(merged, /data-thought="r1" data-with="a"/);
  assert.doesNotMatch(merged, /data-item=/);
  assert.match(merged, /65 步[\s\S]*18 次工具[\s\S]*1 次失败/);
  const failed = render(ProcessPanel, { ...base, status: 'error', statusLabel: '出错', turnClosed: true, get, items: [thought, done('a', 1, { isError: true })], open: true });
  assert.doesNotMatch(failed, /data-thought/);
  assert.match(failed, /data-item="r1"[\s\S]*data-item="a"/);
  const cluster = render(ProcessPanel, { ...base, status: 'done', turnClosed: true, get, items: [thought, done('a', 1), done('b', 1)], open: true });
  assert.doesNotMatch(cluster, /data-thought/);
  assert.match(cluster, /data-item="r1"[\s\S]*data-reader-cluster/);
});

test('a tool call the reader opened keeps its own row instead of folding into the thought', () => {
  const turn = turnLocation({ steps: [1] });
  const node = assistantNode(turn, 1, [reasoning('先看一下。')]);
  const thought: PanelItem = { kind: 'reasoning', key: 'r1', nodeKey: node.key, start: 0, step: 1 };
  const get = (key: string) => key === node.key ? node : undefined;
  const props = { ...base, status: 'done' as const, turnClosed: true, get, items: [thought, done('a', 1)], open: true };
  assert.match(render(ProcessPanel, { ...props, opened: new Set(['a']) }), /data-item="r1"[\s\S]*data-item="a"/);
  assert.match(render(ProcessPanel, props), /data-thought="r1"/);
});
