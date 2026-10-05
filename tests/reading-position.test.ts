import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickAnchor, recallPosition, rememberPosition } from '../src/client/reading-position.ts';

test('the anchor is the first element still visible below the viewport top', () => {
  const anchors = [{ key: 'a', top: -400, bottom: -20 }, { key: 'b', top: -60, bottom: 300 }, { key: 'c', top: 310, bottom: 600 }];
  assert.deepEqual(pickAnchor(anchors, 0), { anchorKey: 'b', offset: -60 });
  assert.equal(pickAnchor([{ key: 'a', top: -400, bottom: -20 }], 0), null);
});

test('positions are remembered per session and cleared when following the bottom', () => {
  rememberPosition('s1', { anchorKey: 'b', offset: -60 });
  assert.deepEqual(recallPosition('s1'), { anchorKey: 'b', offset: -60 });
  assert.equal(recallPosition('s2'), null);
  rememberPosition('s1', null);
  assert.equal(recallPosition('s1'), null);
});
