import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toolRowModel } from '../src/client/native/tool-call-model.ts';

test('a 0.2.0 preparing call carries no arguments and falls back to its call id', () => {
  const preparing = { phase: 'preparing', callId: 'call-7', name: 'bash', turn: 1, step: 2, time: 0, subCalls: [] };
  const model = toolRowModel('bash', preparing as never);
  assert.match(model.summary, /call-7/);
});

test('a started call summarizes its arguments', () => {
  const started = { phase: 'start', callId: 'call-8', name: 'bash', turn: 1, step: 2, time: 0, subCalls: [], argsRaw: JSON.stringify({ command: 'npm run build' }) };
  const model = toolRowModel('bash', started as never);
  assert.doesNotMatch(model.summary, /call-8/);
});
