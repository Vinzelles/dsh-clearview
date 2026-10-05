import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { TurnLocation } from '@deepseek-ai/dsh-client-ui-conversation/client';
import { closingOf, fmtClock, fmtCompactTokens, fmtRun, presentedFiles, turnMeta, turnMetaText } from '../src/client/turn-meta.ts';

const NOW = new Date(2026, 9, 5, 12, 0, 0);

function turn(data: Record<string, unknown>, extra: Partial<Record<string, unknown>> = {}): TurnLocation {
  return { turn: 1, status: 'closed', start: { time: new Date(2026, 8, 24, 17, 3, 41).getTime() }, end: { time: new Date(2026, 8, 24, 17, 20, 20).getTime() },
    steps: [], data: new Map(Object.entries(data)), ...extra } as unknown as TurnLocation;
}
const tail = (overrides: Record<string, unknown> = {}) => ({ turn: 1, seq: 90, time: 0, closing: { step: 65, time: new Date(2026, 8, 24, 17, 20, 0).getTime(), finalNode: { seq: 88 } }, branchUnavailable: false, ...overrides });

test('clock: today shows HH:MM, this year shows the date, older years show the year', () => {
  assert.equal(fmtClock(new Date(2026, 9, 5, 9, 7).getTime(), NOW), '09:07');
  assert.equal(fmtClock(new Date(2026, 8, 24, 17, 20).getTime(), NOW), '9月24日 17:20');
  assert.equal(fmtClock(new Date(2025, 0, 2, 8, 0).getTime(), NOW), '2025年1月2日 08:00');
  assert.equal(fmtClock(Number.NaN, NOW), null);
});

test('run and token formats mirror the native footer', () => {
  assert.equal(fmtRun(999_000), '16分39秒');
  assert.equal(fmtRun(45_400), '45秒');
  assert.equal(fmtCompactTokens(950), '950');
  assert.equal(fmtCompactTokens(12_340), '12.3K');
  assert.equal(fmtCompactTokens(11_400_000), '11.4M');
  assert.equal(fmtCompactTokens(250_000_000), '250M');
});

test('turn meta joins clock, duration and usage from public turn data', () => {
  const meta = turnMeta(turn({ 'turn-tail': tail({ tokenUsage: { totalTokens: 11_400_000 } }) }), NOW);
  assert.deepEqual(meta, { clock: '9月24日 17:20', duration: '用时 16分39秒', usage: '用量 11.4M tok' });
  assert.equal(turnMetaText(meta), '9月24日 17:20 · 用时 16分39秒 · 用量 11.4M tok');
});

test('turn meta drops parts without evidence and ignores open turns', () => {
  assert.equal(turnMetaText(turnMeta(turn({ 'turn-tail': tail() }), NOW)), '9月24日 17:20 · 用时 16分39秒');
  assert.equal(turnMeta(turn({}, { status: 'open' }), NOW), null);
  assert.equal(turnMeta(turn({}, { start: undefined, end: undefined }), NOW), null);
  assert.equal(turnMetaText(null), '');
});

test('closing facts come from turn-tail and reject malformed payloads', () => {
  assert.deepEqual(closingOf(turn({ 'turn-tail': tail() })), { seq: 88, step: 65, time: new Date(2026, 8, 24, 17, 20, 0).getTime() });
  assert.equal(closingOf(turn({ 'turn-tail': { closing: null } })), null);
  assert.equal(closingOf(undefined), null);
});

test('presented files keep first-seen order, take the latest description, and stop at the closing reply', () => {
  const data = { 'turn-tail': tail(), deliverables: { produced: [], presented: [
    { path: 'README.md', description: '旧说明', seq: 10, index: 0 },
    { path: 'scene.png', seq: 11, index: 0 },
    { path: 'README.md', description: '运行、构建与结构说明', seq: 20, index: 0 },
    { path: 'late.txt', seq: 95, index: 0 },
    { path: '', seq: 12, index: 1 },
    { seq: 13, index: 0 },
  ] } };
  assert.deepEqual(presentedFiles(turn(data)), [
    { path: 'README.md', description: '运行、构建与结构说明', seq: 20, index: 0 },
    { path: 'scene.png', description: undefined, seq: 11, index: 0 },
  ]);
  assert.deepEqual(presentedFiles(turn({})), []);
  assert.deepEqual(presentedFiles(undefined), []);
});
