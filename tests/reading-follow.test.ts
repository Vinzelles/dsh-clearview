import assert from 'node:assert/strict';
import test from 'node:test';
import { READING_SURFACE_GAP, nestedConsumesWheel, readingFollowAction, readingScrollAction } from '../src/client/reading-follow.ts';

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

test('an upward pass that lands inside the surface gap holds the detached intent (the snap-back fix)', () => {
  // The reported bug: a small or interrupted scroll-up left the reader inside
  // the 72px gap, and a position-only rule re-pinned follow, so the next
  // content growth yanked the reader back to the bottom. A scroll event that
  // carries no downward reader gesture must not resume follow.
  assert.deepEqual(readingScrollAction(false, false, true), { following: false, wantDown: false });
});

test('a downward reader gesture that settled at the surface resumes follow', () => {
  assert.deepEqual(readingScrollAction(false, true, true), { following: true, wantDown: false });
  // Already following (e.g. guard-hold pill): the gesture is consumed, intent
  // stays — no state flip, no re-render.
  assert.deepEqual(readingScrollAction(true, true, true), { following: true, wantDown: false });
});

test('a following reader at the surface holds without a gesture (anchor events must not flip intent)', () => {
  assert.deepEqual(readingScrollAction(true, false, true), { following: true, wantDown: false });
});

test('passive layout scroll outside the surface does not cancel follow intent', () => {
  // Growth/clamping can emit scroll before the eased follow catches up.
  // Upward input handlers already detach; no gesture here is layout, not intent.
  assert.deepEqual(readingScrollAction(true, false, false), { following: true, wantDown: false });
});

test('a down-gesture landing outside the surface stays pending for the event that crosses in', () => {
  // A smooth scroll / fling / scrollbar drag emits a run of scroll events;
  // only the one that crosses into the surface may resume follow. Consuming
  // the gesture on an out-of-surface event kept the jump pill up after the
  // reader had already reached the bottom by hand.
  assert.deepEqual(readingScrollAction(false, true, false), { following: false, wantDown: true });
  assert.deepEqual(readingScrollAction(true, true, false), { following: false, wantDown: true });
  // The crossing event then resumes follow and consumes the gesture.
  assert.deepEqual(readingScrollAction(false, true, true), { following: true, wantDown: false });
});

test('an up-gesture supersedes a pending down-gesture', () => {
  // The wheel handler clears wantDown before the up-scroll event arrives, so
  // a changed mind (down, then back up) must not re-pin at the surface.
  assert.deepEqual(readingScrollAction(false, false, true), { following: false, wantDown: false });
});

test('a wheel a nested scroll body absorbs never detaches the follow', () => {
  // The capped process body (320px, overscroll-behavior-y: contain) sits between the
  // pointer and the conversation port. An upward step there scrolls the body, not the
  // page: releasing the follow for it silently stopped the page from tracking the batch.
  const body = (current: number) => ({ current, scrollHeight: 900, clientHeight: 320, holds: true });
  assert.equal(nestedConsumesWheel([body(400)], -120), true, 'the body can scroll up: it spends the step');
  assert.equal(nestedConsumesWheel([body(0)], -120), true, 'at its top the containment stops the chain dead');
  assert.equal(nestedConsumesWheel([{ current: 0, scrollHeight: 900, clientHeight: 320, holds: false }], -120), false,
    'without containment the step chains out to the port, which may then detach');
  assert.equal(nestedConsumesWheel([body(0)], 120), true, 'a downward step can move the body again');
  assert.equal(nestedConsumesWheel([{ current: 580, scrollHeight: 900, clientHeight: 320, holds: false }], 120), false,
    'a body already at its bottom lets a downward step reach the port');
  assert.equal(nestedConsumesWheel([{ current: 0, scrollHeight: 320, clientHeight: 320, holds: true }], -120), false,
    'a body that does not overflow is transparent to the gesture');
  assert.equal(nestedConsumesWheel([{ current: 0, scrollHeight: 900, clientHeight: 320, holds: false },
    { current: 0, scrollHeight: 400, clientHeight: 320, holds: true }], -120), true,
    'any body in the chain that holds the step keeps the port still');
});
