import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { COMPAT_CSS } from '../src/client/compat/styles.ts';

const CLIENT = new URL('../src/client/', import.meta.url);
const REDESIGNED = ['Reader', 'ProcessRow', 'ToolRow', 'ToolDetails', 'ReasoningRow', 'RecordRows', 'Opening', 'ProcessPanel', 'TurnSection', 'TurnFooter', 'FloatingStatus', 'FileChanges'];
const sheet = (name: string) => readFileSync(new URL(`${name}.module.css`, CLIENT), 'utf8');

test('redesigned surfaces use token radii and no in-flow backdrop blur', () => {
  for (const name of REDESIGNED) {
    const text = sheet(name);
    assert.doesNotMatch(text, /backdrop-filter/, `${name} uses backdrop-filter`);
    assert.doesNotMatch(text, /border-radius:\s*(?:6|7|10)px/, `${name} uses a retired radius`);
  }
});

test('retired animations are gone', () => {
  const all = REDESIGNED.map(sheet).join('\n') + COMPAT_CSS;
  for (const name of ['tool-state-pulse', 'dsh-cluster-active-pulse', 'dsh-cluster-active-shimmer', 'thinkShimmer', 'activity-twinkle']) {
    assert.doesNotMatch(all, new RegExp(name), name);
  }
});

test('compat CSS keeps only scroll anchoring, off-screen turns and the rewind bridge', () => {
  assert.match(COMPAT_CSS, /reader-scroll-anchor\.css/);
  assert.match(COMPAT_CSS, /reader-perf-long-content\.css/);
  assert.match(COMPAT_CSS, /rewind-reader-bridge\.css/);
  for (const retired of ['toolState', 'jumpDock', 'reasonPlain', 'data-reader-reasoning-card', String.raw`role="alert"\] \+ div`, 'dshcp-turn-footer', 'dshcp-stats-row']) {
    assert.doesNotMatch(COMPAT_CSS, new RegExp(retired), retired);
  }
});

test('every css.<name> used by a component exists in its stylesheet', () => {
  for (const file of readdirSync(CLIENT).filter(name => name.endsWith('.tsx'))) {
    const source = readFileSync(new URL(file, CLIENT), 'utf8');
    const match = /import css from '\.\/([\w.-]+\.module\.css)'/.exec(source);
    if (!match) continue;
    const css = readFileSync(new URL(match[1]!, CLIENT), 'utf8');
    const used = new Set([...source.matchAll(/\bcss\.([A-Za-z_]\w*)/g)].map(found => found[1]!));
    const missing = [...used].filter(name => !new RegExp(String.raw`\.${name}(?![\w-])`).test(css));
    assert.deepEqual(missing, [], `${file} references undefined classes in ${match[1]}`);
  }
});

test('role=button rows keep a focus ring and user bubbles keep the tight block gap', () => {
  const reader = sheet('Reader');
  assert.match(reader, /\.root \[role=button\]:not\(button\):focus-visible \{ outline: 2px solid/);
  assert.match(reader, /\.blocks \{[^}]*gap: var\(--cv-blocks-gap, 16px\)/);
  assert.match(sheet('Opening'), /\.user \{[^}]*--cv-blocks-gap: 10px/);
  assert.match(sheet('RecordRows'), /\.input \{[^}]*--cv-blocks-gap: 10px/);
});

test('the collapsed file-changes header cannot widen the reader (no negative side margin or width overshoot)', () => {
  const header = /\.header \{([^}]*)\}/.exec(sheet('FileChanges'))?.[1] ?? '';
  assert.notEqual(header, '', 'FileChanges .header rule exists');
  assert.doesNotMatch(header, /margin:[^;]*-\d/, 'negative margin leaks into the scrollable area at narrow widths');
  assert.doesNotMatch(header, /width:\s*calc\(100%\s*\+/, 'width overshoot leaks into the scrollable area at narrow widths');
});
