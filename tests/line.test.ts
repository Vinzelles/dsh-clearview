import './support/dom.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Line } from '../src/client/Line.tsx';
import { toolTrailing } from '../src/client/ToolRow.tsx';

test('an expandable line is one button with aria-expanded and one shared icon/chevron slot', () => {
  const html = renderToStaticMarkup(createElement(Line, { icon: 'i', label: '运行', target: 'npm test', open: false, controls: 'tool-details', onToggle: () => {}, data: { 'data-reader-tool-call': 'c1' } }));
  assert.match(html, /<button[^>]*type="button"[^>]*aria-expanded="false"/);
  assert.match(html, /data-reader-line/);
  assert.match(html, /data-reader-tool-call="c1"/);
  assert.match(html, /运行[\s\S]*npm test/);
  assert.match(html, /aria-controls="tool-details"/);
  assert.equal(html.match(/data-reader-line-leading/g)?.length, 1);
  assert.match(html, /data-reader-line-leading[^>]*>[\s\S]*data-reader-line-icon[\s\S]*data-reader-line-chevron/);
  assert.doesNotMatch(html, /data-reader-line-hint|>展开<|>收起</);
});

test('a static line has only an operation icon and no spare disclosure slot', () => {
  const html = renderToStaticMarkup(createElement(Line, { icon: 'i', label: '读取任务输出' }));
  assert.doesNotMatch(html, /<button/);
  assert.match(html, /data-reader-line-leading[^>]*>[\s\S]*data-reader-line-icon/);
  assert.doesNotMatch(html, /data-chevron-slot|data-reader-line-chevron/);
  assert.doesNotMatch(html, /data-reader-line-hint/);
});

test('all disclosures omit side hints and preserve accessible state and toggle callbacks', () => {
  let clicks = 0;
  for (const label of ['思考', '运行了 2 条命令', '运行', '记录']) {
    const props = { icon: 'i', label, open: true, controls: 'detail', onToggle: () => { clicks++; } };
    const html = renderToStaticMarkup(createElement(Line, props));
    assert.match(html, /aria-expanded="true"[^>]*aria-controls="detail"/);
    assert.doesNotMatch(html, /data-reader-line-hint|>展开<|>收起</);
    Line(props).props.children.props.onClick();
  }
  assert.equal(clicks, 4);
});

test('failed and running tones are exposed for styling', () => {
  assert.match(renderToStaticMarkup(createElement(Line, { icon: 'i', label: 'x', tone: 'failed' })), /data-tone="failed"/);
  assert.match(renderToStaticMarkup(createElement(Line, { icon: 'i', label: 'x', tone: 'running', shimmer: true })), /data-shimmer="true"/);
});

test('tool trailing text: failures and edit stats only, no durations', () => {
  assert.deepEqual(toolTrailing('failed', 2, null), { text: '退出码 2', tone: 'failed' });
  assert.deepEqual(toolTrailing('failed', undefined, null), { text: '失败', tone: 'failed' });
  assert.deepEqual(toolTrailing('interrupted', undefined, null), { text: '已中断', tone: 'failed' });
  assert.equal(toolTrailing('succeeded', 0, null), null);
  assert.equal(toolTrailing('running', undefined, null), null);
  assert.deepEqual(toolTrailing('returned', undefined, { added: 3, removed: 1 }), { text: '+3 −1', tone: 'idle' });
});
