import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FOLLOW_DT_MAX, FOLLOW_VMAX, followAdvance } from '../src/client/reasoning-follow.js';

const idle = { pos: 0, velocity: 0, lastTail: 0, lastAt: 0 };

test('steady streaming converges to zero lag at exactly the content speed', () => {
  let state = { ...idle };
  const speed = 120; // px/s
  let previous = 0;
  for (let t = 16; t <= 4000; t += 16) {
    const tail = (speed * t) / 1000;
    state = followAdvance(state, tail, t);
    assert.ok(state.pos <= tail, 'never passes the live tail');
    if (t > 1500) {
      assert.ok(tail - state.pos < 0.5, `lag is invisible at t=${t}`);
      const delta = state.pos - previous;
      assert.ok(delta > 1.5 && delta < 2.5, `per-frame motion stays constant at t=${t}`);
    }
    previous = state.pos;
  }
});

test('a burst closes at capped speed, monotonically, without overshoot', () => {
  let state = { ...idle };
  let previousLag = Infinity;
  let previousPos = 0;
  for (let t = 16; t <= 2000; t += 16) {
    const tail = 900; // one transport burst at the first frame, then quiet
    state = followAdvance(state, tail, t);
    const lag = tail - state.pos;
    assert.ok(state.pos <= tail, 'no overshoot');
    assert.ok(lag <= previousLag + 1e-9, 'lag never grows');
    assert.ok(state.pos - previousPos <= FOLLOW_VMAX * FOLLOW_DT_MAX + 1e-9, 'speed stays capped');
    previousLag = lag; previousPos = state.pos;
  }
  assert.ok(state.settled, 'the loop parks itself once the burst is consumed');
  assert.equal(state.pos, 900);
});

test('a shrinking tail clamps the position instead of chasing a ghost', () => {
  const state = followAdvance({ pos: 500, velocity: 100, lastTail: 600, lastAt: 0 }, 400, 16);
  assert.equal(state.pos, 400);
  assert.equal(state.velocity, 0);
  assert.ok(state.settled);
});

test('the loop settles once the stream stops', () => {
  let state = { ...idle };
  let settledAt = 0;
  for (let t = 16; t <= 2000; t += 16) {
    state = followAdvance(state, 300, t);
    if (state.settled && !settledAt) settledAt = t;
  }
  assert.ok(settledAt > 0 && settledAt < 1500, 'settles shortly after the tail stops moving');
  assert.ok(Math.abs(state.pos - 300) < 0.5);
});

test('a card without overflow parks the loop on its first frame', () => {
  const state = followAdvance({ ...idle }, 0, 16);
  assert.equal(state.pos, 0);
  assert.ok(state.settled);
});

test('a throttled or restored tab moves at most one capped frame, never teleports', () => {
  const state = followAdvance({ ...idle }, 1000, 10000);
  assert.ok(state.pos <= FOLLOW_VMAX * FOLLOW_DT_MAX + 1e-9, 'one throttled frame cannot jump the whole gap');
  assert.ok(state.pos > 0, 'but it does start closing immediately');
});

test('mixed growth, pause, shrink and resume keeps the position inside the transcript', () => {
  let state = { ...idle };
  let tail = 0;
  for (let t = 16; t <= 6000; t += 16) {
    const seconds = t / 1000;
    if (seconds < 2) tail = 150 * seconds;
    else if (seconds < 2.1) tail = 300 + 800; // burst
    else if (seconds < 3) tail = 950;
    else if (seconds < 3.1) tail = 700; // reflow shrinks the transcript
    else tail = 700 + 100 * (seconds - 3.1);
    state = followAdvance(state, tail, t);
    assert.ok(state.pos >= 0 && state.pos <= tail, `position stays inside the transcript at t=${t}`);
    assert.ok(state.velocity >= 0);
  }
});