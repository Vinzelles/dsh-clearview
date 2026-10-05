import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settleOnFrame } from '../src/client/settlement-batch.ts';

test('word completions batch in one frame and cancelled leaves never update', () => {
  const originalRaf = globalThis.requestAnimationFrame, originalCancel = globalThis.cancelAnimationFrame;
  const frames = new Map<number, FrameRequestCallback>(); let id = 0;
  globalThis.requestAnimationFrame = callback => { frames.set(++id, callback); return id; };
  globalThis.cancelAnimationFrame = handle => { frames.delete(handle); };
  try {
    const calls: number[] = [];
    settleOnFrame(() => calls.push(1));
    const cancel = settleOnFrame(() => calls.push(2));
    settleOnFrame(() => calls.push(3));
    assert.equal(frames.size, 1); cancel();
    const callback = [...frames.values()][0]; frames.clear(); callback(16);
    assert.deepEqual(calls, [1, 3]);
    const cancelLast = settleOnFrame(() => calls.push(4)); cancelLast();
    assert.equal(frames.size, 0);
  } finally { globalThis.requestAnimationFrame = originalRaf; globalThis.cancelAnimationFrame = originalCancel; }
});
