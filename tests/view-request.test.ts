import { test } from 'node:test';
import assert from 'node:assert/strict';
import { viewRequestAction } from '../src/client/view-request.ts';

test('a found target is scrolled to, even while more content is loading', () => {
  assert.equal(viewRequestAction(true, false), 'scroll');
  assert.equal(viewRequestAction(true, true), 'scroll');
});

test('an absent target waits while the session is loading', () => {
  assert.equal(viewRequestAction(false, true), 'wait');
});

test('an absent target is dropped once loading has finished', () => {
  assert.equal(viewRequestAction(false, false), 'drop');
});
