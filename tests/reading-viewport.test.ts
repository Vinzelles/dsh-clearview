import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readingInsets } from '../src/client/reading-viewport.ts';

test('offscreen host pane leaves its visible width for prose without shifting the host', () => {
  assert.deepEqual(readingInsets(146, 1294, 1440), { left: 0, right: 0 });
  assert.deepEqual(readingInsets(-78, 334, 480), { left: 78, right: 0 });
  assert.deepEqual(readingInsets(100, 600, 480), { left: 0, right: 120 });
  assert.deepEqual(readingInsets(-80, 600, 480), { left: 80, right: 120 });
});

test('a hidden or missing viewport never produces negative or oversized insets', () => {
  assert.deepEqual(readingInsets(-300, -100, 480), { left: 200, right: 0 });
  assert.deepEqual(readingInsets(500, 700, 480), { left: 0, right: 200 });
  assert.deepEqual(readingInsets(0, 0, 480), { left: 0, right: 0 });
  assert.deepEqual(readingInsets(NaN, 100, 480), { left: 0, right: 0 });
});
