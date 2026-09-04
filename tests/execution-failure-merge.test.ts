import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-runtime/client';
import { exitCodeFromOutput, isMergedExecutionFailure, type ToolActivityEntry } from '../src/client/tool-activity.ts';

/** A settled tool block; `kind` presence is what marks settlement. */
function settledBlock(over: Record<string, unknown> = {}): ToolCallBlock {
  return {
    kind: 'tool-call',
    callId: 'call-1',
    name: 'bash',
    argsRaw: JSON.stringify({ command: 'false' }),
    isError: false,
    content: [],
    meta: {},
    subCalls: [],
    ...over,
  } as unknown as ToolCallBlock;
}

function entry(block: ToolCallBlock): ToolActivityEntry {
  return { kind: 'tool', key: `reader-tool:${block.callId}`, callId: block.callId, step: 1, order: 1, block };
}

test('isMergedExecutionFailure: settled failed shell tool merges into the error card', () => {
  assert.equal(isMergedExecutionFailure(entry(settledBlock({ isError: true }))), true);
});

test('isMergedExecutionFailure: non-zero exit via terminal resultView merges', () => {
  const block = settledBlock({
    resultView: { card: 'terminal', title: 'ls /nope', output: 'ls: cannot access \'/nope\': No such file or directory', exitCode: 2 },
  });
  assert.equal(isMergedExecutionFailure(entry(block)), true);
});

test('isMergedExecutionFailure: failed grep merges — card carries search condition + output', () => {
  const block = settledBlock({
    name: 'grep',
    argsRaw: JSON.stringify({ pattern: 'useSession', path: 'D:\\repo\\src' }),
    isError: true,
    content: [{ type: 'text', text: 'Error: grep search failed (exit 2): rg: D:\\repo\\src: IO error' }],
  });
  assert.equal(isMergedExecutionFailure(entry(block)), true);
});

test('isMergedExecutionFailure: failed glob merges', () => {
  const block = settledBlock({
    name: 'glob',
    argsRaw: JSON.stringify({ pattern: 'src/**/*.ts', path: 'D:\\repo' }),
    isError: true,
    content: [{ type: 'text', text: 'Error: glob search failed (exit 2): rg: src: IO error' }],
  });
  assert.equal(isMergedExecutionFailure(entry(block)), true);
});

test('isMergedExecutionFailure: failed web tool merges — one semantic, one seat', () => {
  const block = settledBlock({
    name: 'web_search',
    argsRaw: JSON.stringify({ query: 'node test runner' }),
    isError: true,
    content: [{ type: 'text', text: 'Error: DeepSeek API error (HTTP 404)' }],
  });
  assert.equal(isMergedExecutionFailure(entry(block)), true);
});

test('isMergedExecutionFailure: failed file edit (write category) merges', () => {
  const block = settledBlock({
    name: 'edit',
    argsRaw: JSON.stringify({ file_path: '/tmp/a.ts', old_string: 'a', new_string: 'b' }),
    isError: true,
    content: [{ type: 'text', text: 'Error: old_string not found' }],
  });
  assert.equal(isMergedExecutionFailure(entry(block)), true);
});

test('isMergedExecutionFailure: failed write merges', () => {
  const block = settledBlock({
    name: 'write',
    argsRaw: JSON.stringify({ file_path: '/tmp/a.txt', content: 'x' }),
    isError: true,
  });
  assert.equal(isMergedExecutionFailure(entry(block)), true);
});

test('isMergedExecutionFailure: unsettled or non-failed tools keep their activity row', () => {
  const running = {
    kind: 'tool',
    key: 'reader-tool:live',
    callId: 'live',
    step: 1,
    order: 1,
    block: { callId: 'live', title: 'bash', args: { command: 'ls' }, isError: false, subCalls: [] },
  } as unknown as ToolActivityEntry;
  const runningGrep = {
    ...running,
    callId: 'live-grep',
    block: { callId: 'live-grep', name: 'grep', argsRaw: '{"pattern":"x"}', isError: false, content: [], subCalls: [] },
  } as unknown as ToolActivityEntry;
  const ok = entry(settledBlock({ isError: false }));
  assert.equal(isMergedExecutionFailure(running), false);
  assert.equal(isMergedExecutionFailure(runningGrep), false);
  assert.equal(isMergedExecutionFailure(ok), false);
});

test('isMergedExecutionFailure: turnClosed only matters for unsettled blocks', () => {
  const failedSettled = entry(settledBlock({ isError: true }));
  assert.equal(isMergedExecutionFailure(failedSettled, true), true);
  assert.equal(isMergedExecutionFailure(failedSettled, false), true);
});

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