import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bridgeLocaleSeat } from '../src/client/compat/locale-bridge.ts';

const MIGRATED = [
  'message.contextInjection',
  'message.contextRecall',
  'message.unknownBlock',
  'message.context.instructions.loaded',
  'message.context.instructions.added',
  'message.context.instructions.updated',
  'message.context.instructions.removed',
  'message.context.catalog.replaced',
  'message.context.catalog.more',
  'message.context.snapshot.supersedes',
  'message.context.relay.from',
  'message.context.recall.counts',
  'message.context.recall.truncated',
  'json.truncated',
];

test('an echo seat (migrated keys) falls back to the builtin Chinese dictionary', () => {
  const t = bridgeLocaleSeat((key: string) => key);
  assert.equal(t('message.contextInjection'), '上下文注入');
  assert.equal(t('message.contextRecall'), '跨会话召回');
  assert.equal(t('json.truncated', { total: 1234 }), '… 已截断，共 1234 字符');
  assert.equal(t('message.context.recall.counts', { retained: 3, omitted: 9 }), '保留 3 条 · 省略 9 条');
  assert.equal(t('message.context.relay.from', { session: 'abc' }), '来自会话 abc');
  assert.equal(t('message.context.catalog.more', { count: 5 }), '…还有 5 条');
});

test('a live seat (0.1.1 conversation NS) passes every migrated key through untouched', () => {
  const seat = (key: string, params?: Record<string, unknown>) =>
    key === 'json.truncated' ? `truncated ${params?.total}` : `<${key}>`;
  const t = bridgeLocaleSeat(seat);
  for (const key of MIGRATED) {
    const value = t(key, { total: 1 });
    assert.equal(value, seat(key, { total: 1 }), key);
  }
});

test('unknown keys that echo keep echoing (no invented translations)', () => {
  const t = bridgeLocaleSeat((key: string) => key);
  assert.equal(t('message.futureKey'), 'message.futureKey');
  assert.equal(t('message.contextInjection.extra'), 'message.contextInjection.extra');
});

test('a template whose param is missing keeps the placeholder', () => {
  const t = bridgeLocaleSeat((key: string) => key);
  assert.equal(t('message.context.recall.counts'), '保留 {retained} 条 · 省略 {omitted} 条');
  assert.equal(t('json.truncated', { total: undefined }), '… 已截断，共 {total} 字符');
});

test('the migrated dictionary covers every consumed key with no gaps', () => {
  // The bridge is the only source of these strings on 0.1.2; a key the reader
  // consumes but the dictionary lacks would echo into the UI.
  const seat = (key: string) => key;
  const t = bridgeLocaleSeat(seat);
  for (const key of MIGRATED) {
    assert.notEqual(t(key), key, `fallback dictionary misses ${key}`);
  }
});
