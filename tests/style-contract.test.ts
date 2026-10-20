import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { COMPAT_CSS } from '../src/client/compat/styles.ts';

const CLIENT = new URL('../src/client/', import.meta.url);
const REDESIGNED = ['Reader', 'Line', 'ToolRow', 'ToolDetails', 'ToolGroupRow', 'ThoughtRow', 'LiveThought', 'StatusLine', 'UserBubble', 'PlanCard', 'QuestionRecord', 'RecordRows', 'Notice', 'Opening', 'TurnSection', 'TurnFooter', 'JumpButton', 'FileChanges'];
const sheet = (name: string) => readFileSync(new URL(`${name}.module.css`, CLIENT), 'utf8');

test('redesigned surfaces use token radii and no in-flow backdrop blur', () => {
  for (const name of REDESIGNED) {
    const text = sheet(name);
    assert.doesNotMatch(text, /backdrop-filter/, `${name} uses backdrop-filter`);
    assert.doesNotMatch(text, /border-radius:\s*7px/, `${name} uses a retired radius`);
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
  assert.match(sheet('UserBubble'), /\.bubble \{[^}]*--cv-blocks-gap: 10px/);
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

test('turn triggers share the process line and detail tokens', () => {
  const opening = sheet('Opening');
  assert.doesNotMatch(opening, /\.triggerButton|\.triggerAction|\.triggerIcon|\.triggerTitle/);
  const detail = /\.triggerBody \{([^}]*)\}/.exec(opening)?.[1] ?? '';
  for (const token of ['--cv-indent', '--cv-detail-border', '--cv-detail-radius', '--cv-surface']) assert.ok(detail.includes(`var(${token})`), token);
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

/** Horizontal margin values a declaration sets (null when it sets none): `margin`, `margin-inline` and the longhands. */
function horizontalMargins(property: string, rawValue: string): string[] | null {
  const value = rawValue.replace(/!important/gi, '').trim();
  const tokens = value.match(/calc\([^)]*\)|\S+/g) ?? [];
  switch (property) {
    case 'margin':
      // 1: all sides; 2: vertical horizontal; 3: top horizontal bottom; 4: top right bottom left.
      return tokens.length === 1 ? [tokens[0]!] : tokens.length === 4 ? [tokens[1]!, tokens[3]!] : tokens.length >= 2 ? [tokens[1]!] : [];
    case 'margin-inline': return tokens.length === 1 ? [tokens[0]!] : tokens.slice(0, 2); // start end
    case 'margin-left': case 'margin-right': case 'margin-inline-start': case 'margin-inline-end': return tokens.slice(0, 1);
    default: return null;
  }
}

test('horizontal margin parsing covers shorthands, two-value margin-inline and !important', () => {
  assert.deepEqual(horizontalMargins('margin', '0 -6px'), ['-6px']);
  assert.deepEqual(horizontalMargins('margin', '1px -3px 2px'), ['-3px']);
  assert.deepEqual(horizontalMargins('margin', '1px 2px 3px -4px'), ['2px', '-4px']);
  assert.deepEqual(horizontalMargins('margin', '-1px'), ['-1px']);
  assert.deepEqual(horizontalMargins('margin-inline', '0 -4px !important'), ['0', '-4px']);
  assert.deepEqual(horizontalMargins('margin-inline', '-2px'), ['-2px']);
  assert.deepEqual(horizontalMargins('margin-left', '-3px !important'), ['-3px']);
  assert.equal(horizontalMargins('padding', '0 -1px'), null);
});

test('no stylesheet under src/client widens its box with a negative horizontal margin or a calc(100% + …) width', () => {
  // Hover bleed past the text is drawn with side box-shadows (ink overflow). A negative side margin or an oversized width makes
  // rows poke out of a narrow column and gives the scroll container a horizontal scrollbar. Allow-list: `<file> <selector>`
  // pairs that are provably unable to widen the scroll area, each with the reason.
  const allowed = new Map<string, string>();
  const sources: { name: string; text: string }[] = [];
  for (const entry of readdirSync(CLIENT, { recursive: true }) as string[]) {
    const name = entry.split(String.fromCharCode(92)).join('/');
    if (name.endsWith('.css')) sources.push({ name, text: readFileSync(new URL(name, CLIENT), 'utf8') });
  }
  sources.push({ name: 'compat/styles.ts COMPAT_CSS', text: COMPAT_CSS });
  assert.ok(sources.length > 10, 'the scan found the stylesheets');
  const offenders: string[] = [];
  for (const { name, text: raw } of sources) {
    const text = raw.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const rule of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = rule[1]!.trim().replace(/\s+/g, ' ');
      for (const declaration of rule[2]!.split(';')) {
        const [property, ...rest] = declaration.split(':');
        const key = property!.trim();
        const value = rest.join(':').replace(/!important/gi, '').trim();
        const negative = (token: string) => /^-\d|^-\./.test(token) || /^calc\(\s*-/.test(token);
        const margins = horizontalMargins(key, value);
        const bad = margins !== null ? margins.some(negative)
          : ['width', 'min-width', 'max-width', 'inline-size'].includes(key) && /calc\(\s*100%\s*\+/.test(value);
        if (bad && !allowed.has(`${name} ${selector}`)) offenders.push(`${name} ${selector} { ${key}: ${value} }`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});

test('process rows keep their compact hit area and file cards use their own bounded surface', () => {
  for (const file of ['Line']) {
    const css = sheet(file);
    assert.match(css, /background: var\(--cv-row-hover/);
    assert.match(css, /min-height: var\(--cv-row-height/);
    assert.match(css, /padding: 5px 8px/);
  }
  assert.doesNotMatch(sheet('Line'), /box-shadow:\s*6px/);
  assert.match(sheet('FileChanges'), /border: 1px solid var\(--cv-detail-border\)/);
  assert.match(sheet('FileChanges'), /\.fileRow[^}]*min-width: 0/);
});

test('a settled-open collapse body does not clip; it clips only while closed or animating', async () => {
  const reader = sheet('Reader');
  assert.doesNotMatch(/\.collapseBody \{([^}]*)\}/.exec(reader)?.[1] ?? '', /overflow/);
  assert.match(reader, /\.collapseBody\[data-open=false\], \.collapseBody\[data-clip\] \{ overflow: hidden; \}/);
  const { createElement } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { CollapseBody } = await import('../src/client/motion.tsx');
  const open = renderToStaticMarkup(createElement(CollapseBody, { open: true, motion: true }, createElement('span', null, 'x')));
  assert.match(open, /class="collapseBody"[^>]*data-open="true"/);
  assert.doesNotMatch(open, /data-clip/);
  assert.equal(renderToStaticMarkup(createElement(CollapseBody, { open: false, motion: true }, createElement('span', null, 'x'))), '');
});

test('narration and answer share one primary prose class', () => {
  const prose = /\.prose \{([^}]*)\}/.exec(sheet('TurnSection'))?.[1] ?? '';
  assert.match(prose, /font-family: var\(--cc-font-response\)/);
  assert.match(prose, /font-size: var\(--cc-size-body\)/);
  assert.match(prose, /line-height: 1\.6/);
  assert.match(prose, /color: var\(--cc-text-100\)/);
});

test('the Markdown table wrapper never exceeds its column', () => {
  const wrapper = /\.tableScroll \{([^}]*)\}/.exec(readFileSync(new URL('markdown/MarkdownText.module.css', CLIENT), 'utf8'))?.[1] ?? '';
  assert.match(wrapper, /box-sizing: border-box/);
  assert.match(wrapper, /width: 100%/);
  assert.match(wrapper, /min-width: 0/);
  assert.match(wrapper, /contain: inline-size/);
});

test('reader root preserves the compatibility palette for light and dark', () => {
  const text = sheet('Reader');
  for (const name of ['--cc-bg-100', '--cc-bg-200', '--cc-bg-300', '--cc-text-100', '--cc-text-300', '--cc-text-500', '--cc-border', '--cc-danger', '--cc-success', '--cc-brand', '--cc-font-ui', '--cc-font-response', '--cc-font-mono', '--cc-size-body']) {
    assert.match(text, new RegExp(`${name}:`), name);
  }
  assert.match(text, /48 33\.3% 97\.1%/, 'light bg-100 / dark text-100');
  assert.match(text, /60 2\.7% 14\.5%/, 'dark bg-100');
  assert.match(text, /:global\(body\[data-ds-dark-theme\]\)\s*\.root/, 'dark override keyed on the host attribute');
  assert.match(text, /anthropic-serif/);
  assert.match(text, /\.root\s*\{[^}]*background:\s*transparent/s);
});

const stylesheets = (): string[] => {
  const names: string[] = [];
  for (const dir of ['', 'markdown/', 'native/']) {
    for (const file of readdirSync(new URL(dir, CLIENT)).filter(name => name.endsWith('.module.css'))) names.push(dir + file);
  }
  return names;
};

test('only the remap block in Reader.module.css names host colour tokens', () => {
  const names = stylesheets();
  assert.ok(names.length > 20, 'the scan found the stylesheets');
  for (const name of names) {
    let text = readFileSync(new URL(name, CLIENT), 'utf8');
    if (name === 'Reader.module.css') text = text.replace(/\/\* host-remap:start[\s\S]*?\/\* host-remap:end \*\//, '');
    assert.doesNotMatch(text, /var\(--dsw-(?!font-family\b)/, `${name} reads a host colour token`);
  }
});

test('retired process-panel and inset surfaces are not reintroduced', () => {
  for (const name of stylesheets()) {
    assert.doesNotMatch(readFileSync(new URL(name, CLIENT), 'utf8'), /--cv-(?:panel-bg|panel-ring|inset-bg|font-body|line-body)/, name);
  }
});

test('answer prose, UI and code inherit host font choices without creating alias cycles', () => {
  const markdown = readFileSync(new URL('markdown/MarkdownText.module.css', CLIENT), 'utf8');
  assert.match(markdown, /var\(--cc-font-mono\)/);
  assert.match(markdown, /var\(--cc-link\)/);
  assert.match(sheet('TurnSection'), /font-family:\s*var\(--cc-font-response\)/);
  assert.match(sheet('Reader'), /--cc-font-response:\s*var\(--dsh-claude-font-prose,\s*var\(--cc-font-ui\)\)/);
  assert.match(sheet('Reader'), /--cc-font-ui:\s*var\(--dsw-font-family,/);
  assert.match(sheet('Reader'), /--cc-font-mono:\s*var\(--dsh-claude-font-code,/);
  assert.doesNotMatch(sheet('Reader'), /--(?:dsw-font-family|ds-font-family-code|dsh-claude-font-(?:prose|code|serif))\s*:/);
  for (const file of ['native/ContextInjectionRow.module.css', 'native/SystemPromptRow.module.css']) {
    const css = readFileSync(new URL(file, CLIENT), 'utf8');
    assert.match(css, /var\(--cc-font-mono\)/, `${file} uses the same code font as the reader`);
    assert.doesNotMatch(css, /--ds-font-family-code/, `${file} must not revert to the host font`);
  }
});

test('every user bubble owns its right alignment instead of depending on the opening wrapper', () => {
  assert.match(sheet('UserBubble'), /\.row\s*\{[^}]*margin-inline-start:\s*auto/);
  assert.match(sheet('UserBubble'), /font-size:\s*var\(--cc-size-body\)/);
});

test('native code cards have a single outer frame and square top content corners', () => {
  const css = readFileSync(new URL('markdown/MarkdownText.module.css', CLIENT), 'utf8');
  const content = /\.markdown :global\(\.md-code-block\) pre\s*\{([^}]*)\}/.exec(css)?.[1];
  assert.ok(content, 'real CodeBlock pre override exists');
  assert.match(content, /border:\s*0;/);
  assert.match(content, /border-radius:\s*0 0 calc\(/);
  assert.match(content, /box-shadow:\s*none/);
  assert.match(css, /\.markdown :global\(\.md-code-block\)\s*\{[^}]*border:\s*1px solid var\(--cv-detail-border\)/);
});
