import './support/dom.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { groupOpen, ToolGroupRow, ToolGroupRowView, sameToolGroupProps, type ToolGroupRowProps, type GroupEntry } from '../src/client/ToolGroupRow.tsx';

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

// Drive the component's hooks and callbacks without adding a browser-test dependency.
function groupInteraction() {
  const slots: unknown[] = [];
  let cursor = 0;
  const dispatcher = {
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], (next: unknown) => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }];
    },
    useCallback: (callback: unknown) => callback,
    useId: () => 'group-detail',
  };
  const internals = (React as any).__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;
  let memberChange: ((key: string, open: boolean) => void) | undefined;
  return (running: boolean, items = group(running).items, renderMedia?: (item: GroupEntry['items'][number]) => React.ReactNode) => {
    cursor = 0;
    const previous = internals.ReactCurrentDispatcher.current;
    internals.ReactCurrentDispatcher.current = dispatcher;
    try {
      const row = ToolGroupRowView({ group: { ...group(running), items }, motion: false, onRead: () => {}, renderMedia, renderItem: (_item, onOpenChange) => { memberChange = onOpenChange; return null; } });
      const line = row.props.children[0];
      return { row, open: row.props['data-expanded'], toggle: line && line.props.onToggle, member: (key: string, open: boolean) => memberChange!(key, open) };
    } finally { internals.ReactCurrentDispatcher.current = previous; }
  };
}

test('opening a member in an auto-open running group preserves it when the group settles', () => {
  const render = groupInteraction();
  render(true).member('r1', true);
  assert.equal(render(false).open, true);
  render(false).member('r1', false);
  assert.equal(render(false).open, false);
});

test('multiple open members, removed members and an explicit group close retain distinct intent', () => {
  const render = groupInteraction();
  render(true).member('r1', true);
  render(true).member('r2', true);
  render(false).member('r1', false);
  assert.equal(render(false).open, true);
  assert.equal(render(false, [group(false).items[0], { kind: 'record', key: 'r3', nodeKey: 'r3', step: 1 }]).open, false, 'removed open member does not pin the group');
  render(false).toggle();
  assert.equal(render(false).open, false, 'explicit group close overrides an open member');
  render(true).toggle();
  assert.equal(render(false).open, true, 'explicit group reopen survives settlement');
});

test('a settled singleton shows its member without a group header or group marker', () => {
  const entry = group(false, 1);
  entry.items = entry.items.slice(0, 1);
  const html = render(entry);
  assert.match(html, /data-member="r1"/);
  assert.doesNotMatch(html, /data-reader-group=|运行了|次失败/);
});

test('media stays visible after settlement and follows each member in source order', () => {
  const draw = (running: boolean) => renderToStaticMarkup(createElement(ToolGroupRow, {
    group: group(running), motion: false, onRead: () => {},
    renderItem: item => createElement('i', { 'data-member': item.key }),
    renderMedia: item => createElement('b', { 'data-media': item.key }),
  }));
  const opened = draw(true);
  assert.match(opened, /data-member="r1"[\s\S]*data-media="r1"[\s\S]*data-member="r2"[\s\S]*data-media="r2"/);
  const settled = draw(false);
  assert.doesNotMatch(settled, /data-member=/);
  assert.match(settled, /data-expanded="false"[\s\S]*data-media="r1"[\s\S]*data-media="r2"/);
});

test('singleton growth retains its keyed member parent and its open-detail intent', () => {
  const draw = groupInteraction();
  const items = group(true).items;
  const one = draw(true, items.slice(0, 1));
  assert.equal(one.open, true);
  assert.equal(one.row.props['data-reader-group'], undefined);
  const oneMembers = one.row.props.children[1];
  assert.equal(oneMembers.type, 'div');
  const oneSeat = oneMembers.props.children[0];
  assert.equal(oneSeat.key, 'r1');
  one.member('r1', true);
  const two = draw(true);
  const twoMembers = two.row.props.children[1];
  const twoSeat = twoMembers.props.children[0];
  assert.equal(twoMembers.type, oneMembers.type);
  assert.equal(twoMembers.props.id, oneMembers.props.id);
  assert.equal(twoSeat.type, oneSeat.type);
  assert.equal(twoSeat.key, oneSeat.key);
  assert.equal(twoSeat.props.children[0].type, oneSeat.props.children[0].type);
  assert.equal(twoSeat.props.children[0].props.open, true);
  assert.equal(draw(false).open, true, 'the detail opened before the group grew still pins it after settlement');
});

