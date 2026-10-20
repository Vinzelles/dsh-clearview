import './support/dom.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PlanCard, keepPlanHistoryOpen, planCallChildren, type PlanCardProps } from '../src/client/PlanCard.tsx';
import { readFileSync } from 'node:fs';
import { buildTranscript, planStatus, type PlanEntry } from '../src/client/transcript-model.ts';
import { settledTool, toolEntry } from './support/chat-fixture.ts';
import { ReaderActionsContext } from '../src/client/reader-context.ts';
import { ToolRow } from '../src/client/ToolRow.tsx';
import { ToolDetails } from '../src/client/ToolDetails.tsx';
import { activityPhase, activitySummary } from '../src/client/tool-activity.ts';

test('a successful clear renders an explicit empty checklist and keeps the original call history', () => {
  const calls = [
    { kind: 'tool' as const, key: 'saved', step: 1, entry: toolEntry('saved', 1, settledTool('saved', 'todo_write', { todos: [{ content: '旧条目', status: 'pending' }] })) },
    { kind: 'tool' as const, key: 'clear', step: 1, entry: toolEntry('clear', 1, settledTool('clear', 'todo_write', { todos: [] })) },
  ];
  const plan = buildTranscript(calls, () => undefined, true)[0] as PlanEntry;
  const html = renderToStaticMarkup(createElement(PlanCard, { todos: plan.todos, ...planStatus(plan, true) },
    plan.calls.map(call => createElement('pre', { key: call.key, 'data-original-call': call.key }, activitySummary(call.entry).raw))));
  assert.match(html, /计划 · 0 \/ 0/);
  assert.match(html, /计划已清空/);
  assert.match(html, /data-reader-plan-empty="true"[^>]*>暂无计划条目/);
  assert.doesNotMatch(html, /data-status=/);
  assert.ok(html.indexOf('data-original-call="saved"') < html.indexOf('data-original-call="clear"'));
  assert.match(html, /&quot;todos&quot;:\[\]/);
});

test('plan card counts done items and marks each state', () => {
  const html = renderToStaticMarkup(createElement(PlanCard, { todos: [{ content: '搭建骨架', status: 'completed' }, { content: '屋顶引擎', status: 'in_progress' }, { content: '验证', status: 'pending' }] }));
  assert.match(html, /data-reader-plan/);
  assert.match(html, /计划 · 1 \/ 3/);
  assert.match(html, /data-status="completed"[^>]*>[\s\S]*搭建骨架/);
  assert.match(html, /data-status="in_progress"[\s\S]*屋顶引擎/);
});

test('latest call state stays visible outside the collapsed original-call history', () => {
  for (const tone of ['running', 'failed', 'interrupted'] as const) {
    const html = renderToStaticMarkup(createElement(PlanCard, { todos: [], tone, detail: `计划状态 ${tone}` },
      createElement('pre', null, 'literal args/result')));
    assert.match(html, new RegExp(`data-reader-plan="true"[^>]*data-tone="${tone}"`));
    assert.ok(html.indexOf(`计划状态 ${tone}`) < html.indexOf('<details'));
    assert.match(html, /<details[^>]*data-reader-plan-calls="true"[^>]*><summary>原始计划调用<\/summary>/);
    assert.doesNotMatch(html, /<details[^>]*\bopen=/);
    assert.match(html, /literal args\/result/);
  }
  const css = readFileSync(new URL('../src/client/PlanCard.module.css', import.meta.url), 'utf8');
  assert.match(css, /data-tone="failed"[^}]*data-tone="interrupted"[^}]*color: var\(--cc-danger\)/);
});

test('fallback uses the same root and details, with no checklist chrome and an open history without a visible summary', () => {
  const html = renderToStaticMarkup(createElement(PlanCard, { todos: [], hasChecklist: false, detail: 'must not show', tone: 'failed' },
    createElement('div', { 'data-reader-tool-call': 'draft' }, '原始工具详情')));
  assert.match(html, /^<div class="fallback"/);
  assert.match(html, /<details[^>]*data-reader-plan-calls="true"[^>]*open=""/);
  assert.match(html, /<summary hidden="">/);
  assert.match(html, /原始工具详情/);
  assert.doesNotMatch(html, /class="title"|role="status"|must not show|暂无计划条目/);
  const css = readFileSync(new URL('../src/client/PlanCard.module.css', import.meta.url), 'utf8');
  assert.doesNotMatch(/\.fallback\s*\{([^}]*)\}/.exec(css)?.[1] ?? '', /border|padding|margin/);
});

