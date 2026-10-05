import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { cssEscape, escapeIdentifier } from '../src/client/css-escape.ts';

const BS = '\\';
const KEYS = ['assistant:1', 'call"quote', "call'single", `back${BS}slash`, 'tool:abc]-[x', '7leading-digit', '-1', '-', 'a b', '中文键', 'a\u0000b', 'a\u001fb'];

function withGlobalCss<T>(value: unknown, run: () => T): T {
  const had = Object.getOwnPropertyDescriptor(globalThis, 'CSS');
  Object.defineProperty(globalThis, 'CSS', { value, configurable: true, writable: true });
  try { return run(); } finally {
    if (had) Object.defineProperty(globalThis, 'CSS', had); else delete (globalThis as { CSS?: unknown }).CSS;
  }
}

test('a host-defined CSS string does not break escaping', () => {
  withGlobalCss('.sap-section{display:none}', () => {
    for (const key of KEYS) assert.equal(cssEscape(key), escapeIdentifier(key));
  });
});

test('the native escape is preferred when it is a function', () => {
  withGlobalCss({ escape: (value: string) => `native(${value})` }, () => assert.equal(cssEscape('a:b'), 'native(a:b)'));
  withGlobalCss({ escape: 'not a function' }, () => assert.equal(cssEscape('a:b'), `a${BS}:b`));
  withGlobalCss(undefined, () => assert.equal(cssEscape('a:b'), `a${BS}:b`));
});

test('the fallback follows the CSSOM identifier rules', () => {
  assert.equal(escapeIdentifier('assistant:1'), `assistant${BS}:1`);
  assert.equal(escapeIdentifier('call"quote'), `call${BS}"quote`);
  assert.equal(escapeIdentifier(`back${BS}slash`), `back${BS}${BS}slash`);
  assert.equal(escapeIdentifier('7a'), `${BS}37 a`);
  assert.equal(escapeIdentifier('-1'), `-${BS}31 `);
  assert.equal(escapeIdentifier('-'), `${BS}-`);
  assert.equal(escapeIdentifier('a b'), `a${BS} b`);
  assert.equal(escapeIdentifier('a\u0000b'), 'a�b');
  assert.equal(escapeIdentifier('a\u001fb'), `a${BS}1f b`);
  assert.equal(escapeIdentifier('中文_键-1'), '中文_键-1');
});

test('an escaped key keeps every quote, bracket, colon and backslash escaped', () => {
  const escapes = new RegExp(`${BS}${BS}(?:[0-9a-f]{1,6} ?|[\\s\\S])`, 'g');
  const raw = /["'\][:\\ ]/;
  for (const key of KEYS) assert.doesNotMatch(escapeIdentifier(key).replace(escapes, ''), raw, key);
});

test('src never reads the bare CSS global', () => {
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!/\.(ts|tsx)$/.test(entry)) continue;
      readFileSync(full, 'utf8').split('\n').forEach((line, index) => {
        if (/(^|[^\w.$])CSS\.(escape|supports)\b/.test(line)) offenders.push(`${full}:${index + 1}`);
      });
    }
  };
  walk(new URL('../src', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  assert.deepEqual(offenders, []);
});
