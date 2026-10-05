import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exitCodeFromOutput } from '../src/client/tool-activity.ts';

test('exitCodeFromOutput: recovers the code the harness embeds in failure text', () => {
  assert.equal(exitCodeFromOutput('Error: grep search failed (exit 2): rg: /x: IO error', true), 2);
  assert.equal(exitCodeFromOutput('Error: exit code: 1 (no output)', true), 1);
  assert.equal(exitCodeFromOutput('exit code： 3', true), 3);
});

test('exitCodeFromOutput: no usable code — undefined, never a fabricated zero', () => {
  assert.equal(exitCodeFromOutput('Error: grep could not start its search command (ripgrep launch failed)', true), undefined);
  assert.equal(exitCodeFromOutput('Error: grep pattern rejected by ripgrep: rg: regex parse error', true), undefined);
  assert.equal(exitCodeFromOutput('Error: exit code: 0', true), undefined);
  assert.equal(exitCodeFromOutput('Error: grep search failed (exit 2)', false), undefined);
});