test('single fallback children and keyed Fragment history keep identical call-seat keys and types', () => {
  const first = createElement('div', { 'data-reader-tool-call': 'first' }, 'first');
  const second = createElement('div', { 'data-reader-tool-call': 'second' }, 'second');
  const fallback = planCallChildren(first) as React.ReactElement[];
  const promoted = planCallChildren([createElement(Fragment, { key: 'first' }, first), createElement(Fragment, { key: 'second' }, second)]) as React.ReactElement[];
  assert.equal(promoted[0]!.key, fallback[0]!.key);
  assert.equal(promoted[0]!.type, fallback[0]!.type);
  assert.equal(promoted[0]!.props.children, fallback[0]!.props.children);
  assert.notEqual(promoted[1]!.key, promoted[0]!.key);
});

function readingHistory(mode: 'none' | 'tool' | 'focus' | 'anchor' | 'focusNode' | 'range') {
  const inside = {};
  return {
    querySelector: () => mode === 'tool' ? inside : null,
    contains: (node: unknown) => node === inside,
    ownerDocument: {
      activeElement: mode === 'focus' ? inside : null,
      getSelection: () => ({ isCollapsed: mode === 'none' || mode === 'tool' || mode === 'focus',
        anchorNode: mode === 'anchor' ? inside : null, focusNode: mode === 'focusNode' ? inside : null,
        rangeCount: mode === 'range' ? 1 : 0, getRangeAt: () => ({ intersectsNode: () => true }) }),
    },
  } as unknown as HTMLDetailsElement;
}

// Drive the component lifecycle and refs with the existing React-18 hook harness pattern.
function cardInteraction() {
  const slots: any[] = [];
  let cursor = 0;
  let effects: (() => void)[] = [];
  const dispatcher = {
    useRef(initial: unknown) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], (next: unknown) => { slots[index] = next; }];
    },
    useLayoutEffect(effect: () => void, deps: unknown[]) {
      const index = cursor++;
      if (!slots[index] || deps.some((dep, i) => !Object.is(dep, slots[index][i]))) effects.push(effect);
      slots[index] = deps;
    },
  };
  const internals = (React as any).__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;
  return (props: PlanCardProps, port: HTMLDetailsElement, commit = true) => {
    cursor = 0; effects = [];
    const previous = internals.ReactCurrentDispatcher.current;
    internals.ReactCurrentDispatcher.current = dispatcher;
    try {
      const root = PlanCard(props);
      const details = root.props.children[1];
      details.ref.current = port;
      const pendingEffects = effects.slice();
      const flush = () => { for (const effect of pendingEffects) effect(); };
      if (commit) flush();
      return { root, details, calls: details.props.children[1], commit: flush };
    } finally { internals.ReactCurrentDispatcher.current = previous; }
  };
}

test('promotion preserves the detail container and reading intent; untouched fallback may close', () => {
  for (const mode of ['none', 'tool', 'focus', 'anchor', 'focusNode', 'range'] as const) {
    const render = cardInteraction();
    const port = readingHistory(mode);
    const child = createElement('div', { 'data-reader-tool-call': 'same' }, 'detail');
    const before = render({ todos: [], hasChecklist: false, children: child }, port);
    assert.equal(before.details.props.open, true);
    const props = { todos: [], hasChecklist: true, children: createElement(Fragment, { key: 'same' }, child) };
    render(props, port); // promotion's layout effect updates open before paint
    const after = render(props, port);
    assert.equal(after.root.type, before.root.type);
    assert.equal(after.details.type, before.details.type);
    assert.equal(after.details.key, before.details.key);
    assert.equal(after.calls.type, before.calls.type);
    assert.equal(after.calls.props.children[0].key, before.calls.props.children[0].key);
    assert.equal(after.details.props.open, mode !== 'none');
    after.details.props.onToggle({ currentTarget: { open: true } });
    assert.equal(render(props, port).details.props.open, true, 'an explicit history open survives unrelated updates');
  }
  assert.equal(keepPlanHistoryOpen(null), false);
});

