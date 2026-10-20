/**
 * The logged-context row grammar.
 *
 * A context row sits in the reader transcript between process rows, so it is
 * one of them: the shared `Line` header and the shared detail surface. These
 * locks exist because the row used to be a vendored 24px host disclosure with
 * a 141px code viewport, which read as a smaller widget wedged between 32px
 * rows. Rendering goes through react-dom/server (see tests/support/dom.ts), so
 * these assertions read the real markup and the real stylesheets; the collapsed
 * body is not mounted, which is itself part of the contract.
 */
import './support/dom.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ContextInjectionRow } from '../src/client/native/ContextInjectionRow.tsx';
import { SystemPromptRow } from '../src/client/native/SystemPromptRow.tsx';

const ZH: Record<string, string> = {
  'message.contextInjection': '上下文注入',
  'message.contextRecall': '上下文回忆',
  'message.unknownBlock': '未知内容块',
};
const t = ((key: string) => ZH[key] ?? key) as never;
const read = (path: string) => readFileSync(new URL(`../src/client/${path}`, import.meta.url), 'utf8');

const render = (extra: Record<string, unknown> = {}): string => renderToStaticMarkup(createElement(ContextInjectionRow, {
  content: [],
  source: null,
  producer: { role: 'injected', label: 'tool-registry' },
  form: null,
  t,
  ...extra,
} as never));

/** The declarations of one top-level rule, for token and shape assertions. */
const rule = (css: string, selector: string): string => {
  const found = [...css.matchAll(new RegExp(`^${selector.replace('.', '\\.')} \\{([^}]*)\\}`, 'gm'))];
  assert.equal(found.length, 1, `expected exactly one ${selector} rule`);
  return found[0]![1]!;
};

test('a logged context row is one transcript Line, not a host disclosure', () => {
  const html = render();
  assert.match(html, /data-reader-line(?![a-z-])/);
  assert.match(html, /data-reader-line-leading[\s\S]*data-reader-line-icon[\s\S]*data-reader-line-chevron/);
  assert.match(html, /<button[^>]*type="button"[^>]*aria-expanded="false"[^>]*aria-controls="[^"]+"/);
  assert.doesNotMatch(html, /data-disclosure-row|data-stub="DisclosureRow"/);
  assert.match(html, /上下文注入[\s\S]*data-context-source[^>]*>tool-registry</);
});

test('the role and the producer are joined by one drawn separator', () => {
  assert.equal(render().match(/class="sep"/g)?.length, 1);
  const notice = render({ form: 'notice', source: { summary: '模型目录已更新' } });
  assert.equal(notice.match(/class="sep"/g)?.length, 2);
  assert.match(notice, /class="sep"[^>]*><\/span>[\s\S]*data-context-summary[^>]*>模型目录已更新</);
});

test('the recall role names the recall and keeps its reference icon', () => {
  const html = render({ producer: { role: 'recall', label: null } });
  assert.match(html, /上下文回忆/);
  assert.match(html, /data-context-recall-icon/);
  assert.doesNotMatch(html, /data-context-source/);
  assert.equal(html.match(/class="sep"/g)?.length ?? 0, 0);
});

test('a collapsed row mounts no body, and opening it is the row toggle', () => {
  const html = render();
  assert.doesNotMatch(html, /data-context-injection-body/);
  const source = read('native/ContextInjectionRow.tsx');
  assert.match(source, /data-context-injection-body/);
  assert.match(source, /data-context-form=\{rendered \?\? undefined\}/);
  assert.match(source, /<Line[\s\S]*open=\{open\}[\s\S]*onToggle=\{toggle\}[\s\S]*controls=\{id\}/);
  assert.match(source, /<CollapseBody open=\{open\} motion=\{motion\}>/);
});

test('the system prompt row shares that grammar', () => {
  const html = renderToStaticMarkup(createElement(SystemPromptRow, { text: '你是助手。' }));
  assert.match(html, /data-reader-line(?![a-z-])/);
  assert.match(html, /<button[^>]*aria-expanded="false"/);
  assert.match(html, /系统提示词/);
  assert.doesNotMatch(html, /data-disclosure-row|data-stub="DisclosureRow"/);
  assert.match(read('native/SystemPromptRow.tsx'), /data-system-prompt-body/);
});

test('both rows leave the 24px host header and the 141px code viewport behind', () => {
  for (const file of ['native/ContextInjectionRow', 'native/SystemPromptRow']) {
    assert.doesNotMatch(read(`${file}.module.css`), /141px|--cc-bg-200|line-height: 24px/, `${file} keeps host geometry`);
    assert.doesNotMatch(read(`${file}.tsx`), /DisclosureRow|chevronClassName/, `${file} keeps the host disclosure`);
  }
});

test('the expanded body is the shared reader detail surface', () => {
  for (const file of ['native/ContextInjectionRow', 'native/SystemPromptRow']) {
    const detail = rule(read(`${file}.module.css`), '.detail');
    assert.match(detail, /margin: 6px 8px 12px var\(--cv-indent\)/);
    assert.match(detail, /border: 1px solid var\(--cv-detail-border\)/);
    assert.match(detail, /border-radius: var\(--cv-detail-radius\)/);
    assert.match(detail, /background: var\(--cv-surface\)/);
    assert.match(detail, /max-height: var\(--cv-process-max-height, 320px\)/);
    assert.match(detail, /font: var\(--cc-size-code\)\/18px var\(--cc-font-mono\)/);
  }
});

test('the producer stays dimmer than the role without shrinking or growing it', () => {
  const css = read('native/ContextInjectionRow.module.css');
  for (const selector of ['.source', '.summary']) {
    const declarations = rule(css, selector);
    assert.match(declarations, /color: var\(--cc-text-500\)/);
    assert.doesNotMatch(declarations, /font-size|line-height/, `${selector} inherits the row size`);
  }
  assert.match(rule(css, '.sep'), /border-radius: 999px;[\s\S]*?corner-shape: round/);
});
