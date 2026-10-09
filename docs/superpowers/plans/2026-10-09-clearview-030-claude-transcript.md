# Clearview 0.3.0 Claude Transcript Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the 「阅读」 tab as a Claude Code Desktop style transcript: one chronological column, narration as serif body text, one-line tool groups, a running status line with live thinking, Claude colours and fonts.

**Architecture:** A new pure derivation (`transcript-model.ts`) turns the existing `layoutTurn` panel items into flat transcript entries. Small presentational components (`Line`, `ToolGroupRow`, `ThoughtRow`, `LiveThought`, `StatusLine`, `UserBubble`, `PlanCard`) render them; `TurnSection` renders entries in order with no process panel. Colours come from `--cc-*` variables on the reader root, which also remap the host `--dsw-*` aliases so embedded host primitives follow. Fonts are served by the plugin's server side from the locally installed Claude Desktop through the host `webServer`.

**Tech Stack:** TypeScript, React 18.3.1 (host-provided), CSS modules via tsdown, node:test + tsx + react-dom/server, Cordis plugin host (DSH 0.2.0-rc.2).

**Spec:** `docs/superpowers/specs/2026-10-09-clearview-030-claude-transcript-design.md` (read it before every task).

**Continuation decisions (2026-10-09):** The user transferred this session to Codex and explicitly removed the Sonnet requirement; subsequent agents use the available model at Medium effort. Preserve earlier task attribution, but do not attribute new Codex changes to Claude. The normal host is now Desktop 0.22.4 with DSH 0.2.0-rc.2. Acceptance browsers must block write requests before transmission, including startup `session/create`; the accepted create count is zero. The interrupted session belongs to the `dsh` workspace, so expand both `0923 5.5` and `dsh`. Performance comparison must preserve motion and full text, use identical workloads, run serially and report three-run medians; a regression blocks candidate preparation.

## Global Constraints

**Final verification refinement:** Font-face declarations now live in `Reader.module.css`; the original `cc-fonts.ts` mount-time injector is removed. Synthetic view-open timing first waits for a native host compositor frame before injecting either tested source's stylesheet or Reader code. `hostReadyFrameMs` is reported separately and is only screenshot-wait duration, not total application startup time. Commit, first-rAF and two-rAF opportunity timings remain reported; the two-rAF metric does not establish actual pixel-completion or native WebView2 acceptance.

- Work only in the worktree `D:/Khabarovsk/K.Develop/dsh/staging/dsh-clearview-0200-20261005`, branch `feat/clearview-030-claude-transcript`. Never touch the main checkout `D:/Khabarovsk/K.Develop/dsh/dsh-clearview`, `dsh-env`, or any running DSH state.
- Presentation only: no provider, tool, session-log, permission or settings mutations; the browser side never sends messages.
- All user-visible copy is Chinese; tool names, arguments, paths and model output are data and are shown verbatim (never translated, summarised or rewritten).
- Inside the reader, colours come only from `--cc-*` variables (Claude tokens, spec §3.5). The only place allowed to name `--dsw-*` colour tokens is the remap block in `Reader.module.css` (Task 1). Layout/size host variables (`--dsh-chat-content-width`, `--dsh-content-font-delta`, `--dsh-content-font-size*`) stay allowed.
- Fonts: response text `var(--cc-font-response)`, UI text `var(--cc-font-ui)`, code `var(--cc-font-mono)` (stacks in spec §3.6). Anthropic font files are never copied into the repo or the package.
- No `backdrop-filter`. Respect `prefers-reduced-motion` and the reader motion switch (`useReaderActions().motion`).
- Keep compat DOM contract (spec §4.3): `data-dsh-clearview`, `section[data-reader-turn]`, `data-reader-turn-state`, `data-reader-turn-result`, `data-reader-key`, `data-reader-text[data-shown-length]`, `data-reader-anchor`, `data-reader-answer`, `data-dshcp-rewind-root`, `data-dshcp-rewind-seat`, `data-dshcp-heavy`, `data-dshcp-load`.
- Gates after every task: `npm test`, `npm run typecheck`. Build gates (`DSHX_HARNESS=D:/Khabarovsk/K.Develop/deepseek-harness npm run build`, `node scripts/check-bundle-externals.mjs lib/client.js`, `node scripts/browser-syntax-gate.mjs lib/client.js`) at the end of Tasks 2, 8, 9 and 11.
- Files keep their existing line endings (several are CRLF); do not mass-convert.
- Commit per task with trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Never commit `.superpowers/`, `lib/`, `.perf-results/`, `*.tgz`, `prototype/`.
- Visual reference: `prototype/cc-flow.prototype.html` and `prototype/shot-*.png` in the worktree (untracked; read-only reference).

## Review Focus

1. A long finished turn (100+ tool calls, 20+ narration paragraphs): every narration paragraph stays visible, tool runs collapse to one line each, nothing is folded into 「前 N 步」 — pinned in Task 3 (`buildTranscript` keeps all narration) and Task 8 (render test).
2. A group that is running when the reader opens it, then settles: it stays open (user intent wins over auto-collapse) — pinned in Task 5.
3. Live thinking at the end of an open turn renders once (below the status line), never twice — pinned in Task 8.
4. Claude Desktop not installed / font route 404 / non-Windows: page renders with fallback fonts, server never throws, route only serves the three whitelisted names — pinned in Task 2.
5. Light theme and dark theme switch with `body[data-ds-dark-theme]`, including host primitives embedded in the reader (diff blocks, code blocks) — pinned in Task 1 (stylesheet contract) and Task 10 (live check in both themes).

---

## File Structure

| File | Responsibility |
|---|---|
| `src/server/claude-fonts.ts` (new) | Locate Claude Desktop font files; HTTP handler for `/dsh-clearview/fonts/<name>.woff2` |
| `src/dsh-clearview.ts` (modify) | Register the font route once `webServer` exists |
| `src/client/cc-fonts.ts` (new) | `@font-face` CSS text + `ensureClaudeFonts()` style injection |
| `src/client/Reader.module.css` (modify) | `--cc-*` tokens (light/dark), host alias remap, root background, typography base |
| `src/client/transcript-model.ts` (new) | Pure: panel items → transcript entries; group counts and wording; plan parsing; diff stats |
| `src/client/Line.tsx` + `.module.css` (new) | The one-line row primitive (chevron, icon, label, target, trailing) |
| `src/client/ToolRow.tsx` (rewrite) | Single tool call on `Line`; details block; sub-calls |
| `src/client/RecordRows.tsx` (modify) | Record rows on `Line`; `InputBubble` → `UserBubble` |
| `src/client/ToolGroupRow.tsx` + css (new, replaces `ClusterRow`) | Group line + members |
| `src/client/ThoughtRow.tsx` + css (new) | Settled thought line + expandable text |
| `src/client/LiveThought.tsx` + css (new, from `ReasoningRow` live part) | Streaming thought viewport with follow controller |
| `src/client/StatusLine.tsx` + css (new, replaces panel header + `FloatingStatus` pill) | ✻ + shimmer verb + timers |
| `src/client/UserBubble.tsx` + css (new) | Right bubble, 6-line clamp, 「展开全文」 |
| `src/client/PlanCard.tsx` + css (new) | `todo_write` checklist |
| `src/client/TurnSection.tsx` + css (rewrite) | Turn = opening + entries + status/live thought + answer + notices + footer |
| `src/client/Reader.tsx` (modify) | Drop 折叠思考 switch and pill; jump button; font injection |
| `src/client/JumpButton.tsx` + css (new, replaces `FloatingStatus`) | Round 「回到最新」 button |
| `src/client/store.ts` (modify) | Drop `collapseThinking` |
| `src/client/native/tool-call-model.ts` (modify) | Verb titles |
| `src/client/markdown/MarkdownText.module.css`, `TurnFooter`, `FileChanges`, `Opening` css (modify) | Claude typography and tokens |
| Delete | `ProcessPanel.*`, `ClusterRow.*`, `FloatingStatus.*`, `ReasoningRow.*`, `compat/memory-tail-keep.ts`, obsolete parts of `process-steps.ts` |
| `scripts/verify-live-reader.mjs` (modify), `scripts/record-compare.mjs` (new) | Live checks with new selectors; side-by-side recorder |

---

### Task 1: Claude tokens, host alias remap and typography base

**Files:**
- Modify: `src/client/Reader.module.css`
- Modify: `tests/style-contract.test.ts`

**Interfaces:**
- Produces (CSS custom properties on `.root`, used by every later task): `--cc-bg-000`, `--cc-bg-100`, `--cc-bg-200`, `--cc-bg-300`, `--cc-text-100`, `--cc-text-300`, `--cc-text-500`, `--cc-border` (an `hsl(... / .15)` colour), `--cc-border-strong` (`/ .3`), `--cc-hover`, `--cc-danger`, `--cc-danger-bg`, `--cc-success`, `--cc-success-bg`, `--cc-brand`, `--cc-link`, `--cc-font-ui`, `--cc-font-response`, `--cc-font-mono`, `--cc-size-body` (`calc(16px + var(--dsh-content-font-delta, 0px))`), `--cc-size-ui` (`calc(14px + delta)`), `--cc-size-small` (`calc(12.5px + delta)`), `--cc-size-code` (`calc(13px + delta)`).

- [ ] **Step 1: Write the failing test** — append to `tests/style-contract.test.ts`:

```ts
test('reader root defines Claude tokens for light and dark', () => {
  const text = sheet('Reader');
  for (const name of ['--cc-bg-100', '--cc-bg-200', '--cc-bg-300', '--cc-text-100', '--cc-text-300', '--cc-text-500', '--cc-border', '--cc-danger', '--cc-success', '--cc-brand', '--cc-font-ui', '--cc-font-response', '--cc-font-mono', '--cc-size-body']) {
    assert.match(text, new RegExp(`${name}:`), name);
  }
  assert.match(text, /48 33\.3% 97\.1%/, 'light bg-100 / dark text-100');
  assert.match(text, /60 2\.7% 14\.5%/, 'dark bg-100');
  assert.match(text, /:global\(body\[data-ds-dark-theme\]\)\s*\.root/, 'dark override keyed on the host attribute');
  assert.match(text, /anthropic-serif/);
  assert.match(text, /\.root\s*\{[^}]*background:\s*var\(--cc-bg-100\)/s);
});

test('only the remap block in Reader.module.css names host colour tokens', () => {
  const names = readdirSync(CLIENT).filter(name => name.endsWith('.module.css'));
  for (const name of names) {
    let text = readFileSync(new URL(name, CLIENT), 'utf8');
    if (name === 'Reader.module.css') text = text.replace(/\/\* host-remap:start \*\/[\s\S]*?\/\* host-remap:end \*\//, '');
    assert.doesNotMatch(text, /var\(--dsw-/, `${name} reads a host colour token`);
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- --test-name-pattern="Claude tokens|host colour tokens"`
Expected: FAIL (`--cc-bg-100` missing; many modules read `var(--dsw-`). The second test stays red until Task 9 finishes the last module; mark it `test.todo`-free by temporarily scoping it: add `const MIGRATED = new Set(['Reader.module.css']);` and only check `names.filter(n => MIGRATED.has(n))`. Each later task adds its migrated sheets to `MIGRATED`; Task 9 replaces the filter with all sheets.

- [ ] **Step 3: Implement** — at the top of `src/client/Reader.module.css`, replace the `.root { … }` block with:

```css
.root {
  /* Claude tokens: [data-theme=claude][data-mode=light] (Claude Desktop 2.26454.2) */
  --cc-bg-000: hsl(0 0% 100%);
  --cc-bg-100: hsl(48 33.3% 97.1%);
  --cc-bg-200: hsl(53 28.6% 94.5%);
  --cc-bg-300: hsl(48 25% 92.2%);
  --cc-text-100: hsl(60 2.6% 7.6%);
  --cc-text-300: hsl(60 2.5% 23.3%);
  --cc-text-500: hsl(51 3.1% 43.7%);
  --cc-border: hsl(30 3.3% 11.8% / .15);
  --cc-border-strong: hsl(30 3.3% 11.8% / .3);
  --cc-hover: hsl(48 25% 92.2% / .6);
  --cc-danger: hsl(0 56.2% 45.4%);
  --cc-danger-bg: hsl(0 50% 95%);
  --cc-success: hsl(103 72.3% 26.9%);
  --cc-success-bg: hsl(86 45.1% 90%);
  --cc-brand: hsl(15 63.1% 59.6%);
  --cc-link: hsl(210 73.7% 40.2%);
  --cc-font-cjk: "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC";
  --cc-font-ui: anthropic-sans, ui-sans-serif, -apple-system, "Segoe UI", var(--cc-font-cjk), sans-serif;
  --cc-font-response: anthropic-serif, Georgia, "Times New Roman", var(--cc-font-cjk), serif;
  --cc-font-mono: anthropic-mono, ui-monospace, "Cascadia Mono", Consolas, monospace;
  --cc-size-body: calc(16px + var(--dsh-content-font-delta, 0px));
  --cc-size-ui: calc(14px + var(--dsh-content-font-delta, 0px));
  --cc-size-small: calc(12.5px + var(--dsh-content-font-delta, 0px));
  --cc-size-code: calc(13px + var(--dsh-content-font-delta, 0px));
  --cv-ease: cubic-bezier(.2,.8,.2,1);
  --cv-fast: 100ms;
  --cv-swap: 200ms;
  --cv-size: 260ms;
  /* host-remap:start — host primitives embedded in the reader (code blocks, diff blocks, dots) follow Claude colours */
  --dsw-alias-label-primary: var(--cc-text-100);
  --dsw-alias-label-secondary: var(--cc-text-300);
  --dsw-alias-label-tertiary: var(--cc-text-500);
  --dsw-alias-markdown-code-block: var(--cc-bg-200);
  /* host-remap:end */
  background: var(--cc-bg-100);
  color: var(--cc-text-100);
  font-family: var(--cc-font-ui);
  font-size: var(--cc-size-ui);
  line-height: 1.5;
  min-width: 0;
  flex: 0 0 auto;
  overflow-anchor: auto;
  container-type: inline-size;
}
:global(body[data-ds-dark-theme]) .root {
  /* [data-theme=claude][data-mode=dark] */
  --cc-bg-000: hsl(60 2.1% 18.4%);
  --cc-bg-100: hsl(60 2.7% 14.5%);
  --cc-bg-200: hsl(30 3.3% 11.8%);
  --cc-bg-300: hsl(60 2.6% 7.6%);
  --cc-text-100: hsl(48 33.3% 97.1%);
  --cc-text-300: hsl(50 9% 73.7%);
  --cc-text-500: hsl(48 4.8% 59.2%);
  --cc-border: hsl(51 16.5% 84.5% / .15);
  --cc-border-strong: hsl(51 16.5% 84.5% / .3);
  --cc-hover: hsl(60 2.1% 18.4% / .7);
  --cc-danger: hsl(0 98.4% 75.1%);
  --cc-danger-bg: hsl(0 46.5% 27.8% / .45);
  --cc-success: hsl(97 59.1% 46.1%);
  --cc-success-bg: hsl(127 100% 13.9% / .45);
  --cc-link: hsl(210 65.5% 67.1%);
}
```

