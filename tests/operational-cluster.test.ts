import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  formatOperationClusterSummary,
  groupOperationalFlow,
  type ReaderFlowEntry,
  type OperationalClusterSummary,
} from '../src/client/tool-activity.ts';
import type { ToolCallBlock } from '../src/client/types.ts';

test('formatOperationClusterSummary formats correctly', () => {
  assert.equal(
    formatOperationClusterSummary({ commands: 3, tools: 5, operations: 2, failed: 0, skills: 0 }),
    '运行了 3 条命令，进行了 5 次工具调用，执行了 2 个操作',
  );
  assert.equal(
    formatOperationClusterSummary({ commands: 1, tools: 1, operations: 0, failed: 0, skills: 0 }),
    '运行了 1 条命令，进行了 1 次工具调用',
  );
  assert.equal(
    formatOperationClusterSummary({ commands: 0, tools: 2, operations: 2, failed: 0, skills: 0 }),
    '进行了 2 次工具调用，执行了 2 个操作',
  );
  assert.equal(
    formatOperationClusterSummary({ commands: 1, tools: 2, operations: 0, failed: 0, skills: 1 }),
    '使用了 1 个技能，运行了 1 条命令，进行了 2 次工具调用',
  );
});

test('groupOperationalFlow does not collapse single item', () => {
  const toolEntry: ReaderFlowEntry = {
    kind: 'tool',
    callId: 'call-1',
    block: {
      callId: 'call-1',
      title: 'bash',
      args: { command: 'ls' },
      isError: false,
      subCalls: [],
    } as unknown as ToolCallBlock,
  };
  const grouped = groupOperationalFlow([toolEntry], () => undefined);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].kind, 'single');
});

test('groupOperationalFlow clusters consecutive tool and command items', () => {
  const bashEntry: ReaderFlowEntry = {
    kind: 'tool',
    callId: 'call-1',
    block: {
      kind: 'tool-call',
      callId: 'call-1',
      name: 'bash',
      argsRaw: JSON.stringify({ command: 'npm test' }),
      isError: false,
      subCalls: [],
    } as unknown as ToolCallBlock,
  };
  const readEntry: ReaderFlowEntry = {
    kind: 'tool',
    callId: 'call-2',
    block: {
      kind: 'tool-call',
      callId: 'call-2',
      name: 'read_file',
      argsRaw: JSON.stringify({ path: '/tmp/test.txt' }),
      isError: false,
      subCalls: [],
    } as unknown as ToolCallBlock,
  };
  const writeEntry: ReaderFlowEntry = {
    kind: 'tool',
    callId: 'call-3',
    block: {
      kind: 'tool-call',
      callId: 'call-3',
      name: 'str_replace_editor',
      argsRaw: JSON.stringify({ command: 'create', path: '/tmp/foo.txt', file_text: 'hello' }),
      isError: false,
      subCalls: [],
    } as unknown as ToolCallBlock,
  };

  const grouped = groupOperationalFlow([bashEntry, readEntry, writeEntry], () => undefined);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].kind, 'cluster');
  if (grouped[0].kind === 'cluster') {
    assert.equal(grouped[0].items.length, 3);
    assert.equal(grouped[0].summary.commands, 1);
    assert.equal(grouped[0].summary.tools, 3);
    assert.equal(grouped[0].summary.operations, 2);
    assert.equal(grouped[0].hasActive, false);
    assert.equal(grouped[0].hasFailed, false);
    assert.equal(
      formatOperationClusterSummary(grouped[0].summary),
      '运行了 1 条命令，进行了 3 次工具调用，执行了 2 个操作',
    );
  }
});

test('groupOperationalFlow counts skill calls and leads the summary', () => {
  const skillEntry: ReaderFlowEntry = {
    kind: 'tool',
    callId: 'skill-1',
    block: {
      kind: 'tool-call',
      callId: 'skill-1',
      name: 'skill',
      argsRaw: JSON.stringify({ name: 'pdf-helper' }),
      isError: false,
      subCalls: [],
    } as unknown as ToolCallBlock,
  };
  const bashEntry: ReaderFlowEntry = {
    kind: 'tool',
    callId: 'call-1',
    block: {
      kind: 'tool-call',
      callId: 'call-1',
      name: 'bash',
      argsRaw: JSON.stringify({ command: 'npm test' }),
      isError: false,
      subCalls: [],
    } as unknown as ToolCallBlock,
  };
  const grouped = groupOperationalFlow([skillEntry, bashEntry], () => undefined);
  assert.equal(grouped.length, 1);
  if (grouped[0]?.kind === 'cluster') {
    assert.equal(grouped[0].summary.skills, 1);
    assert.equal(grouped[0].summary.tools, 2);
    assert.equal(
      formatOperationClusterSummary(grouped[0].summary),
      '使用了 1 个技能，运行了 1 条命令，进行了 2 次工具调用',
    );
  }
});

test('groupOperationalFlow clusters command and manual compaction records together', () => {
  const commandNode: ReaderFlowEntry = { kind: 'node', nodeKey: 'cmd', order: 1 };
  const compactNode: ReaderFlowEntry = { kind: 'node', nodeKey: 'compact', order: 2 };
  const grouped = groupOperationalFlow([commandNode, compactNode], key => {
    if (key === 'cmd') return { kind: 'command', data: { outcome: { kind: 'success' } } } as any;
    if (key === 'compact') return { kind: 'manual-compaction', data: { command: { outcome: { kind: 'success' } } } } as any;
    return undefined;
  });
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0]?.kind, 'cluster');
  if (grouped[0]?.kind === 'cluster') {
    assert.equal(grouped[0].summary.commands, 2);
    assert.equal(grouped[0].summary.operations, 2);
  }
});

test('groupOperationalFlow separates clusters by non-operational items', () => {
  const t1: ReaderFlowEntry = {
    kind: 'tool',
    callId: 'call-1',
    block: { callId: 'call-1', title: 'bash', args: {}, isError: false, subCalls: [] } as unknown as ToolCallBlock,
  };
  const t2: ReaderFlowEntry = {
    kind: 'tool',
    callId: 'call-2',
    block: { callId: 'call-2', title: 'bash', args: {}, isError: false, subCalls: [] } as unknown as ToolCallBlock,
  };
  const nonOpNode: ReaderFlowEntry = {
    kind: 'node',
    nodeKey: 'text-node',
  };
  const t3: ReaderFlowEntry = {
    kind: 'tool',
    callId: 'call-3',
    block: { callId: 'call-3', title: 'read_file', args: {}, isError: false, subCalls: [] } as unknown as ToolCallBlock,
  };
  const t4: ReaderFlowEntry = {
    kind: 'tool',
    callId: 'call-4',
    block: { callId: 'call-4', title: 'read_file', args: {}, isError: false, subCalls: [] } as unknown as ToolCallBlock,
  };

  const grouped = groupOperationalFlow([t1, t2, nonOpNode, t3, t4], key => {
    if (key === 'text-node') return { kind: 'assistant' } as any;
    return undefined;
  });

  assert.equal(grouped.length, 3);
  assert.equal(grouped[0].kind, 'cluster');
  assert.equal(grouped[1].kind, 'single');
  assert.equal(grouped[2].kind, 'cluster');
});