test('late media and explicit group closing keep the members container and keyed slots stable', () => {
  const draw = groupInteraction();
  const before = draw(true);
  const after = draw(true, undefined, item => createElement('b', { 'data-media': item.key }));
  const membersBefore = before.row.props.children[1];
  const membersAfter = after.row.props.children[1];
  assert.equal(membersAfter.type, 'div');
  assert.equal(membersAfter.props.id, membersBefore.props.id);
  assert.deepEqual(membersAfter.props.children.map((seat: React.ReactElement) => seat.key), ['r1', 'r2']);
  for (let index = 0; index < 2; index++) {
    const oldSeat = membersBefore.props.children[index];
    const newSeat = membersAfter.props.children[index];
    assert.equal(newSeat.type, oldSeat.type);
    assert.equal(newSeat.props.children[0].type, oldSeat.props.children[0].type);
    assert.equal(newSeat.props.children[1].props['data-media'], newSeat.key);
  }
  after.toggle();
  const closed = draw(true, undefined, item => createElement('b', { 'data-media': item.key }));
  assert.equal(closed.open, false);
  for (const seat of closed.row.props.children[1].props.children) {
    assert.equal(seat.props.children[0].props.open, false);
    assert.equal(seat.props.children[1].props['data-media'], seat.key);
  }
  const singleton = draw(false, group(false).items.slice(0, 1));
  assert.equal(singleton.open, true, 'a singleton stays visible even after an explicit group close');
  assert.equal(singleton.row.props.children[1].type, 'div');
});

test('a closed group without media leaves an empty members container covered by the empty CSS rule', () => {
  const html = renderToStaticMarkup(createElement(ToolGroupRow, {
    group: group(false), motion: false, onRead: () => {},
    renderItem: item => createElement('i', { 'data-member': item.key }),
    renderMedia: () => null,
  }));
  assert.match(html, /<div[^>]*class="members"[^>]*><\/div>/);
  assert.doesNotMatch(html, /data-member=/);
  const css = readFileSync(new URL('../src/client/ToolGroupRow.module.css', import.meta.url), 'utf8');
  assert.match(css, /\.members:empty\s*\{\s*display:\s*none\s*\}/);
});


test('memo skips recreated wrappers around the same ordered immutable tool payloads', () => {
  const block = { kind: 'tool-call', callId: 'a', call: { name: 'bash', argsRaw: '{"command":"pwd"}' }, subCalls: [], content: [], isError: false, time: 1 } as any;
  const item = { kind: 'tool' as const, key: 'reader-tool:a', step: 1, entry: { kind: 'tool' as const, key: 'reader-tool:a', callId: 'a', step: 1, order: 1, block } };
  const props: ToolGroupRowProps = { group: { ...group(false), items: [item, { ...item, key: 'reader-tool:b', entry: { ...item.entry, key: 'reader-tool:b', callId: 'b', order: 2 } }] }, motion: true, onRead: () => {}, renderItem: () => null, renderMedia: () => null };
  const copied = () => ({ ...props, group: { ...props.group, facts: { ...props.group.facts, order: [...props.group.facts.order], counts: { ...props.group.facts.counts } }, items: props.group.items.map(row => row.kind === 'tool' ? { ...row, entry: { ...row.entry } } : { ...row }) } });
  assert.equal(sameToolGroupProps(props, copied()), true);
  for (const field of ['motion', 'onRead', 'renderItem', 'renderMedia'] as const) {
    const next = copied();
    if (field === 'motion') next.motion = false;
    else next[field] = () => null;
    assert.equal(sameToolGroupProps(props, next), false, field);
  }
  for (const change of ['block', 'draft', 'step', 'key', 'order', 'running', 'failed', 'counts', 'kindOrder']) {
    const next = copied(), row = next.group.items[0];
    if (row.kind !== 'tool') throw Error('tool fixture');
    if (change === 'block') row.entry.block = { ...block, content: [{ type: 'image', attachment: { attachmentId: 'late-image' } }] };
    if (change === 'draft') row.entry.draft = { kind: 'tool-call', callId: 'a', name: 'bash', argsRaw: '{"command":"pwd"}' } as any;
    if (change === 'step') row.entry.step = 2;
    if (change === 'key') row.key = 'different-seat';
    if (change === 'order') next.group.items.reverse();
    if (change === 'running') next.group.facts.running = true;
    if (change === 'failed') next.group.facts.failed = 1;
    if (change === 'counts') next.group.facts.counts.command = 3;
    if (change === 'kindOrder') next.group.facts.order = ['read', 'command'];
    assert.equal(sameToolGroupProps(props, next), false, change);
  }
});