Then extend the remap block: run
`grep -rhoE "var\(--dsw-alias-[a-z0-9-]+" node_modules/@deepseek-ai/dsh-client-ui-primitives/lib node_modules/@deepseek-ai/dsh-client-ui-conversation/lib | sort | uniq -c | sort -rn | head -60`
and add one line per alias inside the block, mapped by family: `label-*` → text tokens (primary 100, secondary 300, tertiary/quaternary 500); `bg-layer-*`/`bg-*` → `--cc-bg-000`…`300` by depth; `border-*` → `--cc-border` (or `--cc-border-strong` for l1/strong); `interactive-bg-hover` → `--cc-hover`; `state-*-danger*`/`*error*` → `--cc-danger`; `*success*` → `--cc-success`; `markdown-*` code/inline backgrounds → `--cc-bg-200`/`--cc-bg-300`; `state-business-primary` → `--cc-link`. Leave any alias you cannot classify unmapped. Replace every other `var(--dsw-…)` colour use in `Reader.module.css` (outside the block) with the matching `--cc-*`; delete the `--cv-panel-*`, `--cv-inset-bg`, `--cv-font-*`, `--cv-line-body`, `--cv-row-height` variables and update their few users in this file to `--cc-*` / `1.5`. Keep `.column`.

- [ ] **Step 4: Run tests**

Run: `npm test` and `npm run typecheck`
Expected: PASS (the second test is scoped by `MIGRATED`).

- [ ] **Step 5: Commit**

```bash
git add src/client/Reader.module.css tests/style-contract.test.ts
git commit -m "feat: Claude colour tokens, host alias remap and typography base on the reader root"
```

---

### Task 2: Claude fonts served from the local Claude Desktop

**Files:**
- Create: `src/server/claude-fonts.ts`
- Modify: `src/dsh-clearview.ts`
- Create: `src/client/cc-fonts.ts`
- Modify: `src/client/Reader.tsx` (call `ensureClaudeFonts()` once on mount)
- Modify: `tsconfig.json` / `tsdown.config.*` only if `src/server/` is not already compiled into `lib/` (check `include` / entry; the server entry is `src/dsh-clearview.ts`, which imports the new file, so the bundler follows the import)
- Test: `tests/claude-fonts.test.ts`

**Interfaces:**
- Produces: `export type FontRole = 'sans' | 'serif' | 'mono'`; `export async function locateClaudeFonts(localAppData: string | undefined): Promise<Partial<Record<FontRole, string>>>` (absolute file paths); `export function fontRouteHandler(locate: () => Promise<Partial<Record<FontRole, string>>>): (req: IncomingMessage, res: ServerResponse) => Promise<void>`; `export const FONT_ROUTE = '/dsh-clearview/fonts'`.
- Produces (client): `export const CLAUDE_FONT_FACES: string`; `export function ensureClaudeFonts(doc?: Document): void` (idempotent, inserts `<style id="dsh-clearview-fonts">`).

- [ ] **Step 1: Write the failing tests** — `tests/claude-fonts.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { FONT_ROUTE, fontRouteHandler, locateClaudeFonts } from '../src/server/claude-fonts.ts';
import { CLAUDE_FONT_FACES, ensureClaudeFonts } from '../src/client/cc-fonts.ts';

function fakeInstall(versions: string[], css: (v: string) => string) {
  const root = mkdtempSync(join(tmpdir(), 'cc-fonts-'));
  for (const version of versions) {
    const dir = join(root, 'AnthropicClaude', `app-${version}`, 'resources', 'ion-dist', 'assets', 'v1');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'main.css'), css(version));
    for (const file of ['sans', 'serif', 'mono']) writeFileSync(join(dir, `${file}-${version}.woff2`), `${file}@${version}`);
  }
  return root;
}
const CSS = (v: string) => [
  `@font-face{font-family:anthropic-sans;src:url(/assets/v1/sans-${v}.woff2)format("woff2");font-weight:300 800;font-style:normal}`,
  `@font-face{font-family:anthropic-sans;src:url(/assets/v1/italic-${v}.woff2)format("woff2");font-weight:300 800;font-style:italic}`,
  `@font-face{font-family:anthropic-serif;src:url(/assets/v1/serif-${v}.woff2)format("woff2");font-weight:300 800;font-style:normal}`,
  `@font-face{font-family:anthropic-mono;src:url(/assets/v1/mono-${v}.woff2)format("woff2");font-weight:300 800;font-style:normal}`,
].join('');

test('picks the highest app version and the normal-style face of each family', async () => {
  const root = fakeInstall(['2.19675.1', '2.26454.2', '2.3.0'], CSS);
  try {
    const found = await locateClaudeFonts(root);
    assert.match(found.sans!, /app-2\.26454\.2[\\/].*sans-2\.26454\.2\.woff2$/);
    assert.match(found.serif!, /serif-2\.26454\.2\.woff2$/);
    assert.match(found.mono!, /mono-2\.26454\.2\.woff2$/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('no install, unreadable css or missing files yield an empty result instead of throwing', async () => {
  assert.deepEqual(await locateClaudeFonts(undefined), {});
  assert.deepEqual(await locateClaudeFonts(join(tmpdir(), 'cc-fonts-missing-xyz')), {});
  const root = fakeInstall(['1.0.0'], () => '@font-face{font-family:anthropic-sans;src:url(/assets/v1/gone.woff2)}');
  try { assert.deepEqual(await locateClaudeFonts(root), {}); } finally { rmSync(root, { recursive: true, force: true }); }
});

function call(handler: ReturnType<typeof fontRouteHandler>, url: string) {
  const res = Object.assign(new EventEmitter(), {
    statusCode: 0, headers: {} as Record<string, string>, body: Buffer.alloc(0),
    setHeader(name: string, value: string) { this.headers[name.toLowerCase()] = value; },
    writeHead(code: number, headers?: Record<string, string>) { this.statusCode = code; for (const [k, v] of Object.entries(headers ?? {})) this.headers[k.toLowerCase()] = v; return this; },
    end(chunk?: Buffer | string) { if (chunk) this.body = Buffer.from(chunk); this.emit('done'); },
  });
  const done = new Promise(resolve => res.once('done', resolve));
  return handler({ url, method: 'GET' } as never, res as never).then(() => done).then(() => res);
}

test('the route serves only the three whitelisted names', async () => {
  const root = fakeInstall(['2.26454.2'], CSS);
  try {
    const handler = fontRouteHandler(() => locateClaudeFonts(root));
    const ok = await call(handler, `${FONT_ROUTE}/serif.woff2`);
    assert.equal(ok.statusCode, 200);
    assert.equal(ok.headers['content-type'], 'font/woff2');
    assert.equal(ok.body.toString(), 'serif@2.26454.2');
    for (const bad of [`${FONT_ROUTE}/../main.css`, `${FONT_ROUTE}/sans.css`, `${FONT_ROUTE}/x.woff2`, `${FONT_ROUTE}/`]) {
      assert.equal((await call(handler, bad)).statusCode, 404, bad);
    }
    assert.equal((await call(fontRouteHandler(async () => ({})), `${FONT_ROUTE}/sans.woff2`)).statusCode, 404);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('client font faces point at the route and inject once', () => {
  assert.match(CLAUDE_FONT_FACES, /font-family:\s*anthropic-serif;[^}]*url\("\/dsh-clearview\/fonts\/serif\.woff2"\)/);
  assert.match(CLAUDE_FONT_FACES, /font-display:\s*swap/);
  const nodes: { id: string; textContent: string }[] = [];
  const doc = { getElementById: (id: string) => nodes.find(node => node.id === id) ?? null, createElement: () => ({ id: '', textContent: '' }), head: { appendChild: (node: never) => nodes.push(node) } };
  ensureClaudeFonts(doc as never); ensureClaudeFonts(doc as never);
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0]!.id, 'dsh-clearview-fonts');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- --test-name-pattern="font|route"`
Expected: FAIL with module not found `src/server/claude-fonts.ts`.

- [ ] **Step 3: Implement `src/server/claude-fonts.ts`**

```ts
import { readdir, readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';

export type FontRole = 'sans' | 'serif' | 'mono';
export const FONT_ROUTE = '/dsh-clearview/fonts';
const FAMILIES: Record<FontRole, string> = { sans: 'anthropic-sans', serif: 'anthropic-serif', mono: 'anthropic-mono' };
const NAME = /^\/dsh-clearview\/fonts\/(sans|serif|mono)\.woff2$/;

function compareVersions(left: string, right: string): number {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Font files of the newest installed Claude Desktop, read from its bundled stylesheet; `{}` when anything is missing. */
export async function locateClaudeFonts(localAppData: string | undefined): Promise<Partial<Record<FontRole, string>>> {
  if (!localAppData) return {};
  try {
    const base = join(localAppData, 'AnthropicClaude');
    const versions = (await readdir(base)).filter(name => /^app-\d+(\.\d+)*$/.test(name)).map(name => name.slice(4)).sort(compareVersions);
    const newest = versions.at(-1);
    if (!newest) return {};
    const assets = join(base, `app-${newest}`, 'resources', 'ion-dist', 'assets', 'v1');
    const files = new Set(await readdir(assets));
    const found: Partial<Record<FontRole, string>> = {};
    for (const sheet of [...files].filter(name => name.endsWith('.css'))) {
      const css = await readFile(join(assets, sheet), 'utf8');
      for (const face of css.match(/@font-face\{[^}]*\}/g) ?? []) {
        const family = /font-family:\s*([\w-]+)/.exec(face)?.[1];
        const role = (Object.keys(FAMILIES) as FontRole[]).find(key => FAMILIES[key] === family);
        if (!role || found[role] || /font-style:\s*italic/.test(face)) continue;
        const file = /url\(\/assets\/v1\/([\w.-]+\.woff2)\)/.exec(face)?.[1];
        if (file && files.has(file)) found[role] = join(assets, file);
      }
    }
    return found;
  } catch {
    return {};
  }
}

/** Read-only handler: `<FONT_ROUTE>/{sans,serif,mono}.woff2` → the located file, anything else → 404. */
export function fontRouteHandler(locate: () => Promise<Partial<Record<FontRole, string>>>) {
  let cached: Promise<Partial<Record<FontRole, string>>> | null = null;
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const role = NAME.exec((req.url ?? '').split('?')[0]!)?.[1] as FontRole | undefined;
    const path = role ? (await (cached ??= locate()))[role] : undefined;
    if (!path || req.method !== 'GET') { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('not found'); return; }
    try {
      const body = await readFile(path);
      res.writeHead(200, { 'Content-Type': 'font/woff2', 'Cache-Control': 'public, max-age=86400' });
      res.end(body);
    } catch {
      cached = null;
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('not found');
    }
  };
}
```

- [ ] **Step 4: Register the route** — `src/dsh-clearview.ts`:

```ts
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-host-webserver';
import { FONT_ROUTE, fontRouteHandler, locateClaudeFonts } from './server/claude-fonts.js';

export const name = 'dsh-clearview';
export const inject: string[] = [];

// Presentation only: no provider, tool, session-log or permission mutations. The only server-side
// effect is a read-only font route, registered once the host webServer exists (never in Electron/tests).
export function apply(ctx: Context): void {
  console.log('[my-plugins/dsh-clearview] loaded');
  ctx.inject(['webServer'], scoped => {
    const dispose = scoped.webServer.register({ kind: 'prefix', path: FONT_ROUTE, handler: fontRouteHandler(() => locateClaudeFonts(process.env.LOCALAPPDATA)) });
    scoped.on('dispose', dispose);
  });
}
```

If `@deepseek-ai/dsh-host-webserver` is not resolvable from the worktree's `node_modules`, declare the minimal module augmentation locally instead (`declare module '@deepseek-ai/cordis' { interface Context { webServer: { register(route: { kind: 'exact' | 'prefix'; path: string; handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void> }): () => void } } }`) in `src/server/claude-fonts.ts`. Check `scripts/check-bundle-externals.mjs` still passes for `lib/dsh-clearview.js` (node built-ins must stay external). If `scoped.on('dispose', …)` is not the Cordis disposal API in this host (check `ctx.effect` / `ctx.on('dispose')` in cordis `src/context.ts`), use the one the file documents.

- [ ] **Step 5: Implement `src/client/cc-fonts.ts`**

```ts
const face = (family: string, file: string) =>
  `@font-face{font-family:${family};src:url("/dsh-clearview/fonts/${file}.woff2") format("woff2");font-weight:300 800;font-style:normal;font-display:swap}`;

/** Claude's three families, served by the plugin's own route; missing files fall through to the fallback stacks. */
export const CLAUDE_FONT_FACES = [face('anthropic-sans', 'sans'), face('anthropic-serif', 'serif'), face('anthropic-mono', 'mono')].join('\n');

export function ensureClaudeFonts(doc: Document = document): void {
  if (doc.getElementById('dsh-clearview-fonts')) return;
  const style = doc.createElement('style');
  style.id = 'dsh-clearview-fonts';
  style.textContent = CLAUDE_FONT_FACES;
  doc.head.appendChild(style);
}
```

In `Reader.tsx` add `useEffect(() => { ensureClaudeFonts(); }, []);` (import from `./cc-fonts.js`).

- [ ] **Step 6: Run tests and build gates**

Run: `npm test`, `npm run typecheck`, `DSHX_HARNESS=D:/Khabarovsk/K.Develop/deepseek-harness npm run build`, `node scripts/check-bundle-externals.mjs lib/client.js`, `node scripts/browser-syntax-gate.mjs lib/client.js`
Expected: all PASS; `lib/dsh-clearview.js` contains `/dsh-clearview/fonts`.

- [ ] **Step 7: Commit**

```bash
git add src/server/claude-fonts.ts src/dsh-clearview.ts src/client/cc-fonts.ts src/client/Reader.tsx tests/claude-fonts.test.ts
git commit -m "feat: serve Claude fonts from the local Claude Desktop through a read-only route"
```

---

### Task 3: Transcript model (pure derivation)

**Files:**
- Create: `src/client/transcript-model.ts`
- Test: `tests/transcript-model.test.ts`

**Interfaces:**
- Consumes: `PanelItem`, `ReasoningItem` from `process-steps.ts`; `activityPhase`, `activitySummary`, `toolIdentity`, `ToolActivityEntry` from `tool-activity.ts`; test fixtures from `tests/support/chat-fixture.ts` (`settledTool`, `toolEntry`, `toolCall`, `chatNode`, `turnLocation`).
- Produces:

