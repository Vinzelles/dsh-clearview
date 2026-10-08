import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const BUNDLE = new URL('../lib/client.js', import.meta.url);

test('the built bundle requires only the three shared host modules', { skip: !existsSync(BUNDLE) && 'lib/client.js is not built' }, () => {
  const output = execFileSync(process.execPath, ['scripts/check-bundle-externals.mjs', 'lib/client.js'], { encoding: 'utf8' });
  assert.match(output, /Runtime externals: @deepseek-ai\/dsh-client-ui-primitives, react, react\/jsx-runtime/);
});

test('the built bundle carries the package version as its root version', { skip: !existsSync(BUNDLE) && 'lib/client.js is not built' }, () => {
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
  assert.ok(readFileSync(BUNDLE, 'utf8').includes(`"${version}"`), `bundle lacks "${version}"`);
});
