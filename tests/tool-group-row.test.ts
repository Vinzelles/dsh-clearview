import './support/dom.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { groupOpen, ToolGroupRow, type GroupEntry } from '../src/client/ToolGroupRow.tsx';

const group = (running: boolean, failed = 0): GroupEntry => ({
  kind: 'group', key: 'group:reader-tool:1',
  items: [{ kind: 'record', key: 'r1', nodeKey: 'r1', step: 1 }, { kind: 'record', key: 'r2', nodeKey: 'r2', step: 1 }],
  facts: { counts: { command: 2 }, order: ['command'], running, failed },
});
const render = (entry: GroupEntry) => renderToStaticMarkup(createElement(ToolGroupRow, { group: entry, motion: true, onRead: () => {}, renderItem: item => createElement('i', { 'data-member': item.key }) }));

test('the reader’s choice wins; otherwise open exactly while running', () => {
  assert.equal(groupOpen(null, true), true);
  assert.equal(groupOpen(null, false), false);
  assert.equal(groupOpen(true, false), true, 'opened while running, stays open after it settles');
  assert.equal(groupOpen(false, true), false);
});

test('a running group is open, shimmering and shows its members', () => {
  const html = render(group(true));
  assert.match(html, /data-reader-group="group:reader-tool:1"[^>]*data-group-state="running"[^>]*data-expanded="true"/);
  assert.match(html, /运行了 2 条命令/);
  assert.match(html, /data-shimmer="true"/);
  assert.match(html, /data-member="r1"[\s\S]*data-member="r2"/);
});

test('a settled group is one closed line; failures add a red count', () => {
  const html = render(group(false, 1));
  assert.match(html, /data-group-state="settled"[^>]*data-expanded="false"/);
  assert.match(html, /· 1 次失败/);
  assert.match(html, /data-tone="failed"/);
});
