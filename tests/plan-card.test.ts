import './support/dom.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PlanCard } from '../src/client/PlanCard.tsx';

test('plan card counts done items and marks each state', () => {
  const html = renderToStaticMarkup(createElement(PlanCard, { todos: [{ content: '搭建骨架', status: 'completed' }, { content: '屋顶引擎', status: 'in_progress' }, { content: '验证', status: 'pending' }] }));
  assert.match(html, /data-reader-plan/);
  assert.match(html, /计划 · 1 \/ 3/);
  assert.match(html, /data-status="completed"[^>]*>[\s\S]*搭建骨架/);
  assert.match(html, /data-status="in_progress"[\s\S]*屋顶引擎/);
});
