import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  activityLabel, formatSeconds, latestOpenTurn, phaseKeyOf, turnPhaseOf,
} from '../src/client/turn-activity.ts';

const step = (n: number, blocks: unknown[]) => ({
  step: n, data: new Map([['assistant-step', { status: 'running', blocks, time: 1000 }]]),
});
const reasoning = { kind: 'reasoning', text: 'x' };
const text = { kind: 'text', text: 'y' };
const tool = { kind: 'tool-call', callId: 'call-1' };

test('turnPhaseOf: running steps map to phases', () => {
  assert.equal(turnPhaseOf({ status: 'open', steps: [step(0, [reasoning, tool])] }, 0), 'tool');
  assert.equal(turnPhaseOf({ status: 'open', steps: [step(0, [reasoning])] }, 0), 'thinking');
  assert.equal(turnPhaseOf({ status: 'open', steps: [step(0, [text])] }, 0), 'output');
  assert.equal(turnPhaseOf({ status: 'open', steps: [step(0, [tool])] }, 0), 'tool');
  assert.equal(turnPhaseOf({ status: 'open', steps: [step(0, [tool])] }, 1), 'waiting');
  assert.equal(turnPhaseOf({ status: 'closed', steps: [step(0, [reasoning])] }, 0), 'idle');
  assert.equal(turnPhaseOf(undefined, 0), 'idle');
});

test('latestOpenTurn selects the newest open turn and derives since/key', () => {
  const chat = [
    { kind: 'assistant-step', data: { status: 'running', blocks: [reasoning], time: 1000 } },
  ] as never[];
  const result = latestOpenTurn(
    { status: 'open', steps: [step(0, [reasoning])] }, 0, chat,
  );
  assert.equal(result?.phase, 'thinking');
  assert.equal(result?.since, 1000);
  assert.equal(typeof result?.key, 'string');
  assert.equal(latestOpenTurn({ status: 'closed' }, 0, chat), null);
});

test('activityLabel maps phases to stable copy', () => {
  assert.equal(activityLabel('thinking'), '正在思考');
  assert.equal(activityLabel('output'), '正在输出');
  assert.equal(activityLabel('tool'), '正在使用工具');
  assert.equal(activityLabel('waiting'), '等待你的操作');
  assert.equal(activityLabel('processing'), '正在处理');
  assert.equal(activityLabel('idle'), '');
});

test('formatSeconds renders duration', () => {
  assert.equal(formatSeconds(0), '不到 1 秒');
  assert.equal(formatSeconds(5), '5 秒');
  assert.equal(formatSeconds(80), '1 分 20 秒');
  assert.equal(formatSeconds(3600), '60 分钟');
});

test('phaseKeyOf is stable for same phase and changes across phases', () => {
  const a = phaseKeyOf({ status: 'open', steps: [step(0, [reasoning])] }, 0, 1000);
  const b = phaseKeyOf({ status: 'open', steps: [step(0, [reasoning])] }, 0, 1000);
  const c = phaseKeyOf({ status: 'open', steps: [step(1, [text])] }, 1, 1000);
  assert.equal(a, b);
  assert.notEqual(a, c);
});
