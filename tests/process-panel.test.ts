import './support/dom.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { render } from './support/render.ts';
import { ProcessPanel } from '../src/client/ProcessPanel.tsx';
import type { PanelItem } from '../src/client/process-steps.ts';
import { toolCall, toolEntry } from './support/chat-fixture.ts';

const think = (step: number): PanelItem => ({ kind: 'reasoning', key: `r${step}`, nodeKey: `n${step}`, start: 0, step });
const tool = (id: string, step: number): PanelItem => ({ kind: 'tool', key: id, entry: toolEntry(id, step, undefined, toolCall(id, 'bash')), step });
const base = {
  panelKey: 'turn:1', statusLabel: '已完成', elapsed: '用时 16 分 39 秒', counts: { steps: 65, tools: 18, failed: 1 },
  onOpenChange: () => {}, earlierOpen: false, onEarlierOpen: () => {}, motion: true, isActive: () => false,
  renderItem: (item: PanelItem) => createElement('div', { 'data-item': item.key }),
};

test('a finished panel is one header bar with its status, time and counts', () => {
  const html = render(ProcessPanel, { ...base, status: 'done', items: [think(1)], open: false });
  assert.match(html, /data-reader-panel="true" data-status="done"/);
  assert.match(html, /data-reader-disclosure="true" data-expanded="false"/);
  assert.match(html, /data-stub="StateDot" data-state="done"/);
  assert.match(html, /已完成[\s\S]*用时 16 分 39 秒[\s\S]*65 步[\s\S]*18 次工具[\s\S]*1 次失败/);
  assert.doesNotMatch(html, /data-reader-process=/);
});

test('a running panel condenses earlier steps and shows the latest step in full', () => {
  const items = [think(1), tool('a', 1), think(2), tool('b', 2)];
  const html = render(ProcessPanel, { ...base, status: 'running', statusLabel: '正在思考', items, open: true, counts: { steps: 2, tools: 2, failed: 0 } });
  assert.match(html, /data-stub="StateDot" data-state="ongoing"/);
  assert.match(html, /data-reader-process="true" data-reader-process-key="turn:1"/);
  assert.match(html, /data-reader-earlier[\s\S]*前 1 步[\s\S]*运行 1 条命令/);
  assert.match(html, /data-reader-step="步骤 2"/);
  assert.match(html, /data-item="b"/);
  assert.doesNotMatch(html, /data-item="a"/);
  assert.doesNotMatch(html, /次失败/);
});

test('an opened earlier range renders every step', () => {
  const items = [think(1), tool('a', 1), think(2), tool('b', 2)];
  const html = render(ProcessPanel, { ...base, status: 'running', statusLabel: '正在思考', items, open: true, earlierOpen: true });
  assert.doesNotMatch(html, /data-reader-earlier/);
  assert.match(html, /data-item="a"[\s\S]*data-item="b"/);
});

test('long runs of tool calls fold behind a count row', () => {
  const items = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(id => tool(id, 1));
  const html = render(ProcessPanel, { ...base, status: 'done', items, open: true });
  assert.match(html, /\+4 次工具调用/);
  assert.match(html, /data-item="e"[\s\S]*data-item="f"[\s\S]*data-item="g"/);
  assert.doesNotMatch(html, /data-item="a"/);
});

test('failed and interrupted panels carry their status for the red ring', () => {
  assert.match(render(ProcessPanel, { ...base, status: 'interrupted', statusLabel: '已中断', items: [think(1)], open: true }), /data-status="interrupted"/);
  assert.match(render(ProcessPanel, { ...base, status: 'waiting', statusLabel: '等待你的操作', items: [think(1)], open: true }), /data-state="warning"/);
});

test('a step group with no known step renders its rows without a label element', () => {
  const html = render(ProcessPanel, { ...base, status: 'unknown', statusLabel: '执行过程', counts: { steps: 0, tools: 1, failed: 0 }, items: [tool('x', 0)], open: true });
  assert.match(html, /data-item="x"/);
  assert.doesNotMatch(html, /data-reader-step-label|stepLabel/);
  assert.match(html, /data-reader-step=""/);
});
