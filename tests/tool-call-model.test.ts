import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toolRowModel, VARIANT_TITLES } from '../src/client/native/tool-call-model.ts';

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

test('an unknown tool gets the Chinese fallback title, its real name rides the summary', () => {
  const started = { phase: 'start', callId: 'call-9', name: 'mystery_tool', turn: 1, step: 2, time: 0, subCalls: [], argsRaw: JSON.stringify({ q: 'x' }) };
  const model = toolRowModel('mystery_tool', started as never);
  assert.equal(model.title, '工具调用');
  assert.match(model.summary, /^mystery_tool · /);
});

test('generic row titles carry no English words; tool names stay as data', () => {
  assert.deepEqual(Object.values(VARIANT_TITLES).filter(title => /[A-Za-z]{3,}/.test(title) && !['Bash'].includes(title)), []);
  for (const name of ['cordis_package_inspect', 'cordis_run', 'cordis_stop', 'cordis_undefine']) {
    const model = toolRowModel(name, { phase: 'start', callId: 'c', name, turn: 1, step: 1, time: 0, subCalls: [], argsRaw: '{}' } as never);
    assert.doesNotMatch(model.title.replace(/Cordis/g, ''), /[A-Za-z]{3,}/, name);
  }
  assert.equal(toolRowModel('bash', { phase: 'start', callId: 'c', name: 'bash', turn: 1, step: 1, time: 0, subCalls: [], argsRaw: '{}' } as never).title, 'Bash');
});
