import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nodeText, workflowRunSummary, workflowStatusLabel } from '../src/client/node-payloads.ts';

test('plain text payloads narrow strict shapes and reject everything else', () => {
  assert.equal(nodeText({ text: 'You are a helpful agent.' }), 'You are a helpful agent.');
  assert.equal(nodeText({ text: '' }), '');
  assert.equal(nodeText({ text: 42 }), null);
  assert.equal(nodeText({ text: ['a'] }), null);
  assert.equal(nodeText({}), null);
  assert.equal(nodeText(null), null);
  assert.equal(nodeText('text'), null);
  assert.equal(nodeText(['text']), null);
});

test('workflow run summary reads name, status and member totals across phases', () => {
  const data = {
    name: 'audit',
    status: 'running',
    phases: [
      { key: 'a', phase: 'recon', members: [{ seq: 1 }, { seq: 2 }] },
      { key: 'b', phase: null, members: [{ seq: 3 }] },
    ],
  };
  assert.deepEqual(workflowRunSummary(data), { name: 'audit', status: 'running', phaseCount: 2, memberCount: 3 });
  assert.deepEqual(workflowRunSummary({ name: 'x', status: 'completed', phases: [] }), { name: 'x', status: 'completed', phaseCount: 0, memberCount: 0 });
});

test('an unreadable phase makes the member total null instead of a partial lie', () => {
  const data = { name: 'x', status: 'failed', phases: [{ members: [{}] }, { members: 'no' }] };
  assert.deepEqual(workflowRunSummary(data), { name: 'x', status: 'failed', phaseCount: 2, memberCount: null });
});

test('unknown status values and malformed payloads report unknown instead of crashing', () => {
  assert.equal(workflowRunSummary({ status: 'nope' }).status, null);
  assert.equal(workflowRunSummary({ status: 'running' }).name, null);
  assert.equal(workflowRunSummary({ status: 'running' }).phaseCount, null);
  assert.equal(workflowRunSummary({ status: 'running' }).memberCount, null);
  assert.deepEqual(workflowRunSummary(undefined), { name: null, status: null, phaseCount: null, memberCount: null });
  assert.deepEqual(workflowRunSummary('run'), { name: null, status: null, phaseCount: null, memberCount: null });
  assert.deepEqual(workflowRunSummary([]), { name: null, status: null, phaseCount: null, memberCount: null });
});

test('status labels cover every durable status plus the unreadable one', () => {
  for (const [status, label] of [
    ['running', '运行中'],
    ['completed', '已完成'],
    ['failed', '已失败'],
    ['cancelled', '已取消'],
    ['interrupted', '已中断'],
  ] as const) {
    assert.equal(workflowStatusLabel(status), label);
  }
  assert.equal(workflowStatusLabel(null), '状态未知');
});
