import './support/dom.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { InspectButton, ToolDetails } from '../src/client/ToolDetails.tsx';
import { activitySummary } from '../src/client/tool-activity.ts';
import { ReaderActionsContext, type ReaderActions } from '../src/client/reader-context.ts';
import { errorExcerpt } from '../src/client/ProcessRow.tsx';
import { ToolImages, ToolRow, toolRowTitle } from '../src/client/ToolRow.tsx';
import { settledTool, toolCall, toolEntry } from './support/chat-fixture.ts';

function renderIn<P extends object>(actions: ReaderActions, component: ComponentType<P>, props: P): string {
  const original = console.error;
  console.error = (...args: unknown[]) => { if (!String(args[0]).includes('useLayoutEffect')) original(...args); };
  try { return renderToStaticMarkup(createElement(ReaderActionsContext.Provider, { value: actions }, createElement(component, props))); } finally { console.error = original; }
}
const render = { renderSlotChain: ((_n: string, _o: unknown, options: { fallback: unknown }) => options.fallback) as never, loadImage: async () => 'blob:x' };

test('error excerpts keep the first non-empty lines and cap the length', () => {
  assert.equal(errorExcerpt('\nError: a\n\n  at x\n  at y\n  at z'), 'Error: a\n  at x\n  at y');
  assert.equal(errorExcerpt('x'.repeat(400)).length, 300);
});

test('a failed command is a failed line with its exit code and no expanded error excerpt', () => {
  const block = settledTool('c1', 'bash', { command: 'npm run build' }, { isError: true, content: [{ type: 'text', text: 'Error: exit code: 2\nmore' }] });
  const html = renderIn({ motion: true }, ToolRow, { entry: toolEntry('c1', 1, block), turnClosed: true, onRead: () => {}, ...render });
  assert.match(html, /data-tool-phase="failed"/);
  assert.match(html, /data-tone="failed"/);
  assert.match(html, /退出码 2/);
  assert.doesNotMatch(html, /data-inset-tone="error"/);
  assert.doesNotMatch(html, /Error: exit code: 2/);
  assert.match(html, /运行[\s\S]*npm run build/);
});

test('a settled command shows the verb and the command, never a duration', () => {
  const block = settledTool('c1b', 'bash', { command: 'npm test' });
  const html = renderIn({ motion: true }, ToolRow, { entry: toolEntry('c1b', 1, block), turnClosed: true, onRead: () => {}, ...render });
  assert.match(html, /运行[\s\S]*npm test/);
  assert.doesNotMatch(html, /毫秒|\d 秒/);
  assert.doesNotMatch(html, /Bash|工具调用/);
});

test('a preparing call shimmers its verb only when motion is on', () => {
  const entry = toolEntry('c2', 1, undefined, toolCall('c2', 'bash', { command: 'ls' }));
  const on = renderIn({ motion: true }, ToolRow, { entry, turnClosed: false, onRead: () => {}, ...render });
  assert.match(on, /data-tone="running"/);
  assert.match(on, /data-shimmer="true"/);
  const off = renderIn({ motion: false }, ToolRow, { entry, turnClosed: false, onRead: () => {}, ...render });
  assert.doesNotMatch(off, /data-shimmer/);
});

test('sub-calls render as nested tool rows', () => {
  const child = settledTool('c4', 'read', { path: 'a.ts' });
  const parent = settledTool('c3', 'code', {}, { subCalls: [child] });
  const html = renderIn({ motion: true }, ToolRow, { entry: toolEntry('c3', 1, parent), turnClosed: true, onRead: () => {}, ...render });
  assert.match(html, /data-reader-tool-call="c3"[\s\S]*data-reader-tool-call="c4"/);
});

test('tool images stay visible as media blocks', () => {
  const block = settledTool('c5', 'screenshot', {}, { content: [{ type: 'image', attachment: { attachmentId: 'a1', mediaType: 'image/png' } }] });
  const html = renderIn({ motion: true }, ToolImages, { entries: [toolEntry('c5', 1, block)], ...render });
  assert.match(html, /data-reader-tool-media/);
  assert.match(html, /data-reader-image/);
  assert.equal(renderIn({ motion: true }, ToolImages, { entries: [toolEntry('c6', 1, settledTool('c6', 'bash', {}))], ...render }), '');
});

test('only the failed row is a failed line, not its healthy sub-calls', () => {
  const child = settledTool('c8', 'read', { path: 'a.ts' });
  const parent = settledTool('c7', 'bash', { command: 'npm run build' }, { isError: true, content: [{ type: 'text', text: 'Error: exit code: 2' }], subCalls: [child] });
  const html = renderIn({ motion: true }, ToolRow, { entry: toolEntry('c7', 1, parent), turnClosed: true, onRead: () => {}, ...render });
  assert.equal(html.match(/data-tone="failed"/g)?.length, 1);
  assert.match(html, /退出码 2[\s\S]*data-reader-tool-call="c8"/);
});

test('a failed call with text output marks its detail for the danger colour', () => {
  const block = settledTool('ce', 'mystery', {}, { isError: true, content: [{ type: 'text', text: 'boom' }] });
  const entry = toolEntry('ce', 1, block);
  const html = renderIn({ motion: true }, ToolDetails, { entry, model: activitySummary(entry), phase: 'failed' as const, ...render });
  assert.match(html, /class="document errorOutput" data-error="true"/);
});

test('the inspect button renders only when the host can inspect a call, and calls it with the call id', () => {
  const entry = toolEntry('c9', 1, settledTool('c9', 'bash', { command: 'ls' }));
  const props = { entry, model: activitySummary(entry), phase: 'succeeded' as const, ...render };
  const withHost = renderIn({ motion: true, inspectCall: () => {} }, ToolDetails, props);
  assert.match(withHost, /data-reader-inspect/);
  assert.match(withHost, /在轨迹中查看/);
  assert.doesNotMatch(renderIn({ motion: true }, ToolDetails, props), /data-reader-inspect/);
  const calls: string[] = [];
  const button = InspectButton({ callId: 'c9', inspectCall: id => calls.push(id) });
  assert.equal(button.type, 'button');
  (button.props as { onClick: () => void }).onClick();
  assert.deepEqual(calls, ['c9']);
});

test('the row title and the merged-row suffix come from one function', () => {
  const entry = toolEntry('t1', 1, settledTool('t1', 'bash', { command: 'ls' }));
  const html = renderIn({ motion: true }, ToolRow, { entry, turnClosed: true, onRead: () => {}, ...render });
  assert.equal(toolRowTitle(entry), '运行');
  assert.match(html, />运行</);
  assert.equal(toolRowTitle(toolEntry('t2', 1, settledTool('t2', 'skill', { name: 'x' }))), '使用技能');
  assert.equal(toolRowTitle(toolEntry('t3', 1, settledTool('t3', 'mystery', {}))), '调用工具');
});
