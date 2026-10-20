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

test('native markdown image buttons are forced to a block box', () => {
  // The host renders an image as <p><button class="_imageButton_…"><img loading="lazy"></button></p>
  // with an inline-block button: its line box never grows to the loaded image, so the paragraph
  // stays one line tall and later text paints over the image. Only the image-button shape may be
  // blockified — a bare `button` selector would also break tool rows and avatars.
  assert.match(COMPAT_CSS, /reader-native-image\.css/);
  const declarations = COMPAT_CSS.split('\n')
    .map(line => line.trim())
    .filter(line => line.includes('button:has(> img)') && !line.startsWith('*') && !line.startsWith('/*'));
  assert.deepEqual(declarations, ['[data-conversation-scroll] p > button:has(> img) {']);
  const start = COMPAT_CSS.indexOf('[data-conversation-scroll] p > button:has(> img) {');
  const body = COMPAT_CSS.slice(start, COMPAT_CSS.indexOf('}', start));
  assert.match(body, /display: block;/);
});
