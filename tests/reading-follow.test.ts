import assert from 'node:assert/strict';
import test from 'node:test';
import { READING_SURFACE_GAP, readingFollowAction } from '../src/client/reading-follow.ts';

const CLEAR = { selected: false, focused: false };

test('unguarded follow states keep the pre-guard semantics', () => {
  assert.equal(readingFollowAction(CLEAR, true, 0), 'follow');
  assert.equal(readingFollowAction(CLEAR, true, 5000), 'follow');
  assert.equal(readingFollowAction(CLEAR, false, 500), 'stabilize');
});

test('a selection freezes anchor work while detached (stale-anchor writes would drag the selected text)', () => {
  assert.equal(readingFollowAction({ selected: true, focused: false }, false, 500), 'none');
});

test('focus does not block stabilization for an already-detached reader', () => {
  assert.equal(readingFollowAction({ selected: false, focused: true }, false, 500), 'stabilize');
});

test('a guard holding a bottom-claiming reader surfaces the jump pill once content outruns the viewport', () => {
  // The silent-stall regression: selection or focus inside the reader used to
  // pause follow with no visible affordance until the reader scrolled by hand.
  assert.equal(readingFollowAction({ selected: true, focused: false }, true, READING_SURFACE_GAP + 1), 'surface');
  assert.equal(readingFollowAction({ selected: false, focused: true }, true, 900), 'surface');
});

test('a guard near the bottom stays silent — no pill for sub-threshold overrun', () => {
  assert.equal(readingFollowAction({ selected: true, focused: false }, true, READING_SURFACE_GAP), 'none');
  assert.equal(readingFollowAction({ selected: false, focused: true }, true, 8), 'none');
});
