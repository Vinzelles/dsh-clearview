import assert from 'node:assert/strict';
import { test } from 'node:test';
import { REASON_CATCH_LINES, REASON_CATCH_MAX, REASON_CATCH_MIN, REASON_STEP, reasoningAdvance, reasoningTarget } from '../src/client/reasoning-follow.js';

test('reasoning follows ordinary growth in two-line steps without passing the tail', () => {
  assert.equal(reasoningTarget(0, 284, 224, 24), 48);
  assert.equal(reasoningTarget(48, 284, 224, 24), 60);
  assert.equal(reasoningTarget(0, 100, 224, 24), 0);
  assert.equal(reasoningTarget(999, 284, 224, 24), 60);
});

test('a large reasoning burst still advances exactly two lines without skipping the middle', () => {
  let top = 0;
  for (const content of [400, 1200, 1500, 1500]) {
    const target = reasoningTarget(top, content, 224, 24);
    assert.equal(target - top, 48, 'a transport burst must not change the reference step distance');
    assert.ok(target <= content - 224);
    top = target;
  }
  while (top < 1500 - 224) {
    const target = reasoningTarget(top, 1500, 224, 24);
    assert.ok(target > top && target - top <= 48);
    top = target;
  }
  assert.equal(top, 1500 - 224);
  assert.equal(reasoningTarget(top, 1500, 224, 24), top, 'reaching the end must not replay the transcript');
});

test('two-line movement follows actual typography and clamps a resized viewport', () => {
  assert.equal(reasoningTarget(28, 900, 192, 30), 88);
  assert.equal(reasoningTarget(-50, 900, 192, 30), 60);
  assert.equal(reasoningTarget(708, 900, 400, 30), 500);
  assert.equal(reasoningTarget(0, 900, 192, 0), 2);
});

test('advance keeps the calm two-line step while the lag is small', () => {
  const step = 24 * 2;
  const calm = reasoningAdvance(0, 224 + 100, 224, 24);
  assert.equal(calm.target, step);
  assert.equal(calm.duration, REASON_STEP);
  assert.equal(calm.catchUp, false);
  // The final partial step may be shorter than two lines, never more.
  const final = reasoningAdvance(198, 224 + 224, 224, 24);
  assert.equal(final.target, 224);
  assert.equal(final.catchUp, false);
});

test('advance glides to the live tail once the lag exceeds the catch threshold', () => {
  const threshold = 24 * 2 * REASON_CATCH_LINES;
  const below = reasoningAdvance(0, 224 + threshold - 1, 224, 24);
  assert.equal(below.catchUp, false);
  assert.ok(below.target <= threshold - 1);
  const above = reasoningAdvance(0, 224 + threshold + 10, 224, 24);
  assert.equal(above.catchUp, true);
  assert.equal(above.target, threshold + 10, 'the glide targets the current end, not a fixed distance');
});

test('the catch-up duration scales with the distance inside its bounds', () => {
  const short = reasoningAdvance(0, 224 + 200, 224, 24);
  assert.ok(short.catchUp && short.duration === REASON_CATCH_MIN);
  const long = reasoningAdvance(0, 224 + 10000, 224, 24);
  assert.ok(long.catchUp && long.duration === REASON_CATCH_MAX);
  for (const gap of [500, 1000, 2000, 5000]) {
    const { duration } = reasoningAdvance(0, 224 + gap, 224, 24);
    assert.ok(duration >= REASON_CATCH_MIN && duration <= REASON_CATCH_MAX, `gap ${gap} within bounds`);
  }
  const monotonic = [300, 600, 1200, 4000].map(gap => reasoningAdvance(0, 224 + gap, 224, 24).duration);
  for (let i = 1; i < monotonic.length; i++) assert.ok(monotonic[i] >= monotonic[i - 1], 'duration never shrinks with distance');
});

test('advance never passes the tail and settles when already at the end', () => {
  for (const gap of [1, 2, 47, 97, 400, 5000]) {
    const { target } = reasoningAdvance(0, 224 + gap, 224, 24);
    assert.ok(target <= gap, 'no overshoot');
  }
  const settled = reasoningAdvance(300, 524, 224, 24);
  assert.equal(settled.target, 300);
  assert.equal(settled.duration, 0);
  assert.equal(settled.catchUp, false);
  assert.equal(reasoningAdvance(999, 524, 224, 24).target, 300, 'a lagged start clamps to the real end');
  assert.equal(reasoningAdvance(-50, 224 + 40, 224, 24).target, 40, 'a negative start clamps to the top');
});