```ts
export type GroupKind = 'command' | 'read' | 'write' | 'edit' | 'search' | 'web' | 'skill' | 'tool' | 'operation';
export interface GroupFacts { counts: Partial<Record<GroupKind, number>>; order: GroupKind[]; running: boolean; failed: number }
export interface PlanTodo { content: string; status: 'pending' | 'in_progress' | 'completed' }
export type TranscriptEntry =
  | { kind: 'narration'; key: string; item: Extract<PanelItem, { kind: 'narration' }> }
  | { kind: 'thought'; key: string; item: ReasoningItem }
  | { kind: 'input'; key: string; item: Extract<PanelItem, { kind: 'input' }> }
  | { kind: 'plan'; key: string; item: Extract<PanelItem, { kind: 'tool' }>; todos: PlanTodo[] }
  | { kind: 'item'; key: string; item: PanelItem }
  | { kind: 'group'; key: string; items: PanelItem[]; facts: GroupFacts };
export function buildTranscript(items: readonly PanelItem[], get: (key: string) => ChatConversationViewNode | undefined, turnClosed: boolean): TranscriptEntry[];
export function groupSummary(facts: GroupFacts): string;
export function parseTodos(argsRaw: string): PlanTodo[] | null;
export function diffStat(oldText: string | null, newText: string): { added: number; removed: number };
export function isOperational(item: PanelItem, get: (key: string) => ChatConversationViewNode | undefined): boolean;
```

Rules (spec §3.2, §4.1): operational = tool calls except `todo_write` and `dispatch`, plus `command` and `manual-compaction` records. Thoughts, narration, inputs, plans, `dispatch` (subagent) and every other record break a run. A run of one is `item`; two or more is `group` keyed `group:<first item key>`. Kind per tool: `skill` (name `skill`) → skill; `activitySummary().category` terminal → command, read → read, search → search, web → web, write → `write` when name is `write` or `str_replace_editor` with `command: "create"`, else `edit`; other → tool. Records: `command` → command, `manual-compaction` → operation. `running`: any tool phase preparing/running, or an unsettled record while the turn is open. `failed`: tool phase `failed` or record outcome `error`.

Summary words (joined by `，`, in `order` of first appearance): command `运行了 N 条命令`, read `读取了 N 个文件`, write `写入了 N 个文件`, edit `编辑了 N 个文件`, search `搜索了 N 次`, web `访问了 N 次网页`, skill `使用了 N 个技能`, tool `调用了 N 次工具`, operation `执行了 N 个操作`.

- [ ] **Step 1: Write the failing tests** — `tests/transcript-model.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PanelItem } from '../src/client/process-steps.ts';
import { buildTranscript, diffStat, groupSummary, parseTodos, type TranscriptEntry } from '../src/client/transcript-model.ts';
import { chatNode, settledTool, toolCall, toolEntry, turnLocation } from './support/chat-fixture.ts';

const turn = turnLocation({ steps: [1] });
const none = () => undefined;
const tool = (id: string, name: string, args: Record<string, unknown> = {}, over: Record<string, unknown> = {}): PanelItem =>
  ({ kind: 'tool', key: `reader-tool:${id}`, entry: toolEntry(id, 1, settledTool(id, name, args, over)), step: 1 });
const live = (id: string, name = 'bash'): PanelItem =>
  ({ kind: 'tool', key: `reader-tool:${id}`, entry: toolEntry(id, 1, { phase: 'start', callId: id, name, argsRaw: '{}', subCalls: [] }), step: 1 });
const draft = (id: string, name: string, args: Record<string, unknown>): PanelItem =>
  ({ kind: 'tool', key: `reader-tool:${id}`, entry: toolEntry(id, 1, undefined, toolCall(id, name, args)), step: 1 });
const say = (key: string): PanelItem => ({ kind: 'narration', key, nodeKey: key, start: 0, step: 1 });
const think = (key: string): PanelItem => ({ kind: 'reasoning', key, nodeKey: key, start: 0, step: 1 });
const kinds = (entries: TranscriptEntry[]) => entries.map(entry => entry.kind);

test('narration, thoughts and inputs are kept in order and break runs', () => {
  const entries = buildTranscript([say('a'), tool('1', 'bash', { command: 'ls' }), tool('2', 'read', { path: 'x' }), think('t'), tool('3', 'bash'), say('b'),
    { kind: 'input', key: 'in', nodeKey: 'in', step: 1 }, tool('4', 'write', { path: 'y' }), tool('5', 'edit', { path: 'y' })], none, true);
  assert.deepEqual(kinds(entries), ['narration', 'group', 'thought', 'item', 'narration', 'input', 'group']);
  assert.equal(entries[1]!.key, 'group:reader-tool:1');
});

test('every narration paragraph of a long turn survives', () => {
  const items: PanelItem[] = [];
  for (let index = 0; index < 30; index++) items.push(say(`s${index}`), tool(`a${index}`, 'bash'), tool(`b${index}`, 'read', { path: 'f' }), tool(`c${index}`, 'edit', { path: 'f' }));
  const entries = buildTranscript(items, none, true);
  assert.equal(entries.filter(entry => entry.kind === 'narration').length, 30);
  assert.equal(entries.filter(entry => entry.kind === 'group').length, 30);
});

test('group wording counts by kind in order of first appearance', () => {
  const [group] = buildTranscript([tool('1', 'bash', { command: 'ls' }), tool('2', 'write', { path: 'a' }), tool('3', 'write', { path: 'b' }),
    tool('4', 'edit', { path: 'a' }), tool('5', 'grep', { pattern: 'x' }), tool('6', 'skill', { name: 'pdf' }), tool('7', 'mystery'), tool('8', 'read', { path: 'a' })], none, true);
  assert.equal(group!.kind, 'group');
  if (group!.kind !== 'group') return;
  assert.equal(groupSummary(group.facts), '运行了 1 条命令，写入了 2 个文件，编辑了 1 个文件，搜索了 1 次，使用了 1 个技能，调用了 1 次工具，读取了 1 个文件');
});

test('str_replace_editor create counts as a write, other editor commands as edits', () => {
  const [group] = buildTranscript([tool('1', 'str_replace_editor', { command: 'create', path: 'a' }), tool('2', 'str_replace_editor', { command: 'str_replace', path: 'a' })], none, true);
  assert.equal(group!.kind === 'group' && groupSummary(group.facts), '写入了 1 个文件，编辑了 1 个文件');
});

test('running and failed facts', () => {
  const [open] = buildTranscript([tool('1', 'bash'), live('2')], none, false);
  assert.equal(open!.kind === 'group' && open.facts.running, true);
  const [failed] = buildTranscript([tool('1', 'bash', {}, { isError: true }), tool('2', 'bash')], none, true);
  assert.equal(failed!.kind === 'group' && failed.facts.failed, 1);
});

test('command and manual-compaction records join groups', () => {
  const command = chatNode('command', { outcome: { kind: 'error' } }, turn, 1);
  const compact = chatNode('manual-compaction', { command: { outcome: { kind: 'success' } }, compaction: {} }, turn, 1);
  const map = new Map([[command.key, command], [compact.key, compact]]);
  const [group] = buildTranscript([{ kind: 'record', key: command.key, nodeKey: command.key, step: 1 }, { kind: 'record', key: compact.key, nodeKey: compact.key, step: 1 }, tool('1', 'bash')], key => map.get(key), true);
  assert.equal(group!.kind === 'group' && groupSummary(group.facts), '运行了 2 条命令，执行了 1 个操作');
  assert.equal(group!.kind === 'group' && group.facts.failed, 1);
});

test('other records and subagent calls stand alone', () => {
  const notice = chatNode('model-retry', {}, turn, 1);
  const entries = buildTranscript([tool('1', 'bash'), { kind: 'record', key: notice.key, nodeKey: notice.key, step: 1 }, tool('2', 'dispatch', { description: '编写植物模块' }), tool('3', 'bash')], key => key === notice.key ? notice : undefined, true);
  assert.deepEqual(kinds(entries), ['item', 'item', 'item', 'item']);
});

test('todo_write becomes a plan entry, or an item when its args do not parse', () => {
  const todos = [{ content: '搭建骨架', status: 'completed' }, { content: '屋顶引擎', status: 'in_progress' }, { content: '验证', status: 'pending' }];
  const [plan] = buildTranscript([tool('p', 'todo_write', { todos })], none, true);
  assert.equal(plan!.kind, 'plan');
  assert.deepEqual(plan!.kind === 'plan' && plan.todos.map(todo => todo.status), ['completed', 'in_progress', 'pending']);
  assert.equal(parseTodos('{"todos":[{"content":"x","status":"pend'), null);
  assert.equal(parseTodos('{"todos":[{"content":"x","status":"weird"}]}'), null);
  const [broken] = buildTranscript([draft('q', 'todo_write', {})], none, false);
  assert.equal(broken!.kind, 'item');
});

test('diffStat trims the common prefix and suffix', () => {
  assert.deepEqual(diffStat('a\nb\nc\n', 'a\nB\nc\n'), { added: 1, removed: 1 });
  assert.deepEqual(diffStat(null, 'x\ny'), { added: 2, removed: 0 });
  assert.deepEqual(diffStat('x\ny\nz', 'x\nz'), { added: 0, removed: 1 });
  assert.deepEqual(diffStat('same', 'same'), { added: 0, removed: 0 });
});
```

If a fixture helper signature differs from these calls (check `tests/support/chat-fixture.ts`), adapt the call, not the assertion.

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- --test-name-pattern="narration|group wording|todo_write|diffStat|records|running"`
Expected: FAIL, module `transcript-model.ts` not found.

- [ ] **Step 3: Implement `src/client/transcript-model.ts`**

```ts
import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-ui-chat/client';
import type { PanelItem, ReasoningItem } from './process-steps.js';
import { activityPhase, activitySummary, objectValue } from './tool-activity.js';

type Getter = (key: string) => ChatConversationViewNode | undefined;
export type GroupKind = 'command' | 'read' | 'write' | 'edit' | 'search' | 'web' | 'skill' | 'tool' | 'operation';
export interface GroupFacts { counts: Partial<Record<GroupKind, number>>; order: GroupKind[]; running: boolean; failed: number }
export interface PlanTodo { content: string; status: 'pending' | 'in_progress' | 'completed' }
type ToolItem = Extract<PanelItem, { kind: 'tool' }>;
export type TranscriptEntry =
  | { kind: 'narration'; key: string; item: Extract<PanelItem, { kind: 'narration' }> }
  | { kind: 'thought'; key: string; item: ReasoningItem }
  | { kind: 'input'; key: string; item: Extract<PanelItem, { kind: 'input' }> }
  | { kind: 'plan'; key: string; item: ToolItem; todos: PlanTodo[] }
  | { kind: 'item'; key: string; item: PanelItem }
  | { kind: 'group'; key: string; items: PanelItem[]; facts: GroupFacts };

const STANDALONE_TOOLS = new Set(['todo_write', 'dispatch']);
const STATUSES = new Set(['pending', 'in_progress', 'completed']);
const WORDS: Record<GroupKind, (count: number) => string> = {
  command: n => `运行了 ${n} 条命令`, read: n => `读取了 ${n} 个文件`, write: n => `写入了 ${n} 个文件`, edit: n => `编辑了 ${n} 个文件`,
  search: n => `搜索了 ${n} 次`, web: n => `访问了 ${n} 次网页`, skill: n => `使用了 ${n} 个技能`, tool: n => `调用了 ${n} 次工具`, operation: n => `执行了 ${n} 个操作`,
};

export function parseTodos(argsRaw: string): PlanTodo[] | null {
  let parsed: unknown;
  try { parsed = JSON.parse(argsRaw); } catch { return null; }
  const list = objectValue(parsed)?.todos;
  if (!Array.isArray(list) || list.length === 0) return null;
  const todos: PlanTodo[] = [];
  for (const raw of list) {
    const item = objectValue(raw);
    if (typeof item?.content !== 'string' || typeof item.status !== 'string' || !STATUSES.has(item.status)) return null;
    todos.push({ content: item.content, status: item.status as PlanTodo['status'] });
  }
  return todos;
}

