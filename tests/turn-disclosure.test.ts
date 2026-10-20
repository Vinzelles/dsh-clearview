import './support/dom.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement, type MouseEvent } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TurnDisclosure } from '../src/client/TurnDisclosure.tsx';

const props = { label: '已完成', elapsed: '用时 4 分 59 秒', steps: 10, tools: 9, open: false,
  controls: 'turn-process', onToggle: () => {}, onPointerDown: () => {} };

test('turn summary has one shared status/disclosure slot and keeps its metadata and accessible label', () => {
  const html = renderToStaticMarkup(createElement(TurnDisclosure, props));
  assert.equal(html.match(/data-reader-turn-leading/g)?.length, 1);
  assert.match(html, /data-reader-turn-leading[^>]*aria-hidden="true"[^>]*>\s*<span[^>]*data-reader-turn-icon[\s\S]*data-reader-turn-chevron/);
  assert.match(html, /aria-expanded="false" aria-controls="turn-process"/);
  assert.match(html, /aria-label="已完成，用时 4 分 59 秒 · 10 步 · 9 次工具调用，展开过程"/);
  assert.match(html, /title="用时 4 分 59 秒 · 10 步 · 9 次工具调用"/);
});

test('expanded danger summary preserves state and omits missing metadata', () => {
  const html = renderToStaticMarkup(createElement(TurnDisclosure, { ...props, label: '处理失败', elapsed: null, steps: 0, tools: 0, open: true, danger: true }));
  assert.match(html, /data-danger="true"/);
  assert.match(html, /aria-expanded="true"/);
  assert.match(html, /aria-label="处理失败[^\"]*收起过程"/);
  assert.match(html, /data-reader-turn-chevron[^>]*data-open="true"/);
  assert.doesNotMatch(html, /0 步|0 次工具调用/);
});

test('the entire summary retains pointer intent and toggle callbacks', () => {
  let intent = 0, toggles = 0;
  const event = {} as MouseEvent<HTMLButtonElement>;
  const button = TurnDisclosure({ ...props, onPointerDown: () => { intent++; }, onToggle: value => { assert.equal(value, event); toggles++; } });
  button.props.onPointerDown();
  button.props.onClick(event);
  assert.equal(intent, 1);
  assert.equal(toggles, 1);
});
