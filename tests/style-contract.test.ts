import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { COMPAT_CSS } from '../src/client/compat/styles.ts';

const CLIENT = new URL('../src/client/', import.meta.url);
const REDESIGNED = ['Reader', 'ProcessRow', 'ToolRow', 'ToolDetails', 'ReasoningRow', 'RecordRows', 'Opening', 'ProcessPanel', 'ClusterRow', 'TurnSection', 'TurnFooter', 'FloatingStatus', 'FileChanges'];
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

test('every rounded rule sets corner-shape: round beside its token radius', () => {
  const missing: string[] = [];
  for (const file of readdirSync(CLIENT).filter(name => name.endsWith('.module.css'))) {
    const text = readFileSync(new URL(file, CLIENT), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const rule of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const body = rule[2]!;
      if (/border-radius:\s*(?:var\(--dsw-radius-(?:sm|md|lg|xl)\)|999px|50%)/.test(body) && !/corner-shape:\s*round/.test(body)) {
        missing.push(`${file} ${rule[1]!.trim().replace(/\s+/g, ' ')}`);
      }
    }
  }
  assert.deepEqual(missing, [], 'rounded rules without corner-shape: round');
});

test('the turn-trigger opening is a 24px row, not a padded card', () => {
  const opening = sheet('Opening');
  const button = /\.triggerButton \{([^}]*)\}/.exec(opening)?.[1] ?? '';
  assert.match(button, /height: var\(--cv-row-height\)/);
  assert.match(button, /font-weight: 500/);
  assert.match(button, /color: var\(--dsw-alias-label-secondary\)/);
  assert.doesNotMatch(button, /padding:\s*10px/);
  assert.doesNotMatch(/\.trigger \{([^}]*)\}/.exec(opening)?.[1] ?? '', /background|box-shadow|border-radius/);
});

test('the reader column keeps 24px of breathing room after its last element, without a measured min-height', () => {
  const column = /\.column \{([^}]*)\}/.exec(sheet('Reader'))?.[1] ?? '';
  assert.match(column, /padding-bottom: 24px/);
  assert.doesNotMatch(readFileSync(new URL('Reader.module.css', CLIENT), 'utf8'), /min-height:\s*var\(--reader-flow-min-height/);
  for (const file of readdirSync(CLIENT).filter(name => name.endsWith('.tsx'))) {
    assert.doesNotMatch(readFileSync(new URL(file, CLIENT), 'utf8'), /reader-flow-min-height/, file);
  }
});

test('the cluster row uses the 24px row grammar with token colours only', () => {
  const css = sheet('ClusterRow');
  assert.match(css, /\.members \{[^}]*margin-left: calc\(22px/);
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}|rgba?\(/);
});

test('the panel header meta items are 12/18 secondary text while the status keeps the row size', () => {
  const css = sheet('ProcessPanel');
  assert.match(/\.meta \{([^}]*)\}/.exec(css)?.[1] ?? '', /font-size: 12px; line-height: 18px/);
  assert.doesNotMatch(/\.status \{([^}]*)\}/.exec(css)?.[1] ?? '', /font-size/);
});

test('no reader stylesheet widens its box with a negative horizontal margin or a calc(100% + …) width', () => {
  // Hover bleed past the text is drawn with side box-shadows (ink overflow). A negative side margin or an oversized width
  // makes rows poke out of a narrow column and gives the scroll container a horizontal scrollbar. No allow-list needed today:
  // add a file/selector pair here only for a rule that is provably inside an overflow:hidden parent, with a comment saying why.
  const allowed = new Set<string>([]);
  const offenders: string[] = [];
  for (const file of readdirSync(CLIENT).filter(name => name.endsWith('.module.css'))) {
    const text = readFileSync(new URL(file, CLIENT), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const rule of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = rule[1]!.trim().replace(/\s+/g, ' ');
      for (const declaration of rule[2]!.split(';')) {
        const [property, ...rest] = declaration.split(':');
        const name = property!.trim();
        const value = rest.join(':').trim();
        const negative = (token: string) => /^-\d|^-\./.test(token) || /^calc\(\s*-/.test(token);
        let bad = false;
        if (name === 'margin' || name === 'margin-inline') {
          const tokens = value.match(/calc\([^)]*\)|\S+/g) ?? [];
          // 1 value: all sides; 2: vertical horizontal; 3: top horizontal bottom; 4: top right bottom left.
          const horizontal = tokens.length === 1 ? [tokens[0]!] : tokens.length === 2 ? [tokens[1]!] : tokens.length === 3 ? [tokens[1]!] : [tokens[1]!, tokens[3]!];
          bad = horizontal.some(negative);
        } else if (['margin-left', 'margin-right', 'margin-inline-start', 'margin-inline-end'].includes(name)) bad = negative(value);
        else if (['width', 'min-width', 'max-width', 'inline-size'].includes(name)) bad = /calc\(\s*100%\s*\+/.test(value);
        if (bad && !allowed.has(`${file} ${selector}`)) offenders.push(`${file} ${selector} { ${name}: ${value} }`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});

test('hover bleed on process rows is drawn with side shadows in the hover colour', () => {
  for (const [file, selector] of [['ToolRow', '.row'], ['ClusterRow', '.row'], ['RecordRows', '.row'], ['ReasoningRow', '.row'], ['ProcessPanel', '.headerButton'], ['FileChanges', '.header']] as const) {
    const css = sheet(file);
    const hover = new RegExp(String.raw`${selector.replace('.', String.raw`\.`)}:hover[^{]*\{([^}]*)\}`).exec(css)?.[1] ?? '';
    assert.match(hover, /box-shadow: 6px 0 0 var\(--dsw-alias-interactive-bg-hover\), -6px 0 0 var\(--dsw-alias-interactive-bg-hover\)/, `${file} ${selector}`);
  }
});