export function diffStat(oldText: string | null, newText: string): { added: number; removed: number } {
  const before = oldText === null || oldText === '' ? [] : oldText.replace(/\n$/, '').split('\n');
  const after = newText === '' ? [] : newText.replace(/\n$/, '').split('\n');
  let head = 0;
  while (head < before.length && head < after.length && before[head] === after[head]) head++;
  let tail = 0;
  while (tail < before.length - head && tail < after.length - head && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail++;
  return { added: after.length - head - tail, removed: before.length - head - tail };
}

function toolKind(item: ToolItem): GroupKind {
  const facts = activitySummary(item.entry);
  if (facts.name === 'skill') return 'skill';
  switch (facts.category) {
    case 'terminal': return 'command';
    case 'read': return 'read';
    case 'search': return 'search';
    case 'web': return 'web';
    case 'write': return facts.name === 'write' || (facts.name === 'str_replace_editor' && facts.args.command === 'create') ? 'write' : 'edit';
    default: return 'tool';
  }
}

function recordData(node: ChatConversationViewNode) {
  return node.data as { outcome?: { kind?: string } | null; compaction?: unknown; command?: { outcome?: { kind?: string } | null } | null } | null;
}

export function isOperational(item: PanelItem, get: Getter): boolean {
  if (item.kind === 'tool') return !STANDALONE_TOOLS.has(activitySummary(item.entry).name);
  if (item.kind !== 'record') return false;
  const kind = get(item.nodeKey)?.kind;
  return kind === 'command' || kind === 'manual-compaction';
}

function factsOf(items: readonly PanelItem[], get: Getter, turnClosed: boolean): GroupFacts {
  const facts: GroupFacts = { counts: {}, order: [], running: false, failed: 0 };
  const count = (kind: GroupKind) => {
    if (!(kind in facts.counts)) facts.order.push(kind);
    facts.counts[kind] = (facts.counts[kind] ?? 0) + 1;
  };
  for (const item of items) {
    if (item.kind === 'tool') {
      count(toolKind(item));
      const phase = activityPhase(item.entry, turnClosed);
      if (phase === 'preparing' || phase === 'running') facts.running = true;
      if (phase === 'failed') facts.failed++;
      continue;
    }
    const node = item.kind === 'record' ? get(item.nodeKey) : undefined;
    if (!node) continue;
    const data = recordData(node);
    if (node.kind === 'command') {
      count('command');
      if (data?.outcome?.kind === 'error') facts.failed++;
      if (!turnClosed && data?.outcome == null) facts.running = true;
    } else {
      count('operation');
      if (data?.command?.outcome?.kind === 'error') facts.failed++;
      if (!turnClosed && data?.command?.outcome == null && data?.compaction == null) facts.running = true;
    }
  }
  return facts;
}

export function groupSummary(facts: GroupFacts): string {
  return facts.order.map(kind => WORDS[kind](facts.counts[kind]!)).join('，');
}

export function buildTranscript(items: readonly PanelItem[], get: Getter, turnClosed: boolean): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];
  let run: PanelItem[] = [];
  const flush = () => {
    if (run.length === 1) entries.push({ kind: 'item', key: run[0]!.key, item: run[0]! });
    else if (run.length > 1) entries.push({ kind: 'group', key: `group:${run[0]!.key}`, items: run, facts: factsOf(run, get, turnClosed) });
    run = [];
  };
  for (const item of items) {
    if (isOperational(item, get)) { run.push(item); continue; }
    flush();
    if (item.kind === 'narration') entries.push({ kind: 'narration', key: item.key, item });
    else if (item.kind === 'reasoning') entries.push({ kind: 'thought', key: item.key, item });
    else if (item.kind === 'input') entries.push({ kind: 'input', key: item.key, item });
    else if (item.kind === 'tool' && activitySummary(item.entry).name === 'todo_write') {
      const todos = parseTodos(activitySummary(item.entry).raw);
      entries.push(todos ? { kind: 'plan', key: item.key, item, todos } : { kind: 'item', key: item.key, item });
    } else entries.push({ kind: 'item', key: item.key, item });
  }
  flush();
  return entries;
}
```

- [ ] **Step 4: Run tests**

Run: `npm test` and `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/transcript-model.ts tests/transcript-model.test.ts
git commit -m "feat: transcript model groups operations between narration in Claude Code wording"
```

### Task 4: Line primitive, verb titles, tool and record rows

**Files:**
- Create: `src/client/Line.tsx`, `src/client/Line.module.css`
- Modify (rewrite render): `src/client/ToolRow.tsx`, `src/client/ToolRow.module.css`
- Modify: `src/client/RecordRows.tsx` (`RecordRow`, `TurnNotice` on `Line`; leave `InputBubble` for Task 7), `src/client/RecordRows.module.css`
- Modify: `src/client/native/tool-call-model.ts` (titles), `src/client/ToolDetails.module.css`
- Test: `tests/line.test.ts` (new), update `tests/tool-row.test.ts`, `tests/tool-call-model.test.ts`, `tests/records-opening.test.ts`

**Interfaces:**
- Consumes: `diffStat` (Task 3); `diffCardModel` from `native017/tool-models.mjs`; `--cc-*` (Task 1).
- Produces:

```ts
// Line.tsx
export type LineTone = 'idle' | 'running' | 'failed';
export interface LineProps {
  icon: ReactNode; label: ReactNode; target?: ReactNode; trailing?: ReactNode;
  tone?: LineTone; shimmer?: boolean;
  /** Both set → the line is a disclosure button; otherwise a static row. */
  open?: boolean; onToggle?: () => void; controls?: string;
  title?: string; data?: Record<string, string | boolean | undefined>;
}
export function Line(props: LineProps): JSX.Element;
// ToolRow.tsx
export function toolTrailing(phase: ToolPhase, exitCode: number | undefined, stat: { added: number; removed: number } | null): { text: string; tone: 'idle' | 'failed' } | null;
export function editStat(block: ToolCallBlock | undefined): { added: number; removed: number } | null; // sums diffStat over diffCardModel(block).card.diffs; null when no diff
export function toolRowTitle(entry: ToolActivityEntry, known?: …): string; // kept, new words
export const ToolRow; // same props as today minus nothing; renders on Line
```

Title words (`VARIANT_TITLES` + `TOOL_TITLES` + `toolRowTitle`): search `搜索`, read `读取`, bash `运行`, pwsh `运行`, write `写入`, edit `编辑`, code `运行代码`, others `调用工具`, skill `使用技能`, `dispatch` `子代理`, `todo_write` `更新计划`, cordis titles unchanged. Tool names stay visible in the target for `others` (`<name> · <summary>`), as today.

Line look (spec §3.2, prototype): 28px min height, `--cc-size-ui` sans, label `--cc-text-300`, target `--cc-text-100` at `--cc-size-small`+0.5px with ellipsis, icon 16px `--cc-text-500`, chevron 12px rotates 90° when open (transition `--cv-fast`, none under reduced motion), hover background `--cc-hover` with 6px radius and `margin: 0 -6px; padding: 0 6px`. `tone=failed` → icon and trailing `--cc-danger`. `shimmer` → label gets the text shimmer (gradient `--cc-text-300` → `--cc-text-100`, 2s linear infinite; static under reduced motion or when the reader motion switch is off — callers pass `shimmer={active && motion}`). Trailing: `--cc-size-small`; edit stats render as `<span data-add>+a</span> <span data-del>−d</span>` in `--cc-success` / `--cc-danger`.

- [ ] **Step 1: Write the failing tests** — `tests/line.test.ts`:

```ts
import './support/dom.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Line } from '../src/client/Line.tsx';
import { toolTrailing } from '../src/client/ToolRow.tsx';

test('an expandable line is one button with aria-expanded and a chevron', () => {
  const html = renderToStaticMarkup(createElement(Line, { icon: 'i', label: '运行', target: 'npm test', open: false, onToggle: () => {}, data: { 'data-reader-tool-call': 'c1' } }));
  assert.match(html, /<button[^>]*type="button"[^>]*aria-expanded="false"/);
  assert.match(html, /data-reader-line/);
  assert.match(html, /data-reader-tool-call="c1"/);
  assert.match(html, /运行[\s\S]*npm test/);
});

test('a static line has no button and keeps the chevron slot', () => {
  const html = renderToStaticMarkup(createElement(Line, { icon: 'i', label: '读取任务输出' }));
  assert.doesNotMatch(html, /<button/);
  assert.match(html, /data-chevron-slot/);
});

test('failed and running tones are exposed for styling', () => {
  assert.match(renderToStaticMarkup(createElement(Line, { icon: 'i', label: 'x', tone: 'failed' })), /data-tone="failed"/);
  assert.match(renderToStaticMarkup(createElement(Line, { icon: 'i', label: 'x', tone: 'running', shimmer: true })), /data-shimmer="true"/);
});

test('tool trailing text: failures and edit stats only, no durations', () => {
  assert.deepEqual(toolTrailing('failed', 2, null), { text: '退出码 2', tone: 'failed' });
  assert.deepEqual(toolTrailing('failed', undefined, null), { text: '失败', tone: 'failed' });
  assert.deepEqual(toolTrailing('interrupted', undefined, null), { text: '已中断', tone: 'failed' });
  assert.equal(toolTrailing('succeeded', 0, null), null);
  assert.equal(toolTrailing('running', undefined, null), null);
  assert.deepEqual(toolTrailing('returned', undefined, { added: 3, removed: 1 }), { text: '+3 −1', tone: 'idle' });
});
```

In `tests/tool-row.test.ts` replace duration/`Tool call`/`Bash` title assertions with: a settled bash row renders `运行` and the command, no `毫秒`/`秒` text, no error excerpt below a collapsed failed row, `data-tone="failed"` on a failed row. In `tests/tool-call-model.test.ts` update the title table to the words above.

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- --test-name-pattern="line|trailing|tool"`
Expected: FAIL (`Line.tsx` missing; old titles).

- [ ] **Step 3: Implement `Line.tsx`**

```tsx
import type { ReactNode } from 'react';
import css from './Line.module.css';

export type LineTone = 'idle' | 'running' | 'failed';
export interface LineProps {
  icon: ReactNode; label: ReactNode; target?: ReactNode; trailing?: ReactNode;
  tone?: LineTone; shimmer?: boolean;
  open?: boolean; onToggle?: () => void; controls?: string;
  title?: string; data?: Record<string, string | boolean | undefined>;
}

/** One transcript row in Claude Code grammar: chevron, icon, verb, target, trailing note. */
export function Line({ icon, label, target, trailing, tone = 'idle', shimmer = false, open, onToggle, controls, title, data }: LineProps) {
  const expandable = open !== undefined && onToggle !== undefined;
  const body = <>
    {expandable
      ? <svg className={css.chevron} data-open={open} viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M4.5 2.5 8 6l-3.5 3.5" /></svg>
      : <span className={css.chevron} data-chevron-slot aria-hidden="true" />}
    <span className={css.icon} aria-hidden="true">{icon}</span>
    <span className={css.label} data-shimmer={shimmer || undefined}>{label}</span>
    {target !== undefined && target !== null && target !== '' && <span className={css.target} title={title}>{target}</span>}
    {trailing && <span className={css.trailing}>{trailing}</span>}
  </>;
  return <div className={css.line} data-reader-line data-tone={tone} {...data}>
    {expandable
      ? <button type="button" className={css.button} aria-expanded={open} aria-controls={controls} onClick={onToggle}>{body}</button>
      : <div className={css.button}>{body}</div>}
  </div>;
}
```

`Line.module.css`:

```css
.line { min-width: 0; }
.button { display: flex; align-items: center; gap: 8px; width: calc(100% + 12px); min-height: 28px; margin: 0 -6px; padding: 0 6px; border: 0; border-radius: 6px; background: transparent; color: var(--cc-text-300); font: inherit; font-size: var(--cc-size-ui); line-height: 20px; text-align: left; }
button.button { cursor: pointer; }
button.button:hover { background: var(--cc-hover); }
.chevron { width: 12px; height: 12px; flex: none; fill: none; stroke: var(--cc-text-500); stroke-width: 1.4; stroke-linecap: round; stroke-linejoin: round; transition: transform var(--cv-fast) var(--cv-ease); }
.chevron[data-open="true"] { transform: rotate(90deg); }
.icon { display: inline-flex; width: 16px; height: 16px; flex: none; align-items: center; justify-content: center; color: var(--cc-text-500); }
.label { flex: none; color: var(--cc-text-300); white-space: nowrap; }
.target { min-width: 0; overflow: hidden; color: var(--cc-text-100); font-size: calc(var(--cc-size-small) + .5px); text-overflow: ellipsis; white-space: nowrap; }
.trailing { flex: none; color: var(--cc-text-500); font-size: var(--cc-size-small); white-space: nowrap; }
.trailing [data-add] { color: var(--cc-success); }
.trailing [data-del] { color: var(--cc-danger); }
.line[data-tone="failed"] .icon, .line[data-tone="failed"] .trailing { color: var(--cc-danger); }
.label[data-shimmer] { background: linear-gradient(90deg, var(--cc-text-300) 0%, var(--cc-text-100) 45%, var(--cc-text-300) 70%); background-size: 220% 100%; -webkit-background-clip: text; background-clip: text; color: transparent; animation: cc-shimmer 2s linear infinite; }
@keyframes cc-shimmer { from { background-position: 120% 0; } to { background-position: -120% 0; } }
@media (prefers-reduced-motion: reduce) { .label[data-shimmer] { animation: none; color: var(--cc-text-300); background: none; } .chevron { transition: none; } }
```

- [ ] **Step 4: Rewrite `ToolRow` render on `Line`** — keep the memo comparator, `ToolImages`, `formatDuration` (still used by tests elsewhere? delete if unused after `npm run typecheck`), `toolRowTitle`. New render body:

```tsx
export function toolTrailing(phase: ToolPhase, exitCode: number | undefined, stat: { added: number; removed: number } | null): { text: string; tone: 'idle' | 'failed' } | null {
  if (phase === 'failed') return { text: exitCode !== undefined ? `退出码 ${exitCode}` : '失败', tone: 'failed' };
  if (phase === 'interrupted') return { text: '已中断', tone: 'failed' };
  if (stat && (stat.added > 0 || stat.removed > 0) && (phase === 'succeeded' || phase === 'returned')) return { text: `+${stat.added} −${stat.removed}`, tone: 'idle' };
  return null;
}

export function editStat(block: ToolCallBlock | undefined): { added: number; removed: number } | null {
  if (!block) return null;
  const diffs = diffCardModel(block)?.card.diffs ?? [];
  if (diffs.length === 0) return null;
  return diffs.reduce((sum, hunk) => { const stat = diffStat(hunk.oldText, hunk.newText); return { added: sum.added + stat.added, removed: sum.removed + stat.removed }; }, { added: 0, removed: 0 });
}
```

Inside the component: `const stat = model.category === 'write' ? editStat(block) : null; const end = toolTrailing(phase, exitCode, stat);` and render

```tsx
<div ref={…} className={css.tool} data-reader-tool-call={entry.callId} data-tool-phase={phase} data-tool-category={model.category} data-expanded={open}>
  <Line icon={<Icon size={14} />} label={title} target={variant === 'bash' ? <code className={css.command}>{summary}</code> : summary} title={summary}
    tone={failed || phase === 'interrupted' ? 'failed' : active ? 'running' : 'idle'} shimmer={active && motion}
    trailing={end && (stat && end.tone === 'idle' ? <><span data-add>+{stat.added}</span> <span data-del>−{stat.removed}</span></> : end.text)}
    open={open} onToggle={toggle} controls={detailId} />
  <CollapseBody open={open} motion={motion}><div id={detailId} className={css.detail}><ToolDetails entry={entry} model={model} phase={phase} {...render} /></div></CollapseBody>
  {!!block?.subCalls.length && <div className={css.children} aria-label="子调用">{/* unchanged recursion */}</div>}
</div>
```

where `variant = classifyTool(model.name)`, `detailId = useId()`. The `ErrorSummary` under a collapsed failed row is removed (spec: failures do not expand). `ToolRow.module.css`: `.tool { min-width: 0 }`, `.detail { margin: 2px 0 8px 22px }`, `.children { margin: 2px 0 6px 7px; padding-left: 14px; border-left: 1px solid var(--cc-border) }`, `.command { font-family: var(--cc-font-mono); font-size: var(--cc-size-code) }`, `.media` unchanged layout, `.deep` `--cc-text-500`. `ToolDetails.module.css`: detail blocks get `border: 1px solid var(--cc-border); border-radius: 10px; background: var(--cc-bg-200); font-family: var(--cc-font-mono); font-size: var(--cc-size-code)`; error output colour `--cc-danger`.

- [ ] **Step 5: Move `RecordRow` and `TurnNotice` onto `Line`** — `RecordRow`: `<Line icon={<Icon size={14} />} label={view.title} target={view.summary} tone={view.tone === 'failed' ? 'failed' : view.tone === 'active' ? 'running' : 'idle'} shimmer={view.tone === 'active' && motion} open={open} onToggle={toggle} data={{ 'data-reader-record-kind': node.kind }} />` followed by `CollapseBody` → `<div className={css.detail}><RecordBody … /></div>` (keep `data-reader-show-in-chat` inside `RecordBody`). `TurnNotice`: static `Line` with a warning/error icon, label `已到达输出长度限制` / `本轮出现错误`, target = message, `tone="failed"` for errors, keep `role` and `data-reader-notice`. CSS: replace every `var(--dsw-…)` with `--cc-*`.

