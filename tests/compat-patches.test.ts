import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { COMPAT_CSS } from '../src/client/compat/styles.ts';

const COMPAT = new URL('../src/client/compat/', import.meta.url);

test('only the three surviving compat patches are registered', () => {
  const source = readFileSync(new URL('index.ts', COMPAT), 'utf8');
  const registered = [...source.matchAll(/\['([\w-]+)',\s*\w+\.apply\]/g)].map(match => match[1]);
  assert.deepEqual(registered, ['perf-guard', 'rewind-bridge']);
  assert.doesNotMatch(source, /turn-metrics-footer|composer-readability/);
  assert.equal(existsSync(new URL('turn-metrics-footer.ts', COMPAT)), false);
  assert.equal(existsSync(new URL('composer-readability.ts', COMPAT)), false);
});

test('no compat style targets the removed footer or composer stats row', () => {
  assert.doesNotMatch(COMPAT_CSS, /dshcp-turn-footer|dshcp-stats-row/);
});

test('native markdown image button is forced to a block box', () => {
  // 宿主的图片按钮是 inline-block + vertical-align:middle，其所在 <p> 的行盒实测
  // 只有 19px（图片高至 360px），后文会压到图片上；块盒化后段落按图片撑开。
  const selectors = COMPAT_CSS.split('\n').map(line => line.trim()).filter(line => line.includes('button:has(> img)') && !line.startsWith('/*') && !line.startsWith('*'));
  assert.deepEqual(selectors, ['[data-conversation-scroll] p > button:has(> img) {']);
  const rule = COMPAT_CSS.slice(COMPAT_CSS.indexOf(selectors[0]));
  assert.match(rule.slice(0, rule.indexOf('}') + 1), /display: block;/);
});
