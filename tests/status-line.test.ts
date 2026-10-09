import './support/dom.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StatusLine, statusVerb } from '../src/client/StatusLine.tsx';

test('verbs', () => {
  assert.equal(statusVerb('正在思考'), '思考中…');
  assert.equal(statusVerb('正在生成文件内容'), '正在生成文件内容…');
  assert.equal(statusVerb('等待你的操作'), '等待你的操作');
});

test('running line: spark, shimmering verb, elapsed and thinking time', () => {
  const html = renderToStaticMarkup(createElement(StatusLine, { phase: 'running', label: '正在思考', elapsed: '13 分 42 秒', thinking: '1 分 42 秒', motion: true }));
  assert.match(html, /data-reader-status-line[^>]*data-phase="running"/);
  assert.match(html, /✻/);
  assert.match(html, /思考中…/);
  assert.match(html, /13 分 42 秒 · 已思考 1 分 42 秒/);
  assert.match(html, /role="status"/);
});

test('interrupted and error lines are red and do not spin', () => {
  const html = renderToStaticMarkup(createElement(StatusLine, { phase: 'interrupted', label: '已中断', elapsed: null, thinking: null, motion: true }));
  assert.match(html, /data-phase="interrupted"/);
  assert.doesNotMatch(html, /data-spin/);
});