- [ ] **Step 6: Run tests**

Run: `npm test`, `npm run typecheck`
Expected: PASS. Add `'Line.module.css', 'ToolRow.module.css', 'ToolDetails.module.css', 'RecordRows.module.css'` to `MIGRATED` in `tests/style-contract.test.ts` (if `RecordRows.module.css` still holds `InputBubble` rules with `--dsw-`, leave it out until Task 7).

- [ ] **Step 7: Commit**

```bash
git add src/client/Line.tsx src/client/Line.module.css src/client/ToolRow.tsx src/client/ToolRow.module.css src/client/ToolDetails.module.css src/client/RecordRows.tsx src/client/RecordRows.module.css src/client/native/tool-call-model.ts tests/
git commit -m "feat: Claude-style line primitive; tool and record rows with verb titles and no durations"
```

---

### Task 5: Tool group row

**Files:**
- Create: `src/client/ToolGroupRow.tsx`, `src/client/ToolGroupRow.module.css`
- Test: `tests/tool-group-row.test.ts`

**Interfaces:**
- Consumes: `Line` (Task 4); `TranscriptEntry`, `groupSummary` (Task 3); `CollapseBody` from `motion.tsx`; icon `IconFlatListOutlineRegular` from `@deepseek-ai/dsh-client-ui-primitives`.
- Produces:

```ts
export type GroupEntry = Extract<TranscriptEntry, { kind: 'group' }>;
/** A choice the reader made wins; with no choice the group is open exactly while it runs. */
export function groupOpen(choice: boolean | null, running: boolean): boolean;
export function ToolGroupRow(props: { group: GroupEntry; motion: boolean; onRead: () => void; renderItem: (item: PanelItem) => ReactNode }): JSX.Element;
```

DOM: `<div data-reader-group={key} data-group-state={running ? 'running' : 'settled'} data-expanded={open}>`; label = `groupSummary(facts)` (shimmer while running and motion); trailing = `· N 次失败` in `--cc-danger` when `failed > 0`; members inside `CollapseBody` → `<div class={members}>` with `margin: 2px 0 6px 7px; padding-left: 14px; border-left: 1px solid var(--cc-border)`.

- [ ] **Step 1: Write the failing tests** — `tests/tool-group-row.test.ts`:

```ts
import './support/dom.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { groupOpen, ToolGroupRow, type GroupEntry } from '../src/client/ToolGroupRow.tsx';

const group = (running: boolean, failed = 0): GroupEntry => ({
  kind: 'group', key: 'group:reader-tool:1',
  items: [{ kind: 'record', key: 'r1', nodeKey: 'r1', step: 1 }, { kind: 'record', key: 'r2', nodeKey: 'r2', step: 1 }],
  facts: { counts: { command: 2 }, order: ['command'], running, failed },
});
const render = (entry: GroupEntry) => renderToStaticMarkup(createElement(ToolGroupRow, { group: entry, motion: true, onRead: () => {}, renderItem: item => createElement('i', { 'data-member': item.key }) }));

test('the reader’s choice wins; otherwise open exactly while running', () => {
  assert.equal(groupOpen(null, true), true);
  assert.equal(groupOpen(null, false), false);
  assert.equal(groupOpen(true, false), true, 'opened while running, stays open after it settles');
  assert.equal(groupOpen(false, true), false);
});

test('a running group is open, shimmering and shows its members', () => {
  const html = render(group(true));
  assert.match(html, /data-reader-group="group:reader-tool:1"[^>]*data-group-state="running"[^>]*data-expanded="true"/);
  assert.match(html, /运行了 2 条命令/);
  assert.match(html, /data-shimmer="true"/);
  assert.match(html, /data-member="r1"[\s\S]*data-member="r2"/);
});

test('a settled group is one closed line; failures add a red count', () => {
  const html = render(group(false, 1));
  assert.match(html, /data-group-state="settled"[^>]*data-expanded="false"/);
  assert.match(html, /· 1 次失败/);
  assert.match(html, /data-tone="failed"/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- --test-name-pattern="group"`
Expected: FAIL, `ToolGroupRow.tsx` missing.

- [ ] **Step 3: Implement**

```tsx
import { Fragment, useCallback, useId, useState } from 'react';
import type { ReactNode } from 'react';
import { IconFlatListOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives';
import { Line } from './Line.js';
import { CollapseBody } from './motion.js';
import type { PanelItem } from './process-steps.js';
import { groupSummary, type TranscriptEntry } from './transcript-model.js';
import css from './ToolGroupRow.module.css';

export type GroupEntry = Extract<TranscriptEntry, { kind: 'group' }>;

export function groupOpen(choice: boolean | null, running: boolean): boolean {
  return choice ?? running;
}

/** Consecutive operations as one line; open while running, then folded unless the reader chose otherwise. */
export function ToolGroupRow({ group, motion, onRead, renderItem }: { group: GroupEntry; motion: boolean; onRead: () => void; renderItem: (item: PanelItem) => ReactNode }) {
  const [choice, setChoice] = useState<boolean | null>(null);
  const open = groupOpen(choice, group.facts.running);
  const id = useId();
  const toggle = useCallback(() => { onRead(); setChoice(!open); }, [onRead, open]);
  const { running, failed } = group.facts;
  return <div className={css.group} data-reader-group={group.key} data-group-state={running ? 'running' : 'settled'} data-expanded={open}>
    <Line icon={<IconFlatListOutlineRegular size={14} />} label={groupSummary(group.facts)} tone={failed > 0 ? 'failed' : running ? 'running' : 'idle'}
      shimmer={running && motion} trailing={failed > 0 ? `· ${failed} 次失败` : undefined} open={open} onToggle={toggle} controls={id} />
    <CollapseBody open={open} motion={motion}>
      <div id={id} className={css.members}>{group.items.map(item => <Fragment key={item.key}>{renderItem(item)}</Fragment>)}</div>
    </CollapseBody>
  </div>;
}
```

`ToolGroupRow.module.css`: `.group { min-width: 0 }` and `.members { margin: 2px 0 6px 7px; padding-left: 14px; border-left: 1px solid var(--cc-border); min-width: 0 }`. Add the sheet to `MIGRATED`.

- [ ] **Step 4: Run tests**

Run: `npm test`, `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/ToolGroupRow.tsx src/client/ToolGroupRow.module.css tests/tool-group-row.test.ts tests/style-contract.test.ts
git commit -m "feat: tool group row opens while running and folds after unless the reader chose"
```

---

### Task 6: Thought row and live thought

**Files:**
- Create: `src/client/ThoughtRow.tsx` + `.module.css`, `src/client/LiveThought.tsx` + `.module.css`
- Read (source to port, then delete in Task 8): `src/client/ReasoningRow.tsx`, `src/client/ReasoningRow.module.css`
- Test: `tests/thought-row.test.ts`, `tests/live-thought.test.ts`

**Interfaces:**
- Consumes: `Line` (Task 4); `followAdvance` from `reasoning-follow.ts`; icon `IconThinkOutlineRegular`.
- Produces:

```ts
// ThoughtRow.tsx
export function formatThinkingSeconds(seconds: number): string; // moved verbatim from ReasoningRow
export function thoughtLabel(durationMs: number | null): string;  // '思考了 41 秒' | '思考了不到 1 秒' | '思考'
export function ThoughtRow(props: { durationMs: number | null; motion: boolean; onRead: () => void; children: ReactNode; initialOpen?: boolean }): JSX.Element;
// LiveThought.tsx
export function scrollMetrics(port: { scrollHeight: number; clientHeight: number }): { tail: number; overflow: boolean }; // moved verbatim
export function LiveThought(props: { follow: boolean; motion: boolean; children: ReactNode }): JSX.Element;
```

ThoughtRow DOM: wrapper `data-reader-reasoning`; `Line` with `label={thoughtLabel(durationMs)}`, closed by default; open → `<div class="text" data-reader-reasoning-text>` = children, styled `font-family: var(--cc-font-response); font-style: italic; font-size: calc(var(--cc-size-ui)); line-height: 1.65; color: var(--cc-text-300); margin: 4px 0 8px 7px; padding-left: 14px; border-left: 1px solid var(--cc-border)`. No preview, no character count, no suffix/tail.

LiveThought DOM: `<div data-reader-live-thought data-following={following}>` containing the scroll viewport `<div data-reader-reasoning-scroll>` (same serif italic text style, `max-height: calc(1.65em * 6)`, `overflow-y: auto`, `scrollbar-width: none`, top fade `mask-image: linear-gradient(to bottom, transparent 0, #000 1.6em)` only when the viewport is scrolled away from the top) and, when following is paused, a small text button `继续跟随` (`--cc-size-small`, `--cc-text-500`) that resumes. Port from `ReasoningRow`: the viewport/content refs, the `following` state, the rAF follow loop built on `followAdvance` (EMA speed match + proportional convergence), the pauses on wheel/touch scroll, focus inside and text selection, the resume action, and `scrollMetrics`. Drop: `manual`/`open`/`compact`, preview, char count, suffix/tail, fullscreen/expand, pause/play icon buttons, the step label, timers (the status line owns time).

- [ ] **Step 1: Write the failing tests**

`tests/thought-row.test.ts`:

```ts
import './support/dom.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { formatThinkingSeconds, thoughtLabel, ThoughtRow } from '../src/client/ThoughtRow.tsx';

test('labels', () => {
  assert.equal(thoughtLabel(41_000), '思考了 41 秒');
  assert.equal(thoughtLabel(400), '思考了不到 1 秒');
  assert.equal(thoughtLabel(125_000), '思考了 2 分 5 秒');
  assert.equal(thoughtLabel(null), '思考');
  assert.equal(formatThinkingSeconds(120), '2 分钟');
});

test('closed by default, no preview or character count; opened shows the text', () => {
  const closed = renderToStaticMarkup(createElement(ThoughtRow, { durationMs: 41_000, motion: true, onRead: () => {} }, 'The user wants a scene'));
  assert.match(closed, /data-reader-reasoning/);
  assert.match(closed, /aria-expanded="false"/);
  assert.doesNotMatch(closed, /字/);
  const open = renderToStaticMarkup(createElement(ThoughtRow, { durationMs: 41_000, motion: true, onRead: () => {}, initialOpen: true }, 'The user wants a scene'));
  assert.match(open, /data-reader-reasoning-text[\s\S]*The user wants a scene/);
});
```

`tests/live-thought.test.ts`:

```ts
import './support/dom.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LiveThought, scrollMetrics } from '../src/client/LiveThought.tsx';

test('scroll metrics are unchanged', () => {
  assert.deepEqual(scrollMetrics({ scrollHeight: 300, clientHeight: 100 }), { tail: 200, overflow: true });
  assert.deepEqual(scrollMetrics({ scrollHeight: 100, clientHeight: 100 }), { tail: 0, overflow: false });
});

test('renders a following viewport with the text and no resume button', () => {
  const html = renderToStaticMarkup(createElement(LiveThought, { follow: true, motion: true }, 'Hmm, the 围脊 boxes'));
  assert.match(html, /data-reader-live-thought[^>]*data-following="true"/);
  assert.match(html, /data-reader-reasoning-scroll[\s\S]*Hmm, the 围脊 boxes/);
  assert.doesNotMatch(html, /继续跟随/);
});
```