test('fallback capture records focus and pointer intent before promotion even if commit has already removed the active element', () => {
  assert.equal(keepPlanHistoryOpen(null, true), true, 'captured intent does not require a surviving DOM ref');
  assert.equal(keepPlanHistoryOpen({ querySelector: () => { throw new Error('too late to inspect DOM'); } } as unknown as HTMLElement, true), true);
  for (const eventName of ['onFocusCapture', 'onPointerDownCapture'] as const) {
    const render = cardInteraction();
    const port = readingHistory('none');
    const before = render({ todos: [], hasChecklist: false }, port);
    before.details.props[eventName]();
    assert.equal(keepPlanHistoryOpen(port), false, 'post-commit DOM reports no focus, selection or open tool');
    const props = { todos: [], hasChecklist: true };
    const promotion = render(props, port, false);
    assert.equal(promotion.details.props.open, true, 'pre-commit render must keep history open');
    promotion.commit();
    assert.equal(render(props, port).details.props.open, true, 'captured intent survives the post-commit guard');
  }
});

test('an untouched newly created checklist stays collapsed, while explicit open and close still win', () => {
  const render = cardInteraction();
  const port = readingHistory('none');
  const props = { todos: [], hasChecklist: true };
  const created = render(props, port);
  assert.equal(created.details.props.open, false);
  created.details.props.onToggle({ currentTarget: { open: true } });
  const opened = render(props, port);
  assert.equal(opened.details.props.open, true);
  opened.details.props.onToggle({ currentTarget: { open: false } });
  assert.equal(render(props, port).details.props.open, false);
});

test('parent integration retains every original ToolRow with native expandable input/result/raw views', () => {
  const calls = ['saved', 'rejected'].map((id, index) => ({
    kind: 'tool' as const, key: `reader-tool:${id}`, step: 1,
    entry: toolEntry(id, 1, settledTool(id, 'todo_write', { todos: [{ content: id, status: 'pending' }] },
      { isError: index === 1, content: [{ type: 'text', text: `${id} original result` }] })),
  }));
  const plan = buildTranscript(calls, () => undefined, true)[0] as PlanEntry;
  const html = renderToStaticMarkup(createElement(ReaderActionsContext.Provider, { value: { motion: false } },
    createElement(PlanCard, { todos: plan.todos, ...planStatus(plan, true) },
      plan.calls.map(call => createElement(ToolRow, {
        key: call.key, entry: call.entry, turnClosed: true, onRead: () => {},
        renderSlotChain: (_name: string, _owner: unknown, value: { fallback: unknown }) => value.fallback,
        loadImage: async () => 'blob:test',
      } as never)))));
  assert.match(html, /计划更新失败/);
  assert.match(html, /data-reader-tool-call="saved"/);
  assert.match(html, /data-reader-tool-call="rejected"[^>]*data-tool-phase="failed"/);
  assert.equal(html.match(/aria-expanded="false"/g)?.length, 2, 'each original row keeps its own disclosure');
  // ToolRow lazily mounts ToolDetails after expansion. Exercise that native detail renderer,
  // rather than expecting closed-row server markup to contain an already mounted detail.
  for (const call of plan.calls) {
    const model = activitySummary(call.entry);
    assert.equal(model.raw, call.entry.block && 'kind' in call.entry.block ? call.entry.block.call.argsRaw : '');
    const detail = renderToStaticMarkup(createElement(ReaderActionsContext.Provider, { value: { motion: false } },
      createElement(ToolDetails, {
        entry: call.entry, model, phase: activityPhase(call.entry, true),
        renderSlotChain: (_name: string, _owner: unknown, value: { fallback: unknown }) => value.fallback,
        loadImage: async () => 'blob:test',
      } as never)));
    assert.match(detail, /data-reader-tool-details/);
    assert.match(detail, />原始数据<\/button>/);
    assert.ok(detail.includes(`${call.entry.callId} original result`));
  }
});
