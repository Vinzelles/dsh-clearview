import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { COMPAT_CSS } from '../src/client/compat/styles.ts';

const COMPAT = new URL('../src/client/compat/', import.meta.url);

test('only the three surviving compat patches are registered', () => {
  const source = readFileSync(new URL('index.ts', COMPAT), 'utf8');
  const registered = [...source.matchAll(/\['([\w-]+)',\s*\w+\.apply\]/g)].map(match => match[1]);
  assert.deepEqual(registered, ['memory-tail-keep', 'perf-guard', 'rewind-bridge']);
  assert.doesNotMatch(source, /turn-metrics-footer|composer-readability/);
  assert.equal(existsSync(new URL('turn-metrics-footer.ts', COMPAT)), false);
  assert.equal(existsSync(new URL('composer-readability.ts', COMPAT)), false);
});

test('no compat style targets the removed footer or composer stats row', () => {
  assert.doesNotMatch(COMPAT_CSS, /dshcp-turn-footer|dshcp-stats-row/);
});