Keep `tests/reasoning-follow.test.ts` unchanged (it tests the controller).

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- --test-name-pattern="labels|closed by default|scroll metrics|following viewport"`
Expected: FAIL, modules missing.

- [ ] **Step 3: Implement `ThoughtRow`**

```tsx
import { useCallback, useId, useState } from 'react';
import type { ReactNode } from 'react';
import { IconThinkOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives';
import { Line } from './Line.js';
import { CollapseBody } from './motion.js';
import css from './ThoughtRow.module.css';

export function formatThinkingSeconds(seconds: number): string {
  if (seconds < 1) return '不到 1 秒';
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes} 分 ${rest} 秒` : `${minutes} 分钟`;
}

export function thoughtLabel(durationMs: number | null): string {
  if (durationMs === null) return '思考';
  const seconds = Math.round(durationMs / 1000);
  return seconds < 1 ? '思考了不到 1 秒' : `思考了 ${formatThinkingSeconds(seconds)}`;
}

/** A settled thought: one line, its full text on demand. */
export function ThoughtRow({ durationMs, motion, onRead, children, initialOpen = false }: { durationMs: number | null; motion: boolean; onRead: () => void; children: ReactNode; initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  const id = useId();
  const toggle = useCallback(() => { onRead(); setOpen(value => !value); }, [onRead]);
  return <div className={css.thought} data-reader-reasoning data-expanded={open}>
    <Line icon={<IconThinkOutlineRegular size={14} />} label={thoughtLabel(durationMs)} open={open} onToggle={toggle} controls={id} />
    <CollapseBody open={open} motion={motion}><div id={id} className={css.text} data-reader-reasoning-text>{children}</div></CollapseBody>
  </div>;
}
```

`ThoughtRow.module.css`: `.thought { min-width: 0 }` and the `.text` rule above (plus `white-space: pre-wrap; overflow-wrap: anywhere` is NOT added — children are `Blocks` that already handle wrapping).

- [ ] **Step 4: Implement `LiveThought`** by porting the follow half of `ReasoningRow.tsx` into this shape:

```tsx
export function LiveThought({ follow, motion, children }: { follow: boolean; motion: boolean; children: ReactNode }) {
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [following, setFollowing] = useState(true);
  const [scrolled, setScrolled] = useState(false);
  // …ported: the rAF loop from ReasoningRow that, while `follow && following`, advances viewport.scrollTop toward
  // scrollMetrics(viewport).tail with followAdvance(); the wheel/touchmove/keydown/focusin/selectionchange handlers that
  // set following=false; a ResizeObserver on `content` that re-arms the loop; `motion === false` jumps straight to tail.
  return <div className={css.live} data-reader-live-thought data-following={following}>
    <div ref={viewport} className={css.viewport} data-reader-reasoning-scroll data-scrolled={scrolled}
      onScroll={() => setScrolled((viewport.current?.scrollTop ?? 0) > 0)}>
      <div ref={content} data-reader-reasoning-text>{children}</div>
    </div>
    {!following && <button type="button" className={css.resume} onClick={() => setFollowing(true)}>继续跟随</button>}
  </div>;
}
```

Copy the loop code from `ReasoningRow` rather than rewriting it; keep its constants from `MOTION`. CSS: `.viewport { font-family: var(--cc-font-response); font-style: italic; font-size: var(--cc-size-ui); line-height: 1.65; color: var(--cc-text-300); max-height: calc(1.65em * 6); overflow-y: auto; scrollbar-width: none; margin: 0 0 8px 7px; padding-left: 14px; border-left: 1px solid var(--cc-border) }`, `.viewport[data-scrolled="true"] { mask-image: linear-gradient(to bottom, transparent 0, #000 1.6em) }`, `.resume { border: 0; background: none; padding: 0 0 0 21px; color: var(--cc-text-500); font: inherit; font-size: var(--cc-size-small); cursor: pointer }`.

- [ ] **Step 5: Run tests**

Run: `npm test`, `npm run typecheck`
Expected: PASS. Add both sheets to `MIGRATED`.

- [ ] **Step 6: Commit**

```bash
git add src/client/ThoughtRow.* src/client/LiveThought.* tests/thought-row.test.ts tests/live-thought.test.ts tests/style-contract.test.ts
git commit -m "feat: one-line settled thoughts and a live thought viewport ported from the follow controller"
```

---

### Task 7: User bubble, plan card and status line

**Files:**
- Create: `src/client/UserBubble.tsx` + css, `src/client/PlanCard.tsx` + css, `src/client/StatusLine.tsx` + css
- Modify: `src/client/Opening.tsx` (user / command-input opening → `UserBubble`; trigger row restyle on `--cc-*`), `src/client/Opening.module.css`, `src/client/RecordRows.tsx` (`InputBubble` renders `UserBubble small`), `src/client/RecordRows.module.css`
- Test: `tests/user-bubble.test.ts`, `tests/plan-card.test.ts`, `tests/status-line.test.ts`; update `tests/records-opening.test.ts`

**Interfaces:**
- Consumes: `PlanTodo` (Task 3).
- Produces:

```ts
export function UserBubble(props: { children: ReactNode; small?: boolean; label?: string; data?: Record<string, string | boolean | undefined> }): JSX.Element;
export function PlanCard(props: { todos: readonly PlanTodo[] }): JSX.Element;
export type StatusPhase = 'running' | 'waiting' | 'interrupted' | 'error';
export function statusVerb(label: string): string; // '正在思考' → '思考中…'; '等待你的操作' unchanged; other '正在X' → '正在X…'
export function StatusLine(props: { phase: StatusPhase; label: string; elapsed: string | null; thinking: string | null; motion: boolean }): JSX.Element;
```

Rewind contract: `compat/rewind-bridge.ts` reads the steering seat (an element with `data-reader-anchor` + `data-reader-key`, and a label paragraph as its first child). Read that file first and keep exactly what it reads: `UserBubble` puts `data` attributes on the bubble element and, when `label` is given, renders `<p className={css.meta}>{label}</p>` as the bubble's first child.

- [ ] **Step 1: Write the failing tests**

`tests/user-bubble.test.ts`:

```ts
import './support/dom.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { UserBubble } from '../src/client/UserBubble.tsx';

test('bubble carries the anchor attributes, the label first, and starts unclamped on the server', () => {
  const html = renderToStaticMarkup(createElement(UserBubble, { label: '补充消息', small: true, data: { 'data-reader-anchor': true, 'data-reader-key': 'k1' } }, '再快一点'));
  assert.match(html, /data-reader-user-bubble[^>]*data-small="true"/);
  assert.match(html, /data-reader-anchor="true"[^>]*data-reader-key="k1"|data-reader-key="k1"[^>]*data-reader-anchor="true"/);
  assert.match(html, /data-reader-user-bubble[^>]*>\s*<p[^>]*>补充消息<\/p>/);
  assert.doesNotMatch(html, /展开全文/);
});
```

`tests/plan-card.test.ts`:

```ts
import './support/dom.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PlanCard } from '../src/client/PlanCard.tsx';

test('plan card counts done items and marks each state', () => {
  const html = renderToStaticMarkup(createElement(PlanCard, { todos: [{ content: '搭建骨架', status: 'completed' }, { content: '屋顶引擎', status: 'in_progress' }, { content: '验证', status: 'pending' }] }));
  assert.match(html, /data-reader-plan/);
  assert.match(html, /计划 · 1 \/ 3/);
  assert.match(html, /data-status="completed"[^>]*>[\s\S]*搭建骨架/);
  assert.match(html, /data-status="in_progress"[\s\S]*屋顶引擎/);
});
```

`tests/status-line.test.ts`:

```ts
import './support/dom.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StatusLine, statusVerb } from '../src/client/StatusLine.tsx';

test('verbs', () => {
  assert.equal(statusVerb('正在思考'), '思考中…');
  assert.equal(statusVerb('正在生成文件内容'), '正在生成文件内容…');
  assert.equal(statusVerb('等待你的操作'), '等待你的操作');
});

test('running line: spark, shimmering verb, elapsed and thinking time', () => {
  const html = renderToStaticMarkup(createElement(StatusLine, { phase: 'running', label: '正在思考', elapsed: '13 分 42 秒', thinking: '1 分 42 秒', motion: true }));
  assert.match(html, /data-reader-status-line[^>]*data-phase="running"/);
  assert.match(html, /✻/);
  assert.match(html, /思考中…/);
  assert.match(html, /13 分 42 秒 · 已思考 1 分 42 秒/);
  assert.match(html, /role="status"/);
});

test('interrupted and error lines are red and do not spin', () => {
  const html = renderToStaticMarkup(createElement(StatusLine, { phase: 'interrupted', label: '已中断', elapsed: null, thinking: null, motion: true }));
  assert.match(html, /data-phase="interrupted"/);
  assert.doesNotMatch(html, /data-spin/);
});
```

In `tests/records-opening.test.ts` replace assertions about the old `.user` / `.input` markup with: opening renders `data-reader-user-bubble` with `data-reader-anchor` and the text; a steering input renders `UserBubble` with `补充消息` as first child.

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- --test-name-pattern="bubble|plan card|verbs|running line|interrupted"`
Expected: FAIL, modules missing.

- [ ] **Step 3: Implement `UserBubble`**

```tsx
import { useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import css from './UserBubble.module.css';

/** The person's message on the right; longer than six lines it clamps behind 「展开全文」. */
export function UserBubble({ children, small = false, label, data }: { children: ReactNode; small?: boolean; label?: string; data?: Record<string, string | boolean | undefined> }) {
  const text = useRef<HTMLDivElement>(null);
  const [clamped, setClamped] = useState(false);
  const [open, setOpen] = useState(false);
  useLayoutEffect(() => {
    const node = text.current;
    if (!node || open) return;
    const check = () => setClamped(node.scrollHeight > node.clientHeight + 1);
    check();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(check) : null;
    observer?.observe(node);
    return () => observer?.disconnect();
  }, [open]);
  return <div className={css.row}>
    <div className={css.bubble} data-reader-user-bubble data-small={small} data-clamped={clamped && !open} {...data}>
      {label && <p className={css.meta}>{label}</p>}
      <div ref={text} className={css.text} data-open={open}>{children}</div>
      {(clamped || open) && <button type="button" className={css.more} onClick={() => setOpen(value => !value)}>{open ? '收起' : '展开全文'}</button>}
    </div>
  </div>;
}
```

`UserBubble.module.css`:

```css
.row { display: flex; justify-content: flex-end; min-width: 0; }
.bubble { max-width: 82%; min-width: 0; padding: 10px 16px; border-radius: 12px; background: var(--cc-bg-300); color: var(--cc-text-100); font-family: var(--cc-font-ui); font-size: calc(15px + var(--dsh-content-font-delta, 0px)); line-height: 1.6; }
.bubble[data-small="true"] { padding: 8px 14px; font-size: var(--cc-size-ui); }
.meta { margin: 0 0 2px; color: var(--cc-text-500); font-size: var(--cc-size-small); }
.text { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 6; overflow: hidden; overflow-wrap: anywhere; }
.text[data-open="true"] { display: block; -webkit-line-clamp: unset; }
.more { margin-top: 4px; padding: 0; border: 0; background: none; color: var(--cc-text-300); font: inherit; font-size: var(--cc-size-small); cursor: pointer; }
@container (max-width: 480px) { .bubble { max-width: 90%; } }
```

- [ ] **Step 4: Implement `PlanCard`**

```tsx
import type { PlanTodo } from './transcript-model.js';
import css from './PlanCard.module.css';

export function PlanCard({ todos }: { todos: readonly PlanTodo[] }) {
  const done = todos.filter(todo => todo.status === 'completed').length;
  return <div className={css.card} data-reader-plan>
    <div className={css.title}>计划 · {done} / {todos.length}</div>
    {todos.map((todo, index) => <div key={index} className={css.item} data-status={todo.status}>
      <span className={css.box} aria-hidden="true">{todo.status === 'completed' ? '✓' : ''}</span>
      <span className={css.content}>{todo.content}</span>
    </div>)}
  </div>;
}
```

CSS: `.card { margin: 4px 0 6px; padding: 8px 12px; border: 1px solid var(--cc-border); border-radius: 10px; font-size: var(--cc-size-ui) }`, `.title { color: var(--cc-text-500); font-size: var(--cc-size-small); margin-bottom: 4px }`, `.item { display: flex; gap: 8px; align-items: center; line-height: 1.9 }`, `.box { width: 13px; height: 13px; flex: none; display: inline-grid; place-items: center; border: 1.5px solid var(--cc-text-500); border-radius: 3px; font-size: 10px }`, `.item[data-status="completed"] .box { background: var(--cc-text-500); color: var(--cc-bg-100) }`, `.item[data-status="completed"] .content { color: var(--cc-text-500); text-decoration: line-through }`, `.item[data-status="in_progress"] .content { color: var(--cc-text-100); font-weight: 600 }`.

- [ ] **Step 5: Implement `StatusLine`**

```tsx
import css from './StatusLine.module.css';

export type StatusPhase = 'running' | 'waiting' | 'interrupted' | 'error';

export function statusVerb(label: string): string {
  if (label === '正在思考') return '思考中…';
  return label.startsWith('正在') ? `${label}…` : label;
}

/** The end of an open (or just stopped) turn: Claude's spark, the current verb and the clocks. */
export function StatusLine({ phase, label, elapsed, thinking, motion }: { phase: StatusPhase; label: string; elapsed: string | null; thinking: string | null; motion: boolean }) {
  const running = phase === 'running';
  const meta = [elapsed, thinking ? `已思考 ${thinking}` : null].filter(Boolean).join(' · ');
  return <div className={css.line} data-reader-status-line data-phase={phase} role="status">
    <span className={css.spark} aria-hidden="true" data-spin={running && motion ? true : undefined}>✻</span>
    <span className={css.verb} data-shimmer={running && motion ? true : undefined}>{statusVerb(label)}</span>
    {meta && <span className={css.meta}>{meta}</span>}
  </div>;
}
```

CSS: `.line { display: flex; align-items: center; gap: 10px; min-height: 28px; font-size: var(--cc-size-ui); color: var(--cc-text-300) }`, `.spark { color: var(--cc-brand); font-size: 17px; line-height: 1; display: inline-block }`, `.spark[data-spin] { animation: cc-spin 2.4s linear infinite }`, `@keyframes cc-spin { to { transform: rotate(360deg) } }`, `.verb[data-shimmer]` = the same shimmer gradient as `Line`, `.meta { color: var(--cc-text-500); font-size: var(--cc-size-small) }`, `.line[data-phase="interrupted"] .spark, .line[data-phase="error"] .spark, .line[data-phase="interrupted"] .verb, .line[data-phase="error"] .verb { color: var(--cc-danger) }`, `.line[data-phase="waiting"] .spark { color: var(--cc-link) }`, reduced motion: no spin, no shimmer.

- [ ] **Step 6: Wire `Opening` and `InputBubble`** — `Opening` user/command-input branch: `<div className={css.group}><UserBubble label={command ? '命令输入' : undefined} data={{ 'data-reader-anchor': true, 'data-reader-key': nodeKey, ...(command ? { 'data-reader-command-input': '' } : {}) }}><Blocks {...render} blocks={blocks} source="user" /></UserBubble>{labels && <div className={css.labels} data-reader-user-labels>{labels}</div>}</div>`. Trigger row: keep markup, recolour with `--cc-*` (title `--cc-text-300`, time/action `--cc-text-500`, body block `--cc-bg-200` + `--cc-border`). `InputBubble`: `<UserBubble small label={label} data={{ 'data-reader-input': node.kind, 'data-reader-anchor': true, 'data-reader-key': nodeKey }}><Blocks … /></UserBubble>` (labels `补充消息` / `命令输入` as today). Remove now-unused `.user`/`.input`/`.meta` rules; migrate the rest of `Opening.module.css` and `RecordRows.module.css` to `--cc-*`; add all four new/changed sheets to `MIGRATED`.

- [ ] **Step 7: Run tests**

Run: `npm test`, `npm run typecheck`
Expected: PASS, including the rewind bridge tests (`tests/compat-patches.test.ts`, `tests/rewind-hidden.test.ts`).

- [ ] **Step 8: Commit**

```bash
git add src/client/UserBubble.* src/client/PlanCard.* src/client/StatusLine.* src/client/Opening.* src/client/RecordRows.* tests/
git commit -m "feat: user bubbles with six-line clamp, plan checklist card and the running status line"
```

### Task 8: Transcript turn — assemble, and retire the process panel

**Files:**
- Rewrite: `src/client/TurnSection.tsx`, `src/client/TurnSection.module.css`
- Modify: `src/client/transcript-model.ts` (add `liveThoughtKey`), `src/client/Reader.tsx`, `src/client/store.ts`, `src/client/motion.tsx` (`usePinnedSelection` default selector), `src/client/compat/index.ts`, `src/client/process-steps.ts` (delete dead exports)
- Create: `src/client/JumpButton.tsx` + `.module.css`
- Delete: `src/client/ProcessPanel.tsx`, `ProcessPanel.module.css`, `ClusterRow.tsx`, `ClusterRow.module.css`, `FloatingStatus.tsx`, `FloatingStatus.module.css`, `ReasoningRow.tsx`, `ReasoningRow.module.css`, `ProcessRow.tsx` + css if nothing imports them any more, `compat/memory-tail-keep.ts`
- Tests: rewrite `tests/turn-section.test.ts`; delete `tests/operational-cluster.test.ts`, `tests/process-panel.test.ts`, `tests/floating-status.test.ts`, `tests/reasoning-row.test.ts`; trim `tests/process-steps.test.ts` to the kept functions; update `tests/compat-patches.test.ts`, `tests/browser/reader-performance.tsx`, `tests/style-contract.test.ts` (`REDESIGNED` list)

**Interfaces:**
- Consumes: everything from Tasks 3–7; kept from `process-steps.ts`: `layoutTurn`, `commandOutputText`, `panelStatus`, `statusLabel`, `elapsedLabel`, `runningLabel`, `PanelItem`, `ReasoningItem`, `PanelStatus`.
- Produces: `export function liveThoughtKey(entries: readonly TranscriptEntry[], get: Getter, open: boolean): string | null` in `transcript-model.ts` — the key of the last entry when it is a thought whose assistant step is `running`, whose segment is the step's last segment and whose last block is `reasoning`; otherwise `null`. `JumpButton({ detached, onJump, motion })`.
- Deleted (must not be imported anywhere afterwards): `groupSteps`, `StepLayout`, `categorySummary`, `groupOperations`, `OperationRow`, `OperationClusterSummary`, `formatOperationClusterSummary`, `mergeThoughts`, `ThoughtRow` type in process-steps, `FlowRow`, `rememberOpened`, `clusterElapsedMs`, `panelCounts`, `PanelCounts`, `processExpanded`/`processChoiceKey` (projection.ts, if unused), `ReaderState.collapseThinking`, `setCollapseThinking`.

Turn order (spec §3): preamble → opening (`UserBubble` / trigger) → `<div data-reader-flow>` with every transcript entry except the live thought → tool media → command outputs → answer articles → notices → status line (open turn: running/waiting; closed `interrupted`/`error`/other non-completed reasons: red, label `terminalLabel(reason) ?? statusLabel(...)`) → live thought (open turn only, directly under the status line) → footer (closed) → `flowTail`. Narration and answer share one class `.prose` (serif, `--cc-size-body`, line-height 1.6, `--cc-text-100`). Nothing collapses when a turn ends.

- [ ] **Step 1: Write the failing tests** — replace `tests/turn-section.test.ts` (keep its `renderTurn` helper, but drop `collapseThinking` from the store stub and `selectedProcessKeys` from props):

```ts
test('a completed turn keeps its narration, groups operations into one line and shows the answer', () => {
  const { turn, nodes, second } = completedTurn();
  const html = renderTurn(nodes, turn);
  assert.match(html, /data-reader-turn="1" data-reader-turn-state="closed" data-reader-turn-result="completed"/);
  assert.match(html, /我先检查一下。/);
  assert.match(html, /data-reader-flow/);
  assert.match(html, new RegExp(`<article[^>]*data-reader-answer="true"[^>]*data-reader-key="${second.key}"`));
  for (const retired of ['data-reader-panel', 'data-reader-process=', 'data-reader-earlier', 'data-reader-cluster', '前 \\d+ 步', '次工具', '毫秒']) {
    assert.doesNotMatch(html, new RegExp(retired), retired);
  }
  assert.doesNotMatch(html, /data-reader-status-line/);
});

test('an open turn ends with the status line and renders live thinking exactly once, below it', () => {
  const turn = turnLocation({ status: 'open', start: 0, steps: [1] });
  const user = chatNode('user', { content: [{ type: 'text', text: '继续' }] }, turn);
  const step = assistantNode(turn, 1, [text('先看一下。'), reasoning('But the 围脊 boxes')], { status: 'running' });
  const html = renderTurn([user, step], turn);
  assert.equal(html.match(/data-reader-live-thought/g)?.length, 1);
  assert.equal(html.match(/But the 围脊 boxes/g)?.length, 1);
  assert.match(html, /data-reader-status-line[^>]*data-phase="running"[\s\S]*data-reader-live-thought/);
  assert.match(html, /思考中…/);
});

test('an interrupted turn shows a red status line and keeps everything', () => {
  const turn = turnLocation({ status: 'closed', reason: 'interrupted', start: 0, end: 5_000, steps: [1], closingStep: null });
  const step = assistantNode(turn, 1, [text('写到一半'), toolCall('c1', 'bash', { command: 'ls' })], { status: 'interrupted' });
  const html = renderTurn([chatNode('user', { content: [{ type: 'text', text: 'x' }] }, turn), step], turn);
  assert.match(html, /data-reader-status-line[^>]*data-phase="interrupted"/);
  assert.match(html, /写到一半/);
});

test('a long turn keeps every narration paragraph', () => {
  const turn = turnLocation({ status: 'closed', reason: 'completed', start: 0, end: 9_000, steps: [1, 2, 3, 4, 5, 6], closingStep: 6 });
  const nodes = [chatNode('user', { content: [{ type: 'text', text: 'go' }] }, turn)];
  for (let step = 1; step <= 5; step++) {
    nodes.push(assistantNode(turn, step, [text(`第 ${step} 段说明`), toolCall(`a${step}`, 'bash', { command: 'ls' }), toolCall(`b${step}`, 'read', { path: 'x' })]));
    nodes.push(chatNode('tool-call', { root: settledTool(`a${step}`, 'bash', { command: 'ls' }) }, turn, step));
    nodes.push(chatNode('tool-call', { root: settledTool(`b${step}`, 'read', { path: 'x' }) }, turn, step));
  }
  nodes.push(assistantNode(turn, 6, [text('最终回答')]));
  const html = renderTurn(nodes, turn);
  for (let step = 1; step <= 5; step++) assert.match(html, new RegExp(`第 ${step} 段说明`));
  assert.equal(html.match(/data-reader-group=/g)?.length, 5);
});
```

If `assistantNode` does not take a status option, set `status` on the returned node's `data` before rendering. Add `liveThoughtKey` unit tests to `tests/transcript-model.test.ts`: live last thought → key; settled step → null; thought not last → null; closed turn → null.

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- --test-name-pattern="completed turn keeps|open turn ends|interrupted turn|long turn|liveThoughtKey"`
Expected: FAIL (old panel markup).

- [ ] **Step 3: Implement `liveThoughtKey`** in `transcript-model.ts`:

```ts
import type { AssistantChatData } from '@deepseek-ai/dsh-client-ui-chat/client';
import { assistantSegments } from './projection.js';

export function liveThoughtKey(entries: readonly TranscriptEntry[], get: Getter, open: boolean): string | null {
  const last = entries.at(-1);
  if (!open || last?.kind !== 'thought') return null;
  const node = get(last.item.nodeKey);
  if (node?.kind !== 'assistant-step') return null;
  const data = node.data as AssistantChatData;
  if (data.status !== 'running' || data.blocks.at(-1)?.kind !== 'reasoning') return null;
  return assistantSegments(data.blocks).at(-1)?.start === last.item.start ? last.key : null;
}
```

- [ ] **Step 4: Rewrite `TurnSection.tsx`** — keep `useSegment`, `revealKeyOf`, `AnswerSegment`, `CommandOutput`, `PromptPreamble`, `useNow`, the `leading` computation, `readerFlow`/`layoutTurn`, `mentions`, `answerText`, `RevealLedgerContext`. Replace the segments and the render:

```tsx
const ThoughtSegment = memo(function ThoughtSegment({ useSession, nodeKey, start, pinned, onRead, ...render }: SegmentProps & { onRead: () => void }) {
  const { motion } = useReaderActions();
  const { data, part } = useSegment(useSession, nodeKey, start);
  const durationMs = useMemo(() => {
    const timing = data?.finalNode?.timing;
    if (!timing || timing.stepStartTime == null) return null;
    const end = timing.firstTokenTime ?? timing.completedTime;
    return end == null ? null : Math.max(0, end - timing.stepStartTime);
  }, [data]);
  if (!data || !part) return null;
  return <ThoughtRow durationMs={durationMs} motion={motion} onRead={onRead}>
    <Blocks {...render} blocks={part.blocks} holdFormatting={pinned} startedAt={data.time} interrupted={data.status === 'interrupted'} liveText />
  </ThoughtRow>;
});

const LiveSegment = memo(function LiveSegment({ useSession, nodeKey, start, pinned, follow, ...render }: SegmentProps & { follow: boolean }) {
  const { motion } = useReaderActions();
  const { data, part } = useSegment(useSession, nodeKey, start);
  if (!data || !part) return null;
  return <LiveThought follow={follow} motion={motion}>
    <Blocks {...render} blocks={part.blocks} streaming holdFormatting={pinned} startedAt={data.time} liveText />
  </LiveThought>;
});

const NarrationSegment = memo(function NarrationSegment({ useSession, nodeKey, start, pinned, ...render }: SegmentProps) {
  const { data, part } = useSegment(useSession, nodeKey, start);
  if (!data || !part) return null;
  return <div className={css.prose} data-reader-key={nodeKey}>
    <Blocks {...render} blocks={part.blocks} streaming={data.status === 'running'} holdFormatting={pinned} startedAt={data.time} interrupted={data.status === 'interrupted'} liveText revealKey={revealKeyOf(nodeKey, start)} />
  </div>;
});
```

`AnswerSegment` keeps its attributes and gets `className={css.prose}`. In the component body (after `layout`):

```tsx
const status = panelStatus(boundary, pendingCount);
const closed = boundary.status === 'closed';
const open = boundary.status === 'open';
const entries = useMemo(() => buildTranscript(layout.panel, get, closed), [layout.panel, get, closed]);
const liveKey = useMemo(() => liveThoughtKey(entries, get, open), [entries, get, open]);
const live = liveKey ? entries.at(-1) as Extract<TranscriptEntry, { kind: 'thought' }> : null;
const now = useNow(status === 'running' || status === 'waiting');
const liveStart = live ? (get(live.item.nodeKey)?.data as AssistantChatData | undefined)?.time : undefined;
const thinking = live && typeof liveStart === 'number' ? formatSeconds(Math.max(0, Math.round((now - liveStart) / 1000))) : null;
const flowPinned = pinnedKeys.includes(group.key);
const noop = useCallback(() => {}, []);
const renderItem = useCallback((item: PanelItem): ReactNode => {
  switch (item.kind) {
    case 'tool': return <BlockBoundary><ToolRow {...shared} entry={item.entry} turnClosed={closed} onRead={noop} /></BlockBoundary>;
    case 'record': return <BlockBoundary><RecordRow {...shared} useSession={props.useSession} nodeKey={item.nodeKey} t={props.contextT} onRead={noop} turnClosed={closed} /></BlockBoundary>;
    case 'input': return <BlockBoundary><InputBubble {...shared} useSession={props.useSession} nodeKey={item.nodeKey} /></BlockBoundary>;
    case 'narration': return <BlockBoundary><NarrationSegment {...shared} useSession={props.useSession} nodeKey={item.nodeKey} start={item.start} pinned={flowPinned} /></BlockBoundary>;
    case 'reasoning': return <BlockBoundary><ThoughtSegment {...shared} useSession={props.useSession} nodeKey={item.nodeKey} start={item.start} pinned={flowPinned} onRead={noop} /></BlockBoundary>;
  }
}, [shared, props.useSession, props.contextT, closed, noop, flowPinned]);
const renderEntry = (entry: TranscriptEntry): ReactNode => {
  switch (entry.kind) {
    case 'group': return <ToolGroupRow key={entry.key} group={entry} motion={motion} onRead={noop} renderItem={renderItem} />;
    case 'plan': return <PlanCard key={entry.key} todos={entry.todos} />;
    default: return <Fragment key={entry.key}>{renderItem(entry.item)}</Fragment>;
  }
};
const terminal = terminalLabel(boundary.reason);
const stopped = closed && boundary.reason !== 'completed';
```

Render:

```tsx
return <RevealLedgerContext.Provider value={revealLedger}><section className={css.turn} data-reader-turn={group.turn ?? 'unresolved'} data-reader-turn-state={boundary.status} data-reader-turn-result={boundary.reason ?? undefined}>
  {preambleKeys.map(key => <BlockBoundary key={key}><PromptPreamble useSession={props.useSession} nodeKey={key} /></BlockBoundary>)}
  {leading.opening && <BlockBoundary><Opening {...shared} useSession={props.useSession} nodeKey={leading.opening} /></BlockBoundary>}
  {entries.length > 0 && <div className={css.flow} data-reader-flow /* + the key attribute usePinnedSelection reads, value group.key */>
    {entries.filter(entry => entry.key !== liveKey).map(renderEntry)}
  </div>}
  {layout.media.length > 0 && <BlockBoundary><ToolImages {...shared} entries={layout.media} /></BlockBoundary>}
  {layout.outputs.map(key => <BlockBoundary key={key}><CommandOutput {...shared} useSession={props.useSession} nodeKey={key} /></BlockBoundary>)}
  {layout.answer.map((segment, index) => <BlockBoundary key={segment.key}>
    <AnswerSegment {...shared} useSession={props.useSession} nodeKey={segment.nodeKey} start={segment.start}
      pinned={pinnedKeys.includes(segment.nodeKey)} fileMentions={index === layout.answer.length - 1 ? mentions : undefined} />
  </BlockBoundary>)}
  {layout.notices.map(key => <BlockBoundary key={key}><TurnNotice useSession={props.useSession} nodeKey={key} /></BlockBoundary>)}
  {open && <StatusLine phase={status === 'waiting' ? 'waiting' : 'running'} label={status === 'waiting' ? '等待你的操作' : runningLabel(turn, group.keys, get)}
    elapsed={elapsedLabel(turn, now, status)} thinking={thinking} motion={motion} />}
  {live && <BlockBoundary><LiveSegment {...shared} useSession={props.useSession} nodeKey={live.item.nodeKey} start={live.item.start} pinned={flowPinned} follow={boundary.latestStep === (get(live.item.nodeKey)?.data as AssistantChatData | undefined)?.step} /></BlockBoundary>}
  {stopped && <StatusLine phase={status === 'interrupted' ? 'interrupted' : 'error'} label={terminal ?? statusLabel(status, boundary.reason, '')} elapsed={elapsedLabel(turn, now, status)} thinking={null} motion={motion} />}
  {closed && <BlockBoundary><TurnFooter turn={turn} answerText={answerText} /></BlockBoundary>}
  {flowTail}
</section></RevealLedgerContext.Provider>;
```

Imports to add: `Fragment`, `ThoughtRow`, `LiveThought`, `ToolGroupRow`, `PlanCard`, `StatusLine`, `buildTranscript`, `liveThoughtKey`, `TranscriptEntry`, `formatSeconds` (from `turn-activity.ts`). Remove: `ProcessPanel`, `ReasoningRow`, `StatusText`, `rememberOpened`, `panelCounts`, `processChoiceKey`, `processExpanded`, `selectedProcessKeys`, the expansion/earlier/compact store reads. `TurnSection.module.css`:

```css
.turn { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.flow { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.prose { margin: 8px 0; min-width: 0; color: var(--cc-text-100); font-family: var(--cc-font-response); font-size: var(--cc-size-body); line-height: 1.6; }
.output { min-width: 0; }
.stopped { color: var(--cc-text-500); font-size: var(--cc-size-small); }
```

(remove every rule whose class is no longer referenced; the style-contract test checks used classes exist).

- [ ] **Step 5: Reader, store, jump button, selection, compat**
  - `store.ts`: `ReaderState = { expanded: Record<string, boolean>; motion: boolean }`; drop `setCollapseThinking` from the type, the init and the actions.
  - `Reader.tsx`: delete the 折叠思考 `Switch` and `collapseThinking`; keep the 动效 switch; remove `selectedProcessKeys` and its prop; replace `<FloatingStatus …/>` with `<JumpButton detached={scroll.detached} onJump={scroll.jump} motion={motion} />`; keep `useTurnActivity` only for `conversationIdle`.
  - `JumpButton.tsx`: the round button half of today's `FloatingStatus` (same `MountFade`, `data-reader-jump`, `aria-label="回到最新"`, arrow icon). CSS: `position: sticky; bottom: 12px; align-self: center; width: 32px; height: 32px; border-radius: 50%; border: 1px solid var(--cc-border); background: var(--cc-bg-000); color: var(--cc-text-300); box-shadow: 0 1px 3px hsl(0 0% 0% / .12)`; copy the dock positioning from `FloatingStatus.module.css`.
  - `motion.tsx`: `usePinnedSelection` default selector `'[data-reader-answer], [data-reader-flow]'`.
  - `compat/index.ts`: stop starting `memory-tail-keep`; delete the file; update `tests/compat-patches.test.ts` so it no longer expects it.
  - `process-steps.ts`: delete the exports listed under Interfaces; delete now-dead helpers (`isOperationRecord`, `recordRunning`, `recordFailed`, `reasoningLive`, `operationSettled`, `effectiveSteps`, `CATEGORY_LABELS`).
  - `projection.ts`: delete `processExpanded` / `processChoiceKey` if nothing imports them.
  - `tests/browser/reader-performance.tsx`: drop `collapseThinking` and `setCollapseThinking`.
  - `tests/style-contract.test.ts`: `REDESIGNED = ['Reader', 'Line', 'ToolRow', 'ToolDetails', 'ToolGroupRow', 'ThoughtRow', 'LiveThought', 'StatusLine', 'UserBubble', 'PlanCard', 'RecordRows', 'Opening', 'TurnSection', 'TurnFooter', 'JumpButton', 'FileChanges']`; relax the retired-radius rule to allow `10px` and `6px` (Claude radii) — keep forbidding `7px`.

- [ ] **Step 6: Run tests and build gates**

Run: `npm test`, `npm run typecheck`, `DSHX_HARNESS=D:/Khabarovsk/K.Develop/deepseek-harness npm run build`, `node scripts/check-bundle-externals.mjs lib/client.js`, `node scripts/browser-syntax-gate.mjs lib/client.js`
Expected: all PASS. `grep -rn "ProcessPanel\|ClusterRow\|FloatingStatus\|ReasoningRow\|collapseThinking\|memory-tail-keep\|groupSteps\|mergeThoughts" src tests` prints nothing.

- [ ] **Step 7: Commit**

```bash
git add -A src tests
git commit -m "feat: transcript turn replaces the process panel; status line and live thinking end an open turn"
```

---

### Task 9: Claude typography for answers, footer, file changes and reader chrome

**Files:**
- Modify: `src/client/markdown/MarkdownText.module.css`, `src/client/TurnFooter.module.css`, `src/client/FileChanges.module.css`, `src/client/Reader.module.css` (toolbar, history button, notices, attention, `.column` gap), `src/client/native/*.module.css`
- Modify: `tests/style-contract.test.ts` (drop the `MIGRATED` filter: every `*.module.css` under `src/client/` and `src/client/markdown/`, `src/client/native/` must pass the host-token test)

**Interfaces:**
- Consumes: `--cc-*` (Task 1).
- Produces: no new names.

- [ ] **Step 1: Make the contract strict** — in `tests/style-contract.test.ts` change the host-token test to scan `src/client`, `src/client/markdown` and `src/client/native` sheets with no `MIGRATED` filter, and add:

```ts
test('answer prose uses the Claude response font and code uses the mono stack', () => {
  const markdown = readFileSync(new URL('markdown/MarkdownText.module.css', CLIENT), 'utf8');
  assert.match(markdown, /var\(--cc-font-mono\)/);
  assert.match(markdown, /var\(--cc-link\)/);
  assert.match(sheet('TurnSection'), /font-family:\s*var\(--cc-font-response\)/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- --test-name-pattern="host colour tokens|response font"`
Expected: FAIL listing the sheets that still read `var(--dsw-`.

- [ ] **Step 3: Restyle**
  - `MarkdownText.module.css`: text inherits family/size from `.prose`; `h1` `1.375em`, `h2` `1.25em`, `h3` `1.125em`, `h4–h6` `1em`, all `font-weight: 600; line-height: 1.4; margin: 1.1em 0 .5em; color: var(--cc-text-100)`; paragraphs `margin: 0 0 .75em`; lists `padding-left: 1.4em`, item gap `.25em`; inline code `font-family: var(--cc-font-mono); font-size: .85em; padding: 1px 5px; border-radius: 4px; background: var(--cc-bg-300); border: .5px solid var(--cc-border); color: var(--cc-danger)`; links `color: var(--cc-link); text-decoration: underline; text-underline-offset: 2px`; `a > code` inherits colour; blockquote `border-left: 2px solid var(--cc-border-strong); padding-left: 12px; color: var(--cc-text-300)`; tables `border-collapse: collapse; font-family: var(--cc-font-ui); font-size: var(--cc-size-ui)` with cell borders `var(--cc-border)` and header background `var(--cc-bg-200)`; keep `.tableScroll` rules from 0.2.1 unchanged; code blocks (wrappers this module styles) `border: 1px solid var(--cc-border); border-radius: 10px; background: var(--cc-bg-200); font-family: var(--cc-font-mono); font-size: var(--cc-size-code)`.
  - `TurnFooter.module.css`: row `gap: 14px; margin-top: 10px; font-family: var(--cc-font-ui); font-size: var(--cc-size-small); color: var(--cc-text-500)`; icon buttons 28px, hover `var(--cc-hover)`; deliverable chips `border: 1px solid var(--cc-border); border-radius: 8px; padding: 4px 10px; color: var(--cc-text-300)`.
  - `FileChanges.module.css`: same chip style; added/modified/deleted counts `--cc-success` / `--cc-text-300` / `--cc-danger`; list rows on `--cc-size-ui` sans.
  - `Reader.module.css`: `.column { gap: 28px }`; toolbar text `--cc-text-500` `--cc-size-small`; switch hover `--cc-hover`; history button `border: 1px solid var(--cc-border); border-radius: 8px; background: var(--cc-bg-000); color: var(--cc-text-300)`; `.notice`/`.error`/`.attention` boxes `border: 1px solid var(--cc-border); border-radius: 10px; background: var(--cc-bg-200)` with error text `--cc-danger`; focus ring `outline: 2px solid var(--cc-link)`.
  - `native/*.module.css`: replace `--dsw-*` colour reads with the matching `--cc-*` token.

- [ ] **Step 4: Run tests and build gates**

Run: `npm test`, `npm run typecheck`, the build and both bundle gates.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client tests/style-contract.test.ts
git commit -m "feat: Claude typography and tokens for answers, footer, file changes and reader chrome"
```

---

### Task 10: Live verification on the real host (read-only)

**Files:**
- Modify: `scripts/verify-live-reader.mjs`
- Create: `scripts/record-compare.mjs` (copy of `C:/Users/Administrator/AppData/Local/Temp/claude/D--Khabarovsk-K-Develop-dsh/da930cb7-5e1f-4a6f-a57f-36b1cd3d2e14/scratchpad/record.mjs`, with its header comment kept: read-only, clicks only workspace rows / 「展开其余」 / the session row / the tab; one Chrome per tab via `REC_TAB=对话|阅读`; block write requests before transmission and fail if any `session/create` was sent)
- Evidence: `D:/Khabarovsk/K.Develop/dsh/.planning/clearview-0200-redesign-20261005/verification.md` (append a `0.3.0` section), screenshots under `.perf-results/live-030/`

**Interfaces:**
- Consumes: DOM attributes from spec §4.3 (`data-reader-flow`, `data-reader-group`, `data-group-state`, `data-reader-line`, `data-reader-status-line`, `data-reader-live-thought`, `data-reader-user-bubble`, `data-clamped`, `data-reader-plan`).

- [ ] **Step 1: Update the verifier** — in `collect`, replace `panels` with `groups: all('[data-reader-group]').map(n => n.getAttribute('data-group-state'))`, add `statusLines`, `liveThoughts`, `bubbles` (with `data-clamped`), `plans`, `narration: all('[data-reader-flow] > div > [data-reader-key]').length` (adapt to the real wrapper), and `retired: all('[data-reader-panel],[data-reader-cluster],[data-reader-earlier],[data-reader-activity-pill]').length` (must be 0). In the open-rows step, open the first closed `[data-reader-group]` button and the first `[data-reader-tool-call] button[aria-expanded="false"]` instead of panel headers. In `measure`, rows are `[data-reader-line]`; add computed font families of `.prose` / `[data-reader-line]` / `code` and the reader root background. Theme check: set `document.body.setAttribute('data-ds-dark-theme', '')` / `removeAttribute` in the headless page only (no host preference is written), screenshot both. Keep every existing safety guard unchanged.

- [ ] **Step 2: Run against the built bundle with interception** (cwd `D:/Khabarovsk/K.Develop/dsh/staging/dsh-clearview-0200-20261005`, DSH running on 3193):

```bash
READER_SESSIONS='#c78af51c|#13af9644|#db871dc5' READER_EXPAND='0923 5.5,dsh' READER_LIVE_OUTPUT=.perf-results/live-030 node scripts/verify-live-reader.mjs
```

Expected: all three sessions covered, every session `version` = package version, `blockErrors` = [], `retired` = 0, `readerErrors` = [], `sessionCreates` = 0, session count unchanged, no horizontal overflow at 1440 and 480 widths, actual prose paragraph size/line-height = 16px/25.6px plus the host font delta, font CSS stack starts with `anthropic-serif` (record separately whether its FontFace loaded), root background equals `hsl(60 2.7% 14.5%)` in dark and `hsl(48 33.3% 97.1%)` in light (as computed rgb). Blocked host background writes and their correlated errors remain explicitly uncovered; they do not count as reader errors and must not be silently suppressed to obtain a whole-host pass.

- [ ] **Step 3: Compare against the prototype** — open the screenshots next to `prototype/shot-*.png`; note differences in `verification.md` (spacing, colours, fonts). Fix CSS-only differences in the owning task's files and re-run Step 2.

- [ ] **Step 4: Commit**

```bash
git add scripts/verify-live-reader.mjs scripts/record-compare.mjs
git commit -m "test: live verifier and side-by-side recorder for the 0.3.0 transcript"
```

(The running-turn comparison needs a user-started task; it happens after install, Task 12 Step 5.)

---

### Task 11: Version 0.3.0, docs, prototype branch

**Files:**
- Modify: `package.json`, `src/client/version.ts`, `tests/version.test.ts`, `CHANGELOG.md`, `README.md`, `DESIGN.md`

- [ ] **Step 1: Version** — `0.3.0` in `package.json` and `src/client/version.ts`; run `npm test -- --test-name-pattern=version` (expected PASS after the bump; FAIL before).

- [ ] **Step 2: Docs**
  - `CHANGELOG.md` — new top entry `## 0.3.0`: 阅读页改为 Claude Code Desktop 式对话流（无过程面板、说明段落始终可见、连续操作合并为一行、运行中底部状态行与实时思考、用户气泡六行截断、计划清单卡片）；配色与字体与 Claude 一致（字体从本机 Claude Desktop 读取，不随包分发，缺失时回退 Georgia / 系统字体）；移除过程面板头部计数、「前 N 步」、浮动状态条、「折叠思考」开关、思考预览与字数、合并思考行、收尾防折叠兼容模块。
  - `README.md` — rewrite 「功能亮点」 to the new grammar; add a note under 安装: 想要 Claude 字体需本机安装 Claude Desktop（Windows），否则自动回退; update the test count (`npm test` total).
  - `DESIGN.md` — replace the Process panel / Long reasoning sections with: transcript entries and grouping rules (spec §3.2), status line and live thinking (§3.3), tokens (§3.5), fonts and the font route (§3.6), compat contract (§4.3).

- [ ] **Step 3: Gates** — `npm test`, `npm run typecheck`, build, both bundle gates. Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add package.json src/client/version.ts tests/version.test.ts CHANGELOG.md README.md DESIGN.md
git commit -m "chore: release 0.3.0 (changelog, README, DESIGN)"
```

- [ ] **Step 5: Park the prototype on its own branch** (keeps it out of main):

```bash
git checkout -b proto/clearview-030-cc-flow
git add prototype
git commit -m "proto: Claude Code Desktop transcript prototype for 0.3.0 (reference only)"
git checkout feat/clearview-030-claude-transcript
```

Expected: `prototype/` is gone from the feature branch's working tree and present on `proto/clearview-030-cc-flow`.

---

### Task 12: Whole-branch review, merge and release candidate (controller)

This task is run by the controller, not a task implementer.

- [x] **Step 1: Whole-branch review** — final spec/quality and bounded lifecycle/performance reviews completed; fixes applied. Fresh 364/364 tests, TypeScript compilation, build, externals and browser syntax passed. Three real reader cases passed. First-view performance did not meet the original target; the user explicitly accepted the measured +35.4ms exception on 2026-10-09 while retaining complete prose and motion (see spec acceptance note).

- [ ] **Step 2: Merge** — after the user approves: fast-forward `main` in `D:/Khabarovsk/K.Develop/dsh/dsh-clearview` to the feature branch (main is clean at 8b8aa60 plus the spec commit lineage); run `npm test` there.

- [x] **Step 3: Package** — assemble a clean source package at `release/clearview-030-final/package` using fresh independent TypeScript output, then `npm pack` there. This excludes 24 obsolete generated files without deleting the original output (that cleanup was denied by automatic policy). Record bundle/archive sha256 in `build-sha256.txt`; use `release/prepare-030-final.mjs` and `update-030-final.json`. The archive has 491 files and matches the live-verified client bundle; no fonts, prototype, screenshots or caches are included. Older `clearview-030` output is superseded and must not be used.

- [x] **Step 4: Candidate** — prepared and independently inspected candidate `be7c9d78-db52-4c1f-a8bd-24feb2ccc299` using `update-030-final.json`, based on current applied `plugin-ea6203ef-4db3-46f2-8d82-76758ed86ae5`. The public inspector verified source/payload/runtime integrity and requirements; both candidate bundles match the built and prepared copies. Receipt: `release/candidate-reviewed-030.json`. Main merge, publication and activation remain pending user authorization. Publication is performed by the user under the existing handoff workflow.

- [ ] **Step 5: After the user installs** — read-only checks: applied revision equals the candidate, port 3193 owned by the new generation with no orphan core, served bundle equals `lib/client.js`, `READER_NO_INTERCEPT=1` verifier run on the three sessions; then ask the user to start a task and run `scripts/record-compare.mjs` for both tabs (7 minutes, 10 s) and compare against spec §2 success criteria 1 and 4. Report in Chinese.
