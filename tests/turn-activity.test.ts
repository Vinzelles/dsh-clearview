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

test('turnPhaseOf: missing or non-running assistant-step falls back to processing', () => {
  // 无 assistant-step → processing
  assert.equal(turnPhaseOf({ status: 'open', steps: [{ step: 0, data: new Map() }] }, 0), 'processing');
  // 非 running 的 assistant-step（含 tool-call）→ processing 兜底
  const settled = {
    step: 0, data: new Map([['assistant-step', { status: 'settled', blocks: [tool], time: 1000 }]]),
  };
  assert.equal(turnPhaseOf({ status: 'open', steps: [settled] }, 0), 'processing');
});

test('turnPhaseOf: settled tail keeps thinking/output but never tool', () => {
  // 锚定现状：settled 的 assistant-step 尾部 reasoning/text 仍映射 thinking/output
  const settledReasoning = {
    step: 0, data: new Map([['assistant-step', { status: 'settled', blocks: [reasoning], time: 1000 }]]),
  };
  assert.equal(turnPhaseOf({ status: 'open', steps: [settledReasoning] }, 0), 'thinking');
  const settledText = {
    step: 0, data: new Map([['assistant-step', { status: 'settled', blocks: [text], time: 1000 }]]),
  };
  assert.equal(turnPhaseOf({ status: 'open', steps: [settledText] }, 0), 'output');
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

test('latestOpenTurn derives since from tool callTime with data.time fallback', () => {
  const chat = [] as never[];
  // 末 block 为 tool-call 且带 callTime：since 取 callTime
  const withCallTime = { kind: 'tool-call', callId: 'call-1', callTime: 2000 };
  const r1 = latestOpenTurn(
    { status: 'open', steps: [step(0, [reasoning, withCallTime])] }, 0, chat,
  );
  assert.equal(r1?.phase, 'tool');
  assert.equal(r1?.since, 2000);
  // 末 block 为 tool-call 但无 callTime：since 回退到 data.time（step() 固定 time: 1000）
  const r2 = latestOpenTurn(
    { status: 'open', steps: [step(0, [reasoning, tool])] }, 0, chat,
  );
  assert.equal(r2?.phase, 'tool');
  assert.equal(r2?.since, 1000);
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
  const t = { status: 'open', steps: [step(0, [reasoning])] };
  // 关键不变量：since 变化不影响 key（计时起点不重置 bar）；同一输入也覆盖确定性
  assert.equal(phaseKeyOf(t, 0, 1000), phaseKeyOf(t, 0, 9999));
  // 单变量：step 变化 → key 变化
  const c = phaseKeyOf({ status: 'open', steps: [step(1, [text])] }, 1, 1000);
  assert.notEqual(phaseKeyOf(t, 0, 1000), c);
  // 单变量：同 step 内 kind 变化 → key 变化
  const t0withText = { status: 'open', steps: [step(0, [text])] };
  assert.notEqual(phaseKeyOf(t, 0, 1000), phaseKeyOf(t0withText, 0, 1000));
});
