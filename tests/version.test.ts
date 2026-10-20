import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { READER_VERSION } from '../src/client/version.ts';

test('the root version attribute follows package.json', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(READER_VERSION, manifest.version);
});

test('this release is 0.3.13', () => {
  assert.equal(READER_VERSION, '0.3.13');
});
