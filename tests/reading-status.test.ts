import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statusBottomInset } from '../src/client/reading-status.ts';

test('tail inset stays constant through growth and intermediate eased scroll positions', () => {
  assert.equal(statusBottomInset(840, 710, 0), 130);
  assert.equal(statusBottomInset(840, 810, 100), 130);
  assert.equal(statusBottomInset(840, 1010, 300), 130);
  assert.equal(statusBottomInset(840, 850, 140), 130);
});
test('the native composer and content padding remain part of the resting inset', () => {
  assert.equal(statusBottomInset(900, 792, 0), 108);
  assert.equal(statusBottomInset(900, 1042, 250), 108);
});
test('subpixel layout rounds once and a tail beyond the surface has no negative inset', () => {
  assert.equal(statusBottomInset(900, 792.4, 0), 108);
  assert.equal(statusBottomInset(900, 992.2, 200), 108);
  assert.equal(statusBottomInset(900, 920, 0), 0);
});
