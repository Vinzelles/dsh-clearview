import './support/dom.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render } from './support/render.ts';
import { FloatingStatus } from '../src/client/FloatingStatus.tsx';

const running = { label: '正在思考', seconds: 134, key: 'open:3:reasoning', phase: 'thinking' as const };
const idle = { label: '', seconds: null, key: null, phase: 'idle' as const };

test('a running turn scrolled away shows the status pill', () => {
  const html = render(FloatingStatus, { activity: running, detached: true, onJump: () => {}, motion: true });
  assert.match(html, /data-reader-activity-pill/);
  assert.match(html, /data-stub="StateDot" data-state="ongoing"/);
  assert.match(html, /正在思考[\s\S]*2 分 14 秒/);
  assert.doesNotMatch(html, /data-reader-jump/);
});

test('an idle reader scrolled away shows the round jump button', () => {
  const html = render(FloatingStatus, { activity: idle, detached: true, onJump: () => {}, motion: true });
  assert.match(html, /data-reader-jump/);
  assert.doesNotMatch(html, /data-reader-activity-pill/);
});

test('nothing floats while the reader is at the latest content', () => {
  assert.equal(render(FloatingStatus, { activity: running, detached: false, onJump: () => {}, motion: true }), '');
});

test('waiting for the user freezes the pill into an attention dot', () => {
  const html = render(FloatingStatus, { activity: { ...running, phase: 'waiting', label: '等待你的操作', seconds: null }, detached: true, onJump: () => {}, motion: true });
  assert.match(html, /data-state="warning"/);
});
