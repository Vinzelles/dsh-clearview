import assert from 'node:assert/strict';
import test from 'node:test';
import { CV_PLACEHOLDER, cvArmSize } from '../src/client/compat/perf-guard.ts';

test('cvArmSize pins the measured height for turns away from the placeholder', () => {
  // Tall closed turns: the inline intrinsic size makes elision size-neutral,
  // which is what keeps native scroll anchoring from yanking the viewport
  // upward when a placeholder swaps to real height mid-scroll.
  assert.equal(cvArmSize(3000), 'auto 3000px');
  assert.equal(cvArmSize(1234.6), 'auto 1235px');
  assert.equal(cvArmSize(482), 'auto 482px');
});

test('cvArmSize tolerates ±1px around the fallback', () => {
  assert.equal(cvArmSize(481), null);
  assert.equal(cvArmSize(479), null);
});

test('cvArmSize refuses to pin a height indistinguishable from the 480px fallback', () => {
  // A real height ≈ placeholder would arm for nothing; the turn stays
  // fully rendered (correct geometry, just no elision win).
  assert.equal(cvArmSize(CV_PLACEHOLDER), null);
  assert.equal(cvArmSize(480.5), null);
  assert.equal(cvArmSize(479.4), null);
});

test('cvArmSize rejects non-finite or non-positive measurements', () => {
  assert.equal(cvArmSize(0), null);
  assert.equal(cvArmSize(-5), null);
  assert.equal(cvArmSize(NaN), null);
  assert.equal(cvArmSize(Infinity), null);
});

test('cvArmSize respects a custom placeholder threshold', () => {
  assert.equal(cvArmSize(240, 240), null);
  assert.equal(cvArmSize(242, 240), 'auto 242px');
  assert.equal(cvArmSize(239, 240), null);
});

test('the placeholder constant matches the compat CSS fallback', () => {
  assert.equal(CV_PLACEHOLDER, 480);
});