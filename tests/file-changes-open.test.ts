import './support/dom.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openFileQuietly } from '../src/client/FileChanges.tsx';

test('a rejected or throwing opener never becomes an unhandled rejection', async () => {
  const unhandled: unknown[] = [];
  const listener = (reason: unknown) => { unhandled.push(reason); };
  process.on('unhandledRejection', listener);
  try {
    openFileQuietly(() => Promise.reject(new Error('missing file')), 'a.ts');
    openFileQuietly(() => { throw new Error('no handler'); }, 'b.ts');
    openFileQuietly(undefined, 'c.ts');
    await new Promise(resolve => setTimeout(resolve, 20));
  } finally { process.off('unhandledRejection', listener); }
  assert.deepEqual(unhandled, []);
});

test('the opener receives the clicked path', () => {
  const seen: string[] = [];
  openFileQuietly(path => { seen.push(path); }, 'src/a.ts');
  assert.deepEqual(seen, ['src/a.ts']);
});
