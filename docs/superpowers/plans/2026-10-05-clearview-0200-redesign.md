# dsh-clearview 0.2.0 接口对齐与视觉重设计 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把阅读视图迁到 DeepSeek Harness 0.2.0-rc.2 的真实接口上，补齐新节点和轮次尾部，并按 B 方向（原生骨架 + 柔和层次）重做过程区的视觉与动效。

**Architecture:** 以运行中的 `0.1.18-dsh020.1` 源码为基线。纯逻辑模块（`process-steps`、`turn-meta`、`turn-trigger`、`host`、`reading-position`）先用 TDD 落地；视图层再按组件拆成 `ProcessPanel`、`ProcessRow`/`ToolRow`、`ReasoningRow`、`RecordRows`、`Opening`、`TurnFooter`、`FloatingStatus`，每个组件配自己的 CSS module。宿主能力全部通过 `ctx.get()` 惰性读取并可降级，组件通过 `ReaderActionsContext` 拿到动作。

**Tech Stack:** TypeScript 6、React 18.3、CSS Modules、node:test + tsx、react-dom/server（组件渲染测试）、tsdown + dshx 适配器、Chrome DevTools Protocol（真实宿主验证）。

**Spec:** `docs/superpowers/specs/2026-10-05-clearview-0200-redesign-design.md`

## Global Constraints

- 版本 `0.2.0`；peer 精确钉为：`@deepseek-ai/cordis` `4.0.4`、`react` `18.3.1`，其余 `@deepseek-ai/dsh-*` 一律 `0.2.0-rc.2`（与运行版 package.json 的 peer 集合一致）。
- 运行时外部依赖只能是 `react`、`react/jsx-runtime`、`@deepseek-ai/dsh-client-ui-primitives`；对其他 `@deepseek-ai/*` 包只允许 `import type`。
- 可选宿主服务（`sidebarRight`、`uiConversation`、`uiWorkspace`、`chatFileMentions`）只能用 `ctx.get('名称')` 惰性读取，缺失时降级，不抛错；`export const inject` 保持 `['slots', 'sessions', 'workspaces', 'remote', 'locale', 'jobs']`。
- 浏览器产物语法上限 es2022（`tsdown.config.ts` 的 `config.target = 'es2022'` 不得改动；`scripts/browser-syntax-gate.mjs` 必须通过）。
- 颜色只用 `--dsw-alias-*` / `--dsw-*` token；圆角只用 `var(--dsw-radius-sm|md|lg|xl)`、`999px`、`50%`，并加 `corner-shape: round`；流内元素不得使用 `backdrop-filter`。
- 字号：正文 `var(--dsh-content-font-size, 14px)` / `calc(24px + var(--dsh-content-font-delta, 0px))`；过程行 `var(--dsh-content-font-size-secondary, 13px)`；元信息 12/18。
- 动效：缓动 `cubic-bezier(.2,.8,.2,1)`；悬停 100ms ease；状态替换/浮层/新行 200ms；展开收起 260ms；逐词渐显保留 `WORD_MOTION`（350ms、1px、60ms、240ms）。扫光只用原生 `TextShimmer`，进行中/状态点只用原生 `StateDot`。
- 必须保留的 DOM 约定（compat 模块依赖）：`section[data-reader-turn][data-reader-turn-state][data-reader-turn-result]`；过程面板头部 `[data-reader-disclosure][data-expanded] > button`；`[data-reader-text][data-shown-length]`；用户气泡 `div[data-reader-anchor][data-reader-key]`；Blocks 的 `data-reader-block-error`。
- 文案一律中文；不改写、不摘要、不推测模型原文。
- 只有成功结束（`closed` + `completed`）的轮次自动收起过程；运行中、出错、中断、等待操作、状态未知一律保持展开。
- 每个任务结束时 `npm test` 与 `npm run typecheck` 都必须通过。
- 提交信息末尾附：`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。只在本地提交，不推送；所有改动都在工作树 `D:/Khabarovsk/K.Develop/dsh/staging/dsh-clearview-0200-20261005`（分支 `feat/clearview-0200-redesign`）里，不得修改 main 检出 `D:/Khabarovsk/K.Develop/dsh/dsh-clearview`。

## Review Focus

1. **窗口从半轮开始的轮次**（没有 `turn/start`，状态 `unknown`）：面板必须保持展开、状态显示「执行过程」、不压缩成「前 N 步」以外的形态也不能丢内容。→ Task 6 `panelStatus` 测试 + Task 11 `TurnSection` 渲染测试。
2. **以工具调用结尾、没有收尾文字的轮次**（中断在工具上）：回答区为空、不出现空的复制按钮、面板保持展开。→ Task 6 `layoutTurn` 测试 + Task 12 `TurnFooter` 测试。
3. **超长轮次（几十步）**：只有一行工具调用的连续步骤必须合并成「步骤 a–b」，不能每步一个小标题。→ Task 6 `groupSteps` 测试。
4. **宿主缺少可选服务**（没有侧栏、没有图片缓存、没有文件名链接、没有分支能力）：对应功能隐藏或退回旧路径，不抛错。→ Task 5 `host` 测试 + Task 12 `TurnFooter` 测试。
5. **轮次结束时面板里还有文字选区**：面板必须保持展开，直到选区释放。→ Task 11 `TurnSection` 渲染测试。

## File Map

| 文件 | 职责 | 任务 |
|---|---|---|
| `scripts/link-generation-dependencies.mjs` | 把 0.2.0 generation 的 13 个宿主包 junction 进 `node_modules` | 2 |
| `tests/support/loader.mjs`、`register.mjs`、`dom.ts`、`render.ts`、`chat-fixture.ts` | 测试基建：CSS 代理、primitives 替身、最小 DOM 全局、SSR 渲染、会话数据夹具 | 2、11 |
| `src/client/version.ts` | `READER_VERSION`，根节点版本属性 | 2 |
| `src/client/turn-meta.ts` | 时钟/用时/用量格式化、收尾信息、交付文件去重 | 3 |
| `src/client/turn-trigger.ts` | 触发来源 → 标题与图标 | 4 |
| `src/client/host.ts` | 文件地址、侧栏打开、图片 URL、分支、文件名链接 | 5 |
| `src/client/process-steps.ts` | 轮次布局、步骤分组、计数、状态、标签 | 6 |
| `src/client/motion-tokens.ts` | 动效参数单一来源 | 7 |
| `src/client/reader-context.ts` | `ReaderActionsContext` | 7 |
| `src/client/ProcessRow.tsx` + `.module.css` | 行图标、分隔点、内凹块、错误摘要、折叠行、箭头 | 8 |
| `src/client/ToolRow.tsx` + `.module.css` | 工具行、子调用、工具图片 | 8 |
| `src/client/ToolDetails.tsx` + `.module.css` | 工具详情三页签、在轨迹中查看 | 8 |
| `src/client/ReasoningRow.tsx` + `.module.css` | 思考行与实时内凹块（迁入跟随控制器） | 9 |
| `src/client/RecordRows.tsx` + `.module.css` | 记录行、插话气泡、轮次通知 | 10 |
| `src/client/Opening.tsx` + `.module.css` | 用户气泡、标签行、turn-trigger 开场 | 10 |
| `src/client/ProcessPanel.tsx` + `.module.css` | 过程面板 | 11 |
| `src/client/TurnSection.tsx` + `.module.css` | 一轮的完整布局（取代 `TurnGroup`） | 11 |
| `src/client/TurnFooter.tsx` + `.module.css` | 交付卡片、复制、分支、元信息 | 12 |
| `src/client/FloatingStatus.tsx` + `.module.css` | 运行胶囊与回到最新圆钮 | 13 |
| `src/client/reading-position.ts` | 阅读位置记忆 | 13 |
| `src/client/FileChanges.module.css` | 文件改动面板新样式 | 13 |
| `scripts/check-bundle-externals.mjs` | 产物外部依赖门禁 | 15 |
| `scripts/verify-live-reader.mjs` | 真实宿主拦截验证 | 16 |
| 删除：`ToolActivity.tsx`、`ReasoningCard.tsx`、`compat/turn-metrics-footer.ts`、`compat/composer-readability.ts`、`tests/turn-metrics-footer.test.ts`、`tests/operational-cluster.test.ts` | | 3、11 |

---

### Task 1: 同步 0.1.18 基线到工作树分支

工作环境说明：仓库本身已有 git 历史和 GitHub 远端；main 检出（`D:/Khabarovsk/K.Develop/dsh/dsh-clearview`）上还有未提交的 0.1.16/0.1.17 改动，**不得修改 main 检出**。本计划全部在工作树 `D:/Khabarovsk/K.Develop/dsh/staging/dsh-clearview-0200-20261005`（分支 `feat/clearview-0200-redesign`，从 main 的 `082332a` 拉出）里进行。工作树已有自己的 `node_modules`（一层指向 main 依赖的 junction，`@deepseek-ai` 是独立目录），`.gitignore` 已加入 `.superpowers/` 与 `.perf-results/`，spec 与本计划已提交。

**Files:**
- Backup（只读来源是 main 检出）: `D:/Khabarovsk/K.Develop/dsh/.planning/clearview-0200-redesign-20261005/baseline-0.1.17/`
- Replace（工作树内）: `src/`、`tests/`、`scripts/`、`CHANGELOG.md`、`DESIGN.md`、`README.md`、`THIRD_PARTY_NOTICES.md`、`LICENSE`、`package.json`、`tsconfig.json`、`tsdown.config.ts`、`cordis.yml`、`cordis.patch.yml`、`dshx.yml`
- Delete（工作树内）: `package-lock.json`、`pnpm-lock.yaml`

**Interfaces:**
- Consumes: 托管源码 `D:/Khabarovsk/K.Develop/dsh/.planning/clearview-perf-20260918/release/managed-source-20260919/package`（0.1.18 仓库外壳与测试），运行版 `src`（generation `40e2b640…/packages/e3e7503fddde1a801e391543/src`）。
- Produces: 分支 `feat/clearview-0200-redesign` 上一个能跑通 165 个测试的 0.1.18 基线提交。

- [ ] **Step 1: 备份 main 检出里的 0.1.17 内容（只读复制）**

在 Git Bash 中执行：

```bash
MAIN=D:/Khabarovsk/K.Develop/dsh/dsh-clearview
BACKUP=D:/Khabarovsk/K.Develop/dsh/.planning/clearview-0200-redesign-20261005/baseline-0.1.17
mkdir -p "$BACKUP"
cd "$MAIN"
cp -r src tests scripts lib CHANGELOG.md DESIGN.md README.md THIRD_PARTY_NOTICES.md LICENSE package.json package-lock.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json tsdown.config.ts cordis.yml cordis.patch.yml dshx.yml .gitignore dsh-clearview-0.1.15.tgz dsh-clearview-0.1.16.tgz "$BACKUP/"
git -C "$MAIN" diff > "$BACKUP/main-uncommitted.diff"
ls "$BACKUP"
git -C "$MAIN" status --short
```

Expected: 备份目录里列出上面全部条目和 `main-uncommitted.diff`；main 的 `git status` 与执行前完全一样（只读，没有改动）。

- [ ] **Step 2: 在工作树里用托管外壳 + 运行版源码替换内容**

```bash
WT=D:/Khabarovsk/K.Develop/dsh/staging/dsh-clearview-0200-20261005
MANAGED=D:/Khabarovsk/K.Develop/dsh/.planning/clearview-perf-20260918/release/managed-source-20260919/package
INSTALLED=D:/Khabarovsk/K.Develop/dsh/dsh-env/.local/device-f/generations/40e2b640-6078-4781-82b0-e4b70499de4e/packages/e3e7503fddde1a801e391543
cd "$WT"
git rm -r -q src tests scripts package-lock.json pnpm-lock.yaml
for x in CHANGELOG.md DESIGN.md README.md THIRD_PARTY_NOTICES.md LICENSE package.json tsconfig.json tsdown.config.ts cordis.yml cordis.patch.yml dshx.yml scripts tests; do cp -r "$MANAGED/$x" ./; done
cp -r "$INSTALLED/src" ./src
diff -rq --strip-trailing-cr "$INSTALLED/src" ./src && echo SRC-OK
```

Expected: 最后输出 `SRC-OK`。`docs/`、`node_modules/`、`.gitignore`、`pnpm-workspace.yaml` 保持不动。

- [ ] **Step 3: 运行基线测试**

Run: `npm test`
Expected: `ℹ tests 165`、`ℹ pass 165`、`ℹ fail 0`。

- [ ] **Step 4: 提交基线**

```bash
cd D:/Khabarovsk/K.Develop/dsh/staging/dsh-clearview-0200-20261005
git add -A
git commit -m "chore: sync 0.1.18-dsh020.1 baseline as the 0.2.0 starting point

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git status --short
```

Expected: 提交成功；`git status` 干净（`node_modules/` 被忽略）。

---

### Task 2: 对准 0.2.0 类型、测试基建、版本号与 PreparingToolCall 修复

**Files:**
- Create: `scripts/link-generation-dependencies.mjs`
- Create: `tests/support/loader.mjs`、`tests/support/register.mjs`、`tests/support/dom.ts`、`tests/support/render.ts`
- Create: `src/client/version.ts`
- Create: `tests/version.test.ts`、`tests/tool-call-model.test.ts`
- Modify: `package.json`
- Modify: `src/client/native/tool-call-model.ts`（`toolRowModel` 里的 `argsRaw` 一行）
- Modify: `src/client/Reader.tsx`（根节点版本属性）

**Interfaces:**
- Produces: `READER_VERSION: '0.2.0'`；测试命令 `node --import ./tests/support/register.mjs --import tsx/esm --test tests/*.test.ts`；`render(component, props): string`（SSR，屏蔽 useLayoutEffect 告警）；primitives 替身里 `StateDot` 渲染为 `<span data-stub="StateDot" data-state=…>`、`TextShimmer` 渲染为 `<span data-stub="TextShimmer" data-active="true|false">`、`DisclosureRow` 渲染为 `<div data-stub="DisclosureRow" data-open=… data-running=…>` 并依次输出 `icon`、`<span data-row-title>title</span>`、`collapsedContent`。

- [ ] **Step 1: 写链接脚本**

`scripts/link-generation-dependencies.mjs`：

```js
// Link the host packages of one DSH generation into node_modules, so typecheck
// and tests read the exact 0.2.0 contracts the reader runs against.
// Usage: node scripts/link-generation-dependencies.mjs <generation>/packages
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmdirSync, rmSync, symlinkSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const packagesDir = resolve(process.argv[2] ?? '');
if (!process.argv[2] || !existsSync(packagesDir)) throw new Error('Pass the generation packages directory.');
const wanted = new Set([
  '@deepseek-ai/cordis', '@deepseek-ai/dsh-attachment', '@deepseek-ai/dsh-session',
  '@deepseek-ai/dsh-client-store', '@deepseek-ai/dsh-client-locale',
  '@deepseek-ai/dsh-client-ui-slots', '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-conversation', '@deepseek-ai/dsh-client-ui-chat',
  '@deepseek-ai/dsh-client-ui-session', '@deepseek-ai/dsh-client-ui-renderer',
  '@deepseek-ai/dsh-api-session-controller', '@deepseek-ai/dsh-api-job-controller',
]);
const found = new Map();
for (const dir of readdirSync(packagesDir)) {
  let name;
  try { name = JSON.parse(readFileSync(join(packagesDir, dir, 'package.json'), 'utf8')).name; } catch { continue; }
  if (wanted.has(name)) found.set(name, join(packagesDir, dir));
}
const missing = [...wanted].filter(name => !found.has(name));
if (missing.length) throw new Error(`Generation is missing: ${missing.join(', ')}`);

function remove(path) {
  let stat;
  try { stat = lstatSync(path); } catch { return; }
  if (stat.isSymbolicLink()) { try { unlinkSync(path); } catch { rmdirSync(path); } return; }
  rmSync(path, { recursive: true, force: true });
}

const local = resolve('node_modules');
for (const [name, target] of found) {
  const destination = join(local, name);
  mkdirSync(dirname(destination), { recursive: true });
  remove(destination);
  symlinkSync(target, destination, 'junction');
}
console.log(`Linked ${found.size} generation packages from ${packagesDir}.`);
```

- [ ] **Step 2: 执行链接**

```bash
cd D:/Khabarovsk/K.Develop/dsh/staging/dsh-clearview-0200-20261005
node scripts/link-generation-dependencies.mjs D:/Khabarovsk/K.Develop/dsh/dsh-env/.local/device-f/generations/40e2b640-6078-4781-82b0-e4b70499de4e/packages
node -p "require('./node_modules/@deepseek-ai/dsh-client-ui-chat/package.json').version"
```

Expected: `Linked 13 generation packages …`，然后输出 `0.2.0-rc.2`。

- [ ] **Step 3: 写测试加载器**

`tests/support/loader.mjs`：

```js
// node:test loader: CSS modules resolve to a class-name proxy, and the host
// primitives package resolves to light stubs generated from its real export
// list, so components can be server-rendered without a browser module table.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const PRIMITIVES = '@deepseek-ai/dsh-client-ui-primitives';
const STUB_URL = new URL('./primitives-stub.virtual.mjs', import.meta.url).href;
const OVERRIDES = new Set(['DisclosureRow', 'TextShimmer', 'StateDot', 'writeClipboard']);

function primitiveNames() {
  const require = createRequire(join(process.cwd(), 'package.json'));
  const manifest = require.resolve(`${PRIMITIVES}/package.json`);
  const source = readFileSync(join(dirname(manifest), 'lib', 'index.js'), 'utf8');
  const names = new Set();
  for (const block of source.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of block[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).at(-1)?.trim();
      if (name && /^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
  }
  return [...names];
}

function primitivesStub() {
  const generic = primitiveNames().filter(name => !OVERRIDES.has(name))
    .map(name => `export const ${name} = stub(${JSON.stringify(name)});`).join('\n');
  return `import { createElement } from 'react';
const stub = name => { const C = props => createElement('span', { 'data-stub': name }, props?.children ?? null); C.displayName = name; return C; };
export const writeClipboard = async () => true;
export const StateDot = props => createElement('span', { 'data-stub': 'StateDot', 'data-state': props.state, className: props.className });
export const TextShimmer = props => createElement('span', { 'data-stub': 'TextShimmer', 'data-active': props.active ? 'true' : 'false', className: props.className }, props.children);
export const DisclosureRow = props => createElement('div', { 'data-stub': 'DisclosureRow', 'data-open': String(props.open), 'data-running': props.running ? 'true' : undefined, className: props.rowClassName },
  props.icon, createElement('span', { 'data-row-title': '', className: props.titleClassName }, props.title), props.collapsedContent ?? null, props.open ? props.children ?? null : null);
${generic}
`;
}

export async function resolve(specifier, context, next) {
  if (specifier === PRIMITIVES) return { url: STUB_URL, format: 'module', shortCircuit: true };
  return next(specifier, context);
}

export async function load(url, context, next) {
  if (url === STUB_URL) return { format: 'module', source: primitivesStub(), shortCircuit: true };
  if (/\.css(\?|$)/.test(url)) return { format: 'module', source: 'export default new Proxy({}, { get: (_, key) => typeof key === "string" ? key : undefined });', shortCircuit: true };
  return next(url, context);
}
```

`tests/support/register.mjs`：

```js
import { register } from 'node:module';
register('./loader.mjs', import.meta.url);
```

`tests/support/dom.ts`：

```ts
// Minimal browser globals for server-rendering components under node:test.
// window deliberately has no `document`, so react-dom/server stays in its
// non-DOM path.
const g = globalThis as Record<string, unknown>;
const noop = () => {};
const media = () => ({ matches: false, addEventListener: noop, removeEventListener: noop });
g.document ??= { hidden: false, timeline: { currentTime: 0 }, addEventListener: noop, removeEventListener: noop, getSelection: () => null, activeElement: null };
g.window ??= { matchMedia: media, addEventListener: noop, removeEventListener: noop, setInterval, clearInterval, setTimeout, clearTimeout };
g.requestAnimationFrame ??= (callback: (time: number) => void) => setTimeout(() => callback(performance.now()), 16);
g.cancelAnimationFrame ??= (id: ReturnType<typeof setTimeout>) => clearTimeout(id);
export {};
```

`tests/support/render.ts`：

```ts
import './dom.ts';
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/** Server-render one component; the server-side useLayoutEffect warning is expected noise. */
export function render<P extends object>(component: ComponentType<P>, props: P): string {
  const original = console.error;
  console.error = (...args: unknown[]) => {
    if (String(args[0]).includes('useLayoutEffect does nothing on the server')) return;
    original(...args);
  };
  try { return renderToStaticMarkup(createElement(component, props)); } finally { console.error = original; }
}
```

- [ ] **Step 4: 更新 package.json**

把 `version` 改为 `"0.2.0"`；`scripts` 改为：

```json
"scripts": {
  "build": "tsc -p tsconfig.json && tsdown",
  "typecheck": "tsc -p tsconfig.json --noEmit",
  "test": "node --import ./tests/support/register.mjs --import tsx/esm --test tests/*.test.ts",
  "link:harness": "node scripts/link-harness-dependencies.mjs",
  "link:generation": "node scripts/link-generation-dependencies.mjs"
},
```

`dsh.client.inject` 改为：

```json
"inject": [
  "@deepseek-ai/dsh-client-ui-conversation",
  "@deepseek-ai/dsh-client-ui-chat",
  "@deepseek-ai/dsh-client-locale",
  "@deepseek-ai/dsh-api-job-controller",
  "@deepseek-ai/dsh-client-ui-renderer",
  "@deepseek-ai/dsh-api-session-controller",
  "@deepseek-ai/dsh-client-ui-session"
]
```

`peerDependencies` 改为：

```json
"peerDependencies": {
  "@deepseek-ai/cordis": "4.0.4",
  "@deepseek-ai/dsh-attachment": "0.2.0-rc.2",
  "@deepseek-ai/dsh-client-ui-conversation": "0.2.0-rc.2",
  "@deepseek-ai/dsh-client-ui-primitives": "0.2.0-rc.2",
  "@deepseek-ai/dsh-client-ui-slots": "0.2.0-rc.2",
  "react": "18.3.1",
  "@deepseek-ai/dsh-client-ui-chat": "0.2.0-rc.2",
  "@deepseek-ai/dsh-client-locale": "0.2.0-rc.2",
  "@deepseek-ai/dsh-api-job-controller": "0.2.0-rc.2",
  "@deepseek-ai/dsh-client-ui-renderer": "0.2.0-rc.2",
  "@deepseek-ai/dsh-api-session-controller": "0.2.0-rc.2",
  "@deepseek-ai/dsh-client-ui-session": "0.2.0-rc.2"
},
```

- [ ] **Step 5: 写失败测试（版本号与 preparing 调用）**

`tests/version.test.ts`：

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { READER_VERSION } from '../src/client/version.ts';

test('the root version attribute follows package.json', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(READER_VERSION, manifest.version);
});
```

`tests/tool-call-model.test.ts`：

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toolRowModel } from '../src/client/native/tool-call-model.ts';

test('a 0.2.0 preparing call carries no arguments and falls back to its call id', () => {
  const preparing = { phase: 'preparing', callId: 'call-7', name: 'bash', turn: 1, step: 2, time: 0, subCalls: [] };
  const model = toolRowModel('bash', preparing as never);
  assert.match(model.summary, /call-7/);
});

test('a started call summarizes its arguments', () => {
  const started = { phase: 'start', callId: 'call-8', name: 'bash', turn: 1, step: 2, time: 0, subCalls: [], argsRaw: JSON.stringify({ command: 'npm run build' }) };
  const model = toolRowModel('bash', started as never);
  assert.doesNotMatch(model.summary, /call-8/);
});
```

- [ ] **Step 6: 运行测试确认失败**

Run: `npm test`
Expected: `version.test.ts` 失败（`Cannot find module …/version.ts`）。另外两条 tool-call-model 测试可能已经通过，因为运行时有 `?? ''` 兜底；它们锁定的是行为，类型错误由 typecheck 发现。

- [ ] **Step 7: 实现**

`src/client/version.ts`：

```ts
/** Reader build identity, mirrored on the root as data-dsh-clearview. Keep equal to package.json. */
export const READER_VERSION = '0.2.0';
```

`src/client/native/tool-call-model.ts` 第 219 行附近，把

```ts
  const argsRaw = (done ? block.call?.argsRaw : block.argsRaw) ?? ''
```

改为

```ts
  // 0.2.0 splits a running call into `preparing` (no arguments yet) and `start`.
  const argsRaw = (done ? block.call?.argsRaw : 'argsRaw' in block ? block.argsRaw : undefined) ?? ''
```

`src/client/Reader.tsx`：在 import 区加 `import { READER_VERSION } from './version.js';`，把根节点上的 `data-dsh-clearview="0.1.18"` 改为 `data-dsh-clearview={READER_VERSION}`。

- [ ] **Step 8: 运行测试与类型检查**

Run: `npm test`
Expected: 168 个测试全部通过（165 + 3）。

Run: `npm run typecheck`
Expected: 无输出，退出码 0。

- [ ] **Step 9: 提交**

```bash
git add -A
git commit -m "build: typecheck against the 0.2.0-rc.2 generation and add component test support

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `turn-meta.ts` 取代 DOM 注入的统计行

**Files:**
- Create: `src/client/turn-meta.ts`
- Create: `tests/turn-meta.test.ts`、`tests/compat-patches.test.ts`
- Delete: `src/client/compat/turn-metrics-footer.ts`、`tests/turn-metrics-footer.test.ts`、`src/client/compat/composer-readability.ts`
- Modify: `src/client/compat/index.ts`、`src/client/compat/styles.ts`、`tests/browser/reader-performance.tsx`

**Interfaces:**
- Produces:
  - `fmtClock(time: number, now?: Date): string | null`
  - `fmtRun(ms: number): string`（`16分39秒` / `45秒`）
  - `fmtCompactTokens(value: number): string`
  - `closingOf(turn: TurnLocation | undefined): TurnClosing | null`，`TurnClosing = { seq: number; step: number; time: number }`
  - `turnMeta(turn, now?): TurnMeta | null`，`TurnMeta = { clock: string | null; duration: string | null; usage: string | null }`
  - `turnMetaText(meta: TurnMeta | null): string`（用 ` · ` 连接非空项）
  - `presentedFiles(turn): PresentedFileRef[]`，`PresentedFileRef = { path: string; description?: string; seq: number; index: number }`

- [ ] **Step 1: 写失败测试**

`tests/turn-meta.test.ts`：

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { TurnLocation } from '@deepseek-ai/dsh-client-ui-conversation/client';
import { closingOf, fmtClock, fmtCompactTokens, fmtRun, presentedFiles, turnMeta, turnMetaText } from '../src/client/turn-meta.ts';

const NOW = new Date(2026, 9, 5, 12, 0, 0);

function turn(data: Record<string, unknown>, extra: Partial<Record<string, unknown>> = {}): TurnLocation {
  return { turn: 1, status: 'closed', start: { time: new Date(2026, 8, 24, 17, 3, 41).getTime() }, end: { time: new Date(2026, 8, 24, 17, 20, 20).getTime() },
    steps: [], data: new Map(Object.entries(data)), ...extra } as unknown as TurnLocation;
}
const tail = (overrides: Record<string, unknown> = {}) => ({ turn: 1, seq: 90, time: 0, closing: { step: 65, time: new Date(2026, 8, 24, 17, 20, 0).getTime(), finalNode: { seq: 88 } }, branchUnavailable: false, ...overrides });

test('clock: today shows HH:MM, this year shows the date, older years show the year', () => {
  assert.equal(fmtClock(new Date(2026, 9, 5, 9, 7).getTime(), NOW), '09:07');
  assert.equal(fmtClock(new Date(2026, 8, 24, 17, 20).getTime(), NOW), '9月24日 17:20');
  assert.equal(fmtClock(new Date(2025, 0, 2, 8, 0).getTime(), NOW), '2025年1月2日 08:00');
  assert.equal(fmtClock(Number.NaN, NOW), null);
});

test('run and token formats mirror the native footer', () => {
  assert.equal(fmtRun(999_000), '16分39秒');
  assert.equal(fmtRun(45_400), '45秒');
  assert.equal(fmtCompactTokens(950), '950');
  assert.equal(fmtCompactTokens(12_340), '12.3K');
  assert.equal(fmtCompactTokens(11_400_000), '11.4M');
  assert.equal(fmtCompactTokens(250_000_000), '250M');
});

test('turn meta joins clock, duration and usage from public turn data', () => {
  const meta = turnMeta(turn({ 'turn-tail': tail({ tokenUsage: { totalTokens: 11_400_000 } }) }), NOW);
  assert.deepEqual(meta, { clock: '9月24日 17:20', duration: '用时 16分39秒', usage: '用量 11.4M tok' });
  assert.equal(turnMetaText(meta), '9月24日 17:20 · 用时 16分39秒 · 用量 11.4M tok');
});

test('turn meta drops parts without evidence and ignores open turns', () => {
  assert.equal(turnMetaText(turnMeta(turn({ 'turn-tail': tail() }), NOW)), '9月24日 17:20 · 用时 16分39秒');
  assert.equal(turnMeta(turn({}, { status: 'open' }), NOW), null);
  assert.equal(turnMeta(turn({}, { start: undefined, end: undefined }), NOW), null);
  assert.equal(turnMetaText(null), '');
});

test('closing facts come from turn-tail and reject malformed payloads', () => {
  assert.deepEqual(closingOf(turn({ 'turn-tail': tail() })), { seq: 88, step: 65, time: new Date(2026, 8, 24, 17, 20, 0).getTime() });
  assert.equal(closingOf(turn({ 'turn-tail': { closing: null } })), null);
  assert.equal(closingOf(undefined), null);
});

test('presented files keep first-seen order, take the latest description, and stop at the closing reply', () => {
  const data = { 'turn-tail': tail(), deliverables: { produced: [], presented: [
    { path: 'README.md', description: '旧说明', seq: 10, index: 0 },
    { path: 'scene.png', seq: 11, index: 0 },
    { path: 'README.md', description: '运行、构建与结构说明', seq: 20, index: 0 },
    { path: 'late.txt', seq: 95, index: 0 },
    { path: '', seq: 12, index: 1 },
    { seq: 13, index: 0 },
  ] } };
  assert.deepEqual(presentedFiles(turn(data)), [
    { path: 'README.md', description: '运行、构建与结构说明', seq: 20, index: 0 },
    { path: 'scene.png', description: undefined, seq: 11, index: 0 },
  ]);
  assert.deepEqual(presentedFiles(turn({})), []);
  assert.deepEqual(presentedFiles(undefined), []);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test`
Expected: `turn-meta.test.ts` 失败（模块不存在）。

- [ ] **Step 3: 实现 `src/client/turn-meta.ts`**

```ts
import type { TurnLocation } from '@deepseek-ai/dsh-client-ui-conversation/client';

const pad2 = (n: number) => (n < 10 ? '0' : '') + n;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** Turn data contributed by other plugins is read by key without importing their type merges. */
function turnData(turn: TurnLocation, key: string): unknown {
  return (turn.data as unknown as { get(key: string): unknown }).get(key);
}

/** Native clock: today HH:MM, this year 9月24日 HH:MM, otherwise with the year. */
export function fmtClock(time: number, now: Date = new Date()): string | null {
  if (typeof time !== 'number' || !Number.isFinite(time)) return null;
  const d = new Date(time);
  const clock = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()) return clock;
  const date = d.getFullYear() === now.getFullYear()
    ? `${d.getMonth() + 1}月${d.getDate()}日`
    : `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  return `${date} ${clock}`;
}

export function fmtRun(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}分${pad2(s)}秒` : `${s}秒`;
}

/** Native formatTokens: <1k raw, <1M one-decimal K, otherwise one-decimal M. */
export function fmtCompactTokens(value: number): string {
  const scaled = (v: number) => v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10);
  if (value < 1e3) return String(Math.round(value));
  if (value < 1e6) return `${scaled(value / 1e3)}K`;
  return `${scaled(value / 1e6)}M`;
}

export interface TurnClosing { seq: number; step: number; time: number }

/** The closing assistant reply recorded by turn-tail, or null without evidence. */
export function closingOf(turn: TurnLocation | undefined): TurnClosing | null {
  if (!turn) return null;
  const closing = record(record(turnData(turn, 'turn-tail'))?.closing);
  const seq = record(closing?.finalNode)?.seq;
  const step = closing?.step;
  const time = closing?.time;
  return typeof seq === 'number' && typeof step === 'number' && typeof time === 'number' ? { seq, step, time } : null;
}

export interface TurnMeta { clock: string | null; duration: string | null; usage: string | null }

export function turnMeta(turn: TurnLocation | undefined, now: Date = new Date()): TurnMeta | null {
  if (!turn || turn.status !== 'closed') return null;
  const closing = closingOf(turn);
  const clock = closing ? fmtClock(closing.time, now) : null;
  const start = turn.start?.time;
  const end = turn.end?.time;
  const duration = typeof start === 'number' && typeof end === 'number' && Number.isFinite(end - start) ? `用时 ${fmtRun(end - start)}` : null;
  const total = record(record(turnData(turn, 'turn-tail'))?.tokenUsage)?.totalTokens;
  const usage = typeof total === 'number' && Number.isFinite(total) && total > 0 ? `用量 ${fmtCompactTokens(total)} tok` : null;
  return clock || duration || usage ? { clock, duration, usage } : null;
}

export function turnMetaText(meta: TurnMeta | null): string {
  return meta ? [meta.clock, meta.duration, meta.usage].filter(Boolean).join(' · ') : '';
}

export interface PresentedFileRef { path: string; description?: string; seq: number; index: number }

/** Explicit deliveries of one turn: latest declaration per path before the closing reply, first-seen order. */
export function presentedFiles(turn: TurnLocation | undefined): PresentedFileRef[] {
  if (!turn) return [];
  const presented = record(turnData(turn, 'deliverables'))?.presented;
  if (!Array.isArray(presented)) return [];
  const limit = closingOf(turn)?.seq;
  const order: string[] = [];
  const latest = new Map<string, PresentedFileRef>();
  for (const raw of presented) {
    const item = record(raw);
    if (!item || typeof item.path !== 'string' || item.path === '' || typeof item.seq !== 'number' || typeof item.index !== 'number') continue;
    if (limit !== undefined && item.seq > limit) continue;
    if (!latest.has(item.path)) order.push(item.path);
    latest.set(item.path, {
      path: item.path,
      description: typeof item.description === 'string' && item.description !== '' ? item.description : undefined,
      seq: item.seq,
      index: item.index,
    });
  }
  return order.map(path => latest.get(path)!);
}
```

- [ ] **Step 4: 删除旧模块并更新 compat 层**

```bash
git rm src/client/compat/turn-metrics-footer.ts tests/turn-metrics-footer.test.ts src/client/compat/composer-readability.ts
```

`src/client/compat/index.ts`：删除 `import * as composerReadability …` 与 `import * as turnMetricsFooter …` 两行；`patches` 数组只保留：

```ts
  const patches: Array<[string, (ctx: any) => (() => void) | void]> = [
    ['memory-tail-keep', memoryTailKeep.apply],
    ['perf-guard', perfGuard.apply],
    ['rewind-bridge', rewindBridge.apply],
  ];
```

并把文件头注释里 `composer-readability.ts` 和 `turn-metrics-footer.ts` 两行改为一行：`  - （统计行与 composer 标记已于 0.2.0 移除：统计改由 TurnFooter 读 turn-tail 公开数据）`。

`src/client/compat/styles.ts`：删除 `/* ==== reader-turn-metrics-footer.css ==== */` 整段（到 `/* ==== rewind-reader-bridge.css ==== */` 之前），以及 `[data-composer-seat] [data-dshcp-stats-row] { … }` 这一条规则；文件头注释里对应的两行同步删除。

`tests/browser/reader-performance.tsx`：把

```ts
import { footerTextForTurn } from 'fixture-source/compat/turn-metrics-footer.ts';
```

改为

```ts
import { turnMeta, turnMetaText } from 'fixture-source/turn-meta.ts';
```

并把

```ts
check(!!snap && !!footerTextForTurn(snap, 21), 'turn footer missing after fine-grained subscriptions');
```

改为

```ts
check(!!snap && turnMetaText(turnMeta(snap.chat.timeline.turns.get(21))) !== '', 'turn footer missing after fine-grained subscriptions');
```

新增 `tests/compat-patches.test.ts`，钉住「删掉的 compat 模块不再注册、也不再留样式」：

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { COMPAT_CSS } from '../src/client/compat/styles.ts';

const COMPAT = new URL('../src/client/compat/', import.meta.url);

test('only the three surviving compat patches are registered', () => {
  const source = readFileSync(new URL('index.ts', COMPAT), 'utf8');
  const registered = [...source.matchAll(/\['([\w-]+)',\s*\w+\.apply\]/g)].map(match => match[1]);
  assert.deepEqual(registered, ['memory-tail-keep', 'perf-guard', 'rewind-bridge']);
  assert.doesNotMatch(source, /turn-metrics-footer|composer-readability/);
  assert.equal(existsSync(new URL('turn-metrics-footer.ts', COMPAT)), false);
  assert.equal(existsSync(new URL('composer-readability.ts', COMPAT)), false);
});

test('no compat style targets the removed footer or composer stats row', () => {
  assert.doesNotMatch(COMPAT_CSS, /dshcp-turn-footer|dshcp-stats-row/);
});
```

- [ ] **Step 5: 运行测试与类型检查**

Run: `npm test`
Expected: 全部通过（turn-metrics-footer 的 5 个测试被移除，turn-meta 新增 6 个，compat-patches 新增 2 个）。

Run: `npm run typecheck`
Expected: 0 错误。

- [ ] **Step 6: 提交**

```bash
git add -A
git commit -m "feat: read turn meta and deliveries from public turn data

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `turn-trigger.ts`

**Files:**
- Create: `src/client/turn-trigger.ts`
- Create: `tests/turn-trigger.test.ts`

**Interfaces:**
- Produces: `type TriggerIcon = 'agent' | 'github' | 'goal' | 'job' | 'plugin' | 'request' | 'schedule' | 'subagent' | 'team' | 'webhook'`；`triggerDetails(source: unknown): { title: string; icon: TriggerIcon }`；`TRIGGER_EXPLANATION = '这条通知触发了本轮回复。'`

- [ ] **Step 1: 写失败测试**

`tests/turn-trigger.test.ts`：

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { triggerDetails } from '../src/client/turn-trigger.ts';

test('every known source kind maps to the native title and icon family', () => {
  const cases: [unknown, string, string][] = [
    [{ kind: 'goal' }, '继续执行目标', 'goal'],
    [{ kind: 'agent-message' }, '收到任务消息', 'agent'],
    [{ kind: 'team-message' }, '收到团队消息', 'team'],
    [{ kind: 'subagent-settled' }, '子任务状态更新', 'subagent'],
    [{ kind: 'webhook', provider: 'github' }, '收到 GitHub 事件', 'github'],
    [{ kind: 'webhook', provider: 'gitlab' }, '收到外部事件', 'webhook'],
    [{ kind: 'schedule' }, '自动化任务', 'schedule'],
    [{ kind: 'tool-jobs' }, '后台任务状态更新', 'job'],
    [{ kind: 'cordis-host-runner' }, '插件状态更新', 'plugin'],
  ];
  for (const [source, title, icon] of cases) assert.deepEqual(triggerDetails(source), { title, icon });
});

test('unknown or unreadable sources fall back to an execution request', () => {
  for (const source of [{ kind: 'new-kind' }, {}, null, 'schedule', 42, []]) {
    assert.deepEqual(triggerDetails(source), { title: '收到执行请求', icon: 'request' });
  }
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test`
Expected: `turn-trigger.test.ts` 失败（模块不存在）。

- [ ] **Step 3: 实现 `src/client/turn-trigger.ts`**

```ts
/** Source families of a non-human message that starts a Turn (mirrors ui-chat turnTriggerDetails). */
export type TriggerIcon = 'agent' | 'github' | 'goal' | 'job' | 'plugin' | 'request' | 'schedule' | 'subagent' | 'team' | 'webhook';

export interface TriggerDetails { title: string; icon: TriggerIcon }

const TITLES: Record<TriggerIcon, string> = {
  request: '收到执行请求',
  goal: '继续执行目标',
  agent: '收到任务消息',
  team: '收到团队消息',
  subagent: '子任务状态更新',
  github: '收到 GitHub 事件',
  webhook: '收到外部事件',
  schedule: '自动化任务',
  job: '后台任务状态更新',
  plugin: '插件状态更新',
};

export const TRIGGER_EXPLANATION = '这条通知触发了本轮回复。';

export function triggerDetails(source: unknown): TriggerDetails {
  const record = typeof source === 'object' && source !== null && !Array.isArray(source) ? source as Record<string, unknown> : null;
  const kind = typeof record?.kind === 'string' ? record.kind : undefined;
  const icon: TriggerIcon = kind === 'goal' ? 'goal'
    : kind === 'agent-message' ? 'agent'
    : kind === 'team-message' ? 'team'
    : kind === 'subagent-settled' ? 'subagent'
    : kind === 'webhook' ? (record?.provider === 'github' ? 'github' : 'webhook')
    : kind === 'schedule' ? 'schedule'
    : kind === 'tool-jobs' ? 'job'
    : kind === 'cordis-host-runner' ? 'plugin'
    : 'request';
  return { title: TITLES[icon], icon };
}
```

- [ ] **Step 4: 运行测试**

Run: `npm test`
Expected: 全部通过。

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "feat: map turn-trigger sources to titles and icons

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `host.ts` 宿主能力适配，并接入注入面、图片与文件名链接

**Files:**
- Create: `src/client/host.ts`
- Create: `tests/host.test.ts`、`tests/blocks-file-mentions.test.ts`
- Modify: `src/client/types.ts`（`ReaderInjected`）
- Modify: `src/client/index.tsx`（构造 host）
- Modify: `src/client/Blocks.tsx`（图片改用 URL、`fileMentions` 透传）
- Modify: `src/client/word-motion.tsx`（`MotionMarkdown` 接收 `fileMentions`）

**Interfaces:**
- Consumes: `MarkdownFileMentions`（`src/client/markdown/render.tsx` 已导出）。
- Produces:
  - `FILE_ADDRESS_PREFIX = 'dsh-resource://file/'`、`sessionFileAddress(sessionId, path)`、`fileAddressFor(sessionId, cwd, path)`
  - `HostServices`、`HostFallbacks`、`ReaderHost`、`createReaderHost(sessionId, services, fallbacks): ReaderHost`
  - `ReaderHost = { openFile(path): Promise<void>; imageUrl(attachment): Promise<string>; fork(atSeq): Promise<void>; fileMentions(turn, seq): MarkdownFileMentions | undefined; dispose(): void }`
  - `ReaderInjected.loadImage: (attachment: ImageAttachmentRef) => Promise<string>`（**签名变更：返回可显示的 URL**）；新增可选 `fork`、`fileMentions`
  - `Blocks` 新增可选 prop `fileMentions?: MarkdownFileMentions`

- [ ] **Step 1: 写失败测试 `tests/host.test.ts`**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { TurnLocation } from '@deepseek-ai/dsh-client-ui-conversation/client';
import { createReaderHost, fileAddressFor, sessionFileAddress, type HostServices } from '../src/client/host.ts';

test('file addresses match the native dsh-resource spelling', () => {
  assert.equal(sessionFileAddress('s1', 'src/a.ts'), 'dsh-resource://file/session/s1/src/a.ts');
  assert.equal(sessionFileAddress('s1', './src/a.ts'), 'dsh-resource://file/session/s1/src/a.ts');
  assert.equal(sessionFileAddress('s1', 'src\\a b.ts'), 'dsh-resource://file/session/s1/src/a%20b.ts');
  assert.equal(sessionFileAddress('s 1', 'x'), 'dsh-resource://file/session/s%201/x');
  assert.equal(fileAddressFor('s1', 'D:\\repo', 'D:\\repo\\src\\x.ts'), 'dsh-resource://file/session/s1/src/x.ts');
  assert.equal(fileAddressFor('s1', '/home/u/repo/', '/home/u/repo'), 'dsh-resource://file/session/s1/');
  assert.equal(fileAddressFor('s1', 'D:\\repo', 'C:\\other\\f.md'), 'dsh-resource://file/session/s1/C:/other/f.md');
  assert.equal(fileAddressFor('s1', undefined, 'notes/todo.md'), 'dsh-resource://file/session/s1/notes/todo.md');
  assert.equal(fileAddressFor('s1', 'D:\\repo', '\\\\srv\\share\\f'), 'dsh-resource://file/session/s1///srv/share/f');
});

function fallbacks(overrides: Partial<Parameters<typeof createReaderHost>[2]> = {}) {
  return { cwd: () => 'D:\\repo', fork: async (_seq: number) => 'child-1', ...overrides };
}

test('openFile prefers the sidebar preview and falls back to the system opener', async () => {
  const opened: string[] = [];
  const system: string[] = [];
  const withSidebar = createReaderHost('s1', () => ({ sidebarRight: { openResource: (address: string) => { opened.push(address); } } }), fallbacks({ openWithSystem: async path => { system.push(path); } }));
  await withSidebar.openFile('D:\\repo\\README.md');
  assert.deepEqual(opened, ['dsh-resource://file/session/s1/README.md']);
  assert.deepEqual(system, []);
  const withoutSidebar = createReaderHost('s1', () => ({}), fallbacks({ openWithSystem: async path => { system.push(path); } }));
  await withoutSidebar.openFile('README.md');
  assert.deepEqual(system, ['README.md']);
  const neither = createReaderHost('s1', () => ({}), fallbacks());
  await assert.rejects(neither.openFile('README.md'), /宿主未提供文件打开能力/);
});

test('imageUrl uses the session image cache, then owned blob URLs with a media-type gate', async () => {
  const attachment = { attachmentId: 'a1', mediaType: 'image/png' } as never;
  const cached = createReaderHost('s1', () => ({ uiConversation: { imageUrl: async () => 'blob:cached' } }), fallbacks());
  assert.equal(await cached.imageUrl(attachment), 'blob:cached');
  let reads = 0;
  const owned = createReaderHost('s1', () => ({}), fallbacks({ readAttachment: async () => { reads++; return { data: new Uint8Array([1, 2, 3]), mediaType: 'image/png' }; } }));
  const first = await owned.imageUrl(attachment);
  const second = await owned.imageUrl(attachment);
  assert.match(first, /^blob:/);
  assert.equal(first, second);
  assert.equal(reads, 1);
  owned.dispose();
  const rejected = createReaderHost('s1', () => ({}), fallbacks({ readAttachment: async () => ({ data: new Uint8Array([1]), mediaType: 'text/html' }) }));
  await assert.rejects(rejected.imageUrl(attachment), /Unsupported image media type/);
  const missing = createReaderHost('s1', () => ({}), fallbacks());
  await assert.rejects(missing.imageUrl(attachment), /宿主未提供图片读取能力/);
});

test('fork opens the child session when the workspace navigator exists', async () => {
  const forked: number[] = [];
  const opened: string[] = [];
  const host = createReaderHost('s1', () => ({ uiWorkspace: { openSession: (id: string) => { opened.push(id); } } }), fallbacks({ fork: async seq => { forked.push(seq); return 'child-9'; } }));
  await host.fork(88);
  assert.deepEqual(forked, [88]);
  assert.deepEqual(opened, ['child-9']);
  const headless = createReaderHost('s1', () => ({}), fallbacks());
  await headless.fork(88);
});

test('file mentions delegate to the deliverables service and are absent without it', () => {
  const turn = { turn: 3 } as unknown as TurnLocation;
  const calls: unknown[] = [];
  const services: HostServices = { chatFileMentions: { forClosing: (owner, sessionId) => { calls.push([owner.turn, owner.seq, sessionId]); return { resolve: () => undefined }; } } };
  const host = createReaderHost('s1', () => services, fallbacks());
  assert.ok(host.fileMentions(turn, 88));
  assert.deepEqual(calls, [[turn, 88, 's1']]);
  assert.equal(createReaderHost('s1', () => ({}), fallbacks()).fileMentions(turn, 88), undefined);
});
```

- [ ] **Step 2: 写失败测试 `tests/blocks-file-mentions.test.ts`**

```ts
import './support/dom.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render } from './support/render.ts';
import { Blocks } from '../src/client/Blocks.tsx';

test('settled answer text links inline-code file mentions', () => {
  const html = render(Blocks, {
    blocks: [{ kind: 'text', text: '已更新 `src/a.ts` 和 `missing.ts`。' }],
    renderSlotChain: ((_name: string, _owner: unknown, options: { fallback: unknown }) => options.fallback) as never,
    loadImage: async () => 'blob:x',
    fileMentions: { resolve: (value: string) => value === 'src/a.ts' ? { open: () => {}, label: '打开 src/a.ts', title: 'D:/repo/src/a.ts' } : undefined },
  });
  assert.match(html, /<button[^>]*title="D:\/repo\/src\/a.ts"[^>]*aria-label="打开 src\/a.ts"[^>]*>src\/a.ts<\/button>/);
  assert.match(html, /<code>missing.ts<\/code>/);
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npm test`
Expected: `host.test.ts` 失败（模块不存在）；`blocks-file-mentions.test.ts` 失败（`missing.ts` 那条通过，`src/a.ts` 没有 button，因为 `fileMentions` 还没透传）。

- [ ] **Step 4: 实现 `src/client/host.ts`**

```ts
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment';
import type { TurnLocation } from '@deepseek-ai/dsh-client-ui-conversation/client';
import type { MarkdownFileMentions } from './markdown/render.js';

export const FILE_ADDRESS_PREFIX = 'dsh-resource://file/';
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

function encodeSegment(segment: string): string { return encodeURIComponent(segment).replace(/%3A/gi, ':'); }
function encodePath(path: string): string { return path.split('/').map(encodeSegment).join('/'); }
export function isWindowsStylePath(value: string): boolean { return /^[A-Za-z]:[/\\]/.test(value) || value.startsWith('\\\\'); }
export function isAbsoluteWorkspacePath(path: string): boolean { return path.startsWith('/') || isWindowsStylePath(path); }

/** `dsh-resource://file/session/<sessionId>/<path>`, the address native Chat opens in the right sidebar. */
export function sessionFileAddress(sessionId: string, path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '');
  return `${FILE_ADDRESS_PREFIX}session/${encodeSegment(sessionId)}/${encodePath(normalized)}`;
}

/** Workspace-rooted paths address relative to the Session cwd, like native fileAddressFor. */
export function fileAddressFor(sessionId: string, cwd: string | undefined, path: string): string {
  const normalized = path.replace(/\\/g, '/');
  if (!isAbsoluteWorkspacePath(normalized)) return sessionFileAddress(sessionId, normalized);
  const root = cwd === undefined ? '' : cwd.replace(/\\/g, '/').replace(/\/+$/, '');
  if (root !== '' && normalized === root) return sessionFileAddress(sessionId, '');
  if (root !== '' && normalized.startsWith(`${root}/`)) return sessionFileAddress(sessionId, normalized.slice(root.length + 1));
  return sessionFileAddress(sessionId, normalized);
}

/** Structural view of the optional host services, read through ctx.get at call time. */
export interface HostServices {
  sidebarRight?: { openResource(address: string): void } | undefined;
  uiConversation?: { imageUrl(sessionId: string, attachment: ImageAttachmentRef): Promise<string> } | undefined;
  uiWorkspace?: { openSession(target: string): void } | undefined;
  chatFileMentions?: {
    forClosing(owner: { turn: TurnLocation; seq: number; openFile: (path: string) => void }, sessionId: string): MarkdownFileMentions | undefined;
  } | undefined;
}

export interface HostFallbacks {
  cwd: () => string | undefined;
  openWithSystem?: (path: string) => Promise<void>;
  readAttachment?: (attachment: ImageAttachmentRef) => Promise<{ data: Uint8Array; mediaType: string }>;
  fork: (atSeq: number) => Promise<string>;
}

export interface ReaderHost {
  openFile(path: string): Promise<void>;
  imageUrl(attachment: ImageAttachmentRef): Promise<string>;
  fork(atSeq: number): Promise<void>;
  fileMentions(turn: TurnLocation, seq: number): MarkdownFileMentions | undefined;
  dispose(): void;
}

export function createReaderHost(sessionId: string, services: () => HostServices, fallbacks: HostFallbacks): ReaderHost {
  const owned = new Map<string, Promise<string>>();
  const urls: string[] = [];
  const openFile = async (path: string): Promise<void> => {
    const sidebar = services().sidebarRight;
    if (sidebar) { sidebar.openResource(fileAddressFor(sessionId, fallbacks.cwd(), path)); return; }
    if (fallbacks.openWithSystem) return fallbacks.openWithSystem(path);
    throw new Error('宿主未提供文件打开能力。');
  };
  return {
    openFile,
    imageUrl(attachment) {
      const conversation = services().uiConversation;
      if (conversation) return conversation.imageUrl(sessionId, attachment);
      const read = fallbacks.readAttachment;
      if (!read) return Promise.reject(new Error('宿主未提供图片读取能力。'));
      const cached = owned.get(attachment.attachmentId);
      if (cached) return cached;
      const pending = read(attachment).then(result => {
        if (!IMAGE_TYPES.has(result.mediaType)) throw new Error('Unsupported image media type');
        const url = URL.createObjectURL(new Blob([Uint8Array.from(result.data)], { type: result.mediaType }));
        urls.push(url);
        return url;
      });
      pending.catch(() => { owned.delete(attachment.attachmentId); });
      owned.set(attachment.attachmentId, pending);
      return pending;
    },
    async fork(atSeq) {
      const child = await fallbacks.fork(atSeq);
      services().uiWorkspace?.openSession(child);
    },
    fileMentions(turn, seq) {
      return services().chatFileMentions?.forClosing({ turn, seq, openFile: path => { void openFile(path).catch(() => {}); } }, sessionId);
    },
    dispose() {
      for (const url of urls.splice(0)) URL.revokeObjectURL(url);
      owned.clear();
    },
  };
}
```

- [ ] **Step 5: 更新 `src/client/types.ts`**

在 import 区加：

```ts
import type { TurnLocation } from '@deepseek-ai/dsh-client-ui-conversation/client';
import type { MarkdownFileMentions } from './markdown/render.js';
```

把 `ReaderInjected` 里的 `loadImage`、`openFile` 改写并新增两项：

```ts
  /** 可直接显示的图片 URL（会话图片缓存优先，缺失时退回自持 blob URL）。 */
  loadImage: (attachment: ImageAttachmentRef) => Promise<string>;
  /** 打开文件：右侧栏预览优先，缺失时退回 Host 默认程序。 */
  openFile?: (path: string) => Promise<void>;
  /** 列一个目录（相对会话 cwd 或绝对路径）下的条目名集合；用于文件改动卡的存在性校准。 */
  listDirNames?: (path: string) => Promise<ReadonlySet<string>>;
  /** 从某个事件序号分支出新会话并打开它。 */
  fork?: (atSeq: number) => Promise<void>;
  /** 收尾正文的文件名链接解析器（ui-deliverables 提供）。 */
  fileMentions?: (turn: TurnLocation, seq: number) => MarkdownFileMentions | undefined;
```

- [ ] **Step 6: 更新 `src/client/index.tsx`**

在 import 区加 `import { createReaderHost, type HostServices, type ReaderHost } from './host.js';`。

在 `apply` 里 `const faces = …` 下面加：

```ts
  const hosts = new Map<SessionId, ReaderHost>();
  const optional = (name: string) => (ctx as unknown as { get(name: string): unknown }).get(name);
  const hostServices = (): HostServices => ({
    sidebarRight: optional('sidebarRight') as HostServices['sidebarRight'],
    uiConversation: optional('uiConversation') as HostServices['uiConversation'],
    uiWorkspace: optional('uiWorkspace') as HostServices['uiWorkspace'],
    chatFileMentions: optional('chatFileMentions') as HostServices['chatFileMentions'],
  });
```

把 `ctx.effect(() => () => { faces.clear(); });` 改为：

```ts
  ctx.effect(() => () => { for (const host of hosts.values()) host.dispose(); hosts.clear(); faces.clear(); });
```

在 `inject` 回调里，把原 `openFile` 箭头函数的函数体整体移进一个局部函数 `openWithSystem(path: string): Promise<void>`（内容不变：先试 `workspaces.openPath`，再试 `remote.session.openWorkspacePath`，都没有则抛错），然后在 `const face` 之前构造 host：

```ts
      const host = createReaderHost(sessionId, hostServices, {
        cwd: () => ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd,
        openWithSystem,
        readAttachment: async attachment => {
          const receipt = await session().readAttachment(attachment.attachmentId);
          if (!receipt.ok) throw new Error(receipt.error.message);
          return { data: Uint8Array.from(receipt.value.data), mediaType: receipt.value.attachment.mediaType };
        },
        fork: atSeq => ctx.sessions.fork({ sessionId, atSeq, increaseTitle: true }),
      });
      hosts.set(sessionId, host);
```

`face` 里：`loadImage: attachment => host.imageUrl(attachment)`、`openFile: path => host.openFile(path)`，并新增 `fork: atSeq => host.fork(atSeq)`、`fileMentions: (turn, seq) => host.fileMentions(turn, seq)`；删除原来的 `loadImage` 与 `openFile` 实现。

- [ ] **Step 7: 更新 `src/client/Blocks.tsx`**

1. 删除 `const IMAGE_TYPES = …` 一行（媒体类型检查已移到 host）。
2. 加 import：`import type { MarkdownFileMentions } from './markdown/render.js';`
3. `ImageBlock` 的加载 effect 整段替换为：

```ts
  useEffect(() => {
    if (!usable || reference === null) { setError(true); return; }
    let active = true;
    const timeout = setTimeout(() => { if (active) { setError(true); active = false; } }, 20000);
    setError(false); setDecoded(false); setUrl(null);
    void loadImage(reference).then(next => {
      if (!active) return;
      clearTimeout(timeout);
      setUrl(next);
    }).catch(() => { clearTimeout(timeout); if (active) setError(true); });
    return () => { active = false; clearTimeout(timeout); };
  }, [usable, reference, attempt, loadImage]);
```

（`const usable = reference !== null && typeof loadImage === 'function';` 与 `const [error, setError] = useState(!usable);` 两行保持原样，`user-content.test.ts` 的静态断言依赖它们。）

4. `ReadingMarkdown` 的参数加 `fileMentions?: MarkdownFileMentions`，并把它传给 `MotionMarkdown`：

```tsx
function ReadingMarkdown({ text, streaming, holdFormatting, startedAt, interrupted = false, liveText = false, kind = 'body', fileMentions }: { text: string; streaming: boolean; holdFormatting: boolean; kind?: 'body' | 'reasoning'; fileMentions?: MarkdownFileMentions } & TextPresentation) {
```

```tsx
    <MotionMarkdown text={presentation.text} streaming={effectiveMode} enabled={liveText && presentation.reveal && effectiveMode} revision={presentation.revision} fileMentions={fileMentions} />
```

5. `fallback` 增加最后一个参数 `fileMentions: MarkdownFileMentions | undefined`，`text` 分支改为：

```tsx
    case 'text': return source === 'user' ? <UserText text={block.text} /> : <ReadingMarkdown text={block.text} streaming={streaming} holdFormatting={holdFormatting} fileMentions={fileMentions} {...presentation} />;
```

6. `Blocks` 的 props 加 `fileMentions?: MarkdownFileMentions`，调用 `fallback(…, { startedAt, interrupted, liveText }, fileMentions)`。

- [ ] **Step 8: 更新 `src/client/word-motion.tsx`**

加 import：`import type { MarkdownFileMentions } from './markdown/render.js';`，`MotionMarkdown` 改为：

```tsx
export function MotionMarkdown({ text, streaming, enabled, revision, fileMentions }: { text: string; streaming: boolean; enabled: boolean; revision: number; fileMentions?: MarkdownFileMentions }) {
```

并在渲染处把 `fileMentions={fileMentions}` 传给 `<MarkdownText … />`。

- [ ] **Step 9: 运行测试与类型检查**

Run: `npm test`
Expected: 全部通过（含 `host.test.ts` 5 条、`blocks-file-mentions.test.ts` 1 条）。

Run: `npm run typecheck`
Expected: 0 错误。若 `ctx.sessions.fork` 的返回类型报 `SessionId` 不能赋给 `string`，把 `fork` 回调写成 `atSeq => ctx.sessions.fork({ … }).then(id => String(id))`。

- [ ] **Step 10: 提交**

```bash
git add -A
git commit -m "feat: route files, images, forks and file mentions through optional host services

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 6: `process-steps.ts`：轮次布局、步骤分组、计数与状态

**Files:**
- Create: `tests/support/chat-fixture.ts`
- Create: `src/client/process-steps.ts`
- Create: `tests/process-steps.test.ts`

**Interfaces:**
- Consumes: `assistantSegments`、`hasVisibleBody`、`TurnBoundary`（`projection.ts`）；`activityPhase`、`activitySummary`、`preparingLabel`、`ReaderFlowEntry`、`ToolActivityEntry`、`ToolCategory`（`tool-activity.ts`）。
- Produces:
  - `type PanelItem = { kind: 'reasoning'|'narration'; key; nodeKey; start: number; step: number|null } | { kind: 'tool'; key; entry: ToolActivityEntry; step } | { kind: 'record'|'input'; key; nodeKey; step }`
  - `layoutTurn(flow, get, boundary): TurnLayout`，`TurnLayout = { panel: PanelItem[]; answer: AnswerSegment[]; notices: string[]; media: ToolActivityEntry[] }`，`AnswerSegment = { key; nodeKey; start }`
  - `groupSteps(items, { condense, isActive? }): StepLayout`，`StepLayout = { earlier: { steps: number; summary: string } | null; groups: StepGroup[] }`，`StepGroup = { key; label; entries: PanelEntry[] }`，`PanelEntry = { kind: 'item'; item } | { kind: 'fold'; key; items }`
  - `categorySummary(items): string`、`panelCounts(items, get, turnClosed): PanelCounts`（`{ steps; tools; failed }`）
  - `type PanelStatus = 'running'|'waiting'|'done'|'interrupted'|'error'|'unknown'`、`panelStatus(boundary, pendingCount)`、`statusLabel(status, reason, running)`、`elapsedLabel(turn, now, status)`、`runningLabel(turn, keys, get)`
  - 测试夹具：`turnLocation(spec)`、`chatNode(kind, data, turn, step?)`、`assistantNode(turn, step, blocks, status?)`、`settledTool(callId, name, args, over?)`、`toolEntry(callId, step, block?, draft?)`、`nodeEntry(node)`、`text(t)`、`reasoning(t)`、`toolCall(callId, name, args?)`、`chatOf(nodes, turns)`

- [ ] **Step 1: 写测试夹具 `tests/support/chat-fixture.ts`**

```ts
// Pure data builders for chat snapshots; no React, no host modules.
import type { ChatConversationViewNode, ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client';
import type { TurnLocation } from '@deepseek-ai/dsh-client-ui-conversation/client';
import type { ReaderFlowEntry, ToolActivityEntry } from '../../src/client/tool-activity.ts';

export interface TurnSpec {
  turn?: number;
  status?: 'open' | 'closed' | 'unknown';
  reason?: string;
  start?: number;
  end?: number;
  steps?: number[];
  closingStep?: number;
  closingSeq?: number;
  data?: Record<string, unknown>;
}

export function turnLocation(spec: TurnSpec = {}): TurnLocation {
  const turn = spec.turn ?? 1;
  const status = spec.status ?? 'closed';
  const data: Record<string, unknown> = { ...(spec.data ?? {}) };
  if (spec.closingStep !== undefined) {
    data['turn-tail'] ??= { turn, seq: 1000, time: spec.end ?? 0, closing: { step: spec.closingStep, time: spec.end ?? 0, finalNode: { seq: spec.closingSeq ?? 900 } }, branchUnavailable: false };
  }
  return {
    turn,
    status,
    start: spec.start === undefined ? undefined : { seq: 1, time: spec.start },
    end: status === 'closed' ? { seq: 1000, time: spec.end ?? 0, data: { reason: { kind: spec.reason ?? 'completed' } } } : undefined,
    steps: (spec.steps ?? []).map(step => ({ turn, step, start: { seq: step * 10, time: step * 1000 }, end: undefined, status: 'closed', data: new Map() })),
    data: new Map(Object.entries(data)),
  } as unknown as TurnLocation;
}

let seq = 0;
export function chatNode(kind: string, data: unknown, turn: TurnLocation, step?: number, extra: Record<string, unknown> = {}): ChatConversationViewNode {
  const anchorSeq = ++seq * 10;
  const location = step === undefined
    ? { kind: 'turn', turn }
    : { kind: 'step', turn, step: { turn: turn.turn, step, start: undefined, end: undefined, status: 'closed', data: new Map() } };
  return { key: `${kind}:${anchorSeq}`, target: 'chat', kind, data, anchorSeq, location, visibility: 'visible', ...extra } as unknown as ChatConversationViewNode;
}

export const text = (value: string) => ({ kind: 'text' as const, text: value });
export const reasoning = (value: string) => ({ kind: 'reasoning' as const, text: value });
export const toolCall = (callId: string, name: string, args: Record<string, unknown> = {}) => ({ kind: 'tool-call' as const, callId, name, argsRaw: JSON.stringify(args) });

export function assistantNode(turn: TurnLocation, step: number, blocks: readonly unknown[], status: 'running' | 'settled' | 'interrupted' = 'settled'): ChatConversationViewNode {
  return chatNode('assistant-step', { status, turn: turn.turn, step, blocks, time: step * 1000 }, turn, step);
}

export function settledTool(callId: string, name: string, args: Record<string, unknown>, over: Record<string, unknown> = {}) {
  return { kind: 'tool-result', seq: 0, time: 2500, callTime: 1000, callId, call: { name, argsRaw: JSON.stringify(args) }, content: [{ type: 'text', text: 'ok' }], isError: false, meta: {}, subCalls: [], ...over };
}

export function toolEntry(callId: string, step: number, block?: unknown, draft?: unknown): ToolActivityEntry {
  return { kind: 'tool', key: `reader-tool:${callId}`, callId, step, order: step * 10 + 5, block, draft } as unknown as ToolActivityEntry;
}

export function nodeEntry(node: ChatConversationViewNode): ReaderFlowEntry {
  return { kind: 'node', key: node.key, nodeKey: node.key, order: node.anchorSeq };
}

export function chatOf(nodes: readonly ChatConversationViewNode[], turns: readonly TurnLocation[]): ChatSnapshot {
  const byKey = new Map(nodes.map(node => [node.key, node]));
  return {
    order: nodes.map(node => node.key),
    nodes: { get: (key: string) => byKey.get(key), values: () => [...byKey.values()] },
    timeline: { turnOrder: turns.map(turn => turn.turn), turns: new Map(turns.map(turn => [turn.turn, turn])) },
  } as unknown as ChatSnapshot;
}
```

- [ ] **Step 2: 写失败测试 `tests/process-steps.test.ts`**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boundaryOf } from '../src/client/projection.ts';
import {
  categorySummary, elapsedLabel, groupSteps, layoutTurn, panelCounts, panelStatus, runningLabel, statusLabel, type PanelItem,
} from '../src/client/process-steps.ts';
import { assistantNode, chatNode, nodeEntry, reasoning, settledTool, text, toolCall, toolEntry, turnLocation } from './support/chat-fixture.ts';

function getter(...nodes: ReturnType<typeof chatNode>[]) {
  const map = new Map(nodes.map(node => [node.key, node]));
  return (key: string) => map.get(key);
}
const kinds = (items: readonly PanelItem[]) => items.map(item => item.kind);

test('a completed turn keeps earlier narration in the panel and the closing step as the answer', () => {
  const turn = turnLocation({ status: 'closed', reason: 'completed', steps: [1, 2], closingStep: 2 });
  const first = assistantNode(turn, 1, [reasoning('先看工作区'), text('我先检查一下。'), toolCall('c1', 'bash', { command: 'ls' })]);
  const second = assistantNode(turn, 2, [reasoning('可以收尾'), text('## 结论')]);
  const layout = layoutTurn([nodeEntry(first), toolEntry('c1', 1, settledTool('c1', 'bash', { command: 'ls' })), nodeEntry(second)], getter(first, second), boundaryOf(turn));
  assert.deepEqual(kinds(layout.panel), ['reasoning', 'narration', 'tool', 'reasoning']);
  assert.deepEqual(layout.answer.map(segment => segment.nodeKey), [second.key]);
});

test('a running turn shows trailing text as the tentative answer and earlier text as narration', () => {
  const turn = turnLocation({ status: 'open', steps: [1, 2] });
  const first = assistantNode(turn, 1, [text('先检查'), toolCall('c1', 'bash')]);
  const second = assistantNode(turn, 2, [text('结论正在生成')], 'running');
  const layout = layoutTurn([nodeEntry(first), toolEntry('c1', 1), nodeEntry(second)], getter(first, second), boundaryOf(turn));
  assert.deepEqual(kinds(layout.panel), ['narration', 'tool']);
  assert.deepEqual(layout.answer.map(segment => segment.nodeKey), [second.key]);
});

test('a turn interrupted on a tool call has no answer and keeps its text as narration', () => {
  const turn = turnLocation({ status: 'closed', reason: 'aborted', steps: [1] });
  const only = assistantNode(turn, 1, [text('准备写文件'), toolCall('c1', 'write')], 'interrupted');
  const layout = layoutTurn([nodeEntry(only), toolEntry('c1', 1)], getter(only), boundaryOf(turn));
  assert.deepEqual(kinds(layout.panel), ['narration', 'tool']);
  assert.deepEqual(layout.answer, []);
});

test('notices, inputs, records and hidden or structural nodes are routed by kind', () => {
  const turn = turnLocation({ status: 'closed', reason: 'error', steps: [1] });
  const context = chatNode('context', { content: [] }, turn);
  const steering = chatNode('steering', { content: [] }, turn, 1);
  const error = chatNode('turn-error', { message: 'boom' }, turn);
  const tail = chatNode('turn-tail', {}, turn);
  const hidden = chatNode('command', {}, turn, 1, { visibility: 'hidden' });
  const plan = chatNode('submitted-plan', { title: '计划', markdown: '# 计划' }, turn, 1);
  const layout = layoutTurn([context, steering, error, tail, hidden, plan].map(nodeEntry), getter(context, steering, error, tail, hidden, plan), boundaryOf(turn));
  assert.deepEqual(kinds(layout.panel), ['record', 'input', 'record']);
  assert.deepEqual(layout.notices, [error.key]);
});

test('tools whose results carry images are also listed as media', () => {
  const turn = turnLocation({ status: 'closed', reason: 'completed', steps: [1], closingStep: 1 });
  const image = settledTool('c1', 'screenshot', {}, { content: [{ type: 'image', attachment: { attachmentId: 'a1' } }] });
  const layout = layoutTurn([toolEntry('c1', 1, image)], getter(), boundaryOf(turn));
  assert.equal(layout.media.length, 1);
  assert.equal(layout.panel.length, 1);
});

test('a media-bearing body before the closing step stays visible as answer', () => {
  const turn = turnLocation({ status: 'closed', reason: 'completed', steps: [1, 2], closingStep: 2 });
  const first = assistantNode(turn, 1, [{ kind: 'image', attachment: { attachmentId: 'a1' } }]);
  const second = assistantNode(turn, 2, [text('完成')]);
  const layout = layoutTurn([nodeEntry(first), nodeEntry(second)], getter(first, second), boundaryOf(turn));
  assert.deepEqual(layout.answer.map(segment => segment.nodeKey), [first.key, second.key]);
});

function tool(callId: string, step: number, name = 'bash'): PanelItem {
  return { kind: 'tool', key: `reader-tool:${callId}`, entry: toolEntry(callId, step, undefined, toolCall(callId, name)), step };
}
function think(step: number): PanelItem {
  return { kind: 'reasoning', key: `r:${step}`, nodeKey: `n:${step}`, start: 0, step };
}

test('steps with a single tool row merge into one range label', () => {
  const layout = groupSteps([think(1), tool('a', 1), tool('b', 2), tool('c', 3), tool('d', 4), think(5), tool('e', 5)], { condense: false });
  assert.deepEqual(layout.groups.map(group => group.label), ['步骤 1', '步骤 2–4', '步骤 5']);
  assert.equal(layout.earlier, null);
});

test('condensing keeps only the latest step group and summarizes the rest', () => {
  const items = [think(1), tool('a', 1, 'read'), tool('b', 1, 'read'), think(2), tool('c', 2, 'bash'), think(3), tool('d', 3, 'write')];
  const layout = groupSteps(items, { condense: true });
  assert.deepEqual(layout.groups.map(group => group.label), ['步骤 3']);
  assert.deepEqual(layout.earlier, { steps: 2, summary: '读取 2 个文件 · 运行 1 条命令' });
  assert.equal(groupSteps(items.slice(0, 3), { condense: true }).earlier, null);
});

test('six or more consecutive tools fold all but the last three, keeping active calls visible', () => {
  const items = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(id => tool(id, 1));
  const [group] = groupSteps(items, { condense: false }).groups;
  assert.equal(group!.entries[0]!.kind, 'fold');
  assert.equal((group!.entries[0] as { items: PanelItem[] }).items.length, 4);
  assert.equal(group!.entries.length, 4);
  const withActive = groupSteps(items, { condense: false, isActive: item => item.key === 'reader-tool:b' }).groups[0]!;
  assert.equal((withActive.entries[0] as { items: PanelItem[] }).items.length, 3);
  assert.equal(withActive.entries.length, 5);
});

test('items without a step join the nearest step instead of creating their own group', () => {
  const record: PanelItem = { kind: 'record', key: 'ctx', nodeKey: 'ctx', step: null };
  const layout = groupSteps([record, think(1), tool('a', 1)], { condense: false });
  assert.deepEqual(layout.groups.map(group => group.label), ['步骤 1']);
});

test('category summary uses a fixed order and the first three non-zero counts', () => {
  const items = [tool('a', 1, 'web_search'), tool('b', 1, 'grep'), tool('c', 1, 'write'), tool('d', 1, 'bash'), tool('e', 1, 'read'), tool('f', 1, 'skill')];
  assert.equal(categorySummary(items), '读取 1 个文件 · 运行 1 条命令 · 写入 1 个文件');
  assert.equal(categorySummary([think(1)]), '');
});

test('panel counts distinct steps, tools and failures', () => {
  const turn = turnLocation({ steps: [1, 2] });
  const failedCommand = chatNode('command', { outcome: { kind: 'error' } }, turn, 2);
  const items: PanelItem[] = [
    think(1),
    { kind: 'tool', key: 't1', entry: toolEntry('t1', 1, settledTool('t1', 'bash', {}, { isError: true })), step: 1 },
    { kind: 'tool', key: 't2', entry: toolEntry('t2', 2, settledTool('t2', 'read', {})), step: 2 },
    { kind: 'record', key: failedCommand.key, nodeKey: failedCommand.key, step: 2 },
    { kind: 'input', key: 'in', nodeKey: 'in', step: 3 },
  ];
  assert.deepEqual(panelCounts(items, getter(failedCommand), true), { steps: 2, tools: 2, failed: 2 });
});

test('panel status follows the turn boundary; an unresolved window stays neutral', () => {
  assert.equal(panelStatus(boundaryOf(turnLocation({ status: 'open' })), 0), 'running');
  assert.equal(panelStatus(boundaryOf(turnLocation({ status: 'open' })), 1), 'waiting');
  assert.equal(panelStatus(boundaryOf(turnLocation({ reason: 'completed' })), 0), 'done');
  assert.equal(panelStatus(boundaryOf(turnLocation({ reason: 'aborted' })), 0), 'interrupted');
  assert.equal(panelStatus(boundaryOf(turnLocation({ reason: 'max-tokens' })), 0), 'error');
  assert.equal(panelStatus(boundaryOf(undefined), 0), 'unknown');
  assert.equal(statusLabel('unknown', null, ''), '执行过程');
  assert.equal(statusLabel('error', 'max-tokens', ''), '已到输出上限');
  assert.equal(statusLabel('running', null, '正在思考'), '正在思考');
});

test('elapsed label ticks while running and reads 用时 once finished', () => {
  const running = turnLocation({ status: 'open', start: 0 });
  assert.equal(elapsedLabel(running, 134_000, 'running'), '2 分 14 秒');
  const done = turnLocation({ status: 'closed', start: 0, end: 999_000 });
  assert.equal(elapsedLabel(done, 5_000_000, 'done'), '用时 16 分 39 秒');
  assert.equal(elapsedLabel(turnLocation({ status: 'open' }), 1000, 'running'), null);
});

test('running label names the current activity', () => {
  const turn = turnLocation({ status: 'open', steps: [1] });
  (turn.steps[0]!.data as unknown as Map<string, unknown>).set('assistant-step', { status: 'running', blocks: [toolCall('c1', 'bash')] });
  assert.equal(runningLabel(turn, [], () => undefined), '正在准备命令');
  const thinking = turnLocation({ status: 'open', steps: [1] });
  const node = assistantNode(thinking, 1, [reasoning('…')], 'running');
  assert.equal(runningLabel(thinking, [node.key], getter(node)), '正在思考');
  const waitingTool = chatNode('tool-call', { root: { callId: 'c2', name: 'bash', phase: 'start', argsRaw: '{}', subCalls: [] } }, thinking, 1);
  assert.equal(runningLabel(thinking, [node.key, waitingTool.key], getter(node, waitingTool)), '正在使用工具');
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npm test`
Expected: `process-steps.test.ts` 失败（模块不存在）。

- [ ] **Step 4: 实现 `src/client/process-steps.ts`**

```ts
import type { AssistantChatData, ChatConversationViewNode, ToolChatData } from '@deepseek-ai/dsh-client-ui-chat/client';
import type { TurnLocation } from '@deepseek-ai/dsh-client-ui-conversation/client';
import { assistantSegments, hasVisibleBody, type TurnBoundary } from './projection.js';
import { activityPhase, activitySummary, preparingLabel, type ReaderFlowEntry, type ToolActivityEntry, type ToolCategory } from './tool-activity.js';

/** One chronological row of a turn's process panel. */
export type PanelItem =
  | { kind: 'reasoning' | 'narration'; key: string; nodeKey: string; start: number; step: number | null }
  | { kind: 'tool'; key: string; entry: ToolActivityEntry; step: number | null }
  | { kind: 'record' | 'input'; key: string; nodeKey: string; step: number | null };

export interface AnswerSegment { key: string; nodeKey: string; start: number }
export interface TurnLayout { panel: PanelItem[]; answer: AnswerSegment[]; notices: string[]; media: ToolActivityEntry[] }

type Getter = (key: string) => ChatConversationViewNode | undefined;

const NOTICE_KINDS = new Set(['turn-error', 'turn-max-tokens']);
const SKIPPED_KINDS = new Set(['turn-process', 'turn-tail', 'tool-call']);
const INPUT_KINDS = new Set(['user', 'steering', 'command-input']);
const PROCESS_KINDS = new Set<PanelItem['kind']>(['reasoning', 'tool', 'record']);

function stepOf(node: ChatConversationViewNode): number | null {
  return node.location.kind === 'step' ? node.location.step.step : null;
}

function carriesMedia(block: ToolActivityEntry['block']): boolean {
  if (!block || !('kind' in block)) return false;
  return block.content.some(item => item.type !== 'text') || block.subCalls.some(child => carriesMedia(child));
}

/**
 * Route one turn's flow into the process panel, the answer zone, turn-level
 * notices and tool media. A completed turn answers with its closing step (and
 * keeps media bodies visible); any other turn treats body text as the answer
 * only while no process row follows it.
 */
export function layoutTurn(flow: readonly ReaderFlowEntry[], get: Getter, boundary: TurnBoundary): TurnLayout {
  const panel: PanelItem[] = [];
  const notices: string[] = [];
  const media: ToolActivityEntry[] = [];
  const bodies: { item: PanelItem & { kind: 'narration' }; position: number; media: boolean }[] = [];
  for (const entry of flow) {
    if (entry.kind === 'tool') {
      panel.push({ kind: 'tool', key: entry.key, entry, step: entry.step > 0 ? entry.step : null });
      if (carriesMedia(entry.block)) media.push(entry);
      continue;
    }
    const node = get(entry.nodeKey);
    if (!node || node.visibility === 'hidden' || SKIPPED_KINDS.has(node.kind)) continue;
    if (NOTICE_KINDS.has(node.kind)) { notices.push(entry.nodeKey); continue; }
    const step = stepOf(node);
    if (node.kind === 'assistant-step') {
      for (const segment of assistantSegments((node.data as AssistantChatData).blocks)) {
        const key = `${entry.nodeKey}:${segment.start}`;
        if (segment.kind === 'reasoning') {
          if (segment.blocks.some(block => block.kind === 'reasoning' && block.text.trim() !== '')) {
            panel.push({ kind: 'reasoning', key, nodeKey: entry.nodeKey, start: segment.start, step });
          }
          continue;
        }
        if (!hasVisibleBody(segment.blocks)) continue;
        const item = { kind: 'narration' as const, key, nodeKey: entry.nodeKey, start: segment.start, step };
        bodies.push({ item, position: panel.length, media: segment.blocks.some(block => block.kind === 'image' || block.kind === 'other') });
        panel.push(item);
      }
      continue;
    }
    panel.push({ kind: INPUT_KINDS.has(node.kind) ? 'input' : 'record', key: entry.key, nodeKey: entry.nodeKey, step });
  }
  const completed = boundary.status === 'closed' && boundary.reason === 'completed' && boundary.closingStep !== null;
  const answerKeys = new Set<string>();
  for (const body of bodies) {
    const isAnswer = completed
      ? body.media || (body.item.step !== null && body.item.step >= boundary.closingStep!)
      : !panel.slice(body.position + 1).some(item => PROCESS_KINDS.has(item.kind));
    if (isAnswer) answerKeys.add(body.item.key);
  }
  return {
    panel: panel.filter(item => !answerKeys.has(item.key)),
    answer: bodies.filter(body => answerKeys.has(body.item.key)).map(({ item }) => ({ key: item.key, nodeKey: item.nodeKey, start: item.start })),
    notices,
    media,
  };
}

export type PanelEntry = { kind: 'item'; item: PanelItem } | { kind: 'fold'; key: string; items: PanelItem[] };
export interface StepGroup { key: string; label: string; entries: PanelEntry[] }
export interface StepLayout { earlier: { steps: number; summary: string } | null; groups: StepGroup[] }

const FOLD_MIN = 6;
const FOLD_KEEP = 3;

export function stepLabel(first: number, last: number): string {
  return first === last ? `步骤 ${first}` : `步骤 ${first}–${last}`;
}

/** Step-less rows (turn-level context, records) join the nearest known step. */
function effectiveSteps(items: readonly PanelItem[]): number[] {
  const result: number[] = [];
  let previous: number | null = null;
  for (let index = 0; index < items.length; index++) {
    const own = items[index]!.step;
    if (own !== null) previous = own;
    let next: number | null = null;
    if (own === null && previous === null) {
      for (let ahead = index + 1; ahead < items.length && next === null; ahead++) next = items[ahead]!.step;
    }
    result.push(own ?? previous ?? next ?? 0);
  }
  return result;
}

function foldEntries(items: readonly PanelItem[], isActive: (item: PanelItem) => boolean): PanelEntry[] {
  const entries: PanelEntry[] = [];
  let run: PanelItem[] = [];
  const flush = () => {
    if (run.length >= FOLD_MIN) {
      const head = run.slice(0, run.length - FOLD_KEEP);
      const folded = head.filter(item => !isActive(item));
      if (folded.length > 0) entries.push({ kind: 'fold', key: `fold:${folded[0]!.key}`, items: folded });
      for (const item of head) if (isActive(item)) entries.push({ kind: 'item', item });
      for (const item of run.slice(run.length - FOLD_KEEP)) entries.push({ kind: 'item', item });
    } else {
      for (const item of run) entries.push({ kind: 'item', item });
    }
    run = [];
  };
  for (const item of items) {
    if (item.kind === 'tool') { run.push(item); continue; }
    flush();
    entries.push({ kind: 'item', item });
  }
  flush();
  return entries;
}

export function groupSteps(items: readonly PanelItem[], options: { condense: boolean; isActive?: (item: PanelItem) => boolean }): StepLayout {
  const isActive = options.isActive ?? (() => false);
  const steps = effectiveSteps(items);
  const runs: { step: number; items: PanelItem[] }[] = [];
  items.forEach((item, index) => {
    const step = steps[index]!;
    const last = runs.at(-1);
    if (last && last.step === step) last.items.push(item);
    else runs.push({ step, items: [item] });
  });
  const ranges: { first: number; last: number; items: PanelItem[] }[] = [];
  let pending: { first: number; last: number; items: PanelItem[] } | null = null;
  for (const run of runs) {
    const trivial = run.items.length === 1 && run.items[0]!.kind === 'tool';
    if (trivial) {
      if (pending) { pending.last = run.step; pending.items.push(...run.items); }
      else pending = { first: run.step, last: run.step, items: [...run.items] };
      continue;
    }
    if (pending) { ranges.push(pending); pending = null; }
    ranges.push({ first: run.step, last: run.step, items: run.items });
  }
  if (pending) ranges.push(pending);
  const stepOfItem = new Map(items.map((item, index) => [item, steps[index]!]));
  const groups = ranges.map(range => ({
    key: `step:${range.first}:${range.items[0]!.key}`,
    label: stepLabel(range.first, range.last),
    entries: foldEntries(range.items, isActive),
    steps: new Set(range.items.map(item => stepOfItem.get(item)!)).size,
    items: range.items,
  }));
  const strip = ({ key, label, entries }: (typeof groups)[number]): StepGroup => ({ key, label, entries });
  if (!options.condense || groups.length < 2) return { earlier: null, groups: groups.map(strip) };
  const earlier = groups.slice(0, -1);
  return {
    earlier: { steps: earlier.reduce((sum, group) => sum + group.steps, 0), summary: categorySummary(earlier.flatMap(group => group.items)) },
    groups: [strip(groups.at(-1)!)],
  };
}

const CATEGORY_LABELS: [ToolCategory, (count: number) => string][] = [
  ['read', count => `读取 ${count} 个文件`],
  ['terminal', count => `运行 ${count} 条命令`],
  ['write', count => `写入 ${count} 个文件`],
  ['search', count => `搜索 ${count} 次`],
  ['web', count => `联网 ${count} 次`],
  ['other', count => `${count} 次其他工具`],
];

export function categorySummary(items: readonly PanelItem[]): string {
  const counts = new Map<ToolCategory, number>();
  for (const item of items) {
    if (item.kind !== 'tool') continue;
    const category = activitySummary(item.entry).category;
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  return CATEGORY_LABELS.filter(([category]) => (counts.get(category) ?? 0) > 0).slice(0, 3)
    .map(([category, label]) => label(counts.get(category)!)).join(' · ');
}

export interface PanelCounts { steps: number; tools: number; failed: number }

function recordFailed(node: ChatConversationViewNode | undefined): boolean {
  if (!node) return false;
  const data = node.data as { outcome?: { kind?: string } | null; command?: { outcome?: { kind?: string } | null } };
  if (node.kind === 'command') return data.outcome?.kind === 'error';
  if (node.kind === 'manual-compaction') return data.command?.outcome?.kind === 'error';
  return false;
}

export function panelCounts(items: readonly PanelItem[], get: Getter, turnClosed: boolean): PanelCounts {
  const steps = new Set<number>();
  let tools = 0;
  let failed = 0;
  for (const item of items) {
    if (item.step !== null && item.kind !== 'input') steps.add(item.step);
    if (item.kind === 'tool') {
      tools++;
      if (activityPhase(item.entry, turnClosed) === 'failed') failed++;
    } else if (item.kind === 'record' && recordFailed(get(item.nodeKey))) failed++;
  }
  return { steps: steps.size, tools, failed };
}

export type PanelStatus = 'running' | 'waiting' | 'done' | 'interrupted' | 'error' | 'unknown';

export function panelStatus(boundary: TurnBoundary, pendingCount: number): PanelStatus {
  if (boundary.status === 'open') return pendingCount > 0 ? 'waiting' : 'running';
  if (boundary.status !== 'closed') return 'unknown';
  if (boundary.reason === 'completed') return 'done';
  if (boundary.reason === 'aborted' || boundary.reason === 'interrupted') return 'interrupted';
  return 'error';
}

export function statusLabel(status: PanelStatus, reason: string | null, running: string): string {
  switch (status) {
    case 'running': return running;
    case 'waiting': return '等待你的操作';
    case 'done': return '已完成';
    case 'interrupted': return '已中断';
    case 'error': return reason === 'max-tokens' ? '已到输出上限' : reason === 'blocked' ? '需要处理' : '出错';
    case 'unknown': return '执行过程';
  }
}

export function elapsedLabel(turn: TurnLocation | undefined, now: number, status: PanelStatus): string | null {
  const start = turn?.start?.time;
  if (typeof start !== 'number') return null;
  const live = status === 'running' || status === 'waiting';
  const end = live ? now : turn?.end?.time;
  if (typeof end !== 'number' || end < start) return null;
  const seconds = Math.round((end - start) / 1000);
  const value = seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
  return live ? value : `用时 ${value}`;
}

/** The live activity of an open turn, phrased like the native running status. */
export function runningLabel(turn: TurnLocation | undefined, keys: readonly string[], get: Getter): string {
  const current = turn?.steps.at(-1)?.data.get('assistant-step') as AssistantChatData | undefined;
  const last = current?.blocks.at(-1);
  if (current?.status === 'running' && last?.kind === 'tool-call') return preparingLabel(last.name);
  for (let index = keys.length - 1; index >= 0; index--) {
    const node = get(keys[index]!);
    if (!node) continue;
    if (node.kind === 'tool-call' && !('kind' in (node.data as ToolChatData).root)) return '正在使用工具';
    if (node.kind === 'assistant-step' && (node.data as AssistantChatData).status === 'running') {
      const tail = (node.data as AssistantChatData).blocks.at(-1);
      return tail?.kind === 'reasoning' ? '正在思考' : tail?.kind === 'text' ? '正在输出' : '正在准备回复';
    }
  }
  return '正在处理';
}
```

- [ ] **Step 5: 运行测试与类型检查**

Run: `npm test`
Expected: 全部通过，`process-steps.test.ts` 共 15 条。

Run: `npm run typecheck`
Expected: 0 错误。

- [ ] **Step 6: 提交**

```bash
git add -A
git commit -m "feat: model turn layout, step groups, counts and panel status

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: 动效参数、动作上下文与根节点排版

**Files:**
- Create: `src/client/motion-tokens.ts`、`src/client/reader-context.ts`
- Create: `tests/motion-tokens.test.ts`
- Modify: `src/client/motion.tsx`（缓动与时长、`StatusText`）
- Modify: `src/client/Reader.module.css`（`.root`、`.statusText`、`.think` 系列）

（`compat/styles.ts` 不改：0.1.18 已决定重负载只做离屏优化、不降级扫光与模糊，这里只加测试守住它。）

**Interfaces:**
- Produces:
  - `MOTION = { ease: 'cubic-bezier(.2,.8,.2,1)', fast: 100, swap: 200, size: 260, swapDistance: 4, swapBlur: 1, swapGap: 50 }`
  - `ReaderActions = { motion: boolean; openFile?: (path: string) => void; fork?: (atSeq: number) => Promise<void>; fileMentions?: (turn, seq) => MarkdownFileMentions | undefined; inspectCall?: (callId: string) => void; showInChat?: (focus: string) => void }`、`ReaderActionsContext`、`useReaderActions()`
  - `StatusText` 新增可选 `className`；激活时用原生 `TextShimmer` 包住当前文字
  - 根节点 CSS 变量：`--cv-ease`、`--cv-fast`、`--cv-swap`、`--cv-size`、`--cv-row-height`、`--cv-font-body`、`--cv-line-body`、`--cv-font-secondary`、`--cv-panel-bg`、`--cv-panel-ring`、`--cv-inset-bg`

- [ ] **Step 1: 写失败测试 `tests/motion-tokens.test.ts`**

```ts
import './support/dom.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MOTION } from '../src/client/motion-tokens.ts';
import { COMPAT_CSS } from '../src/client/compat/styles.ts';
import { StatusText } from '../src/client/motion.tsx';
import { render } from './support/render.ts';

const readerCss = readFileSync(new URL('../src/client/Reader.module.css', import.meta.url), 'utf8');

test('motion tokens follow the spec', () => {
  assert.deepEqual(MOTION, { ease: 'cubic-bezier(.2,.8,.2,1)', fast: 100, swap: 200, size: 260, swapDistance: 4, swapBlur: 1, swapGap: 50 });
});

test('the root mirrors the motion tokens and follows the host font size', () => {
  assert.match(readerCss, /--cv-ease: cubic-bezier\(\.2,\.8,\.2,1\);/);
  assert.match(readerCss, /--cv-fast: 100ms;/);
  assert.match(readerCss, /--cv-swap: 200ms;/);
  assert.match(readerCss, /--cv-size: 260ms;/);
  assert.match(readerCss, /--cv-font-body: var\(--dsh-content-font-size, 14px\);/);
  assert.match(readerCss, /--think-distance: 4px;/);
  assert.doesNotMatch(readerCss, /@keyframes thinkShimmer/);
});

test('heavy mode only optimizes off-screen layout and never degrades visible motion', () => {
  assert.match(COMPAT_CSS, /\[data-dshcp-heavy="on"\] section\[data-reader-turn\]/);
  assert.doesNotMatch(COMPAT_CSS, /\[data-dshcp-heavy="on"\][^{]*(data-reader-word|data-reader-atom|data-shimmer|data-reader-shimmer)/);
});

test('status text uses the native shimmer only while busy', () => {
  assert.match(render(StatusText, { text: '正在思考', motion: true, shimmer: true, className: 'x' }), /data-stub="TextShimmer" data-active="true"/);
  assert.doesNotMatch(render(StatusText, { text: '已完成', motion: true, shimmer: false }), /TextShimmer/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test`
Expected: `motion-tokens.test.ts` 失败（模块不存在）。

- [ ] **Step 3: 新建 `src/client/motion-tokens.ts` 与 `src/client/reader-context.ts`**

```ts
/** One source for reader motion; Reader.module.css mirrors these as --cv-* variables. */
export const MOTION = {
  ease: 'cubic-bezier(.2,.8,.2,1)',
  fast: 100,
  swap: 200,
  size: 260,
  swapDistance: 4,
  swapBlur: 1,
  swapGap: 50,
} as const;
```

```ts
import { createContext, useContext } from 'react';
import type { TurnLocation } from '@deepseek-ai/dsh-client-ui-conversation/client';
import type { MarkdownFileMentions } from './markdown/render.js';

/** Host actions and the motion switch, provided once by Reader for every row. */
export interface ReaderActions {
  motion: boolean;
  openFile?: (path: string) => void;
  fork?: (atSeq: number) => Promise<void>;
  fileMentions?: (turn: TurnLocation, seq: number) => MarkdownFileMentions | undefined;
  inspectCall?: (callId: string) => void;
  showInChat?: (focus: string) => void;
}

export const ReaderActionsContext = createContext<ReaderActions>({ motion: false });

export function useReaderActions(): ReaderActions {
  return useContext(ReaderActionsContext);
}
```

- [ ] **Step 4: 更新 `src/client/motion.tsx`**

1. import 区加：

```ts
import { TextShimmer } from '@deepseek-ai/dsh-client-ui-primitives';
import { MOTION } from './motion-tokens.js';
```

并把 `const EASING = 'cubic-bezier(.22,1,.36,1)';` 改为 `const EASING = MOTION.ease;`。
2. `ProcessFragment` 与 `CollapseBody` 里的 `{ duration: 260, easing: EASING, fill: 'both' }` 改为 `{ duration: MOTION.size, easing: EASING, fill: 'both' }`。
3. `RetiringContent` 里的 `{ duration: 220, easing: EASING, fill: 'both' }` 改为 `{ duration: MOTION.size, easing: EASING, fill: 'both' }`。
4. `MountFade` 里的 `setTimeout(() => setEntering(false), 240)` 改为 `setTimeout(() => setEntering(false), MOTION.swap + 40)`。
5. `StatusText` 签名改为 `export function StatusText({ text, motion, shimmer = false, className }: { text: string; motion: boolean; shimmer?: boolean; className?: string })`；`timer = window.setTimeout(settle, 200); // 150ms swap + 50ms incoming gap.` 改为 `timer = window.setTimeout(settle, MOTION.swap + MOTION.swapGap);`；返回的外层 span 改为 `className={className ? \`${css.statusText} ${className}\` : css.statusText}`；当前文字副本改为：

```tsx
      <span key={frame.id} ref={ref} className={`${css.thinkText} ${swapping && frame.phase === 'start' ? css.isEnterStart : ''}`}
        data-reader-status-copy="current" data-text={text}>{active ? <TextShimmer active>{text}</TextShimmer> : text}</span>
```

（删除原来的 `data-reader-shimmer={active || undefined}`。）

- [ ] **Step 5: 更新 `src/client/Reader.module.css`**

把 `.root { … }` 整段替换为：

```css
.root {
  --cv-ease: cubic-bezier(.2,.8,.2,1);
  --cv-fast: 100ms;
  --cv-swap: 200ms;
  --cv-size: 260ms;
  --cv-row-height: calc(24px + var(--dsh-content-font-delta, 0px));
  --cv-font-body: var(--dsh-content-font-size, 14px);
  --cv-line-body: calc(24px + var(--dsh-content-font-delta, 0px));
  --cv-font-secondary: var(--dsh-content-font-size-secondary, 13px);
  --cv-panel-bg: color-mix(in srgb, var(--dsw-alias-bg-layer-1) 72%, transparent);
  --cv-panel-ring: 0 0 0 .5px var(--dsw-alias-border-l3);
  --cv-inset-bg: var(--dsw-alias-markdown-code-block);
  color: var(--dsw-alias-label-primary);
  font-family: inherit;
  font-size: var(--cv-font-body);
  line-height: var(--cv-line-body);
  min-width: 0;
  flex: 0 0 auto;
  overflow-anchor: auto;
  container-type: inline-size;
}
```

把 `.statusText { … }` 改为：

```css
.statusText { display: inline-flex; min-width: 0; max-width: 100%; font: inherit; color: inherit; }
```

把 `.think { … }` 里的变量改为：

```css
  --think-swap: 200ms;
  --think-gap: 50ms;
  --think-distance: 4px;
  --think-blur: 1px;
  --think-ease: cubic-bezier(.2,.8,.2,1);
```

删除 `@supports (background-clip: text) or (-webkit-background-clip: text) { .think[data-active=true] .thinkText::before { … } }` 整段、`@keyframes thinkShimmer { … }` 一行、`[data-motion=off] .thinkText::before { display: none !important; }` 一行，以及 `@media (prefers-reduced-motion: reduce), (forced-colors: active) { … }` 里的 `.thinkText::before { display: none !important; }` 一行。

- [ ] **Step 6: 运行测试与类型检查**

Run: `npm test`
Expected: 全部通过。

Run: `npm run typecheck`
Expected: 0 错误。

- [ ] **Step 7: 提交**

```bash
git add -A
git commit -m "feat: unify motion tokens, host typography and the native shimmer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 8: 统一行语法：`ProcessRow`、`ToolRow`、`ToolDetails`

**Files:**
- Create: `src/client/ProcessRow.tsx`、`src/client/ProcessRow.module.css`
- Create: `src/client/ToolRow.tsx`、`src/client/ToolRow.module.css`
- Create: `src/client/ToolDetails.tsx`、`src/client/ToolDetails.module.css`
- Create: `tests/tool-row.test.ts`

（旧的 `ToolActivity.tsx` 暂不删除，Task 11 接线后再删。）

**Interfaces:**
- Consumes: `useReaderActions()`（Task 7）；`activityPhase`、`activitySummary`、`executionFacts`、`exitCodeFromOutput`、`ToolActivityEntry`、`ToolPhase`、`ToolCategory`；`toolRowModel`、`classifyTool`、`VARIANT_TITLES`；`ProcessFragment`；`Blocks`、`contentBlocks`。
- Produces:
  - `ProcessRow.tsx`：`RowGlyph({ tone: 'idle'|'active'|'failed', icon })`、`RowSeparator()`、`Chevron({ open })`、`Inset({ children, tone?, className? })`（根元素带 `data-inset-tone`）、`errorExcerpt(text, lines = 3, chars = 300)`、`ErrorSummary({ text })`、`FoldRow({ count, open, onToggle })`
  - `ToolRow.tsx`：`ToolRow({ entry, turnClosed, onRead, depth?, renderSlotChain, loadImage })`（根元素 `data-reader-tool-call`、`data-tool-phase`、`data-tool-category`）、`ToolImages({ entries, renderSlotChain, loadImage })`、`toolEndLabel(phase, exitCode, elapsedMs)`、`formatDuration(ms)`
  - `ToolDetails.tsx`：`ToolDetails({ entry, model, phase, renderSlotChain, loadImage })`

- [ ] **Step 1: 写失败测试 `tests/tool-row.test.ts`**

```ts
import './support/dom.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReaderActionsContext, type ReaderActions } from '../src/client/reader-context.ts';
import { errorExcerpt } from '../src/client/ProcessRow.tsx';
import { ToolImages, ToolRow, toolEndLabel } from '../src/client/ToolRow.tsx';
import { settledTool, toolCall, toolEntry } from './support/chat-fixture.ts';

function renderIn<P extends object>(actions: ReaderActions, component: ComponentType<P>, props: P): string {
  const original = console.error;
  console.error = (...args: unknown[]) => { if (!String(args[0]).includes('useLayoutEffect')) original(...args); };
  try { return renderToStaticMarkup(createElement(ReaderActionsContext.Provider, { value: actions }, createElement(component, props))); } finally { console.error = original; }
}
const render = { renderSlotChain: ((_n: string, _o: unknown, options: { fallback: unknown }) => options.fallback) as never, loadImage: async () => 'blob:x' };

test('end labels name the phase, the exit code, or the elapsed time', () => {
  assert.equal(toolEndLabel('preparing', undefined, null), '生成输入');
  assert.equal(toolEndLabel('running', undefined, null), '执行中');
  assert.equal(toolEndLabel('failed', 2, 900), '退出码 2');
  assert.equal(toolEndLabel('failed', undefined, null), '失败');
  assert.equal(toolEndLabel('interrupted', undefined, null), '已中断');
  assert.equal(toolEndLabel('succeeded', 0, 1500), '1.5 秒');
  assert.equal(toolEndLabel('returned', undefined, 320), '320 毫秒');
  assert.equal(toolEndLabel('returned', undefined, null), '');
});

test('error excerpts keep the first non-empty lines and cap the length', () => {
  assert.equal(errorExcerpt('\nError: a\n\n  at x\n  at y\n  at z'), 'Error: a\n  at x\n  at y');
  assert.equal(errorExcerpt('x'.repeat(400)).length, 300);
});

test('a failed command shows a red dot, its exit code and an error summary', () => {
  const block = settledTool('c1', 'bash', { command: 'npm run build' }, { isError: true, content: [{ type: 'text', text: 'Error: exit code: 2\nmore' }] });
  const html = renderIn({ motion: true }, ToolRow, { entry: toolEntry('c1', 1, block), turnClosed: true, onRead: () => {}, ...render });
  assert.match(html, /data-tool-phase="failed"/);
  assert.match(html, /data-stub="StateDot" data-state="error"/);
  assert.match(html, /退出码 2/);
  assert.match(html, /data-inset-tone="error"[\s\S]*Error: exit code: 2/);
  assert.match(html, /npm run build/);
});

test('a preparing call spins and sweeps its summary only when motion is on', () => {
  const entry = toolEntry('c2', 1, undefined, toolCall('c2', 'bash', { command: 'ls' }));
  const on = renderIn({ motion: true }, ToolRow, { entry, turnClosed: false, onRead: () => {}, ...render });
  assert.match(on, /data-stub="StateDot" data-state="ongoing"/);
  assert.match(on, /data-stub="TextShimmer" data-active="true"/);
  const off = renderIn({ motion: false }, ToolRow, { entry, turnClosed: false, onRead: () => {}, ...render });
  assert.match(off, /data-stub="TextShimmer" data-active="false"/);
});

test('sub-calls render as nested tool rows', () => {
  const child = settledTool('c4', 'read', { path: 'a.ts' });
  const parent = settledTool('c3', 'code', {}, { subCalls: [child] });
  const html = renderIn({ motion: true }, ToolRow, { entry: toolEntry('c3', 1, parent), turnClosed: true, onRead: () => {}, ...render });
  assert.match(html, /data-reader-tool-call="c3"[\s\S]*data-reader-tool-call="c4"/);
});

test('tool images stay visible as media blocks', () => {
  const block = settledTool('c5', 'screenshot', {}, { content: [{ type: 'image', attachment: { attachmentId: 'a1', mediaType: 'image/png' } }] });
  const html = renderIn({ motion: true }, ToolImages, { entries: [toolEntry('c5', 1, block)], ...render });
  assert.match(html, /data-reader-tool-media/);
  assert.match(html, /data-reader-image/);
  assert.equal(renderIn({ motion: true }, ToolImages, { entries: [toolEntry('c6', 1, settledTool('c6', 'bash', {}))], ...render }), '');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test`
Expected: `tool-row.test.ts` 失败（模块不存在）。

- [ ] **Step 3: 实现 `src/client/ProcessRow.tsx` 与样式**

```tsx
import type { ReactNode } from 'react';
import { StateDot } from '@deepseek-ai/dsh-client-ui-primitives';
import css from './ProcessRow.module.css';

export type RowTone = 'idle' | 'active' | 'failed';

/** Leading glyph of a process row: its own icon, the native spinner while active, a red dot on failure. */
export function RowGlyph({ tone, icon }: { tone: RowTone; icon: ReactNode }) {
  if (tone === 'active') return <StateDot state="ongoing" size={12} />;
  if (tone === 'failed') return <StateDot state="error" />;
  return <>{icon}</>;
}

/** 2px dot between a row title and its summary; follows the shimmer highlight. */
export function RowSeparator() {
  return <span className={css.separator} aria-hidden="true" data-shimmer-decoration="" />;
}

export function Chevron({ open }: { open: boolean }) {
  return <svg className={css.chevron} data-open={open} viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="m6 4 4 4-4 4" /></svg>;
}

/** Recessed block under a row: thinking text, tool details, raw records, failure summaries. */
export function Inset({ children, tone = 'plain', className }: { children: ReactNode; tone?: 'plain' | 'error'; className?: string }) {
  const classes = [css.inset, tone === 'error' ? css.insetError : '', className ?? ''].filter(Boolean).join(' ');
  return <div className={classes} data-inset-tone={tone}>{children}</div>;
}

/** First non-empty lines of a failure, capped so a stack trace never floods the panel. */
export function errorExcerpt(text: string, lines = 3, chars = 300): string {
  const kept = text.split(/\r?\n/).map(line => line.trimEnd()).filter(line => line.trim() !== '').slice(0, lines).join('\n');
  return kept.length > chars ? `${kept.slice(0, chars - 1)}…` : kept;
}

export function ErrorSummary({ text }: { text: string }) {
  if (!text) return null;
  return <Inset tone="error"><pre className={css.errorText}>{text}</pre></Inset>;
}

/** A run of folded tool calls inside one step. */
export function FoldRow({ count, open, onToggle }: { count: number; open: boolean; onToggle: () => void }) {
  return <button type="button" className={css.fold} aria-expanded={open} onClick={onToggle} data-reader-fold>
    <span className={css.foldIcon}><Chevron open={open} /></span>
    <span>{open ? `收起 ${count} 次工具调用` : `+${count} 次工具调用`}</span>
  </button>;
}
```

`src/client/ProcessRow.module.css`：

```css
.separator { flex: none; width: 2px; height: 2px; margin: 0 8px; border-radius: 1px; background: var(--dsw-alias-label-caption); }
.chevron { flex: none; stroke: currentColor; fill: none; stroke-width: 1.4; stroke-linecap: round; stroke-linejoin: round; transition: transform var(--cv-size) var(--cv-ease); }
.chevron[data-open=true] { transform: rotate(90deg); }
.inset {
  margin: 2px 0 6px calc(22px + var(--dsh-content-font-delta, 0px));
  padding: 8px 12px;
  min-width: 0;
  border-radius: var(--dsw-radius-md);
  corner-shape: round;
  background: var(--cv-inset-bg);
  color: var(--dsw-alias-label-tertiary);
  font-size: var(--cv-font-secondary);
  line-height: 21px;
  overflow-wrap: anywhere;
}
.insetError { background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, var(--cv-inset-bg)); color: var(--dsw-alias-label-secondary); }
.errorText { margin: 0; font: 12px/18px var(--ds-font-family-code, ui-monospace, monospace); white-space: pre-wrap; }
.fold {
  display: flex; align-items: center; gap: 6px;
  height: var(--cv-row-height);
  margin: 0 -6px; padding: 0 6px;
  border: 0; border-radius: var(--dsw-radius-sm);
  background: transparent; color: var(--dsw-alias-label-tertiary);
  font: inherit; font-size: var(--cv-font-secondary); text-align: left; cursor: pointer;
  transition: background-color var(--cv-fast) ease, color var(--cv-fast) ease;
}
.fold:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-secondary); }
.foldIcon { display: inline-flex; justify-content: center; width: 16px; }
[data-motion=off] .chevron, [data-motion=off] .fold { transition: none; }
@media (prefers-reduced-motion: reduce) { .chevron, .fold { transition: none; } }
```

- [ ] **Step 4: 实现 `src/client/ToolDetails.tsx` 与样式**

内容由 `ToolActivity.tsx` 的 `generatedInput`、`RawRecord`、`InputView`、`ResultView`、`ToolDetails` 迁移而来；行为不变，只换样式类并加「在轨迹中查看」。

```tsx
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ToolResultNode } from '@deepseek-ai/dsh-client-ui-conversation/client';
import { IconInspectOutlineRegular, JsonTree } from '@deepseek-ai/dsh-client-ui-primitives';
import { readCardModel, diffCardModel, searchCardModel, terminalCardModel, webCardModel } from './native017/tool-models.mjs';
import { DiffBlockL, ReadBlockL, SearchBlockL, TerminalBlockL, WebBlockL } from './native/labeled-blocks.js';
import { JSON_TREE_LABELS } from './native/primitive-labels.js';
import { Blocks } from './Blocks.js';
import { contentBlocks } from './user-content.js';
import { useReaderActions } from './reader-context.js';
import { activitySummary, executionFacts, exitCodeFromOutput } from './tool-activity.js';
import type { ToolActivityEntry, ToolPhase } from './tool-activity.js';
import type { BlockRenderProps } from './types.js';
import css from './ToolDetails.module.css';

type Model = ReturnType<typeof activitySummary>;
const number = new Intl.NumberFormat('zh-CN');
const language = (path: string | undefined) => path?.split('.').at(-1);
const duration = (ms: number) => ms < 1000 ? `${Math.round(ms)} 毫秒` : `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} 秒`;

function generatedInput(content: string, target: string | undefined, preparing: boolean) {
  const lines = content.split('\n').map((text, index) => ({ number: index + 1, text }));
  const visible = preparing ? lines.slice(-12) : lines.slice(0, 1600);
  return <div data-reader-tool-file><p className={css.note}>{preparing ? '正在生成的输入 · 尚未执行 · 末尾 12 行' : '工具输入中的文件内容'}{!preparing && lines.length > visible.length ? ' · 预览前 1,600 行，完整内容在原始数据中' : ''}</p>
    <ReadBlockL label={target ?? '文件内容'} lang={language(target)} lines={visible} totalLines={lines.length} maxLines={16} />
  </div>;
}

function RawRecord({ raw, result }: { raw: string; result: string }) {
  return <div className={css.rawSection}>
    <p className={css.note}>完整记录 · 只读 · 不执行其中的代码</p>
    <h4 className={css.rawLabel}>工具输入</h4>
    <pre className={css.raw}>{raw || '输入尚未到达'}</pre>
    {result && <><h4 className={css.rawLabel}>工具结果</h4><pre className={css.raw}>{result}</pre></>}
  </div>;
}

function InputView({ model, preparing }: { model: Model; preparing: boolean }) {
  if (model.content) return generatedInput(model.content, model.target, preparing);
  if (model.command) return <div data-reader-tool-terminal><p className={css.note}>{preparing ? '正在生成命令 · 尚未执行' : '提交的命令'}</p><TerminalBlockL command={model.command} cwd={model.cwd} /></div>;
  return <JsonTree data={model.args} label={preparing ? '已收到的输入字段' : '工具输入'} labels={JSON_TREE_LABELS} />;
}

function ResultView({ entry, model, phase, ...render }: BlockRenderProps & { entry: ToolActivityEntry; model: Model; phase: ToolPhase }) {
  const block = entry.block;
  if (!block || !('kind' in block)) return <>
    <p className={css.note}>{phase === 'interrupted' ? '已中断，没有工具结果。已生成的输入仍可查看。' : phase === 'preparing' ? '模型正在生成工具输入，工具还未开始执行。' : '工具已开始执行，正在等待结果。'}</p>
    <InputView model={model} preparing={phase === 'preparing'} />
  </>;
  const terminal = terminalCardModel(block, model.cwd);
  const text = block.content.filter(item => item.type === 'text').map(item => item.text).join('\n');
  if (terminal || model.category === 'terminal') {
    const facts = executionFacts(block);
    const output = terminal?.card.output ?? text;
    const exitCode = facts.exitCode ?? (phase === 'failed' ? exitCodeFromOutput(output, true) : undefined);
    const command = terminal?.copy.kind === 'shell' ? terminal.copy.command : model.command ?? model.name;
    return <div data-reader-tool-terminal><TerminalBlockL command={command} cwd={terminal?.card.cwd ?? model.cwd}
      output={output} exitCode={exitCode} signal={facts.signal}
      labels={phase === 'failed' && exitCode === undefined ? { done: '失败' } : undefined} maxLines={18} /></div>;
  }
  const read = readCardModel(block);
  if (read) return <div data-reader-tool-file><ReadBlockL {...read} maxLines={18} /></div>;
  const diff = diffCardModel(block);
  if (diff?.card.diffs.length) return <div data-reader-tool-diff><DiffBlockL {...diff.card} maxLines={18} /></div>;
  const search = searchCardModel(block);
  if (search) return <div data-reader-tool-search><SearchBlockL {...search.card} maxLines={18} />{search.recovery && <p className={css.note}>{search.recovery}</p>}</div>;
  const web = webCardModel(block);
  if (web) return <div data-reader-tool-web><WebBlockL {...web} /></div>;
  if (model.category === 'write' && model.content && !block.isError) return <>
    <p className={css.note}>文件工具已返回。以下为提交的内容；完整返回记录可在「原始数据」查看。</p>
    {generatedInput(model.content, model.target, false)}
  </>;
  const content: ToolResultNode['content'] = block.content;
  if (content.some(item => item.type === 'text')) return <div className={css.document}><Blocks {...render} blocks={contentBlocks(content).filter(item => item.kind === 'text')} source="tool" /></div>;
  if (content.length) return <p className={css.note}>图片或扩展内容已在下方单独展示。</p>;
  return <p className={css.note}>工具没有返回可展示的内容。</p>;
}

/** Ledger + result / input / raw tabs for one tool call, inside a recessed block. */
export function ToolDetails({ entry, model, phase, ...render }: BlockRenderProps & { entry: ToolActivityEntry; model: Model; phase: ToolPhase }) {
  const { inspectCall } = useReaderActions();
  const [tab, setTab] = useState<'result' | 'input' | 'raw'>('result');
  const panel = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState(false);
  const detailId = useId();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const heldPreview = useRef({ entry, model, phase });
  if (!selected) heldPreview.current = { entry, model, phase };
  const preview = heldPreview.current;
  useEffect(() => {
    const track = () => {
      const selection = document.getSelection();
      setSelected(!!selection && !selection.isCollapsed && !!selection.anchorNode && !!panel.current?.contains(selection.anchorNode));
    };
    document.addEventListener('selectionchange', track);
    return () => document.removeEventListener('selectionchange', track);
  }, []);
  const facts = executionFacts(entry.block);
  const elapsed = entry.block && 'kind' in entry.block && entry.block.callTime != null ? Math.max(0, entry.block.time - entry.block.callTime) : null;
  const rawResult = useMemo(() => {
    const block = preview.entry.block;
    return block && 'kind' in block ? JSON.stringify({ content: block.content, isError: block.isError, meta: block.meta, resultView: Reflect.get(block, 'resultView') }, null, 2) : '';
  }, [preview.entry.block]);
  const tabs = [['result', phase === 'preparing' ? '生成预览' : '结果'], ['input', '输入'], ['raw', '原始数据']] as const;
  const activate = (index: number) => { const next = (index + tabs.length) % tabs.length; setTab(tabs[next]![0]); tabRefs.current[next]?.focus(); };
  return <div className={css.details} data-reader-tool-details>
    <div className={css.ledger} aria-live="off">
      <span>工具 · <span className={css.engine}>{model.name}</span></span>
      <span data-reader-tool-progress>{phase === 'preparing' ? `已接收 ${number.format(model.raw.length)} 字符输入` : phase === 'running' ? '已提交 · 等待工具返回' : phase === 'interrupted' ? '已停止 · 输入记录保留' : elapsed !== null ? `执行 ${duration(elapsed)}` : '结果已记录'}</span>
      {facts.exitCode !== undefined && <span>退出码 {facts.exitCode}</span>}
      {facts.signal && <span>信号 {facts.signal}</span>}
      {inspectCall && <button type="button" className={css.inspect} onClick={() => inspectCall(entry.callId)} data-reader-inspect><IconInspectOutlineRegular size={12} />在轨迹中查看</button>}
    </div>
    <div className={css.tabs} role="tablist" aria-label={`${model.title}的执行数据`} onKeyDown={event => {
      const index = tabs.findIndex(item => item[0] === tab);
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); activate(index + (event.key === 'ArrowRight' ? 1 : -1)); }
      else if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); activate(event.key === 'Home' ? 0 : tabs.length - 1); }
    }}>{tabs.map(([id, title], index) => <button key={id} ref={element => { tabRefs.current[index] = element; }} type="button" role="tab" id={`${detailId}-${id}`} aria-selected={tab === id} aria-controls={`${detailId}-panel`} tabIndex={tab === id ? 0 : -1} onClick={() => setTab(id)}>{title}</button>)}</div>
    <div ref={panel} id={`${detailId}-panel`} className={css.panel} role="tabpanel" aria-labelledby={`${detailId}-${tab}`} tabIndex={0}>
      {selected && <p className={css.note}>为保留选区，预览暂停更新；当前状态见行标题。</p>}
      {tab === 'result' && <ResultView {...render} {...preview} />}
      {tab === 'input' && <><InputView model={preview.model} preparing={preview.phase === 'preparing'} /><details className={css.detail}><summary>全部输入字段</summary><JsonTree data={preview.model.args} label="输入字段" labels={JSON_TREE_LABELS} /></details></>}
      {tab === 'raw' && <RawRecord raw={preview.model.raw} result={rawResult} />}
    </div>
  </div>;
}
```

`src/client/ToolDetails.module.css`：

```css
.details { margin: 2px 0 6px calc(22px + var(--dsh-content-font-delta, 0px)); min-width: 0; overflow: hidden; border-radius: var(--dsw-radius-md); corner-shape: round; background: var(--cv-inset-bg); }
.ledger { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 12px; padding: 10px 12px 0; color: var(--dsw-alias-label-caption); font-size: 11px; line-height: 18px; font-variant-numeric: tabular-nums; }
.engine { font-family: var(--ds-font-family-code, ui-monospace, monospace); }
.inspect { display: inline-flex; align-items: center; gap: 4px; margin-left: auto; padding: 0 6px; border: 0; border-radius: var(--dsw-radius-sm); background: transparent; color: var(--dsw-alias-state-business-primary); font: inherit; cursor: pointer; transition: background-color var(--cv-fast) ease; }
.inspect:hover { background: var(--dsw-alias-interactive-bg-hover); }
.tabs { display: flex; gap: 14px; padding: 0 12px; }
.tabs > button { padding: 8px 1px 6px; border: 0; border-bottom: 1.5px solid transparent; background: transparent; color: var(--dsw-alias-label-tertiary); font: inherit; font-size: 12px; line-height: 18px; cursor: pointer; transition: color var(--cv-fast) ease, border-color var(--cv-fast) ease; }
.tabs > button:hover { color: var(--dsw-alias-label-secondary); }
.tabs > button[aria-selected=true] { color: var(--dsw-alias-label-primary); border-bottom-color: var(--dsw-alias-label-primary); }
.panel { display: flex; flex-direction: column; gap: 10px; min-width: 0; padding: 10px 12px 12px; font-size: var(--cv-font-secondary); line-height: 21px; }
.panel:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: -2px; }
.note { margin: 0; color: var(--dsw-alias-label-caption); font-size: 12px; line-height: 18px; }
.rawSection { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.rawLabel { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 12px; font-weight: 500; }
.raw { margin: 0; max-height: 360px; overflow: auto; padding: 10px 12px; border-radius: var(--dsw-radius-sm); background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-secondary); font: 12px/18px var(--ds-font-family-code, ui-monospace, monospace); white-space: pre-wrap; overflow-wrap: anywhere; }
.document { font-size: var(--cv-font-secondary); line-height: 21px; }
.detail > summary { margin: 0 -6px; padding: 2px 6px; border-radius: var(--dsw-radius-sm); color: var(--dsw-alias-label-tertiary); font-size: 12px; cursor: pointer; }
.detail > summary:hover { background: var(--dsw-alias-interactive-bg-hover); }
[data-motion=off] .tabs > button, [data-motion=off] .inspect { transition: none; }
@media (pointer: coarse) { .tabs > button { min-height: 44px; } }
```

- [ ] **Step 5: 实现 `src/client/ToolRow.tsx` 与样式**

```tsx
import { memo, useCallback, useMemo, useRef, useState } from 'react';
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-ui-conversation/client';
import {
  DisclosureRow, TextShimmer,
  IconApiOutlineRegular, IconBrowseOutlineRegular, IconCodeOutlineRegular, IconEditOutlineRegular,
  IconGlobeOutlineRegular, IconSearchOutlineRegular, IconSkillOutlineRegular, IconSparkleRegular,
} from '@deepseek-ai/dsh-client-ui-primitives';
import { Blocks } from './Blocks.js';
import { contentBlocks } from './user-content.js';
import { ProcessFragment } from './motion.js';
import { classifyTool, toolRowModel, VARIANT_TITLES } from './native/tool-call-model.js';
import { ErrorSummary, RowGlyph, RowSeparator, errorExcerpt } from './ProcessRow.js';
import { useReaderActions } from './reader-context.js';
import { activityPhase, activitySummary, executionFacts, exitCodeFromOutput } from './tool-activity.js';
import type { ToolActivityEntry, ToolCategory, ToolPhase } from './tool-activity.js';
import { ToolDetails } from './ToolDetails.js';
import type { BlockRenderProps } from './types.js';
import css from './ToolRow.module.css';

const ICONS: Record<ToolCategory, typeof IconSparkleRegular> = {
  write: IconEditOutlineRegular,
  read: IconBrowseOutlineRegular,
  terminal: IconApiOutlineRegular,
  search: IconSearchOutlineRegular,
  web: IconGlobeOutlineRegular,
  other: IconSparkleRegular,
};

export function formatDuration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} 毫秒` : `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} 秒`;
}

export function toolEndLabel(phase: ToolPhase, exitCode: number | undefined, elapsedMs: number | null): string {
  switch (phase) {
    case 'preparing': return '生成输入';
    case 'running': return '执行中';
    case 'failed': return exitCode !== undefined ? `退出码 ${exitCode}` : '失败';
    case 'interrupted': return '已中断';
    default: return elapsedMs !== null ? formatDuration(elapsedMs) : '';
  }
}

function resultText(block: ToolCallBlock | undefined): string {
  return block && 'kind' in block ? block.content.filter(item => item.type === 'text').map(item => item.text).join('\n') : '';
}

/** One tool call in the native 24px row grammar, keyed by call id from generation to result. */
export const ToolRow = memo(function ToolRow({ entry, turnClosed, onRead, depth = 0, ...render }: BlockRenderProps & {
  entry: ToolActivityEntry; turnClosed: boolean; onRead: () => void; depth?: number;
}) {
  const { motion } = useReaderActions();
  const [open, setOpen] = useState(false);
  const control = useRef<HTMLElement | null>(null);
  const toggle = useCallback(() => { onRead(); setOpen(value => !value); }, [onRead]);
  const model = useMemo(() => activitySummary(entry), [entry.block, entry.draft]);
  if (depth > 6) return <p className={css.deep}>更深的嵌套调用可在原对话查看。</p>;
  const phase = activityPhase(entry, turnClosed);
  const block = entry.block;
  const native = block ? toolRowModel(model.name, block) : null;
  const skill = model.name === 'skill';
  const Icon = skill ? IconSkillOutlineRegular : model.name === 'code' ? IconCodeOutlineRegular : ICONS[model.category];
  const title = skill ? 'Skill' : native?.title ?? VARIANT_TITLES[classifyTool(model.name)];
  const skillName = typeof model.args?.name === 'string' ? model.args.name.split('\n')[0] : model.raw.split('\n')[0];
  const summary = skill ? skillName : native?.summary
    ?? (classifyTool(model.name) === 'others' ? `${model.name} · ${model.target ?? model.title}` : model.target ?? model.title);
  const active = phase === 'preparing' || phase === 'running';
  const failed = phase === 'failed';
  const text = resultText(block);
  const facts = executionFacts(block);
  const exitCode = facts.exitCode ?? (failed ? exitCodeFromOutput(text, true) : undefined);
  const elapsed = block && 'kind' in block && block.callTime != null ? Math.max(0, block.time - block.callTime) : null;
  const end = toolEndLabel(phase, exitCode, elapsed);
  return <div ref={element => { control.current = element?.querySelector<HTMLElement>('[data-disclosure-row]') ?? null; }}
    className={css.tool} data-reader-tool-call={entry.callId} data-tool-phase={phase} data-tool-category={model.category} data-expanded={open}>
    <DisclosureRow icon={<RowGlyph tone={active ? 'active' : failed ? 'failed' : 'idle'} icon={<Icon size={14} />} />}
      title={title} open={open} expandable expandOnRowClick previewChevron keepContentWhenOpen onToggle={toggle}
      rowClassName={css.row} titleClassName={failed ? css.failedTitle : undefined}
      collapsedContent={<>
        <RowSeparator />
        <TextShimmer active={active && motion} className={css.summary} contentClassName={css.summaryContent}><span className={css.summaryText} title={summary}>{summary}</span></TextShimmer>
        {end && <span className={css.end}>{end}</span>}
      </>} />
    {failed && !open && <ErrorSummary text={errorExcerpt(native?.errorSummary ?? text)} />}
    <ProcessFragment open={open} motion={motion} onRead={onRead} returnFocusTo={control} nodeKey={`${entry.key}:detail`} framed>
      <ToolDetails entry={entry} model={model} phase={phase} {...render} />
    </ProcessFragment>
    {!!block?.subCalls.length && <div className={css.children} aria-label="子调用">{block.subCalls.map((child, index) => <ToolRow key={child.callId} {...render}
      entry={{ kind: 'tool', key: `reader-tool:${child.callId}`, callId: child.callId, step: entry.step, order: index, block: child }}
      turnClosed={turnClosed} onRead={onRead} depth={depth + 1} />)}</div>}
  </div>;
}, (previous, next) => previous.entry.callId === next.entry.callId && previous.entry.block === next.entry.block
  && previous.entry.draft === next.entry.draft && previous.entry.step === next.entry.step
  && previous.turnClosed === next.turnClosed && previous.depth === next.depth && previous.onRead === next.onRead
  && previous.renderSlotChain === next.renderSlotChain && previous.loadImage === next.loadImage);

function mediaOf(block: ToolCallBlock | undefined, depth = 0): ReturnType<typeof contentBlocks> {
  if (!block || depth > 6) return [];
  const own = 'kind' in block ? contentBlocks(block.content).filter(item => item.kind === 'image' || item.kind === 'other') : [];
  return [...own, ...block.subCalls.flatMap(child => mediaOf(child, depth + 1))];
}

/** Images and extension content returned by tools stay visible beside the answer. */
export function ToolImages({ entries, ...render }: BlockRenderProps & { entries: readonly ToolActivityEntry[] }) {
  const blocks = useMemo(() => entries.flatMap(entry => mediaOf(entry.block)), [entries]);
  if (blocks.length === 0) return null;
  return <div className={css.media} data-reader-tool-media><Blocks {...render} blocks={blocks} source="tool" /></div>;
}
```

`src/client/ToolRow.module.css`：

```css
.tool { min-width: 0; }
.row { margin: 0 -6px; padding: 0 6px; border-radius: var(--dsw-radius-sm); transition: background-color var(--cv-fast) ease; }
.row:hover { background: var(--dsw-alias-interactive-bg-hover); }
.failedTitle { color: var(--dsw-alias-state-error-primary); }
.summary { flex: 1 1 auto; min-width: 0; color: var(--dsw-alias-label-caption); }
.summaryContent { min-width: 0; overflow: hidden; }
.summaryText { display: block; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: var(--cv-font-secondary); }
.end { flex: none; margin-left: 8px; color: var(--dsw-alias-label-caption); font-size: 12px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.tool[data-tool-phase=failed] > div > .end, .tool[data-tool-phase=failed] .end { color: var(--dsw-alias-state-error-primary); }
.children { display: flex; flex-direction: column; gap: 2px; margin-left: calc(22px + var(--dsh-content-font-delta, 0px)); }
.deep { margin: 0; color: var(--dsw-alias-label-caption); font-size: 12px; }
.media { display: flex; flex-direction: column; gap: 12px; }
[data-motion=off] .row { transition: none; }
@media (prefers-reduced-motion: reduce) { .row { transition: none; } }
```

- [ ] **Step 6: 运行测试与类型检查**

Run: `npm test`
Expected: 全部通过，`tool-row.test.ts` 6 条。

Run: `npm run typecheck`
Expected: 0 错误。若 `IconSparkleRegular` 的类型不能作为 `ICONS` 的值类型，把它改为 `ComponentType<{ size?: number }>`（从 `react` 引入 `ComponentType`）。

- [ ] **Step 7: 提交**

```bash
git add -A
git commit -m "feat: render tool calls in the native row grammar with inset details

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: `ReasoningRow` 取代思考卡片

**Files:**
- Create: `src/client/ReasoningRow.tsx`、`src/client/ReasoningRow.module.css`
- Create: `tests/reasoning-row.test.ts`

（旧的 `ReasoningCard.tsx` 暂不删除，Task 11 接线后再删。）

**Interfaces:**
- Consumes: `followAdvance`（`reasoning-follow.ts`，不改）；`MOTION`；`RowSeparator`；原生 `StateDot`、`TextShimmer` 与图标。
- Produces:
  - `formatThinkingSeconds(seconds: number): string`、`reasoningPreview(text: string, limit = 80): string`
  - `ReasoningRow(props: ReasoningRowProps)`，`ReasoningRowProps = { children; step: number; live: boolean; follow: boolean; motion: boolean; selected: boolean; onRead: () => void; compact: boolean; durationMs: number | null; startedAt: number | null; charCount: number; preview: string }`
  - DOM：行 `button[data-reader-reasoning-row]`；内凹块 `[data-reader-reasoning-card][data-live][data-preview][data-expanded][data-following][data-overflow]`；视口 `[data-reader-reasoning-scroll][data-edges]`；正文 `[data-reader-reasoning-text]`

- [ ] **Step 1: 写失败测试 `tests/reasoning-row.test.ts`**

```ts
import './support/dom.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { render } from './support/render.ts';
import { ReasoningRow, formatThinkingSeconds, reasoningPreview } from '../src/client/ReasoningRow.tsx';

const base = { step: 3, follow: true, motion: true, selected: false, onRead: () => {}, durationMs: 6000, startedAt: null, charCount: 120, preview: '先看工作区。', children: createElement('span', null, '原文') };

test('thinking seconds read naturally', () => {
  assert.equal(formatThinkingSeconds(0), '不到 1 秒');
  assert.equal(formatThinkingSeconds(42), '42 秒');
  assert.equal(formatThinkingSeconds(120), '2 分钟');
  assert.equal(formatThinkingSeconds(135), '2 分 15 秒');
});

test('the preview is the first sentence of the first line', () => {
  assert.equal(reasoningPreview('  我会先查看工作区。然后搭建场景。\n第二行'), '我会先查看工作区。');
  assert.equal(reasoningPreview('no terminator here'), 'no terminator here');
  assert.equal(reasoningPreview('a'.repeat(100)).length, 80);
});

test('live thinking spins, sweeps its title and shows the inset', () => {
  const html = render(ReasoningRow, { ...base, live: true, compact: true });
  assert.match(html, /data-stub="StateDot" data-state="ongoing"/);
  assert.match(html, /data-stub="TextShimmer" data-active="true"[^>]*>思考中/);
  assert.match(html, /data-live="true"/);
  assert.match(html, /data-reader-reasoning-text[^>]*><span>原文<\/span>/);
});

test('settled thinking in compact mode is a single row with its duration and preview', () => {
  const html = render(ReasoningRow, { ...base, live: false, compact: true });
  assert.match(html, /思考了 6 秒/);
  assert.match(html, /先看工作区。/);
  assert.doesNotMatch(html, /data-reader-reasoning-card/);
});

test('settled thinking outside compact mode shows a clamped preview inset', () => {
  const html = render(ReasoningRow, { ...base, live: false, compact: false });
  assert.match(html, /data-preview="true"/);
  assert.doesNotMatch(html, /data-live/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test`
Expected: `reasoning-row.test.ts` 失败（模块不存在）。

- [ ] **Step 3: 实现 `src/client/ReasoningRow.tsx`**

跟随逻辑（缓存度量、rAF 速度匹配、结束滑行、滚轮/选区/聚焦暂停、展开时的高度动画、阅读高度适配）原样迁自 `ReasoningCard.tsx`，只改外层结构。

```tsx
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  StateDot, TextShimmer,
  IconFullscreenOutlineRegular, IconPauseOutlineRegular, IconPlayOutlineRegular, IconThinkOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives';
import { followAdvance } from './reasoning-follow.js';
import { MOTION } from './motion-tokens.js';
import { RowSeparator } from './ProcessRow.js';
import css from './ReasoningRow.module.css';

export function formatThinkingSeconds(seconds: number): string {
  if (seconds < 1) return '不到 1 秒';
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes} 分 ${rest} 秒` : `${minutes} 分钟`;
}

/** First sentence of the first line, for the collapsed row. Never rewrites the text. */
export function reasoningPreview(text: string, limit = 80): string {
  const first = text.trim().split(/\n+/)[0] ?? '';
  const sentence = /^(.+?[。！？!?])/.exec(first)?.[1] ?? first;
  const value = sentence.trim();
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}

export interface ReasoningRowProps {
  children: ReactNode;
  step: number;
  /** This segment is still streaming. */
  live: boolean;
  /** The turn is open and this is its latest step: eligible for auto-follow. */
  follow: boolean;
  motion: boolean;
  selected: boolean;
  onRead: () => void;
  /** 折叠思考 on: settled thinking keeps only its row. */
  compact: boolean;
  durationMs: number | null;
  startedAt: number | null;
  charCount: number;
  preview: string;
}

export function ReasoningRow({ children, step, live, follow, motion, selected, onRead, compact, durationMs, startedAt, charCount, preview }: ReasoningRowProps) {
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const viewportId = useId();
  const [manual, setManual] = useState<'open' | 'closed' | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [following, setFollowing] = useState(true);
  const [overflow, setOverflow] = useState(false);
  const [edges, setEdges] = useState('none');
  const [now, setNow] = useState(() => Date.now());
  const [frozenSeconds, setFrozenSeconds] = useState<number | null>(null);
  const lastLiveSeconds = useRef<number | null>(null);
  const previousLive = useRef(false);
  const lastHeight = useRef(0);
  const resize = useRef<Animation | null>(null);
  const previousExpanded = useRef(expanded);
  const stopFollow = useRef<() => void>(() => {});
  const finishRef = useRef<{ cancel: () => void } | null>(null);
  const lastTop = useRef(0);
  const followSeeded = useRef(false);
  const open = manual === null ? live : manual === 'open';
  const previewMode = !open && !compact && !live;
  const allowed = open && following && follow && motion && !selected;

  useEffect(() => {
    if (!live || startedAt == null) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [live, startedAt]);

  useEffect(() => {
    if (live) { setFrozenSeconds(null); previousLive.current = true; return; }
    if (previousLive.current && lastLiveSeconds.current != null) setFrozenSeconds(lastLiveSeconds.current);
    previousLive.current = false;
  }, [live]);

  const pause = useCallback(() => {
    stopFollow.current();
    setFollowing(false);
    onRead();
  }, [onRead]);

  useLayoutEffect(() => {
    if (!selected) return;
    stopFollow.current();
    setFollowing(false);
  }, [selected]);

  useLayoutEffect(() => {
    const port = viewport.current;
    const host = port?.closest<HTMLElement>('[data-conversation-scroll]');
    if (!port || !host) return;
    const fit = () => {
      const composer = parseFloat(getComputedStyle(host).getPropertyValue('--dsh-composer-height')) || 152;
      const available = Math.max(120, host.clientHeight - composer - 64);
      port.style.setProperty('--reason-reading-height', `${available}px`);
    };
    fit();
    const observer = new ResizeObserver(fit); observer.observe(host);
    const attributes = new MutationObserver(fit);
    attributes.observe(host, { attributes: true, attributeFilter: ['style'] });
    return () => { observer.disconnect(); attributes.disconnect(); };
  }, [expanded, open]);

  useLayoutEffect(() => {
    const port = viewport.current;
    const text = content.current;
    if (!port || !text) return;
    if (allowed) finishRef.current?.cancel();
    let clientHeight = port.clientHeight;
    let tail = Math.max(0, text.offsetHeight - clientHeight);
    let frame = 0;
    let alive = true;
    let tracking = false;
    let state = { pos: port.scrollTop, velocity: 0, lastTail: tail, lastAt: 0 };
    lastTop.current = state.pos;
    const hasSelection = () => {
      const selection = document.getSelection();
      return !!selection && !selection.isCollapsed && !!selection.anchorNode && text.contains(selection.anchorNode);
    };
    const cancel = () => { cancelAnimationFrame(frame); frame = 0; delete port.dataset.reasoningMoving; };
    const paint = (pos: number) => { port.scrollTop = pos; lastTop.current = port.scrollTop; };
    const edgesFor = (pos: number, end: number) => {
      const top = pos > 1;
      const bottom = end - pos > 1;
      const next = top ? bottom ? 'both' : 'top' : bottom ? 'bottom' : 'none';
      setEdges(value => value === next ? value : next);
    };
    const refresh = (recordHeight = true) => {
      clientHeight = port.clientHeight;
      const height = text.offsetHeight;
      tail = Math.max(0, height - clientHeight);
      setOverflow(height > clientHeight + 1);
      edgesFor(tracking ? state.pos : port.scrollTop, tail);
      if (recordHeight && !resize.current) lastHeight.current = clientHeight;
    };
    stopFollow.current = () => { finishRef.current?.cancel(); cancel(); tracking = false; };
    const canFollow = () => allowed && alive && !document.hidden && !hasSelection();
    const loop = (time: number) => {
      frame = 0;
      if (!canFollow()) { cancel(); return; }
      const next = followAdvance(state, tail, time);
      state = next;
      paint(next.pos);
      edgesFor(next.pos, tail);
      if (next.settled) { cancel(); return; }
      frame = requestAnimationFrame(loop);
    };
    const run = () => {
      if (!canFollow() || frame) return;
      if (!followSeeded.current) {
        followSeeded.current = true;
        if (tail > 1) {
          state = { pos: tail, velocity: 0, lastTail: tail, lastAt: performance.now() };
          paint(tail);
          edgesFor(tail, tail);
        }
      }
      tracking = true;
      state.lastAt = performance.now();
      state.lastTail = tail;
      port.dataset.reasoningMoving = 'true';
      frame = requestAnimationFrame(loop);
    };
    const onScroll = () => {
      if ((tracking || finishRef.current) && Math.abs(port.scrollTop - lastTop.current) > 1) pause();
      else if (!tracking && !finishRef.current) edgesFor(port.scrollTop, tail);
    };
    const onWheel = () => { if (tracking || finishRef.current) pause(); };
    const onSelection = () => { if (hasSelection()) pause(); };
    const onVisibility = () => { if (!document.hidden && canFollow()) run(); };
    const observer = new ResizeObserver(() => { refresh(); if (tracking) run(); });
    observer.observe(text); observer.observe(port);
    port.addEventListener('scroll', onScroll, { passive: true });
    port.addEventListener('wheel', onWheel, { passive: true });
    document.addEventListener('selectionchange', onSelection);
    document.addEventListener('visibilitychange', onVisibility);
    refresh(false);
    if (canFollow()) run();
    return () => {
      alive = false;
      cancel();
      observer.disconnect();
      port.removeEventListener('scroll', onScroll); port.removeEventListener('wheel', onWheel);
      document.removeEventListener('selectionchange', onSelection);
      document.removeEventListener('visibilitychange', onVisibility);
      stopFollow.current = () => {};
      if (!tracking) return;
      tracking = false;
      const end = tail;
      if (clientHeight > 1 && end - state.pos > 1 && port.isConnected) {
        let glideFrame = 0;
        let glideState = { ...state, lastTail: end, lastAt: performance.now() };
        const token = { cancel: () => { if (finishRef.current !== token) return; finishRef.current = null; cancelAnimationFrame(glideFrame); } };
        finishRef.current = token;
        const glide = (time: number) => {
          glideFrame = 0;
          if (finishRef.current !== token) return;
          const next = followAdvance(glideState, end, time);
          glideState = next;
          port.scrollTop = next.pos;
          lastTop.current = port.scrollTop;
          edgesFor(next.pos, end);
          if (next.settled) { finishRef.current = null; return; }
          glideFrame = requestAnimationFrame(glide);
        };
        glideFrame = requestAnimationFrame(glide);
      }
    };
  }, [allowed, pause, open, previewMode]);

  useLayoutEffect(() => {
    const port = viewport.current;
    if (!port) return;
    const changed = expanded !== previousExpanded.current;
    previousExpanded.current = expanded;
    const from = resize.current ? port.clientHeight : lastHeight.current;
    resize.current?.cancel(); resize.current = null;
    port.style.maxHeight = ''; port.style.height = '';
    const target = port.clientHeight;
    if (!changed || !motion || from < 1 || Math.abs(target - from) < 1) { lastHeight.current = target; return; }
    port.style.maxHeight = 'none';
    const animation = port.animate([{ height: `${from}px` }, { height: `${target}px` }], { duration: MOTION.size, easing: MOTION.ease, fill: 'both' });
    resize.current = animation;
    animation.onfinish = () => {
      if (resize.current !== animation) return;
      resize.current = null; animation.cancel();
      port.style.maxHeight = ''; port.style.height = '';
      lastHeight.current = port.clientHeight;
    };
  }, [expanded, motion]);
  useEffect(() => () => resize.current?.cancel(), []);

  if (live && startedAt != null) lastLiveSeconds.current = Math.max(1, Math.floor((now - startedAt) / 1000));
  const liveSeconds = live && startedAt != null ? lastLiveSeconds.current : null;
  const summarySeconds = liveSeconds ?? frozenSeconds ?? (durationMs != null ? Math.max(0, Math.round(durationMs / 1000)) : null);
  const title = live ? '思考中' : summarySeconds !== null ? `思考了 ${formatThinkingSeconds(summarySeconds)}` : '思考';
  const toggle = () => {
    onRead();
    if (open) { setManual('closed'); setExpanded(false); } else setManual('open');
  };

  return <div className={css.reasoning} data-reader-reasoning data-reader-anchor>
    <button type="button" className={css.row} aria-expanded={open} aria-controls={viewportId} onClick={toggle} data-reader-reasoning-row>
      <span className={css.icon} aria-hidden="true">{live ? <StateDot state="ongoing" size={12} /> : <IconThinkOutlineRegular size={14} />}</span>
      <TextShimmer active={live && motion} className={css.title}>{title}</TextShimmer>
      {!open && preview && <><RowSeparator /><span className={css.preview}>{preview}</span></>}
      <span className={css.end}>{liveSeconds !== null ? `已 ${liveSeconds} 秒` : `${charCount} 字`}</span>
    </button>
    {(open || previewMode) && <div className={css.inset} data-reader-reasoning-card data-live={live || undefined} data-preview={previewMode || undefined}
      data-expanded={expanded || undefined} data-following={allowed} data-overflow={overflow}>
      <div ref={viewport} id={viewportId} className={css.viewport} data-edges={edges} data-reader-reasoning-scroll role="region"
        aria-label={`步骤 ${step} 的思考${overflow ? '，可滚动阅读' : ''}`} tabIndex={open && overflow ? 0 : undefined}
        onPointerDown={open ? pause : undefined} onFocus={open ? pause : undefined}
        onClick={previewMode ? () => { onRead(); setManual('open'); } : undefined}>
        <div ref={content} className={css.text} data-reader-reasoning-text>{children}</div>
      </div>
      {open && (overflow || expanded) && <div className={css.controls}>
        {follow && motion && <button type="button" className={css.control} disabled={selected}
          aria-label={following ? '暂停自动跟随思考' : '继续跟随最新思考'} title={selected ? '取消文字选择后可继续跟随' : following ? '暂停跟随' : '跟随最新'}
          onClick={() => { if (following) pause(); else { onRead(); setFollowing(true); } }}>
          {following ? <IconPauseOutlineRegular size={12} /> : <IconPlayOutlineRegular size={12} />}
        </button>}
        <button type="button" className={css.control} aria-expanded={expanded} aria-controls={viewportId}
          aria-label={expanded ? '收起完整思考' : '展开阅读完整思考'} title={expanded ? '收起' : '展开阅读'}
          onClick={() => { onRead(); setExpanded(value => !value); }}>
          <IconFullscreenOutlineRegular size={12} />
        </button>
      </div>}
    </div>}
  </div>;
}
```

- [ ] **Step 4: 写 `src/client/ReasoningRow.module.css`**

```css
.reasoning { min-width: 0; }
.row {
  display: flex; align-items: center;
  width: calc(100% + 12px); height: var(--cv-row-height);
  margin: 0 -6px; padding: 0 6px;
  border: 0; border-radius: var(--dsw-radius-sm);
  background: transparent; color: var(--dsw-alias-label-tertiary);
  font: inherit; font-size: var(--cv-font-secondary); text-align: left; cursor: pointer;
  transition: background-color var(--cv-fast) ease, color var(--cv-fast) ease;
}
.row:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-secondary); }
.row:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: -2px; }
.icon { display: inline-flex; flex: none; align-items: center; justify-content: center; width: 16px; height: 16px; margin-right: 6px; }
.title { flex: none; }
.preview { flex: 1 1 auto; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: var(--dsw-alias-label-caption); }
.end { flex: none; margin-left: auto; padding-left: 8px; color: var(--dsw-alias-label-caption); font-size: 12px; font-variant-numeric: tabular-nums; }
.inset { position: relative; margin: 2px 0 6px calc(22px + var(--dsh-content-font-delta, 0px)); border-radius: var(--dsw-radius-md); corner-shape: round; background: var(--cv-inset-bg); }
.viewport {
  position: relative; max-height: 240px; overflow: auto; overflow-anchor: none;
  padding: 8px 12px;
  color: var(--dsw-alias-label-tertiary); font-size: var(--cv-font-secondary); line-height: 21px; overflow-wrap: anywhere;
  scrollbar-width: thin; scrollbar-color: var(--dsw-alias-border-l1) transparent;
}
.inset[data-live=true] .viewport { max-height: 128px; }
.inset[data-preview=true] .viewport { max-height: 72px; overflow: hidden; cursor: pointer; -webkit-mask-image: linear-gradient(#000 55%, transparent); mask-image: linear-gradient(#000 55%, transparent); }
.inset[data-expanded=true] .viewport { max-height: min(60vh, 560px, var(--reason-reading-height, 560px)); }
.viewport[data-edges=top], .viewport[data-edges=both] { -webkit-mask-image: linear-gradient(transparent 0, #000 26px, #000 100%); mask-image: linear-gradient(transparent 0, #000 26px, #000 100%); }
.inset[data-expanded=true] .viewport { -webkit-mask-image: none; mask-image: none; }
.viewport:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: -2px; }
.text { min-width: 0; }
.controls { position: absolute; top: 6px; right: 6px; display: flex; gap: 2px; opacity: 0; transition: opacity var(--cv-fast) ease; }
.inset:hover .controls, .inset:focus-within .controls { opacity: 1; }
.control { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; padding: 0; border: 0; border-radius: var(--dsw-radius-sm); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); cursor: pointer; }
.control:hover { color: var(--dsw-alias-label-primary); }
.control:disabled { opacity: .5; cursor: default; }
@media (pointer: coarse) { .controls { opacity: 1; } }
@media (forced-colors: active) { .viewport { -webkit-mask-image: none !important; mask-image: none !important; } }
[data-motion=off] .row, [data-motion=off] .controls { transition: none; }
@media (prefers-reduced-motion: reduce) { .row, .controls { transition: none; } }
```

- [ ] **Step 5: 运行测试与类型检查**

Run: `npm test`
Expected: 全部通过，`reasoning-row.test.ts` 5 条。

Run: `npm run typecheck`
Expected: 0 错误。

- [ ] **Step 6: 提交**

```bash
git add -A
git commit -m "feat: turn reasoning cards into rows with a live recessed viewport

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 10: 记录行、插话气泡、轮次通知与开场

**Files:**
- Create: `tests/support/session.ts`
- Create: `src/client/RecordRows.tsx`、`src/client/RecordRows.module.css`
- Create: `src/client/Opening.tsx`、`src/client/Opening.module.css`
- Create: `tests/records-opening.test.ts`

**Interfaces:**
- Consumes: `useChatSelector`；`RowGlyph`、`RowSeparator`、`Inset`、`Chevron`；`triggerDetails`、`TRIGGER_EXPLANATION`；`fmtClock`；`nodeText`、`workflowRunSummary`、`workflowStatusLabel`；`ContextInjectionRow({ content, source, producer, form, t })`、`SystemPromptRow({ text })`。
- Produces:
  - `recordView(node: { kind: string; data: unknown }): RecordView`，`RecordView = { title; summary; tone: 'idle'|'active'|'done'|'failed'; showInChat: boolean }`
  - `replyAnswerValues(data: unknown, id: string): string[]`
  - `RecordRow({ useSession, nodeKey, t, onRead, renderSlotChain, loadImage })`（根元素 `data-reader-record-kind`、`data-record-tone`）
  - `InputBubble({ useSession, nodeKey, renderSlotChain, loadImage })`（根元素 `data-reader-input`）
  - `TurnNotice({ useSession, nodeKey })`（根元素 `data-reader-notice="error"|"max-tokens"`）
  - `labelsLine(data: unknown): string`、`Opening({ useSession, nodeKey, renderSlotChain, loadImage })`（turn-trigger 根元素 `data-reader-trigger={icon}`；用户气泡 `div[data-reader-anchor][data-reader-key]`）
  - 测试：`sessionHook(chat, session?)` 返回 compat 会话钩子

- [ ] **Step 1: 写测试会话钩子 `tests/support/session.ts`**

```ts
import type { ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client';
import { createCompatSessionHook } from '../../src/client/compat/session-snapshot.ts';

/** A compat session hook over fixed fakes, shaped like the 0.2.0 standard hooks. */
export function sessionHook(chat: ChatSnapshot, session: Record<string, unknown> = {}, pending: unknown = undefined) {
  const snapshot = { sessionId: 's1', openState: 'ready', running: false, pendingSubmissions: [], hasMore: false, loadingOlder: false, openError: null, ...session };
  const pendingMap = new Map(pending === undefined ? [] : [['s1', pending]]);
  return createCompatSessionHook({
    useSession: ((selector: (value: unknown) => unknown) => selector(snapshot)) as never,
    useChat: ((selector: (value: unknown) => unknown) => selector(chat)) as never,
    useSessionPendingInteraction: ((selector: (value: unknown) => unknown) => selector(pendingMap)) as never,
    sessionId: 's1',
  });
}
```

- [ ] **Step 2: 写失败测试 `tests/records-opening.test.ts`**

```ts
import './support/dom.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render } from './support/render.ts';
import { InputBubble, RecordRow, TurnNotice, recordView, replyAnswerValues } from '../src/client/RecordRows.tsx';
import { Opening, labelsLine } from '../src/client/Opening.tsx';
import { chatNode, chatOf, turnLocation } from './support/chat-fixture.ts';
import { sessionHook } from './support/session.ts';

const blocks = { renderSlotChain: ((_n: string, _o: unknown, options: { fallback: unknown }) => options.fallback) as never, loadImage: async () => 'blob:x' };

test('record views name each lifecycle and its tone', () => {
  assert.deepEqual(recordView({ kind: 'model-retry', data: { current: { retryState: 'scheduled', retry: 2, failure: { code: 'RATE_LIMIT', status: 429 } } } }),
    { title: '模型请求未成功，正在等待重试', summary: '第 2 次 · RATE_LIMIT · HTTP 429', tone: 'active', showInChat: false });
  assert.equal(recordView({ kind: 'command', data: { name: 'compact', outcome: null } }).tone, 'active');
  assert.deepEqual(recordView({ kind: 'command', data: { name: 'goal', outcome: { kind: 'success', text: '已设定' } } }),
    { title: '命令执行完成', summary: '/goal · 已设定', tone: 'done', showInChat: false });
  assert.equal(recordView({ kind: 'command', data: { name: 'x', outcome: { kind: 'error' } } }).title, '命令执行失败');
  assert.equal(recordView({ kind: 'manual-compaction', data: { command: { outcome: { kind: 'error', text: '超时' } }, compaction: null } }).summary, '超时');
  assert.equal(recordView({ kind: 'manual-compaction', data: { command: { outcome: null }, compaction: { seq: 1 } } }).title, '上下文已整理');
  assert.equal(recordView({ kind: 'compaction', data: { shadowedItemCount: 12 } }).summary, '已整理 12 条记录 · 原始记录仍保留');
  assert.equal(recordView({ kind: 'question-reply', data: { questions: [{ id: 'q1', question: '用哪个框架？' }] } }).summary, '用哪个框架？');
  assert.equal(recordView({ kind: 'submitted-plan', data: { title: '重构计划', markdown: '# x' } }).title, '重构计划');
  assert.deepEqual(recordView({ kind: 'workflow-run', data: { name: '发布', status: 'running', phases: [{ members: [1, 2] }] } }),
    { title: '发布', summary: '运行中 · 2 个子会话 · 1 个阶段', tone: 'active', showInChat: true });
  assert.deepEqual(recordView({ kind: 'agent-teams', data: {} }), { title: '工具调用', summary: 'agent-teams', tone: 'idle', showInChat: true });
  assert.equal(recordView({ kind: 'unknown', data: { type: 'x/y' } }).summary, 'x/y');
});

test('reply answers list selected options then a non-blank custom answer', () => {
  const data = { answers: [{ id: 'q1', selected: ['React', 'Vue'], custom: '  都可以 ' }, { id: 'q2', selected: [] }] };
  assert.deepEqual(replyAnswerValues(data, 'q1'), ['React', 'Vue', '都可以']);
  assert.deepEqual(replyAnswerValues(data, 'q2'), []);
  assert.deepEqual(replyAnswerValues({}, 'q1'), []);
});

test('user labels list references then skills', () => {
  assert.equal(labelsLine({ referenceLabels: ['会话 A', 'README.md'], skillNames: ['design'] }), '引用 会话 A、README.md · 技能 design');
  assert.equal(labelsLine({}), '');
});

test('a scheduled trigger opens the turn as a trigger row, not a generic card', () => {
  const turn = turnLocation({ status: 'open' });
  const trigger = chatNode('turn-trigger', { source: { kind: 'schedule' }, content: [{ type: 'text', text: '每日巡检' }], time: Date.now() }, turn);
  const html = render(Opening, { useSession: sessionHook(chatOf([trigger], [turn])), nodeKey: trigger.key, ...blocks });
  assert.match(html, /data-reader-trigger="schedule"/);
  assert.match(html, /自动化任务/);
  assert.doesNotMatch(html, /工具调用/);
});

test('a user opening keeps the rewind seat contract and shows its labels', () => {
  const turn = turnLocation({ status: 'open' });
  const user = chatNode('user', { content: [{ type: 'text', text: '你好' }], skillNames: ['design'] }, turn);
  const html = render(Opening, { useSession: sessionHook(chatOf([user], [turn])), nodeKey: user.key, ...blocks });
  assert.match(html, new RegExp(`<div class="user" data-reader-anchor="true" data-reader-key="${user.key}"`));
  assert.match(html, /技能 design/);
});

test('rows, inputs and notices render from their nodes', () => {
  const turn = turnLocation({ status: 'closed', reason: 'error', steps: [1] });
  const failed = chatNode('command', { name: 'compact', outcome: { kind: 'error', text: '失败' } }, turn, 1);
  const steering = chatNode('steering', { content: [{ type: 'text', text: '禁止使用子代理' }] }, turn, 1);
  const error = chatNode('turn-error', { message: 'upstream 500', code: 'HTTP_500' }, turn);
  const useSession = sessionHook(chatOf([failed, steering, error], [turn]));
  const row = render(RecordRow, { useSession, nodeKey: failed.key, t: ((key: string) => key) as never, onRead: () => {}, ...blocks });
  assert.match(row, /data-record-tone="failed"/);
  assert.match(row, /data-stub="StateDot" data-state="error"/);
  const input = render(InputBubble, { useSession, nodeKey: steering.key, ...blocks });
  assert.match(input, /补充消息[\s\S]*禁止使用子代理/);
  const notice = render(TurnNotice, { useSession, nodeKey: error.key });
  assert.match(notice, /本轮出现错误[\s\S]*upstream 500[\s\S]*HTTP_500/);
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npm test`
Expected: `records-opening.test.ts` 失败（模块不存在）。

- [ ] **Step 4: 实现 `src/client/RecordRows.tsx`**

```tsx
import { memo, useCallback, useMemo, useState } from 'react';
import type { ComponentType } from 'react';
import type { ContextMessageNode } from '@deepseek-ai/dsh-client-ui-chat/client';
import {
  DisclosureRow, JsonTree, StateDot,
  IconApiOutlineRegular, IconCompactOutlineRegular, IconFlatListOutlineRegular, IconPlanOutlineRegular,
  IconQuestionOutlineRegular, IconRefreshOutlineRegular, IconSparkleRegular,
} from '@deepseek-ai/dsh-client-ui-primitives';
import { Blocks } from './Blocks.js';
import { useChatSelector } from './compat/session-snapshot.js';
import { CollapseBody } from './motion.js';
import { ContextInjectionRow } from './native/ContextInjectionRow.js';
import { JSON_TREE_LABELS } from './native/primitive-labels.js';
import { SystemPromptRow } from './native/SystemPromptRow.js';
import { nodeText, workflowRunSummary, workflowStatusLabel } from './node-payloads.js';
import { Inset, RowGlyph, RowSeparator } from './ProcessRow.js';
import { useReaderActions } from './reader-context.js';
import { contentBlocks } from './user-content.js';
import type { BlockRenderProps, ReaderProps } from './types.js';
import css from './RecordRows.module.css';

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export type RecordTone = 'idle' | 'active' | 'done' | 'failed';
export interface RecordView { title: string; summary: string; tone: RecordTone; showInChat: boolean }

/** Title, one-line summary and tone of a process record; every payload is read defensively. */
export function recordView(node: { kind: string; data: unknown }): RecordView {
  const data = record(node.data);
  switch (node.kind) {
    case 'model-retry': {
      const current = record(data?.current);
      const state = current?.retryState;
      const failure = record(current?.failure);
      const title = state === 'scheduled' ? '模型请求未成功，正在等待重试' : state === 'started' ? '模型请求正在重试' : '模型重试记录';
      const parts = [
        typeof current?.retry === 'number' ? `第 ${current.retry} 次` : null,
        typeof failure?.code === 'string' ? failure.code : null,
        typeof failure?.status === 'number' ? `HTTP ${failure.status}` : null,
      ];
      return { title, summary: parts.filter(Boolean).join(' · '), tone: state === 'scheduled' || state === 'started' ? 'active' : 'idle', showInChat: false };
    }
    case 'command': {
      const outcome = record(data?.outcome);
      const name = typeof data?.name === 'string' ? `/${data.name}` : null;
      if (!outcome) return { title: '命令执行中', summary: name ?? '', tone: 'active', showInChat: false };
      const ok = outcome.kind === 'success';
      const text = typeof outcome.text === 'string' ? outcome.text : null;
      return { title: ok ? '命令执行完成' : '命令执行失败', summary: [name, text].filter(Boolean).join(' · '), tone: ok ? 'done' : 'failed', showInChat: false };
    }
    case 'manual-compaction': {
      const outcome = record(record(data?.command)?.outcome);
      if (outcome?.kind === 'error') return { title: '上下文压缩失败', summary: typeof outcome.text === 'string' ? outcome.text : '', tone: 'failed', showInChat: false };
      if (data?.compaction != null) return { title: '上下文已整理', summary: '原始记录仍保留', tone: 'done', showInChat: false };
      return { title: '正在整理上下文', summary: '', tone: 'active', showInChat: false };
    }
    case 'compaction': {
      const count = data?.shadowedItemCount;
      return { title: '上下文已整理', summary: typeof count === 'number' ? `已整理 ${count} 条记录 · 原始记录仍保留` : '原始记录仍保留', tone: 'done', showInChat: false };
    }
    case 'question-reply': {
      const first = Array.isArray(data?.questions) ? record(data.questions[0]) : null;
      return { title: '已回答问题', summary: typeof first?.question === 'string' ? first.question : '', tone: 'done', showInChat: false };
    }
    case 'submitted-plan':
      return { title: typeof data?.title === 'string' && data.title !== '' ? data.title : '计划', summary: '已提交计划', tone: 'idle', showInChat: false };
    case 'workflow-run': {
      const run = workflowRunSummary(node.data);
      const summary = workflowStatusLabel(run.status)
        + (run.memberCount != null ? ` · ${run.memberCount} 个子会话` : '')
        + (run.phaseCount != null ? ` · ${run.phaseCount} 个阶段` : '');
      const tone: RecordTone = run.status === 'running' ? 'active' : run.status === 'failed' ? 'failed' : run.status === 'completed' ? 'done' : 'idle';
      return { title: run.name ?? '工作流运行', summary, tone, showInChat: true };
    }
    default: {
      const kind = node.kind !== 'unknown' ? node.kind : typeof data?.type === 'string' ? data.type : '';
      return { title: '工具调用', summary: kind, tone: 'idle', showInChat: true };
    }
  }
}

/** Selected option labels followed by a non-blank custom answer, in display order. */
export function replyAnswerValues(data: unknown, id: string): string[] {
  const answers = record(data)?.answers;
  const answer = Array.isArray(answers) ? answers.map(record).find(item => item?.id === id) : undefined;
  if (!answer) return [];
  const selected = Array.isArray(answer.selected) ? answer.selected.filter((value): value is string => typeof value === 'string') : [];
  const custom = typeof answer.custom === 'string' && answer.custom.trim() !== '' ? [answer.custom.trim()] : [];
  return [...selected, ...custom];
}

const ICONS: Record<string, ComponentType<{ size?: number }>> = {
  'model-retry': IconRefreshOutlineRegular,
  command: IconApiOutlineRegular,
  'manual-compaction': IconCompactOutlineRegular,
  compaction: IconCompactOutlineRegular,
  'question-reply': IconQuestionOutlineRegular,
  'submitted-plan': IconPlanOutlineRegular,
  'workflow-run': IconFlatListOutlineRegular,
};

function RecordJson({ label, payload }: { label: string; payload: unknown }) {
  const text = useMemo(() => { try { return JSON.stringify(payload, null, 2) ?? String(payload); } catch { return String(payload); } }, [payload]);
  return <div className={css.section}><h4 className={css.label}>{label}</h4><pre className={css.raw}>{text}</pre></div>;
}

function RecordBody({ kind, data, view, nodeKey, ...render }: BlockRenderProps & { kind: string; data: unknown; view: RecordView; nodeKey: string }) {
  const { showInChat } = useReaderActions();
  const chatLink = view.showInChat && showInChat
    ? <button type="button" className={css.chatLink} onClick={() => showInChat(nodeKey)} data-reader-show-in-chat>在对话中查看</button>
    : null;
  if (kind === 'question-reply') {
    const questions = Array.isArray(record(data)?.questions) ? (record(data)!.questions as unknown[]).map(record).filter(Boolean) as Record<string, unknown>[] : [];
    return <div className={css.qa}>{questions.map(question => {
      const id = typeof question.id === 'string' ? question.id : '';
      const values = replyAnswerValues(data, id);
      return <div key={id}>
        <p className={css.question}>{typeof question.question === 'string' ? question.question : id}</p>
        {values.length ? <ul className={css.answers}>{values.map(value => <li key={value}>{value}</li>)}</ul> : <p className={css.skipped}>未作答</p>}
      </div>;
    })}</div>;
  }
  if (kind === 'submitted-plan') {
    const markdown = record(data)?.markdown;
    return <Blocks {...render} blocks={[{ kind: 'text', text: typeof markdown === 'string' ? markdown : '' }]} source="tool" />;
  }
  if (kind === 'model-retry') {
    return <JsonTree data={(record(data)?.attempts ?? []) as object} label="模型重试记录" expandTopLevel={false} labels={JSON_TREE_LABELS} />;
  }
  return <div className={css.section}>
    <RecordJson label={kind === 'command' || kind === 'manual-compaction' ? '命令记录' : kind === 'compaction' ? '压缩记录' : kind === 'workflow-run' ? '工作流记录' : '原始记录'} payload={data} />
    {chatLink}
  </div>;
}

/** One process record in the native row grammar; context and prompt rows keep their native presentation. */
export const RecordRow = memo(function RecordRow({ useSession, nodeKey, t, onRead, ...render }: BlockRenderProps & Pick<ReaderProps, 'useSession'> & {
  nodeKey: string; t: ReaderProps['contextT']; onRead: () => void;
}) {
  const node = useChatSelector(useSession, chat => chat.nodes.get(nodeKey));
  const { motion } = useReaderActions();
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => { onRead(); setOpen(value => !value); }, [onRead]);
  if (!node || node.visibility === 'hidden') return null;
  if (node.kind === 'context') return <ContextInjectionRow {...(node.data as ContextMessageNode)} t={t} />;
  if (node.kind === 'system-prompt') {
    const text = nodeText(node.data);
    return text ? <SystemPromptRow text={text} /> : null;
  }
  const view = recordView(node);
  const Icon = ICONS[node.kind] ?? IconSparkleRegular;
  return <div className={css.record} data-reader-record-kind={node.kind} data-record-tone={view.tone}>
    <DisclosureRow icon={<RowGlyph tone={view.tone === 'active' ? 'active' : view.tone === 'failed' ? 'failed' : 'idle'} icon={<Icon size={14} />} />}
      title={view.title} open={open} expandable expandOnRowClick previewChevron keepContentWhenOpen onToggle={toggle} rowClassName={css.row}
      titleClassName={view.tone === 'failed' ? css.failedTitle : view.tone === 'done' ? css.doneTitle : undefined}
      collapsedContent={view.summary ? <><RowSeparator /><span className={css.summary} title={view.summary}>{view.summary}</span></> : undefined} />
    <CollapseBody open={open} motion={motion}><Inset><RecordBody kind={node.kind} data={node.data} view={view} nodeKey={nodeKey} {...render} /></Inset></CollapseBody>
  </div>;
});

/** A human input admitted mid-turn, shown at its chronological position inside the panel. */
export const InputBubble = memo(function InputBubble({ useSession, nodeKey, ...render }: BlockRenderProps & Pick<ReaderProps, 'useSession'> & { nodeKey: string }) {
  const node = useChatSelector(useSession, chat => chat.nodes.get(nodeKey));
  if (!node || node.visibility === 'hidden') return null;
  const label = node.kind === 'steering' ? '补充消息' : node.kind === 'command-input' ? '命令输入' : '用户消息';
  const blocks = node.kind === 'command-input' ? [{ kind: 'text' as const, text: nodeText(node.data) ?? '' }] : contentBlocks(record(node.data)?.content);
  return <div className={css.input} data-reader-input={node.kind} data-reader-key={nodeKey}>
    <div className={css.bubble}><p className={css.inputMeta}>{label}</p><Blocks {...render} blocks={blocks} source="user" /></div>
  </div>;
});

/** Turn-level failure or output-cap notice, kept beside the answer. */
export const TurnNotice = memo(function TurnNotice({ useSession, nodeKey }: Pick<ReaderProps, 'useSession'> & { nodeKey: string }) {
  const node = useChatSelector(useSession, chat => chat.nodes.get(nodeKey));
  if (!node || node.visibility === 'hidden') return null;
  if (node.kind === 'turn-max-tokens') return <div className={css.notice} role="status" data-reader-notice="max-tokens">
    <StateDot state="warning" /><span className={css.noticeTitle} data-tone="warning">已到达输出长度限制</span>
    <span className={css.noticeText}>回答可能尚未完整，已生成的内容仍保留。</span>
  </div>;
  const data = record(node.data);
  const message = typeof data?.message === 'string' ? data.message : '';
  const code = typeof data?.code === 'string' ? data.code : '';
  return <div className={css.notice} role="alert" data-reader-notice="error">
    <StateDot state="error" /><span className={css.noticeTitle} data-tone="error">本轮出现错误</span>
    {message && <span className={css.noticeText}>{message}</span>}
    {code && <code className={css.noticeCode}>{code}</code>}
  </div>;
});
```

`src/client/RecordRows.module.css`：

```css
.record { min-width: 0; }
.row { margin: 0 -6px; padding: 0 6px; border-radius: var(--dsw-radius-sm); transition: background-color var(--cv-fast) ease; }
.row:hover { background: var(--dsw-alias-interactive-bg-hover); }
.failedTitle { color: var(--dsw-alias-state-error-primary); }
.doneTitle { color: var(--dsw-alias-label-secondary); }
.summary { flex: 1 1 auto; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: var(--dsw-alias-label-caption); font-size: var(--cv-font-secondary); }
.section { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.label { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; font-weight: 500; }
.raw { margin: 0; max-height: 320px; overflow: auto; padding: 10px 12px; border-radius: var(--dsw-radius-sm); background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-secondary); font: 12px/18px var(--ds-font-family-code, ui-monospace, monospace); white-space: pre-wrap; overflow-wrap: anywhere; }
.qa { display: flex; flex-direction: column; gap: 10px; }
.question { margin: 0; color: var(--dsw-alias-label-secondary); font-weight: 500; }
.answers { margin: 2px 0 0; padding-left: 18px; color: var(--dsw-alias-label-primary); }
.skipped { margin: 2px 0 0; color: var(--dsw-alias-label-caption); font-size: 12px; }
.chatLink { align-self: flex-start; margin-left: -6px; padding: 2px 6px; border: 0; border-radius: var(--dsw-radius-sm); background: transparent; color: var(--dsw-alias-state-business-primary); font: inherit; font-size: 12px; cursor: pointer; transition: background-color var(--cv-fast) ease; }
.chatLink:hover { background: var(--dsw-alias-interactive-bg-hover); }
.input { display: flex; justify-content: flex-end; margin: 6px 0; }
.bubble { max-width: min(78%, 520px); padding: 6px 12px; border-radius: var(--dsw-radius-md); corner-shape: round; background: var(--dsw-specific-bubble); color: var(--dsw-alias-label-primary); font-size: var(--cv-font-secondary); line-height: 20px; overflow-wrap: anywhere; }
.inputMeta { margin: 0 0 2px; color: var(--dsw-alias-label-caption); font-size: 11px; line-height: 16px; }
.notice { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 8px; min-height: var(--cv-row-height); font-size: var(--cv-font-secondary); line-height: 20px; }
.noticeTitle { font-weight: 600; }
.noticeTitle[data-tone=error] { color: var(--dsw-alias-state-error-primary); }
.noticeTitle[data-tone=warning] { color: var(--dsw-alias-state-warn-primary); }
.noticeText { color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }
.noticeCode { color: var(--dsw-alias-label-tertiary); font: 12px/18px var(--ds-font-family-code, ui-monospace, monospace); }
[data-motion=off] .row, [data-motion=off] .chatLink { transition: none; }
@media (prefers-reduced-motion: reduce) { .row, .chatLink { transition: none; } }
```

- [ ] **Step 5: 实现 `src/client/Opening.tsx` 与样式**

```tsx
import { memo, useState } from 'react';
import type { ComponentType } from 'react';
import {
  IconAgentPresetOutlineRegular, IconAlarmClockOutlineRegular, IconCodeOutlineRegular, IconCordisPluginOutlineRegular,
  IconGoalOutlineRegular, IconLinkOutlineRegular, IconPaperPlaneOutlineRegular, IconQueueOutlineRegular,
  IconUserOutlineRegular, IconUsersOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives';
import { Blocks } from './Blocks.js';
import { useChatSelector } from './compat/session-snapshot.js';
import { CollapseBody } from './motion.js';
import { nodeText } from './node-payloads.js';
import { Chevron } from './ProcessRow.js';
import { useReaderActions } from './reader-context.js';
import { fmtClock } from './turn-meta.js';
import { TRIGGER_EXPLANATION, triggerDetails, type TriggerIcon } from './turn-trigger.js';
import { contentBlocks } from './user-content.js';
import type { BlockRenderProps, ReaderProps } from './types.js';
import css from './Opening.module.css';

const TRIGGER_ICONS: Record<TriggerIcon, ComponentType<{ size?: number }>> = {
  agent: IconUserOutlineRegular,
  github: IconCodeOutlineRegular,
  goal: IconGoalOutlineRegular,
  job: IconQueueOutlineRegular,
  plugin: IconCordisPluginOutlineRegular,
  request: IconPaperPlaneOutlineRegular,
  schedule: IconAlarmClockOutlineRegular,
  subagent: IconAgentPresetOutlineRegular,
  team: IconUsersOutlineRegular,
  webhook: IconLinkOutlineRegular,
};

/** 引用 A、B · 技能 x, from the labels the Chat projection attached to a sent message. */
export function labelsLine(data: unknown): string {
  const value = typeof data === 'object' && data !== null ? data as { referenceLabels?: unknown; skillNames?: unknown } : {};
  const list = (items: unknown) => Array.isArray(items) ? items.filter((item): item is string => typeof item === 'string' && item !== '') : [];
  const references = list(value.referenceLabels);
  const skills = list(value.skillNames);
  return [references.length ? `引用 ${references.join('、')}` : '', skills.length ? `技能 ${skills.join('、')}` : ''].filter(Boolean).join(' · ');
}

function plainText(content: unknown): string {
  return contentBlocks(content).flatMap(block => block.kind === 'text' ? [block.text] : []).join('\n\n');
}

/** What starts a turn: the user's message, a /goal-style command input, or a non-human trigger. */
export const Opening = memo(function Opening({ useSession, nodeKey, ...render }: BlockRenderProps & Pick<ReaderProps, 'useSession'> & { nodeKey: string }) {
  const node = useChatSelector(useSession, chat => chat.nodes.get(nodeKey));
  const { motion } = useReaderActions();
  const [open, setOpen] = useState(false);
  if (!node || node.visibility === 'hidden') return null;
  if (node.kind === 'turn-trigger') {
    const data = node.data as { source?: unknown; content?: unknown; time?: unknown };
    const details = triggerDetails(data.source);
    const Icon = TRIGGER_ICONS[details.icon];
    const time = typeof data.time === 'number' ? fmtClock(data.time) : null;
    const body = plainText(data.content);
    return <div className={css.trigger} data-reader-trigger={details.icon} data-reader-key={nodeKey}>
      <button type="button" className={css.triggerButton} aria-expanded={open} onClick={() => setOpen(value => !value)}>
        <span className={css.triggerIcon} aria-hidden="true"><Icon size={16} /></span>
        <span className={css.triggerTitle}>{details.title}</span>
        {time && <span className={css.triggerTime}>{time}</span>}
        <Chevron open={open} />
      </button>
      <CollapseBody open={open} motion={motion}>
        <div className={css.triggerBody}><p className={css.triggerNote}>{TRIGGER_EXPLANATION}</p>{body || '（原文为空）'}</div>
      </CollapseBody>
    </div>;
  }
  const command = node.kind === 'command-input';
  const blocks = command ? [{ kind: 'text' as const, text: nodeText(node.data) ?? '' }] : contentBlocks((node.data as { content?: unknown }).content);
  const labels = node.kind === 'user' ? labelsLine(node.data) : '';
  return <div className={css.group}>
    <div className={css.user} data-reader-anchor data-reader-key={nodeKey} {...(command ? { 'data-reader-command-input': '' } : {})}>
      {command && <p className={css.meta}>命令输入</p>}
      <Blocks {...render} blocks={blocks} source="user" />
    </div>
    {labels && <div className={css.labels} data-reader-user-labels>{labels}</div>}
  </div>;
});
```

`src/client/Opening.module.css`：

```css
.group { align-self: flex-end; display: flex; flex-direction: column; align-items: flex-end; gap: 6px; max-width: 100%; }
.user {
  max-width: min(calc(var(--dsh-chat-content-width, 748px) * .702), 82%);
  padding: 10px 16px;
  border-radius: var(--dsw-radius-xl);
  corner-shape: round;
  background: var(--dsw-specific-bubble);
  color: var(--dsw-alias-label-primary);
  font-size: var(--cv-font-body);
  line-height: calc(22px + var(--dsh-content-font-delta, 0px));
  overflow-wrap: anywhere;
}
.meta { margin: 0 0 2px; color: var(--dsw-alias-label-caption); font-size: 12px; line-height: 18px; }
.labels { color: var(--dsw-alias-label-tertiary); font-size: var(--cv-font-secondary); line-height: 18px; }
.trigger { border-radius: var(--dsw-radius-lg); corner-shape: round; background: var(--cv-inset-bg); box-shadow: 0 0 0 .5px var(--dsw-alias-border-l1); overflow: hidden; }
.triggerButton { display: flex; align-items: center; gap: 10px; width: 100%; padding: 10px 14px; border: 0; background: transparent; color: var(--dsw-alias-label-tertiary); font: inherit; font-size: var(--cv-font-body); text-align: left; cursor: pointer; transition: color var(--cv-fast) ease, background-color var(--cv-fast) ease; }
.triggerButton:hover { color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-interactive-bg-hover); }
.triggerIcon { display: inline-flex; flex: none; }
.triggerTitle { flex: none; }
.triggerTime { margin-left: auto; color: var(--dsw-alias-label-caption); font-size: 12px; font-variant-numeric: tabular-nums; }
.triggerBody { padding: 0 14px 12px 40px; color: var(--dsw-alias-label-tertiary); font-size: var(--cv-font-secondary); line-height: 21px; white-space: pre-wrap; overflow-wrap: anywhere; }
.triggerNote { margin: 0 0 6px; color: var(--dsw-alias-label-caption); font-size: 12px; }
[data-motion=off] .triggerButton { transition: none; }
@media (prefers-reduced-motion: reduce) { .triggerButton { transition: none; } }
@media (max-width: 600px) { .user { max-width: 90%; } }
```

- [ ] **Step 6: 运行测试与类型检查**

Run: `npm test`
Expected: 全部通过，`records-opening.test.ts` 6 条。

Run: `npm run typecheck`
Expected: 0 错误。若 `JsonTree` 的 `data` 类型不接受 `object`，改为 `data={(record(data)?.attempts ?? []) as unknown as object[]}`。

- [ ] **Step 7: 提交**

```bash
git add -A
git commit -m "feat: render records, mid-turn inputs, notices and turn openings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: `ProcessPanel` + `TurnSection`，接入 Reader 并删除旧组件

**Files:**
- Create: `src/client/ProcessPanel.tsx`、`src/client/ProcessPanel.module.css`
- Create: `src/client/TurnSection.tsx`、`src/client/TurnSection.module.css`
- Create: `tests/process-panel.test.ts`、`tests/turn-section.test.ts`
- Replace: `src/client/Reader.tsx`
- Modify: `src/client/tool-activity.ts`（删除集群与合并失败相关导出）
- Replace: `tests/execution-failure-merge.test.ts` → 改名为 `tests/exit-code.test.ts`
- Delete: `src/client/ToolActivity.tsx`、`src/client/ReasoningCard.tsx`、`tests/operational-cluster.test.ts`

**Interfaces:**
- Consumes: Task 6 的 `layoutTurn`、`groupSteps`、`panelCounts`、`panelStatus`、`statusLabel`、`elapsedLabel`、`runningLabel`；Task 8–10 的行组件；Task 7 的 `ReaderActionsContext`。
- Produces:
  - `ProcessPanel(props: ProcessPanelProps)`，`ProcessPanelProps = { panelKey; status: PanelStatus; statusLabel: string; elapsed: string | null; counts: PanelCounts; items: readonly PanelItem[]; open: boolean; onOpenChange(open): void; earlierOpen: boolean; onEarlierOpen(): void; motion: boolean; isActive(item): boolean; renderItem(item): ReactNode }`
  - DOM：面板根 `[data-reader-panel][data-status]`；头部 `[data-reader-disclosure][data-expanded] > button`；主体 `[data-reader-process][data-reader-process-key={panelKey}]`；步骤 `[data-reader-step]`；「前 N 步」`button[data-reader-earlier]`
  - `TurnSection(props: ReaderProps & { group; pinnedKeys; selectedProcessKeys; rewindHidden; rewindSpans; flowTail? })`，根 `section[data-reader-turn][data-reader-turn-state][data-reader-turn-result]`；回答 `article[data-reader-answer][data-reader-key]`
  - store 键：面板展开 `processChoiceKey(group.key, boundary)`；「前 N 步」展开 `${processChoiceKey(...)}:earlier`

- [ ] **Step 1: 写失败测试 `tests/process-panel.test.ts`**

```ts
import './support/dom.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { render } from './support/render.ts';
import { ProcessPanel } from '../src/client/ProcessPanel.tsx';
import type { PanelItem } from '../src/client/process-steps.ts';
import { toolCall, toolEntry } from './support/chat-fixture.ts';

const think = (step: number): PanelItem => ({ kind: 'reasoning', key: `r${step}`, nodeKey: `n${step}`, start: 0, step });
const tool = (id: string, step: number): PanelItem => ({ kind: 'tool', key: id, entry: toolEntry(id, step, undefined, toolCall(id, 'bash')), step });
const base = {
  panelKey: 'turn:1', statusLabel: '已完成', elapsed: '用时 16 分 39 秒', counts: { steps: 65, tools: 18, failed: 1 },
  onOpenChange: () => {}, earlierOpen: false, onEarlierOpen: () => {}, motion: true, isActive: () => false,
  renderItem: (item: PanelItem) => createElement('div', { 'data-item': item.key }),
};

test('a finished panel is one header bar with its status, time and counts', () => {
  const html = render(ProcessPanel, { ...base, status: 'done', items: [think(1)], open: false });
  assert.match(html, /data-reader-panel="true" data-status="done"/);
  assert.match(html, /data-reader-disclosure="true" data-expanded="false"/);
  assert.match(html, /data-stub="StateDot" data-state="done"/);
  assert.match(html, /已完成[\s\S]*用时 16 分 39 秒[\s\S]*65 步[\s\S]*18 次工具[\s\S]*1 次失败/);
  assert.doesNotMatch(html, /data-reader-process=/);
});

test('a running panel condenses earlier steps and shows the latest step in full', () => {
  const items = [think(1), tool('a', 1), think(2), tool('b', 2)];
  const html = render(ProcessPanel, { ...base, status: 'running', statusLabel: '正在思考', items, open: true, counts: { steps: 2, tools: 2, failed: 0 } });
  assert.match(html, /data-stub="StateDot" data-state="ongoing"/);
  assert.match(html, /data-reader-process="true" data-reader-process-key="turn:1"/);
  assert.match(html, /data-reader-earlier[\s\S]*前 1 步[\s\S]*运行 1 条命令/);
  assert.match(html, /data-reader-step="步骤 2"/);
  assert.match(html, /data-item="b"/);
  assert.doesNotMatch(html, /data-item="a"/);
  assert.doesNotMatch(html, /次失败/);
});

test('an opened earlier range renders every step', () => {
  const items = [think(1), tool('a', 1), think(2), tool('b', 2)];
  const html = render(ProcessPanel, { ...base, status: 'running', statusLabel: '正在思考', items, open: true, earlierOpen: true });
  assert.doesNotMatch(html, /data-reader-earlier/);
  assert.match(html, /data-item="a"[\s\S]*data-item="b"/);
});

test('long runs of tool calls fold behind a count row', () => {
  const items = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(id => tool(id, 1));
  const html = render(ProcessPanel, { ...base, status: 'done', items, open: true });
  assert.match(html, /\+4 次工具调用/);
  assert.match(html, /data-item="e"[\s\S]*data-item="f"[\s\S]*data-item="g"/);
  assert.doesNotMatch(html, /data-item="a"/);
});

test('failed and interrupted panels carry their status for the red ring', () => {
  assert.match(render(ProcessPanel, { ...base, status: 'interrupted', statusLabel: '已中断', items: [think(1)], open: true }), /data-status="interrupted"/);
  assert.match(render(ProcessPanel, { ...base, status: 'waiting', statusLabel: '等待你的操作', items: [think(1)], open: true }), /data-state="warning"/);
});
```

- [ ] **Step 2: 写失败测试 `tests/turn-section.test.ts`**

```ts
import './support/dom.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReaderActionsContext } from '../src/client/reader-context.ts';
import { TurnSection } from '../src/client/TurnSection.tsx';
import { assistantNode, chatNode, chatOf, reasoning, settledTool, text, toolCall, turnLocation } from './support/chat-fixture.ts';
import { sessionHook } from './support/session.ts';

function renderTurn(nodes: ReturnType<typeof chatNode>[], turn: ReturnType<typeof turnLocation> | undefined, options: { selected?: string[]; expanded?: Record<string, boolean>; groupTurn?: number | null } = {}) {
  const chat = chatOf(nodes, turn ? [turn] : []);
  const group = { key: 'turn:1', turn: options.groupTurn === undefined ? 1 : options.groupTurn, keys: nodes.map(node => node.key) };
  const props = {
    useSession: sessionHook(chat),
    useStore: (selector: (state: unknown) => unknown) => selector({ expanded: options.expanded ?? {}, motion: true, collapseThinking: true }),
    actions: { setExpanded: () => {}, setMotion: () => {}, setCollapseThinking: () => {} },
    renderSlotChain: (_n: string, _o: unknown, value: { fallback: unknown }) => value.fallback,
    loadImage: async () => 'blob:x',
    contextT: (key: string) => key,
    group, pinnedKeys: [], selectedProcessKeys: options.selected ?? [], rewindHidden: new Set(), rewindSpans: [],
  };
  const original = console.error;
  console.error = (...args: unknown[]) => { if (!String(args[0]).includes('useLayoutEffect')) original(...args); };
  try {
    return renderToStaticMarkup(createElement(ReaderActionsContext.Provider, { value: { motion: true } }, createElement(TurnSection, props as never)));
  } finally { console.error = original; }
}

function completedTurn() {
  const turn = turnLocation({ status: 'closed', reason: 'completed', start: 0, end: 999_000, steps: [1, 2], closingStep: 2 });
  const user = chatNode('user', { content: [{ type: 'text', text: '做一个场景' }] }, turn);
  const first = assistantNode(turn, 1, [reasoning('先看工作区'), text('我先检查一下。'), toolCall('c1', 'bash', { command: 'ls' })]);
  const tool = chatNode('tool-call', { root: settledTool('c1', 'bash', { command: 'ls' }) }, turn, 1);
  const second = assistantNode(turn, 2, [text('## 实际验证结果')]);
  return { turn, nodes: [user, first, tool, second], second };
}

test('a completed turn collapses its process and keeps the answer in place', () => {
  const { turn, nodes, second } = completedTurn();
  const html = renderTurn(nodes, turn);
  assert.match(html, /data-reader-turn="1" data-reader-turn-state="closed" data-reader-turn-result="completed"/);
  assert.match(html, /data-reader-disclosure="true" data-expanded="false"/);
  assert.match(html, /已完成[\s\S]*用时 16 分 39 秒/);
  assert.match(html, new RegExp(`<article[^>]*data-reader-answer="true"[^>]*data-reader-key="${second.key}"`));
  assert.doesNotMatch(html, /我先检查一下/);
});

test('a live text selection inside the panel keeps a completed turn open', () => {
  const { turn, nodes } = completedTurn();
  const html = renderTurn(nodes, turn, { selected: ['turn:1'] });
  assert.match(html, /data-expanded="true"/);
  assert.match(html, /我先检查一下/);
});

test('a running turn stays open and names its current activity', () => {
  const turn = turnLocation({ status: 'open', start: 0, steps: [1] });
  const user = chatNode('user', { content: [{ type: 'text', text: '修构建' }] }, turn);
  const live = assistantNode(turn, 1, [reasoning('构建报错是因为')], 'running');
  const html = renderTurn([user, live], turn);
  assert.match(html, /data-status="running"/);
  assert.match(html, /data-expanded="true"/);
  assert.match(html, /正在思考/);
});

test('a window that starts mid-turn stays open and neutral', () => {
  const turn = turnLocation({ status: 'unknown', steps: [4] });
  const node = assistantNode(turn, 4, [reasoning('继续'), text('部分说明'), toolCall('c9', 'read')]);
  const tool = chatNode('tool-call', { root: settledTool('c9', 'read', { path: 'a.ts' }) }, turn, 4);
  const html = renderTurn([node, tool], turn);
  assert.match(html, /data-status="unknown"/);
  assert.match(html, /data-expanded="true"/);
  assert.match(html, /执行过程/);
});

test('a turn interrupted on a tool has no answer and stays open', () => {
  const turn = turnLocation({ status: 'closed', reason: 'aborted', steps: [1] });
  const user = chatNode('user', { content: [{ type: 'text', text: '写文件' }] }, turn);
  const only = assistantNode(turn, 1, [text('准备写入'), toolCall('c1', 'write', { path: 'a.ts' })], 'interrupted');
  const started = chatNode('tool-call', { root: { callId: 'c1', name: 'write', phase: 'start', argsRaw: '{"path":"a.ts"}', turn: 1, step: 1, time: 0, subCalls: [] } }, turn, 1);
  const html = renderTurn([user, only, started], turn);
  assert.match(html, /data-status="interrupted"/);
  assert.match(html, /data-expanded="true"/);
  assert.doesNotMatch(html, /data-reader-answer/);
});

test('a scheduled trigger opens its turn without a generic card', () => {
  const turn = turnLocation({ status: 'closed', reason: 'completed', steps: [1], closingStep: 1 });
  const trigger = chatNode('turn-trigger', { source: { kind: 'schedule' }, content: [{ type: 'text', text: '巡检' }], time: 0 }, turn);
  const answer = assistantNode(turn, 1, [text('一切正常')]);
  const html = renderTurn([trigger, answer], turn);
  assert.match(html, /data-reader-trigger="schedule"/);
  assert.doesNotMatch(html, /工具调用/);
  assert.match(html, /一切正常/);
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npm test`
Expected: 两个新测试文件失败（模块不存在）。

- [ ] **Step 4: 实现 `src/client/ProcessPanel.tsx` 与样式**

```tsx
import { Fragment, useId, useState } from 'react';
import type { ReactNode } from 'react';
import { StateDot } from '@deepseek-ai/dsh-client-ui-primitives';
import { CollapseBody, StatusText } from './motion.js';
import { FoldRow } from './ProcessRow.js';
import { groupSteps, type PanelCounts, type PanelEntry, type PanelItem, type PanelStatus } from './process-steps.js';
import css from './ProcessPanel.module.css';

const DOT: Record<Exclude<PanelStatus, 'running'>, 'done' | 'error' | 'warning' | 'idle'> = {
  done: 'done', interrupted: 'error', error: 'error', waiting: 'warning', unknown: 'idle',
};

export interface ProcessPanelProps {
  panelKey: string;
  status: PanelStatus;
  statusLabel: string;
  elapsed: string | null;
  counts: PanelCounts;
  items: readonly PanelItem[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  earlierOpen: boolean;
  onEarlierOpen: () => void;
  motion: boolean;
  isActive: (item: PanelItem) => boolean;
  renderItem: (item: PanelItem) => ReactNode;
}

/** One turn's process in a hairline panel: a status header and step-grouped rows. */
export function ProcessPanel(props: ProcessPanelProps) {
  const bodyId = useId();
  const [openFolds, setOpenFolds] = useState<ReadonlySet<string>>(() => new Set());
  const layout = groupSteps(props.items, { condense: props.status !== 'done' && !props.earlierOpen, isActive: props.isActive });
  const toggleFold = (key: string) => setOpenFolds(previous => {
    const next = new Set(previous);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const renderEntry = (entry: PanelEntry) => entry.kind === 'item'
    ? <Fragment key={entry.item.key}>{props.renderItem(entry.item)}</Fragment>
    : <Fragment key={entry.key}>
      <FoldRow count={entry.items.length} open={openFolds.has(entry.key)} onToggle={() => toggleFold(entry.key)} />
      {openFolds.has(entry.key) && entry.items.map(item => <Fragment key={item.key}>{props.renderItem(item)}</Fragment>)}
    </Fragment>;
  return <div className={css.panel} data-reader-panel data-status={props.status}>
    <div className={css.header} data-reader-disclosure data-expanded={props.open}>
      <button type="button" className={css.headerButton} aria-expanded={props.open} aria-controls={bodyId}
        aria-label={`${props.open ? '收起' : '展开'}执行过程，${props.statusLabel}`} onClick={() => props.onOpenChange(!props.open)}>
        <span className={css.glyph} aria-hidden="true">{props.status === 'running' ? <StateDot state="ongoing" size={12} /> : <StateDot state={DOT[props.status]} />}</span>
        <StatusText text={props.statusLabel} motion={props.motion} shimmer={props.status === 'running'} className={css.status} />
        {props.elapsed && <span className={css.elapsed}>{props.elapsed}</span>}
        <span className={css.spacer} />
        {props.counts.steps > 0 && <span className={css.tag}>{props.counts.steps} 步</span>}
        {props.counts.tools > 0 && <span className={css.tag}>{props.counts.tools} 次工具</span>}
        {props.counts.failed > 0 && <span className={`${css.tag} ${css.tagDanger}`}>{props.counts.failed} 次失败</span>}
        <svg className={css.headerChevron} data-open={props.open} viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="m4 10 4-4 4 4" /></svg>
      </button>
    </div>
    <CollapseBody open={props.open} motion={props.motion}>
      <div id={bodyId} className={css.body} data-reader-process data-reader-process-key={props.panelKey}>
        {layout.earlier && <button type="button" className={css.earlier} onClick={props.onEarlierOpen} data-reader-earlier>
          <svg className={css.earlierChevron} viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="m6 4 4 4-4 4" /></svg>
          <span>前 {layout.earlier.steps} 步</span>
          {layout.earlier.summary && <><span className={css.dot} aria-hidden="true" /><span className={css.earlierSummary}>{layout.earlier.summary}</span></>}
        </button>}
        {layout.groups.map(group => <div key={group.key} className={css.step} data-reader-step={group.label}>
          <div className={css.stepLabel}>{group.label}</div>
          {group.entries.map(renderEntry)}
        </div>)}
      </div>
    </CollapseBody>
  </div>;
}
```

`src/client/ProcessPanel.module.css`：

```css
.panel {
  min-width: 0;
  border-radius: var(--dsw-radius-lg);
  corner-shape: round;
  background: var(--cv-panel-bg);
  box-shadow: var(--cv-panel-ring), var(--dsw-shadow-lv1);
  overflow: hidden;
  contain: paint;
  transition: box-shadow var(--cv-swap) var(--cv-ease);
}
.panel[data-status=error], .panel[data-status=interrupted] { box-shadow: 0 0 0 .5px color-mix(in srgb, var(--dsw-alias-state-error-primary) 45%, transparent), var(--dsw-shadow-lv1); }
.panel[data-status=waiting] { box-shadow: 0 0 0 .5px color-mix(in srgb, var(--dsw-alias-state-business-primary) 45%, transparent), var(--dsw-shadow-lv1); }
.headerButton {
  display: flex; align-items: center; gap: 8px;
  width: 100%; min-height: 38px; padding: 9px 14px;
  border: 0; background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit; font-size: var(--cv-font-secondary); line-height: 20px; text-align: left; cursor: pointer;
  transition: background-color var(--cv-fast) ease;
}
.headerButton:hover { background: color-mix(in srgb, var(--dsw-alias-interactive-bg-hover) 60%, transparent); }
.headerButton:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: -2px; }
.glyph { display: inline-flex; flex: none; align-items: center; justify-content: center; width: 14px; height: 14px; }
.status { font-weight: 500; }
.panel[data-status=running] .status { color: var(--dsw-alias-label-deep-diving, var(--dsw-alias-label-secondary)); }
.panel[data-status=error] .status, .panel[data-status=interrupted] .status { color: var(--dsw-alias-state-error-primary); }
.elapsed { flex: none; color: var(--dsw-alias-label-caption); font-variant-numeric: tabular-nums; }
.spacer { flex: 1; }
.tag { flex: none; padding: 1px 8px; border-radius: 999px; corner-shape: round; background: var(--dsw-alias-bg-layer-3); color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 17px; font-weight: 500; font-variant-numeric: tabular-nums; }
.tagDanger { background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent); color: var(--dsw-alias-state-error-primary); }
.headerChevron { flex: none; color: var(--dsw-alias-label-caption); stroke: currentColor; fill: none; stroke-width: 1.4; stroke-linecap: round; stroke-linejoin: round; transition: transform var(--cv-size) var(--cv-ease); }
.headerChevron[data-open=false] { transform: rotate(180deg); }
.body { display: flex; flex-direction: column; gap: 2px; min-width: 0; padding: 8px 14px 12px; border-top: .5px solid var(--dsw-alias-border-l2); }
.step { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.stepLabel { margin-top: 4px; color: var(--dsw-alias-label-caption); font-size: 11px; line-height: 20px; letter-spacing: .02em; font-variant-numeric: tabular-nums; }
.earlier {
  display: flex; align-items: center; gap: 6px;
  height: var(--cv-row-height); margin: 0 -6px; padding: 0 6px;
  border: 0; border-radius: var(--dsw-radius-sm); background: transparent;
  color: var(--dsw-alias-label-tertiary); font: inherit; font-size: var(--cv-font-secondary); text-align: left; cursor: pointer;
  transition: background-color var(--cv-fast) ease, color var(--cv-fast) ease;
}
.earlier:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-secondary); }
.earlierChevron { flex: none; width: 16px; stroke: currentColor; fill: none; stroke-width: 1.4; stroke-linecap: round; stroke-linejoin: round; }
.dot { flex: none; width: 2px; height: 2px; margin: 0 2px; border-radius: 1px; background: var(--dsw-alias-label-caption); }
.earlierSummary { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: var(--dsw-alias-label-caption); }
[data-motion=off] .panel, [data-motion=off] .headerButton, [data-motion=off] .headerChevron, [data-motion=off] .earlier { transition: none; }
@media (prefers-reduced-motion: reduce) { .panel, .headerButton, .headerChevron, .earlier { transition: none; } }
@container (max-width: 480px) { .elapsed { display: none; } .headerButton { padding: 8px 12px; } .body { padding: 8px 12px 10px; } }
```

- [ ] **Step 5: 实现 `src/client/TurnSection.tsx` 与样式**

```tsx
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { AssistantChatData } from '@deepseek-ai/dsh-client-ui-chat/client';
import { BlockBoundary, Blocks, CopyAnswer } from './Blocks.js';
import { useChatSelector, usePendingSelector } from './compat/session-snapshot.js';
import type { MarkdownFileMentions } from './markdown/render.js';
import { StatusText } from './motion.js';
import { SystemPromptRow } from './native/SystemPromptRow.js';
import { nodeText } from './node-payloads.js';
import { Opening } from './Opening.js';
import { ProcessPanel } from './ProcessPanel.js';
import { elapsedLabel, layoutTurn, panelCounts, panelStatus, runningLabel, statusLabel, type PanelItem } from './process-steps.js';
import { assistantSegments, boundaryOf, processChoiceKey, processExpanded, terminalLabel, type ReaderGroup, type TurnBoundary } from './projection.js';
import { ReasoningRow, reasoningPreview } from './ReasoningRow.js';
import { useReaderActions } from './reader-context.js';
import { createGroupSelector } from './reader-selection.js';
import { InputBubble, RecordRow, TurnNotice } from './RecordRows.js';
import type { RewindSpan } from './rewind-hidden.js';
import { activityPhase, readerFlow } from './tool-activity.js';
import { ToolImages, ToolRow } from './ToolRow.js';
import { closingOf } from './turn-meta.js';
import type { BlockRenderProps, ReaderProps } from './types.js';
import css from './TurnSection.module.css';

const OPENING_KINDS = new Set(['user', 'turn-trigger', 'command-input']);
const EMPTY_BLOCKS: AssistantChatData['blocks'] = [];

type SegmentProps = BlockRenderProps & Pick<ReaderProps, 'useSession'> & { nodeKey: string; start: number; pinned: boolean };

function useSegment(useSession: ReaderProps['useSession'], nodeKey: string, start: number) {
  const node = useChatSelector(useSession, chat => chat.nodes.get(nodeKey));
  const data = node && node.visibility !== 'hidden' && node.kind === 'assistant-step' ? node.data as AssistantChatData : undefined;
  const blocks = data?.blocks ?? EMPTY_BLOCKS;
  const parts = useMemo(() => assistantSegments(blocks), [blocks]);
  const index = parts.findIndex(part => part.start === start);
  return { data, part: index >= 0 ? parts[index] : undefined, last: index === parts.length - 1 };
}

const ReasoningSegment = memo(function ReasoningSegment({ useSession, nodeKey, start, pinned, boundary, panelOpen, compact, onRead, ...render }: SegmentProps & {
  boundary: TurnBoundary; panelOpen: boolean; compact: boolean; onRead: () => void;
}) {
  const { motion } = useReaderActions();
  const { data, part, last } = useSegment(useSession, nodeKey, start);
  const thinkingMs = useMemo(() => {
    const timing = data?.finalNode?.timing;
    if (!timing) return null;
    if (timing.stepStartTime != null && timing.firstTokenTime != null) return Math.max(0, timing.firstTokenTime - timing.stepStartTime);
    if (timing.stepStartTime != null && timing.completedTime != null) return Math.max(0, timing.completedTime - timing.stepStartTime);
    return null;
  }, [data]);
  if (!data || !part) return null;
  const live = data.status === 'running' && last && data.blocks.at(-1)?.kind === 'reasoning';
  const text = part.blocks.map(block => block.kind === 'reasoning' ? block.text : '').join('\n');
  return <ReasoningRow step={data.step} live={live} follow={panelOpen && boundary.status === 'open' && data.step === boundary.latestStep}
    motion={motion} selected={pinned} onRead={onRead} compact={compact} durationMs={thinkingMs} startedAt={data.time}
    charCount={text.length} preview={reasoningPreview(text)}>
    <Blocks {...render} blocks={part.blocks} streaming={live} holdFormatting={pinned} startedAt={data.time} interrupted={data.status === 'interrupted'} liveText />
  </ReasoningRow>;
});

const NarrationSegment = memo(function NarrationSegment({ useSession, nodeKey, start, pinned, ...render }: SegmentProps) {
  const { data, part } = useSegment(useSession, nodeKey, start);
  if (!data || !part) return null;
  return <div className={css.narration} data-reader-narration data-reader-key={nodeKey}>
    <Blocks {...render} blocks={part.blocks} streaming={data.status === 'running'} holdFormatting={pinned} startedAt={data.time} interrupted={data.status === 'interrupted'} liveText />
  </div>;
});

const AnswerSegment = memo(function AnswerSegment({ useSession, nodeKey, start, pinned, fileMentions, ...render }: SegmentProps & { fileMentions?: MarkdownFileMentions }) {
  const { data, part, last } = useSegment(useSession, nodeKey, start);
  if (!data || !part) return null;
  return <article className={css.answer} data-reader-answer data-reader-anchor data-reader-key={nodeKey} data-reader-source-start={start} data-answer-status={data.status}>
    <Blocks {...render} blocks={part.blocks} streaming={data.status === 'running'} holdFormatting={pinned} startedAt={data.time} interrupted={data.status === 'interrupted'} liveText fileMentions={fileMentions} />
    {last && data.status === 'interrupted' && <span className={css.stopped}>已停止</span>}
  </article>;
});

const PromptPreamble = memo(function PromptPreamble({ useSession, nodeKey }: Pick<ReaderProps, 'useSession'> & { nodeKey: string }) {
  const node = useChatSelector(useSession, chat => chat.nodes.get(nodeKey));
  const text = node && node.visibility !== 'hidden' ? nodeText(node.data) : null;
  return text ? <SystemPromptRow text={text} /> : null;
});

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [active]);
  return now;
}

/** One turn: opening → process panel → tool media → answer → notices → footer. */
export const TurnSection = memo(function TurnSection({ group, pinnedKeys, selectedProcessKeys, rewindHidden, rewindSpans, flowTail, ...props }: ReaderProps & {
  group: ReaderGroup; pinnedKeys: readonly string[]; selectedProcessKeys: readonly string[];
  rewindHidden: ReadonlySet<number>; rewindSpans: readonly RewindSpan[]; flowTail?: ReactNode;
}) {
  const { motion, fileMentions } = useReaderActions();
  const selectGroup = useMemo(() => createGroupSelector(group), [group]);
  const chat = useChatSelector(props.useSession, selectGroup);
  const turn = chat.turn;
  const nextBoundary = boundaryOf(turn);
  const boundary = useMemo(() => nextBoundary, [nextBoundary.status, nextBoundary.reason, nextBoundary.latestStep, nextBoundary.closingStep]);
  const pendingCount = usePendingSelector(props.useSession, pending => pending.length);
  const choiceKey = processChoiceKey(group.key, boundary);
  const expansionChoice = props.useStore(state => state.expanded[choiceKey]);
  const earlierOpen = props.useStore(state => state.expanded[`${choiceKey}:earlier`] ?? false);
  const compact = props.useStore(state => state.collapseThinking ?? false);
  const setOpen = useCallback((value: boolean) => props.actions.setExpanded(choiceKey, value), [props.actions, choiceKey]);
  const openEarlier = useCallback(() => props.actions.setExpanded(`${choiceKey}:earlier`, true), [props.actions, choiceKey]);
  const pinPanel = useCallback(() => setOpen(true), [setOpen]);
  const get = useCallback((key: string) => chat.nodes.get(key), [chat]);
  const leading = useMemo(() => {
    let systemPrompts = 0;
    let opening: string | null = null;
    for (const key of group.keys) {
      const node = chat.nodes.get(key);
      if (!node) break;
      if (opening === null && node.kind === 'system-prompt') { systemPrompts++; continue; }
      if (opening === null && OPENING_KINDS.has(node.kind)) { opening = key; continue; }
      break;
    }
    return { systemPrompts, opening };
  }, [chat, group.keys]);
  const preambleKeys = useMemo(() => leading.opening ? group.keys.slice(0, leading.systemPrompts) : [], [leading, group.keys]);
  const mainKeys = useMemo(() => leading.opening ? group.keys.slice(leading.systemPrompts + 1) : group.keys, [leading, group.keys]);
  const flow = useMemo(() => readerFlow({ ...group, keys: mainKeys }, turn, get, { hidden: rewindHidden, spans: rewindSpans }), [group, mainKeys, turn, get, rewindHidden, rewindSpans]);
  const layout = useMemo(() => layoutTurn(flow, get, boundary), [flow, get, boundary]);
  const status = panelStatus(boundary, pendingCount);
  const closed = boundary.status === 'closed';
  const counts = useMemo(() => panelCounts(layout.panel, get, closed), [layout.panel, get, closed]);
  const open = selectedProcessKeys.includes(group.key) || processExpanded(expansionChoice, boundary);
  const now = useNow(status === 'running' || status === 'waiting');
  const label = statusLabel(status, boundary.reason, status === 'running' ? runningLabel(turn, group.keys, get) : '');
  const elapsed = elapsedLabel(turn, now, status);
  const isActive = useCallback((item: PanelItem) => item.kind === 'tool' && ['preparing', 'running'].includes(activityPhase(item.entry, closed)), [closed]);
  const panelPinned = pinnedKeys.includes(group.key);
  const closingSeq = closingOf(turn)?.seq;
  const mentions = useMemo(() => status === 'done' && turn && closingSeq !== undefined ? fileMentions?.(turn, closingSeq) : undefined, [status, turn, closingSeq, fileMentions]);
  const shared = useMemo(() => ({ renderSlotChain: props.renderSlotChain, loadImage: props.loadImage }), [props.renderSlotChain, props.loadImage]);
  const renderItem = useCallback((item: PanelItem): ReactNode => {
    switch (item.kind) {
      case 'reasoning': return <BlockBoundary><ReasoningSegment {...shared} useSession={props.useSession} nodeKey={item.nodeKey} start={item.start} pinned={panelPinned} boundary={boundary} panelOpen={open} compact={compact} onRead={pinPanel} /></BlockBoundary>;
      case 'narration': return <BlockBoundary><NarrationSegment {...shared} useSession={props.useSession} nodeKey={item.nodeKey} start={item.start} pinned={panelPinned} /></BlockBoundary>;
      case 'tool': return <BlockBoundary><ToolRow {...shared} entry={item.entry} turnClosed={closed} onRead={pinPanel} /></BlockBoundary>;
      case 'record': return <BlockBoundary><RecordRow {...shared} useSession={props.useSession} nodeKey={item.nodeKey} t={props.contextT} onRead={pinPanel} /></BlockBoundary>;
      case 'input': return <BlockBoundary><InputBubble {...shared} useSession={props.useSession} nodeKey={item.nodeKey} /></BlockBoundary>;
    }
  }, [shared, props.useSession, props.contextT, panelPinned, boundary, open, compact, pinPanel, closed]);
  const answerBlocks = useMemo(() => layout.answer.flatMap(segment => {
    const node = get(segment.nodeKey);
    if (!node || node.kind !== 'assistant-step') return [];
    return assistantSegments((node.data as AssistantChatData).blocks).find(part => part.start === segment.start)?.blocks ?? [];
  }), [layout.answer, get]);
  const terminal = terminalLabel(boundary.reason);
  const showTerminal = terminal && boundary.reason !== 'error' && boundary.reason !== 'max-tokens';
  return <section className={css.turn} data-reader-turn={group.turn ?? 'unresolved'} data-reader-turn-state={boundary.status} data-reader-turn-result={boundary.reason ?? undefined}>
    {preambleKeys.map(key => <BlockBoundary key={key}><PromptPreamble useSession={props.useSession} nodeKey={key} /></BlockBoundary>)}
    {leading.opening && <BlockBoundary><Opening {...shared} useSession={props.useSession} nodeKey={leading.opening} /></BlockBoundary>}
    {layout.panel.length > 0 && <ProcessPanel panelKey={group.key} status={status} statusLabel={label} elapsed={elapsed} counts={counts}
      items={layout.panel} open={open} onOpenChange={setOpen} earlierOpen={earlierOpen} onEarlierOpen={openEarlier}
      motion={motion} isActive={isActive} renderItem={renderItem} />}
    {layout.panel.length === 0 && boundary.status === 'open' && <div className={css.statusOnly} data-reader-status-only>
      <StatusText text={label} motion={motion} shimmer={status === 'running'} />
    </div>}
    {layout.media.length > 0 && <BlockBoundary><ToolImages {...shared} entries={layout.media} /></BlockBoundary>}
    {layout.answer.map((segment, index) => <BlockBoundary key={segment.key}>
      <AnswerSegment {...shared} useSession={props.useSession} nodeKey={segment.nodeKey} start={segment.start}
        pinned={pinnedKeys.includes(segment.nodeKey)} fileMentions={index === layout.answer.length - 1 ? mentions : undefined} />
    </BlockBoundary>)}
    {layout.notices.map(key => <BlockBoundary key={key}><TurnNotice useSession={props.useSession} nodeKey={key} /></BlockBoundary>)}
    {showTerminal && <p className={css.terminal} data-reader-terminal>{terminal}</p>}
    {status === 'done' && <CopyAnswer blocks={answerBlocks} />}
    {flowTail}
  </section>;
});
```

`src/client/TurnSection.module.css`：

```css
.turn { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.turn + .turn { margin-top: 20px; }
.statusOnly { display: flex; align-items: center; min-height: var(--cv-row-height); color: var(--dsw-alias-label-secondary); font-size: var(--cv-font-secondary); }
.narration { min-width: 0; margin: 2px 0 6px; color: var(--dsw-alias-label-secondary); font-size: var(--cv-font-body); line-height: var(--cv-line-body); overflow-wrap: anywhere; }
.answer { display: flex; flex-direction: column; min-width: 0; overflow-wrap: anywhere; }
[data-reader-panel] + .answer { margin-top: 4px; }
.stopped { align-self: flex-start; margin-top: 8px; padding: 1px 8px; border-radius: 999px; corner-shape: round; background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 17px; font-weight: 500; }
.terminal { margin: 0; color: var(--dsw-alias-label-caption); font-size: 12px; line-height: 18px; }
@media (max-width: 600px) { .turn + .turn { margin-top: 16px; } }
```

- [ ] **Step 6: 替换 `src/client/Reader.tsx`**

整文件替换为下面内容。和旧文件相比：`TurnGroup`、`AssistantNode`、`MainNode`、`ProcessNode`、`NoticeCard`、`CommandRecord`、`CompactionRecord`、`RecordJson`、`GenericCallCard`、`GroupStatus`、`OperationalClusterBlock` 全部移除；新增 `ReaderActionsContext` 提供者；运行状态条与回到最新按钮暂时保持原样（Task 13 再替换）。

```tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { FileChangesPanel } from './FileChanges.js';
import { TurnSection } from './TurnSection.js';
import { formatSeconds } from './turn-activity.js';
import { useTurnActivity } from './use-turn-activity.js';
import { MountFade, useContentWidth, useMotionAllowed, usePinnedSelection, useReadingScroll } from './motion.js';
import { StreamMotionContext } from './streaming.js';
import { ReaderActionsContext, type ReaderActions } from './reader-context.js';
import { useCompatReaderProps, useChatSelector, usePendingSelector, useSessionSelector, readerSnapshot } from './compat/session-snapshot.js';
import { READER_COMPAT_MOUNT_EVENT, READER_COMPAT_UNMOUNT_EVENT, registerReaderSnapshot } from './compat/reader-root.js';
import { createReaderStructureSelector } from './reader-selection.js';
import { READER_VERSION } from './version.js';
import type { ReaderProps } from './types.js';
import css from './Reader.module.css';

function Switch({ label, checked, onChange, title }: { label: string; checked: boolean; onChange: () => void; title?: string }) {
  return <button type="button" className={css.switchButton} role="switch" aria-checked={checked} onClick={onChange} title={title}>
    <span className={css.switchLabel} data-checked={checked}>{label}</span>
  </button>;
}

export function Reader(rawProps: ReaderProps) {
  const props = useCompatReaderProps(rawProps);
  const root = useRef<HTMLDivElement>(null);
  const activatedAt = useRef(Date.now());
  const selectStructure = useMemo(createReaderStructureSelector, [props.sessionId]);
  const { visibleOrder, groups, hidden: rewindHidden, spans: rewindSpans, latestUserKey } = useChatSelector(props.useSession, selectStructure);
  const pending = usePendingSelector(props.useSession, value => value, (a, b) => a.length === b.length && a.every((item, index) => item === b[index]));
  const openError = useSessionSelector(props.useSession, snapshot => snapshot.openError);
  const loading = useSessionSelector(props.useSession, snapshot => snapshot.openState === 'loading');
  const hasMore = useSessionSelector(props.useSession, snapshot => snapshot.hasMore);
  const loadingOlder = useSessionSelector(props.useSession, snapshot => snapshot.loadingOlder);
  const motionPreference = props.useStore(state => state.motion);
  const collapseThinking = props.useStore(state => state.collapseThinking ?? false);
  const motion = useMotionAllowed(motionPreference);
  const activity = useTurnActivity(props.useSession);
  const conversationIdle = !activity.key && pending.length === 0 && !loading;
  const streamMotion = useMemo(() => ({ enabled: motion, activatedAt: activatedAt.current }), [motion]);
  const scroll = useReadingScroll(root, motion);
  const { openFile, fork, fileMentions, inspectCall, openView } = props;
  const actions = useMemo<ReaderActions>(() => ({
    motion,
    openFile: openFile ? path => { void openFile(path).catch(() => {}); } : undefined,
    fork,
    fileMentions,
    inspectCall,
    showInChat: focus => openView('chat', focus),
  }), [motion, openFile, fork, fileMentions, inspectCall, openView]);
  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const unregister = registerReaderSnapshot(node, () => readerSnapshot(props.useSession));
    document.dispatchEvent(new CustomEvent<HTMLElement>(READER_COMPAT_MOUNT_EVENT, { detail: node }));
    return () => { document.dispatchEvent(new CustomEvent<HTMLElement>(READER_COMPAT_UNMOUNT_EVENT, { detail: node })); unregister(); };
  }, [props.useSession]);
  const [trackActivityWidth, activityWidth] = useContentWidth();
  useEffect(() => {
    const content = root.current;
    if (!content) return;
    const host = content.closest<HTMLElement>('[data-conversation-scroll]');
    if (!host) return;
    const fit = () => {
      const composer = parseFloat(getComputedStyle(host).getPropertyValue('--dsh-composer-height')) || 152;
      const own = getComputedStyle(content);
      const padding = (parseFloat(own.paddingTop) || 0) + (parseFloat(own.paddingBottom) || 0);
      content.style.setProperty('--reader-flow-min-height', `${Math.max(0, host.clientHeight - composer - padding)}px`);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(host);
    const attributes = new MutationObserver(fit);
    attributes.observe(host, { attributes: true, attributeFilter: ['style'] });
    return () => { observer.disconnect(); attributes.disconnect(); };
  }, []);
  const seenUserKeys = useRef(new Set<string>());
  const previousLatestUserKey = useRef<string | null>(null);
  useEffect(() => {
    const previous = previousLatestUserKey.current;
    const latest = latestUserKey;
    if (latest && previous && latest !== previous && !seenUserKeys.current.has(latest)) {
      const previousIndex = visibleOrder.indexOf(previous);
      const latestIndex = visibleOrder.indexOf(latest);
      if (previousIndex >= 0 && latestIndex > previousIndex) scroll.jump();
    }
    if (latest) seenUserKeys.current.add(latest);
    previousLatestUserKey.current = latest;
  }, [latestUserKey]);
  const pinnedKeys = usePinnedSelection(root);
  const selectedProcessKeys = usePinnedSelection(root, '[data-reader-process]');
  const [historyError, setHistoryError] = useState(false);
  const fileChanges = useMemo(() => (
    <FileChangesPanel
      useProjection={props.useProjection}
      jobsSource={props.jobsSource}
      watchJobs={props.watchJobs}
      useSession={props.useSession}
      useSessions={props.useSessions}
      sessionId={props.sessionId}
      order={visibleOrder}
      motion={motion}
      hasMore={hasMore}
      conversationIdle={conversationIdle}
      openFile={props.openFile}
      listDirNames={props.listDirNames}
    />
  ), [props.useProjection, props.jobsSource, props.watchJobs, props.useSession, props.useSessions, props.sessionId, visibleOrder, motion, hasMore, conversationIdle, props.openFile, props.listDirNames]);
  return <StreamMotionContext.Provider value={streamMotion}><ReaderActionsContext.Provider value={actions}>
    <div ref={root} className={css.root} data-dsh-clearview={READER_VERSION} data-motion={motion ? 'on' : 'off'}>
      <div className={css.column}>
        <div className={css.toolbar} data-ud-check="reader-toolbar">
          <Switch label={`折叠思考${collapseThinking ? '开' : '关'}`} checked={collapseThinking} onChange={() => props.actions.setCollapseThinking(!collapseThinking)}
            title="开启后，已完成的思考只保留一行；关闭后显示前三行预览。" />
          <Switch label={`动效${motionPreference ? '开' : '关'}`} checked={motionPreference} onChange={() => props.actions.setMotion(!motionPreference)}
            title="新到文字柔和显现，过程平滑展开；关闭后立即完整显示，自动遵循系统减少动态效果设置。" />
        </div>
        {hasMore && <button type="button" className={css.historyButton} disabled={loadingOlder} onClick={async () => {
          setHistoryError(false);
          try { await props.loadOlder(); } catch { setHistoryError(true); }
        }}>{loadingOlder ? '正在加载更早记录' : '加载更早记录'}</button>}
        {historyError && <div className={css.notice}>历史记录加载失败，可再次尝试；现有内容未改变。</div>}
        {openError && <div className={css.error} role="alert">会话暂时无法读取：{openError.message}</div>}
        {loading && groups.length === 0 && <p className={css.empty} role="status">正在读取会话…</p>}
        {groups.map((group, index) => <TurnSection key={group.key} {...props} group={group} pinnedKeys={pinnedKeys} selectedProcessKeys={selectedProcessKeys}
          rewindHidden={rewindHidden} rewindSpans={rewindSpans} flowTail={index === groups.length - 1 ? fileChanges : undefined} />)}
        {pending.length > 0 && <MountFade mounted={pending.length > 0} motion={motion}>{({ entering }) =>
          <div className={`${css.attention} ${entering ? css.isEntering : css.isIn}`} role="alert" data-reader-attention>
            <strong>{pending.some(item => item.kind === 'question') ? '需要你回答一个问题' : '需要你的确认'}</strong>
            <span>请在下方原生操作区处理。此提示不会收进执行过程。</span>
          </div>}</MountFade>}
        <MountFade mounted={!!activity.key} motion={motion}>{({ entering }) => activity.key ? (
          <button type="button" className={`${css.activityBar} ${entering ? css.isEntering : css.isIn}`}
            style={activityWidth === null ? undefined : { width: `${activityWidth}px` }}
            data-detached={scroll.detached ? 'true' : undefined} data-phase={activity.phase} data-ud-check="reader-activity-bar"
            title={scroll.detached ? '回到最新' : undefined} onClick={scroll.jump}>
            <span className={css.activityBarContent} ref={trackActivityWidth}>
              <span className={css.activityText} role="status" data-reader-activity-label>{activity.label}</span>
              {activity.seconds !== null && <span className={css.activityTimer} data-reader-activity-timer aria-hidden="true">{formatSeconds(activity.seconds)}</span>}
            </span>
          </button>
        ) : null}</MountFade>
        <MountFade mounted={scroll.detached && !activity.key} motion={motion}>{({ entering }) => scroll.detached && !activity.key ? (
          <div className={`${css.jumpDock} ${entering ? css.isEntering : css.isIn}`}><button type="button" className={css.jump} onClick={scroll.jump} aria-label="回到最新" title="回到最新">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 3v10m-4-4 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button></div>
        ) : null}</MountFade>
      </div>
    </div>
  </ReaderActionsContext.Provider></StreamMotionContext.Provider>;
}
```

（运行状态条里的三星图标在这里已去掉，Task 13 再整体换成 `FloatingStatus`。）

- [ ] **Step 7: 删除旧组件与集群逻辑**

```bash
git rm src/client/ToolActivity.tsx src/client/ReasoningCard.tsx tests/operational-cluster.test.ts
git mv tests/execution-failure-merge.test.ts tests/exit-code.test.ts
```

`src/client/tool-activity.ts`：删除 `isMergedExecutionFailure`（含其上方注释）、`OperationalClusterSummary`、`OperationalFlowItem`、`formatOperationClusterSummary`、`groupOperationalFlow`。

`tests/exit-code.test.ts` 整文件替换为：

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exitCodeFromOutput } from '../src/client/tool-activity.ts';

test('exitCodeFromOutput: recovers the code the harness embeds in failure text', () => {
  assert.equal(exitCodeFromOutput('Error: grep search failed (exit 2): rg: /x: IO error', true), 2);
  assert.equal(exitCodeFromOutput('Error: exit code: 1 (no output)', true), 1);
  assert.equal(exitCodeFromOutput('exit code： 3', true), 3);
});

test('exitCodeFromOutput: no usable code — undefined, never a fabricated zero', () => {
  assert.equal(exitCodeFromOutput('Error: grep could not start its search command (ripgrep launch failed)', true), undefined);
  assert.equal(exitCodeFromOutput('Error: grep pattern rejected by ripgrep: rg: regex parse error', true), undefined);
  assert.equal(exitCodeFromOutput('Error: exit code: 0', true), undefined);
  assert.equal(exitCodeFromOutput('Error: grep search failed (exit 2)', false), undefined);
});
```

确认没有残留引用：

```bash
grep -rn "ToolActivity\|ReasoningCard\|groupOperationalFlow\|isMergedExecutionFailure\|OperationalCluster" src tests || echo CLEAN
```

Expected: 输出 `CLEAN`。

- [ ] **Step 8: 运行测试与类型检查**

Run: `npm test`
Expected: 全部通过（`process-panel` 5 条、`turn-section` 6 条；`operational-cluster` 与合并失败的旧测试已移除）。

Run: `npm run typecheck`
Expected: 0 错误。

- [ ] **Step 9: 提交**

```bash
git add -A
git commit -m "feat: lay out each turn as opening, process panel and answer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 12: `TurnFooter`：交付卡片、复制、分支与元信息

**Files:**
- Create: `src/client/TurnFooter.tsx`、`src/client/TurnFooter.module.css`
- Create: `tests/turn-footer.test.ts`
- Modify: `src/client/TurnSection.tsx`（用 `TurnFooter` 取代 `CopyAnswer`）

**Interfaces:**
- Consumes: `presentedFiles`、`turnMeta`、`turnMetaText`、`PresentedFileRef`（Task 3）；`useReaderActions()` 的 `fork`、`openFile`；原生 `writeClipboard`、`IconCopyOutlineRegular`、`IconBranchOutlineRegular`、`IconDeliverDocRegular`。
- Produces: `TurnFooter({ turn, answerText, now? })`（根元素 `data-reader-turn-footer`；操作行 `data-reader-answer-actions`）；`Deliverables({ files, openFile? })`（根元素 `data-reader-deliverables`，最多显示 4 个，其余折叠）。

- [ ] **Step 1: 写失败测试 `tests/turn-footer.test.ts`**

```ts
import './support/dom.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReaderActionsContext, type ReaderActions } from '../src/client/reader-context.ts';
import { TurnFooter } from '../src/client/TurnFooter.tsx';
import { turnLocation } from './support/chat-fixture.ts';

const NOW = new Date(2026, 9, 5, 12, 0);
const footer = (actions: ReaderActions, props: Parameters<typeof TurnFooter>[0]) =>
  renderToStaticMarkup(createElement(ReaderActionsContext.Provider, { value: actions }, createElement(TurnFooter, props)));

function closedTurn(presented: unknown[] = []) {
  return turnLocation({
    status: 'closed', reason: 'completed', start: new Date(2026, 8, 24, 17, 3, 41).getTime(), end: new Date(2026, 8, 24, 17, 20, 20).getTime(),
    data: {
      'turn-tail': { closing: { step: 2, time: new Date(2026, 8, 24, 17, 20).getTime(), finalNode: { seq: 88 } }, tokenUsage: { totalTokens: 11_400_000 } },
      deliverables: { produced: [], presented },
    },
  });
}

test('a finished turn offers copy, fork, delivered files and its meta line', () => {
  const html = footer({ motion: true, fork: async () => {}, openFile: () => {} }, {
    turn: closedTurn([{ path: 'README.md', description: '运行、构建与结构说明', seq: 20, index: 0 }, { path: 'artifacts/scene.png', seq: 21, index: 0 }]),
    answerText: '## 实际验证结果', now: NOW,
  });
  assert.match(html, /aria-label="复制回答"/);
  assert.match(html, /aria-label="从这里分支"/);
  assert.match(html, /9月24日 17:20 · 用时 16分39秒 · 用量 11.4M tok/);
  assert.match(html, /README.md[\s\S]*运行、构建与结构说明/);
  assert.match(html, /scene.png[\s\S]*artifacts\/scene.png/);
});

test('without a fork service or answer text the matching buttons are absent', () => {
  const html = footer({ motion: true }, { turn: closedTurn(), answerText: '   ', now: NOW });
  assert.doesNotMatch(html, /复制回答/);
  assert.doesNotMatch(html, /从这里分支/);
  assert.match(html, /用时 16分39秒/);
});

test('nothing to show renders nothing', () => {
  assert.equal(footer({ motion: true }, { turn: undefined, answerText: '', now: NOW }), '');
});

test('more than four deliveries fold the rest, and cards stay inert without an opener', () => {
  const presented = ['a', 'b', 'c', 'd', 'e'].map((name, index) => ({ path: `${name}.md`, seq: 10 + index, index: 0 }));
  const html = footer({ motion: true }, { turn: closedTurn(presented), answerText: 'x', now: NOW });
  assert.match(html, /展开其余 1 个/);
  assert.doesNotMatch(html, /e\.md/);
  assert.match(html, /<button type="button" class="card" disabled=""/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test`
Expected: `turn-footer.test.ts` 失败（模块不存在）。

- [ ] **Step 3: 实现 `src/client/TurnFooter.tsx` 与样式**

```tsx
import { useEffect, useRef, useState } from 'react';
import type { TurnLocation } from '@deepseek-ai/dsh-client-ui-conversation/client';
import { IconBranchOutlineRegular, IconCopyOutlineRegular, IconDeliverDocRegular, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives';
import { useReaderActions } from './reader-context.js';
import { presentedFiles, turnMeta, turnMetaText, type PresentedFileRef } from './turn-meta.js';
import css from './TurnFooter.module.css';

const DELIVERY_LIMIT = 4;

function basename(path: string): string {
  return path.split(/[/\\]/).filter(Boolean).at(-1) ?? path;
}

/** Files the turn explicitly delivered; a card opens the sidebar preview. */
export function Deliverables({ files, openFile }: { files: readonly PresentedFileRef[]; openFile?: (path: string) => void }) {
  const [showAll, setShowAll] = useState(false);
  if (files.length === 0) return null;
  const visible = showAll ? files : files.slice(0, DELIVERY_LIMIT);
  return <div className={css.deliverables} data-count={files.length === 1 ? '1' : undefined} data-reader-deliverables>
    {visible.map(file => <button key={file.path} type="button" className={css.card} disabled={!openFile} title={file.path} onClick={() => openFile?.(file.path)}>
      <span className={css.cardIcon} aria-hidden="true"><IconDeliverDocRegular size={16} /></span>
      <span className={css.cardText}>
        <span className={css.cardName}>{basename(file.path)}</span>
        <span className={css.cardDesc}>{file.description ?? file.path}</span>
      </span>
    </button>)}
    {files.length > visible.length && <button type="button" className={css.more} onClick={() => setShowAll(true)}>展开其余 {files.length - visible.length} 个</button>}
  </div>;
}

/** Closing row of a finished turn: deliveries, copy, fork, and clock · duration · usage. */
export function TurnFooter({ turn, answerText, now }: { turn: TurnLocation | undefined; answerText: string; now?: Date }) {
  const { fork, openFile } = useReaderActions();
  const [receipt, setReceipt] = useState('');
  const [failed, setFailed] = useState(false);
  const [forking, setForking] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const meta = turnMetaText(turnMeta(turn, now));
  const files = presentedFiles(turn);
  const endSeq = turn?.end?.seq;
  const canCopy = answerText.trim() !== '';
  if (!canCopy && !meta && files.length === 0) return null;
  const flash = (text: string, error: boolean, ms: number) => {
    setReceipt(text); setFailed(error);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { setReceipt(''); setFailed(false); }, ms);
  };
  return <div className={css.footer} data-reader-turn-footer>
    <Deliverables files={files} openFile={openFile} />
    <div className={css.actions} data-reader-answer-actions>
      {canCopy && <button type="button" className={css.action} aria-label="复制回答" title="复制回答" onClick={async () => {
        const accepted = await writeClipboard(answerText);
        flash(accepted ? '已复制' : '未能复制，请手动选择文字', false, 2000);
      }}><IconCopyOutlineRegular size={15} /></button>}
      {fork && typeof endSeq === 'number' && <button type="button" className={css.action} aria-label="从这里分支" title="从这里分支" disabled={forking} onClick={async () => {
        setForking(true);
        try { await fork(endSeq); } catch (error) { flash(`分支失败：${error instanceof Error ? error.message : String(error)}`, true, 5000); } finally { setForking(false); }
      }}><IconBranchOutlineRegular size={15} /></button>}
      {meta && <span className={css.meta}>{meta}</span>}
      <span role="status" className={failed ? css.error : css.receipt}>{receipt}</span>
    </div>
  </div>;
}
```

`src/client/TurnFooter.module.css`：

```css
.footer { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.deliverables { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.deliverables[data-count="1"] { grid-template-columns: minmax(0, 1fr); }
.card {
  display: flex; align-items: center; gap: 10px; min-width: 0;
  padding: 10px 12px;
  border: .5px solid var(--dsw-alias-border-l3); border-radius: var(--dsw-radius-lg); corner-shape: round;
  background: color-mix(in srgb, var(--dsw-alias-bg-layer-1) 60%, transparent);
  color: inherit; font: inherit; text-align: left; cursor: pointer;
  transition: background-color var(--cv-fast) ease, border-color var(--cv-fast) ease;
}
.card:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); border-color: var(--dsw-alias-border-l4); }
.card:disabled { cursor: default; }
.cardIcon { display: inline-flex; flex: none; align-items: center; justify-content: center; width: 32px; height: 32px; border: .5px solid var(--dsw-alias-border-l3); border-radius: var(--dsw-radius-sm); corner-shape: round; background: color-mix(in srgb, #fff 50%, transparent); color: var(--dsw-alias-state-business-primary); }
:global(body[data-ds-dark-theme]) .cardIcon { background: color-mix(in srgb, #fff 5%, transparent); }
.cardText { display: flex; flex-direction: column; min-width: 0; }
.cardName { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: var(--dsw-alias-label-primary); font-size: var(--cv-font-secondary); line-height: 20px; font-weight: 500; }
.cardDesc { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: var(--dsw-alias-label-caption); font-size: 12px; line-height: 16px; }
.more { justify-self: start; padding: 2px 6px; border: 0; border-radius: var(--dsw-radius-sm); background: transparent; color: var(--dsw-alias-label-tertiary); font: inherit; font-size: 12px; cursor: pointer; }
.more:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-secondary); }
.actions { display: flex; align-items: center; gap: 4px; min-height: 28px; margin-left: -6px; color: var(--dsw-alias-label-tertiary); }
.action { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0; border: 0; border-radius: var(--dsw-radius-sm); background: transparent; color: inherit; cursor: pointer; transition: background-color var(--cv-fast) ease, color var(--cv-fast) ease, transform var(--cv-fast) ease; }
.action:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-secondary); }
.action:active:not(:disabled) { transform: scale(.96); }
.action:disabled { opacity: .4; cursor: default; }
.meta { min-width: 0; margin-left: 8px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: var(--dsw-alias-label-caption); font-size: 12px; line-height: 18px; font-variant-numeric: tabular-nums; }
.receipt { color: var(--dsw-alias-label-caption); font-size: 12px; }
.error { color: var(--dsw-alias-state-error-primary); font-size: 12px; }
[data-motion=off] .card, [data-motion=off] .action { transition: none; }
@media (prefers-reduced-motion: reduce) { .card, .action { transition: none; } }
@container (max-width: 480px) { .deliverables { grid-template-columns: minmax(0, 1fr); } }
```

- [ ] **Step 4: 在 `TurnSection` 里接入**

`src/client/TurnSection.tsx`：import 由 `import { BlockBoundary, Blocks, CopyAnswer } from './Blocks.js';` 改为 `import { BlockBoundary, Blocks } from './Blocks.js';`，并加 `import { TurnFooter } from './TurnFooter.js';`。在 `answerBlocks` 下面加：

```tsx
  const answerText = useMemo(() => answerBlocks.flatMap(block => block.kind === 'text' ? [block.text] : []).join('\n\n'), [answerBlocks]);
```

把 `{status === 'done' && <CopyAnswer blocks={answerBlocks} />}` 替换为：

```tsx
    {closed && <TurnFooter turn={turn} answerText={answerText} />}
```

- [ ] **Step 5: 运行测试与类型检查**

Run: `npm test`
Expected: 全部通过，`turn-footer.test.ts` 4 条；`turn-section.test.ts` 仍然通过。

Run: `npm run typecheck`
Expected: 0 错误。

- [ ] **Step 6: 提交**

```bash
git add -A
git commit -m "feat: close finished turns with deliveries, copy, fork and meta

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: 浮动状态、阅读位置、视图聚焦请求与文件改动面板

**Files:**
- Create: `src/client/FloatingStatus.tsx`、`src/client/FloatingStatus.module.css`
- Create: `src/client/reading-position.ts`
- Create: `src/client/FileChanges.module.css`
- Create: `tests/floating-status.test.ts`、`tests/reading-position.test.ts`
- Modify: `src/client/motion.tsx`（`useReadingScroll` 记忆与恢复位置）
- Modify: `src/client/Reader.tsx`（接入 `FloatingStatus`、`viewRequest`、去掉流高度测量）
- Modify: `src/client/FileChanges.tsx`（新样式与 `CollapseBody`）

**Interfaces:**
- Consumes: `ActivityView`（`use-turn-activity.ts`）、`formatSeconds`、`MountFade`、`Chevron`、`CollapseBody`。
- Produces:
  - `FloatingStatus({ activity, detached, onJump, motion })`：运行中且离开底部 → `button[data-reader-activity-pill]`；空闲且离开底部 → `button[data-reader-jump]`；在底部 → 不渲染
  - `pickAnchor(anchors: readonly { key: string; top: number; bottom: number }[], viewportTop: number): SavedPosition | null`、`rememberPosition(sessionId, position | null)`、`recallPosition(sessionId)`，`SavedPosition = { anchorKey: string; offset: number }`
  - `useReadingScroll(root, motion, sessionId?)`

- [ ] **Step 1: 写失败测试**

`tests/floating-status.test.ts`：

```ts
import './support/dom.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render } from './support/render.ts';
import { FloatingStatus } from '../src/client/FloatingStatus.tsx';

const running = { label: '正在思考', seconds: 134, key: 'open:3:reasoning', phase: 'thinking' as const };
const idle = { label: '', seconds: null, key: null, phase: 'idle' as const };

test('a running turn scrolled away shows the status pill', () => {
  const html = render(FloatingStatus, { activity: running, detached: true, onJump: () => {}, motion: true });
  assert.match(html, /data-reader-activity-pill/);
  assert.match(html, /data-stub="StateDot" data-state="ongoing"/);
  assert.match(html, /正在思考[\s\S]*2 分 14 秒/);
  assert.doesNotMatch(html, /data-reader-jump/);
});

test('an idle reader scrolled away shows the round jump button', () => {
  const html = render(FloatingStatus, { activity: idle, detached: true, onJump: () => {}, motion: true });
  assert.match(html, /data-reader-jump/);
  assert.doesNotMatch(html, /data-reader-activity-pill/);
});

test('nothing floats while the reader is at the latest content', () => {
  assert.equal(render(FloatingStatus, { activity: running, detached: false, onJump: () => {}, motion: true }), '');
});

test('waiting for the user freezes the pill into an attention dot', () => {
  const html = render(FloatingStatus, { activity: { ...running, phase: 'waiting', label: '等待你的操作', seconds: null }, detached: true, onJump: () => {}, motion: true });
  assert.match(html, /data-state="warning"/);
});
```

`tests/reading-position.test.ts`：

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickAnchor, recallPosition, rememberPosition } from '../src/client/reading-position.ts';

test('the anchor is the first element still visible below the viewport top', () => {
  const anchors = [{ key: 'a', top: -400, bottom: -20 }, { key: 'b', top: -60, bottom: 300 }, { key: 'c', top: 310, bottom: 600 }];
  assert.deepEqual(pickAnchor(anchors, 0), { anchorKey: 'b', offset: -60 });
  assert.equal(pickAnchor([{ key: 'a', top: -400, bottom: -20 }], 0), null);
});

test('positions are remembered per session and cleared when following the bottom', () => {
  rememberPosition('s1', { anchorKey: 'b', offset: -60 });
  assert.deepEqual(recallPosition('s1'), { anchorKey: 'b', offset: -60 });
  assert.equal(recallPosition('s2'), null);
  rememberPosition('s1', null);
  assert.equal(recallPosition('s1'), null);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test`
Expected: 两个新测试文件失败（模块不存在）。

- [ ] **Step 3: 实现 `src/client/reading-position.ts`**

```ts
/** In-memory reading position per session: restored when the reading tab mounts again. */
export interface SavedPosition { anchorKey: string; offset: number }
export interface AnchorRect { key: string; top: number; bottom: number }

const positions = new Map<string, SavedPosition>();

/** The first anchor whose bottom is still below the viewport top, with its offset from that top. */
export function pickAnchor(anchors: readonly AnchorRect[], viewportTop: number): SavedPosition | null {
  for (const anchor of anchors) if (anchor.bottom > viewportTop) return { anchorKey: anchor.key, offset: anchor.top - viewportTop };
  return null;
}

export function rememberPosition(sessionId: string, position: SavedPosition | null): void {
  if (position) positions.set(sessionId, position);
  else positions.delete(sessionId);
}

export function recallPosition(sessionId: string): SavedPosition | null {
  return positions.get(sessionId) ?? null;
}
```

- [ ] **Step 4: 实现 `src/client/FloatingStatus.tsx` 与样式**

```tsx
import { StateDot } from '@deepseek-ai/dsh-client-ui-primitives';
import { MountFade, useContentWidth } from './motion.js';
import { formatSeconds } from './turn-activity.js';
import type { ActivityView } from './use-turn-activity.js';
import css from './FloatingStatus.module.css';

const Arrow = ({ size }: { size: number }) => <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 3v10m-4-4 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;

/** Shown only after the reader scrolls away: a status pill while running, the native round jump button when idle. */
export function FloatingStatus({ activity, detached, onJump, motion }: { activity: ActivityView; detached: boolean; onJump: () => void; motion: boolean }) {
  const running = activity.key !== null;
  // The pill's width follows its content so a label change slides instead of jumping.
  const [trackWidth, width] = useContentWidth();
  return <>
    <MountFade mounted={running && detached} motion={motion}>{({ entering }) => running && detached ? <div className={css.dock}>
      <button type="button" className={`${css.pill} ${entering ? css.entering : ''}`} onClick={onJump} title="回到最新" data-reader-activity-pill data-phase={activity.phase}
        style={width === null ? undefined : { width: `${width}px` }}>
        <span className={css.pillContent} ref={trackWidth}>
          <StateDot state={activity.phase === 'waiting' ? 'warning' : 'ongoing'} size={12} />
          <span className={css.label} role="status" data-reader-activity-label>{activity.label}</span>
          {activity.seconds !== null && <span className={css.timer} aria-hidden="true" data-reader-activity-timer>{formatSeconds(activity.seconds)}</span>}
          <Arrow size={12} />
        </span>
      </button>
    </div> : null}</MountFade>
    <MountFade mounted={!running && detached} motion={motion}>{({ entering }) => !running && detached ? <div className={css.dock}>
      <button type="button" className={`${css.circle} ${entering ? css.entering : ''}`} onClick={onJump} aria-label="回到最新" title="回到最新" data-reader-jump>
        <Arrow size={16} />
      </button>
    </div> : null}</MountFade>
  </>;
}
```

`src/client/FloatingStatus.module.css`：

```css
.dock { position: sticky; bottom: calc(var(--dsh-composer-height, 152px) + 12px); z-index: 7; align-self: center; display: flex; justify-content: center; height: 0; }
.pill {
  box-sizing: content-box;
  display: inline-flex; align-items: center;
  height: 28px; padding: 0 12px 0 10px; overflow: hidden;
  transform: translateY(-100%);
  border: 0; border-radius: 999px; corner-shape: round;
  background: var(--dsw-alias-button-floating-fill, var(--dsw-alias-bg-layer-2));
  box-shadow: var(--dsw-elevation-panel);
  color: var(--dsw-alias-label-secondary);
  font: inherit; font-size: 12px; line-height: 18px; white-space: nowrap; cursor: pointer;
  transition: width var(--cv-swap) var(--cv-ease), opacity var(--cv-swap) var(--cv-ease), transform var(--cv-swap) var(--cv-ease), background-color var(--cv-fast) ease, color var(--cv-fast) ease;
}
.pillContent { display: inline-flex; align-items: center; gap: 8px; flex: none; }
.pill:hover { background: var(--dsw-alias-button-floating-hover, var(--dsw-alias-interactive-bg-hover-solid)); color: var(--dsw-alias-label-primary); }
.label { font-weight: 500; color: var(--dsw-alias-label-primary); }
.timer { color: var(--dsw-alias-label-caption); font-variant-numeric: tabular-nums; }
.circle {
  display: flex; align-items: center; justify-content: center;
  width: 34px; height: 34px; padding: 0;
  transform: translateY(-100%);
  border: 0; border-radius: 999px; corner-shape: round;
  background: var(--dsw-alias-button-floating-fill, var(--dsw-alias-bg-layer-2));
  box-shadow: var(--dsw-elevation-panel);
  color: var(--dsw-alias-label-primary); cursor: pointer;
  transition: opacity var(--cv-swap) var(--cv-ease), transform var(--cv-swap) var(--cv-ease), background-color var(--cv-fast) ease;
}
.circle:hover { background: var(--dsw-alias-button-floating-hover, var(--dsw-alias-interactive-bg-hover-solid)); }
.pill:active, .circle:active { transform: translateY(-100%) scale(.96); }
.entering { opacity: 0; transform: translateY(calc(-100% + 6px)); transition: none; }
[data-motion=off] .pill, [data-motion=off] .circle { transition: none; }
@media (prefers-reduced-motion: reduce) { .pill, .circle { transition: none; } }
```

- [ ] **Step 5: `useReadingScroll` 记忆与恢复位置（`src/client/motion.tsx`）**

1. import 区加 `import { pickAnchor, recallPosition, rememberPosition } from './reading-position.js';`。
2. 签名改为 `export function useReadingScroll(root: RefObject<HTMLElement>, motion: boolean, sessionId?: string): { detached: boolean; jump: () => void }`。
3. 把

```ts
    const firstFrame = requestAnimationFrame(() => {
      measure();
      if (following.current && !selected()) writeTop(maxTop);
    });
```

替换为

```ts
    const firstFrame = requestAnimationFrame(() => {
      measure();
      const saved = sessionId ? recallPosition(sessionId) : null;
      const anchor = saved ? content.querySelector<HTMLElement>(`[data-reader-key="${CSS.escape(saved.anchorKey)}"]`) : null;
      if (saved && anchor) {
        writeTop(currentTop + anchor.getBoundingClientRect().top - scroll.getBoundingClientRect().top - saved.offset);
        following.current = false;
        setDetached(true);
      } else if (following.current && !selected()) writeTop(maxTop);
    });
```

4. 在 effect 的清理函数最前面加：

```ts
      if (sessionId) {
        if (following.current) rememberPosition(sessionId, null);
        else {
          const viewportTop = scroll.getBoundingClientRect().top;
          const anchors = Array.from(content.querySelectorAll<HTMLElement>('[data-reader-key]'), element => {
            const rect = element.getBoundingClientRect();
            return { key: element.dataset.readerKey!, top: rect.top, bottom: rect.bottom };
          });
          rememberPosition(sessionId, pickAnchor(anchors, viewportTop));
        }
      }
```

5. effect 依赖改为 `[root, motion, sessionId]`。

- [ ] **Step 6: 接入 Reader（`src/client/Reader.tsx`）**

1. import 区：删除 `formatSeconds` 与 `useContentWidth` 的导入；加 `import { FloatingStatus } from './FloatingStatus.js';`。
2. `const scroll = useReadingScroll(root, motion);` 改为 `const scroll = useReadingScroll(root, motion, props.sessionId);`。
3. 删除 `const [trackActivityWidth, activityWidth] = useContentWidth();` 以及下面测量 `--reader-flow-min-height` 的整个 `useEffect`（浮条不再常驻，不需要把列撑满视口）。
4. 在 `actions` 定义之后加：

```tsx
  const { viewRequest, completeViewRequest } = props;
  useEffect(() => {
    if (!viewRequest || viewRequest.view !== 'reader') return;
    const focus = CSS.escape(viewRequest.focus);
    root.current?.querySelector<HTMLElement>(`[data-reader-key="${focus}"], [data-reader-tool-call="${focus}"]`)?.scrollIntoView({ block: 'center' });
    completeViewRequest();
  }, [viewRequest, completeViewRequest]);
```

5. 把运行状态条与回到最新按钮的两个 `<MountFade>…</MountFade>` 整段替换为：

```tsx
        <FloatingStatus activity={activity} detached={scroll.detached} onJump={scroll.jump} motion={motion} />
```

- [ ] **Step 7: 文件改动面板换新样式（`src/client/FileChanges.tsx`）**

1. import 区：`import { MountFade } from './motion.js';` 改为 `import { CollapseBody, MountFade } from './motion.js';`；加 `import { Chevron } from './ProcessRow.js';`；`import css from './Reader.module.css';` 改为 `import css from './FileChanges.module.css';`。
2. `const CHIP_LIMIT = 12;` 改为 `const FILE_LIMIT = 12;`，注释改为「展开后每组默认显示的文件数上限（超出折叠为「展开其余 N 个」）」。
3. 文件头注释里描述 chip 的几行改为：「v4：收起时是一行（标题 + 文件数 + 新增/修改/删除标签）；展开后是与过程面板同款的面板，按操作分组列出路径（目录弱化、文件名主色），点击在右侧栏预览。」
4. `return <MountFade …>` 整段替换为：

```tsx
  return <MountFade mounted={visible} motion={motion}>{({ entering }) => !visible ? null : (
    <section className={`${css.changes} ${entering ? css.entering : ''}`} data-reader-file-changes data-open={open} aria-label="本会话文件改动">
      <button type="button" className={css.header} aria-expanded={open} onClick={() => setOpen(value => !value)}>
        <Chevron open={open} />
        <span className={css.title}>本会话文件改动</span>
        <span className={css.meta}>{adjusted.total} 个文件{hasMore ? ' · 仅已加载记录' : ''}</span>
        <span className={css.tags} aria-hidden="true">
          {adjusted.added.length > 0 && <span className={css.tag} data-tone="added">新增 {adjusted.added.length}</span>}
          {adjusted.modified.length > 0 && <span className={css.tag} data-tone="modified">修改 {adjusted.modified.length}</span>}
          {adjusted.deleted.length > 0 && <span className={css.tag} data-tone="deleted">删除 {adjusted.deleted.length}</span>}
        </span>
      </button>
      <CollapseBody open={open} motion={motion}>
        <div className={css.body}>
          <FileGroup label="新增" tone="added" items={adjusted.added} openFile={openFile} />
          <FileGroup label="修改" tone="modified" items={adjusted.modified} openFile={openFile} />
          <FileGroup label="删除" tone="deleted" items={adjusted.deleted} openFile={openFile} />
        </div>
      </CollapseBody>
    </section>
  )}</MountFade>;
```

5. `FileChangeRow` 整个函数替换为：

```tsx
/** One operation group: label + count, then one path row per file (directory muted, name primary). */
function FileGroup({ label, tone, items, openFile }: {
  label: string; tone: FileChangeKind; items: readonly FileChangeEntry[]; openFile?: (path: string) => void | Promise<void>;
}) {
  const [showAll, setShowAll] = useState(false);
  if (items.length === 0) return null;
  const visible = showAll ? items : items.slice(0, FILE_LIMIT);
  return <div className={css.group} data-tone={tone}>
    <div className={css.groupLabel}><span className={css.dot} aria-hidden="true" />{label} · {items.length}</div>
    {visible.map(item => {
      const cut = item.display.lastIndexOf('/');
      const directory = cut < 0 ? '' : item.display.slice(0, cut + 1);
      const name = cut < 0 ? item.display : item.display.slice(cut + 1);
      return <button key={item.key} type="button" className={css.file} title={item.display} disabled={!openFile} onClick={() => { void openFile?.(item.display); }}>
        {directory && <span className={css.directory}>{directory}</span>}<span className={css.name}>{name}</span>
      </button>;
    })}
    {items.length > visible.length && <button type="button" className={css.more} onClick={() => setShowAll(true)}>展开其余 {items.length - visible.length} 个</button>}
  </div>;
}
```

`src/client/FileChanges.module.css`：

```css
.changes { min-width: 0; border-radius: var(--dsw-radius-lg); corner-shape: round; transition: background-color var(--cv-swap) var(--cv-ease), box-shadow var(--cv-swap) var(--cv-ease), opacity var(--cv-swap) var(--cv-ease), transform var(--cv-swap) var(--cv-ease); }
.changes[data-open=true] { background: var(--cv-panel-bg); box-shadow: var(--cv-panel-ring), var(--dsw-shadow-lv1); }
.entering { opacity: 0; transform: translateY(4px); transition: none; }
.header {
  display: flex; align-items: center; gap: 8px;
  width: calc(100% + 12px); min-height: var(--cv-row-height); margin: 0 -6px; padding: 0 6px;
  border: 0; border-radius: var(--dsw-radius-sm); background: transparent;
  color: var(--dsw-alias-label-tertiary); font: inherit; text-align: left; cursor: pointer;
  transition: background-color var(--cv-fast) ease, color var(--cv-fast) ease;
}
.header:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-secondary); }
.changes[data-open=true] .header { width: 100%; margin: 0; padding: 9px 14px; border-radius: 0; }
.title { flex: none; color: var(--dsw-alias-label-secondary); font-size: var(--cv-font-secondary); font-weight: 500; }
.meta { flex: 1 1 auto; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: var(--dsw-alias-label-caption); font-size: 12px; }
.tags { display: inline-flex; flex: none; gap: 6px; }
.tag { padding: 1px 8px; border-radius: 999px; corner-shape: round; font-size: 11px; line-height: 17px; font-weight: 500; }
.tag[data-tone=added] { color: var(--dsw-alias-state-success-primary); background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent); }
.tag[data-tone=modified] { color: var(--dsw-alias-state-business-primary); background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 10%, transparent); }
.tag[data-tone=deleted] { color: var(--dsw-alias-state-error-primary); background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent); }
.body { display: flex; flex-direction: column; gap: 10px; padding: 8px 14px 12px; border-top: .5px solid var(--dsw-alias-border-l2); }
.group { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.groupLabel { display: flex; align-items: center; gap: 6px; color: var(--dsw-alias-label-caption); font-size: 11px; line-height: 20px; }
.dot { width: 6px; height: 6px; border-radius: 50%; background: var(--dsw-alias-label-caption); }
.group[data-tone=added] .dot { background: var(--dsw-alias-state-success-primary); }
.group[data-tone=modified] .dot { background: var(--dsw-alias-state-business-primary); }
.group[data-tone=deleted] .dot { background: var(--dsw-alias-state-error-primary); }
.file {
  display: flex; align-items: center; min-width: 0; min-height: var(--cv-row-height);
  margin: 0 -6px; padding: 0 6px;
  border: 0; border-radius: var(--dsw-radius-sm); background: transparent;
  font: inherit; font-size: var(--cv-font-secondary); text-align: left; cursor: pointer;
  transition: background-color var(--cv-fast) ease;
}
.file:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.file:disabled { cursor: default; }
.directory { flex: 0 1 auto; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: var(--dsw-alias-label-caption); }
.name { flex: none; color: var(--dsw-alias-label-primary); }
.more { align-self: flex-start; padding: 2px 6px; margin-left: -6px; border: 0; border-radius: var(--dsw-radius-sm); background: transparent; color: var(--dsw-alias-label-tertiary); font: inherit; font-size: 12px; cursor: pointer; }
.more:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-secondary); }
[data-motion=off] .changes, [data-motion=off] .header, [data-motion=off] .file { transition: none; }
@media (prefers-reduced-motion: reduce) { .changes, .header, .file { transition: none; } }
@media (pointer: coarse) { .file, .more { min-height: 32px; } }
```

（若 `FileChangesPanelProps.openFile` 的类型与 `(path: string) => void | Promise<void>` 不兼容，把 `FileGroup` 的 `openFile` 参数类型改成 `FileChangesPanelProps['openFile']`。）

- [ ] **Step 8: 运行测试与类型检查**

Run: `npm test`
Expected: 全部通过（`floating-status` 4 条、`reading-position` 2 条）。

Run: `npm run typecheck`
Expected: 0 错误。

- [ ] **Step 9: 提交**

```bash
git add -A
git commit -m "feat: float status only when scrolled away and remember reading position

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 14: 清理旧样式与旧动画，收紧 compat 层

**Files:**
- Replace: `src/client/Reader.module.css`
- Replace: `src/client/compat/styles.ts` 中的 `COMPAT_CSS` 字符串与文件头注释
- Modify: `src/client/Blocks.tsx`（删除 `CopyAnswer`）
- Modify: `src/client/motion.tsx`（删除 `Disclosure`、`RetiringContent` 及其不再使用的 import；`useContentWidth` 保留给 `FloatingStatus`）
- Create: `tests/style-contract.test.ts`

**Interfaces:**
- Produces: `Reader.module.css` 只保留根节点 token、列与工具栏、Blocks/图片、逐词动画、状态文字、`CollapseBody`/`ProcessFragment` 所需类、通知/错误/等待操作提示；`COMPAT_CSS` 只保留滚动锚定、离屏轮次、rewind 桥三段。

- [ ] **Step 1: 写失败测试 `tests/style-contract.test.ts`**

```ts
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
  for (const retired of ['toolState', 'jumpDock', 'reasonPlain', 'data-reader-reasoning-card', 'role="alert"\\] \\+ div', 'dshcp-turn-footer', 'dshcp-stats-row']) {
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
    const missing = [...used].filter(name => !new RegExp(`\\.${name}(?![\\w-])`).test(css));
    assert.deepEqual(missing, [], `${file} references undefined classes in ${match[1]}`);
  }
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test`
Expected: `style-contract.test.ts` 前三条失败（`Reader.module.css` 里还有 `backdrop-filter`、6/7/10px 圆角和旧关键帧；`COMPAT_CSS` 还有 `toolState` 等旧规则）。

- [ ] **Step 3: 删除不再使用的组件代码**

- `src/client/Blocks.tsx`：删除 `export function CopyAnswer …` 整个函数；如果 `writeClipboard` 不再被引用，从 import 中去掉。
- `src/client/motion.tsx`：删除 `Disclosure`、`RetiringContent` 两个导出（`useContentWidth` 保留，`FloatingStatus` 在用）；逐个检查 import 里的名字，在文件里已经搜不到的就删掉。

确认没有残留引用：

```bash
grep -rn "CopyAnswer\|RetiringContent\|<Disclosure\b" src tests || echo CLEAN
```

Expected: `CLEAN`。

- [ ] **Step 4: 整文件替换 `src/client/Reader.module.css`**

```css
.root {
  --cv-ease: cubic-bezier(.2,.8,.2,1);
  --cv-fast: 100ms;
  --cv-swap: 200ms;
  --cv-size: 260ms;
  --cv-row-height: calc(24px + var(--dsh-content-font-delta, 0px));
  --cv-font-body: var(--dsh-content-font-size, 14px);
  --cv-line-body: calc(24px + var(--dsh-content-font-delta, 0px));
  --cv-font-secondary: var(--dsh-content-font-size-secondary, 13px);
  --cv-panel-bg: color-mix(in srgb, var(--dsw-alias-bg-layer-1) 72%, transparent);
  --cv-panel-ring: 0 0 0 .5px var(--dsw-alias-border-l3);
  --cv-inset-bg: var(--dsw-alias-markdown-code-block);
  color: var(--dsw-alias-label-primary);
  font-family: inherit;
  font-size: var(--cv-font-body);
  line-height: var(--cv-line-body);
  min-width: 0;
  flex: 0 0 auto;
  overflow-anchor: auto;
  container-type: inline-size;
}
.column { display: flex; flex-direction: column; gap: 22px; width: 100%; max-width: var(--dsh-chat-content-width, 748px); min-width: 0; margin: 0 auto; }
.toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
.switchButton { display: inline-flex; align-items: center; gap: 8px; padding: 2px 8px; border: 0; border-radius: var(--dsw-radius-sm); background: transparent; color: var(--dsw-alias-label-tertiary); font: inherit; white-space: nowrap; cursor: pointer; transition: background-color var(--cv-fast) ease, color var(--cv-fast) ease; }
.switchButton:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-secondary); }
.switchLabel[data-checked=true] { color: var(--dsw-alias-label-secondary); }
.root button:focus-visible, .root summary:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 2px; }

.blocks { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.blocks:empty { display: none; }
.blocks > :first-child { margin-top: 0; }
.blocks > :last-child { margin-bottom: 0; }
.blocks :global(.md-table-wide) { max-width: 100%; }
.readingText { min-width: 0; }
.readingText button { min-width: 24px; min-height: 24px; }
.userText { white-space: pre-wrap; word-break: break-word; }
.reasonPlain { white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; color: inherit; }
.streamWord { display: inline-block; }
.streamInlineWord { display: inline; }
.streamWord, .streamInlineWord, .streamAtom, .streamInlineAtom { opacity: 1; filter: none; }
.streamAtom, .streamInlineAtom { min-width: 0; }
.streamInlineAtom { display: inline; }
@media (prefers-reduced-motion: reduce) { .streamWord, .streamInlineWord, .streamAtom, .streamInlineAtom { opacity: 1 !important; filter: none !important; } }

.statusText { display: inline-flex; min-width: 0; max-width: 100%; font: inherit; color: inherit; }
.srOnly { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
.think {
  --think-swap: 200ms;
  --think-gap: 50ms;
  --think-distance: 4px;
  --think-blur: 1px;
  --think-ease: cubic-bezier(.2,.8,.2,1);
  position: relative; display: inline-block; max-width: 100%; text-align: left;
}
.thinkSizer { display: block; visibility: hidden; white-space: nowrap; }
.thinkText {
  position: absolute; top: 0; left: 0; right: 0; display: block;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  transform: translateY(0); filter: blur(0); opacity: 1;
  transition: transform var(--think-swap) var(--think-ease), filter var(--think-swap) var(--think-ease), opacity var(--think-swap) var(--think-ease);
}
.think[data-reader-status-phase=running] .thinkText[data-reader-status-copy=current] { transition-delay: var(--think-gap); }
.think:not([data-reader-status-phase=idle]) .thinkText { will-change: transform, filter, opacity; }
.thinkText.isExit { transform: translateY(calc(var(--think-distance) * -1)); filter: blur(var(--think-blur)); opacity: 0; }
.thinkText.isEnterStart { transition: none; transform: translateY(var(--think-distance)); filter: blur(var(--think-blur)); opacity: 0; }
[data-motion=off] .thinkText { transition: none !important; transform: none !important; filter: none !important; opacity: 1 !important; }
[data-motion=off] .thinkText[data-reader-status-copy=outgoing] { display: none !important; }
@media (prefers-reduced-motion: reduce), (forced-colors: active) {
  .thinkText { transition: none !important; transform: none !important; filter: none !important; opacity: 1 !important; }
  .thinkText[data-reader-status-copy=outgoing] { display: none !important; }
}

.disclosureBody { overflow: hidden; height: 0; }
.collapseBody { overflow: hidden; }
.processFrame { min-width: 0; }
.processContents { display: flow-root; min-width: 0; }

.notice { padding: 10px 14px; border-radius: var(--dsw-radius-md); corner-shape: round; background: var(--cv-inset-bg); color: var(--dsw-alias-label-secondary); font-size: var(--cv-font-secondary); line-height: 21px; overflow-wrap: anywhere; }
.error { padding: 10px 14px; border-radius: var(--dsw-radius-md); corner-shape: round; background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent); color: var(--dsw-alias-state-error-primary); font-size: var(--cv-font-secondary); line-height: 21px; overflow-wrap: anywhere; }
.unknown { padding: 10px 14px; border-radius: var(--dsw-radius-md); corner-shape: round; background: var(--cv-inset-bg); font-size: var(--cv-font-secondary); line-height: 21px; }
.unknown p { margin: 0 0 6px; }
.attention {
  display: flex; flex-direction: column; gap: 2px;
  padding: 10px 14px;
  border-radius: var(--dsw-radius-lg); corner-shape: round;
  background: var(--cv-panel-bg);
  box-shadow: 0 0 0 .5px color-mix(in srgb, var(--dsw-alias-state-business-primary) 45%, transparent), var(--dsw-shadow-lv1);
  color: var(--dsw-alias-label-primary); font-size: var(--cv-font-secondary); line-height: 20px;
}
.attention span { color: var(--dsw-alias-label-secondary); }
.attention.isEntering { opacity: 0; transform: translateY(4px); transition: none; }
.attention.isIn { opacity: 1; transform: none; transition: opacity var(--cv-swap) var(--cv-ease), transform var(--cv-swap) var(--cv-ease); }
.historyButton { align-self: center; padding: 4px 12px; border: 0; border-radius: var(--dsw-radius-sm); background: var(--dsw-alias-interactive-bg-hover-solid, var(--dsw-alias-interactive-bg-hover)); color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; cursor: pointer; transition: color var(--cv-fast) ease, opacity var(--cv-fast) ease; }
.historyButton:hover:not(:disabled) { color: var(--dsw-alias-label-primary); }
.historyButton:disabled { opacity: .55; cursor: default; }
.empty { padding: 40px 0; color: var(--dsw-alias-label-tertiary); text-align: center; }
.textButton { padding: 2px 6px; border: 0; border-radius: var(--dsw-radius-sm); background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; white-space: nowrap; cursor: pointer; transition: background-color var(--cv-fast) ease, color var(--cv-fast) ease; }
.textButton:hover { background: var(--dsw-alias-interactive-bg-hover); }

.imageFigure { align-self: flex-start; width: min(100%, 460px); margin: 0; }
.imageFrame { position: relative; max-width: 100%; max-height: 520px; min-height: 96px; overflow: hidden; border: .5px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-lg); corner-shape: round; background: var(--cv-inset-bg); }
.imageOpen { position: absolute; inset: 0; display: flex; width: 100%; height: 100%; padding: 0; border: 0; background: transparent; cursor: zoom-in; }
.imageOpen img { display: block; width: 100%; height: 100%; object-fit: contain; opacity: 0; transition: opacity var(--cv-swap) var(--cv-ease), filter var(--cv-fast) ease; }
.imageOpen img[data-ready=true] { opacity: 1; }
.imageOpen:hover img[data-ready=true] { filter: brightness(1.06); }
.imagePlaceholder { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; color: var(--dsw-alias-label-tertiary); font-size: var(--cv-font-secondary); pointer-events: none; }
.imagePlaceholder button { pointer-events: auto; }
.imageFigure figcaption { margin-top: 6px; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; overflow-wrap: anywhere; }
.imageDialog { max-width: 90vw; max-height: 90vh; padding: 38px 20px 20px; border: .5px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-lg); corner-shape: round; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); box-shadow: var(--dsw-elevation-panel); }
.imageDialog::backdrop { background: var(--dsw-alias-bg-mask-photo); opacity: 0; transition: opacity var(--cv-swap) var(--cv-ease); }
.imageDialog[open]::backdrop { opacity: 1; }
.imageDialog img { display: block; max-width: 82vw; max-height: 75vh; object-fit: contain; }
.dialogClose { position: absolute; top: 4px; right: 8px; width: 32px; height: 32px; border: 0; border-radius: var(--dsw-radius-sm); background: transparent; color: inherit; font-size: 24px; cursor: pointer; transition: background-color var(--cv-fast) ease, transform var(--cv-fast) ease; }
.dialogClose:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dialogClose:active { transform: scale(.96); }

[data-motion=off] .switchButton, [data-motion=off] .historyButton, [data-motion=off] .textButton, [data-motion=off] .imageOpen img, [data-motion=off] .dialogClose, [data-motion=off] .isEntering, [data-motion=off] .isIn { transition: none; }
@media (prefers-reduced-motion: reduce) { .switchButton, .historyButton, .textButton, .imageOpen img, .dialogClose, .isEntering, .isIn { transition: none; } }
@media (pointer: coarse) { .switchButton { min-height: 32px; } }
@media (max-width: 600px) { .column { gap: 18px; } }
```

- [ ] **Step 5: 收紧 `src/client/compat/styles.ts`**

文件头注释的模块清单改为：

```
 * 包含：
 *  - reader-scroll-anchor.css        对话滚动容器交给原生 scroll anchoring
 *  - reader-perf-long-content.css    已关闭旧轮次的离屏渲染（heavy 标记）
 *  - rewind-reader-bridge.css        rewind 兼容桥 actions 行样式
 *
 * 0.2.0 起移除：工具状态胶囊、回到最新药丸定位、思考卡渐隐/短思考、失败去重、
 * 统计行（这些表面已由组件自身样式承担）。
```

`COMPAT_CSS` 只保留三段：`/* ==== reader-scroll-anchor.css ==== */`、`/* ==== reader-perf-long-content.css ==== */`（含其注释与 `content-visibility` 规则，内容保持 0.1.18 原样）、`/* ==== rewind-reader-bridge.css ==== */`（保持原样）。删除 `reader-tool-state.css`、`reader-composer-layout.css`、`reader-reasoning-follow.css`、`reader-reasoning-plain.css`、`reader-tool-error-dedup.css` 五段。

- [ ] **Step 6: 运行测试与类型检查**

Run: `npm test`
Expected: 全部通过，`style-contract.test.ts` 4 条；`user-content.test.ts` 对 `.userText` 的静态断言仍然通过。

Run: `npm run typecheck`
Expected: 0 错误。

- [ ] **Step 7: 提交**

```bash
git add -A
git commit -m "refactor: drop retired styles, animations and compat overrides

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: 构建与产物门禁

**Files:**
- Create: `scripts/check-bundle-externals.mjs`
- Create: `tests/bundle-externals.test.ts`

**Interfaces:**
- Consumes: `D:/Khabarovsk/K.Develop/deepseek-harness/tools/dshx/src/client-build.js`（它的 `lightningcss` 从 `tools/dshx/node_modules` 解析；tsdown、rolldown、typescript 来自本仓库 `node_modules`）。
- Produces: `lib/client.js`、`lib/dsh-clearview.js`、`lib/types/**`、`dsh-clearview-0.2.0.tgz`。

- [ ] **Step 1: 写外部依赖门禁脚本 `scripts/check-bundle-externals.mjs`**

```js
// The lazy-CJS bundle may require only the modules every supported host preloads.
import { readFileSync } from 'node:fs';

const bundle = readFileSync(process.argv[2] ?? 'lib/client.js', 'utf8');
const allowed = new Set(['react', 'react/jsx-runtime', '@deepseek-ai/dsh-client-ui-primitives']);
const found = [...new Set([...bundle.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g)].map(match => match[1]))].sort();
const extra = found.filter(name => !allowed.has(name));
if (extra.length) {
  console.error(`Unexpected runtime externals: ${extra.join(', ')}`);
  process.exit(1);
}
console.log(`Runtime externals: ${found.join(', ')}`);
```

- [ ] **Step 2: 写门禁测试 `tests/bundle-externals.test.ts`**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const BUNDLE = new URL('../lib/client.js', import.meta.url);

test('the built bundle requires only the three shared host modules', { skip: !existsSync(BUNDLE) && 'lib/client.js is not built' }, () => {
  const output = execFileSync(process.execPath, ['scripts/check-bundle-externals.mjs', 'lib/client.js'], { encoding: 'utf8' });
  assert.match(output, /Runtime externals: @deepseek-ai\/dsh-client-ui-primitives, react, react\/jsx-runtime/);
});

test('the built bundle carries the 0.2.0 root version', { skip: !existsSync(BUNDLE) && 'lib/client.js is not built' }, () => {
  assert.match(readFileSync(BUNDLE, 'utf8'), /"0\.2\.0"/);
});
```

- [ ] **Step 3: 构建**

```bash
cd D:/Khabarovsk/K.Develop/dsh/staging/dsh-clearview-0200-20261005
DSHX_HARNESS=D:/Khabarovsk/K.Develop/deepseek-harness npm run build
ls -la lib/client.js lib/dsh-clearview.js
```

Expected: 构建无报错，两个文件存在。若 tsdown 报 `DSHX externalClientBundle adapter is missing`，核对 `DSHX_HARNESS` 路径；若报找不到 `lightningcss`，确认 `D:/Khabarovsk/K.Develop/deepseek-harness/tools/dshx/node_modules/lightningcss` 存在。

- [ ] **Step 4: 运行产物门禁**

```bash
node scripts/browser-syntax-gate.mjs lib/client.js
node scripts/check-bundle-externals.mjs lib/client.js
npm test
```

Expected: 语法门禁通过；外部依赖只列出三个模块；`npm test` 全部通过，且 `browser-target`、`client-store-resolution`、`bundle-externals` 中依赖产物的测试此时实际执行（不再 skip）。

- [ ] **Step 5: 打包并记录校验和**

```bash
npm pack
sha256sum dsh-clearview-0.2.0.tgz lib/client.js lib/dsh-clearview.js | tee D:/Khabarovsk/K.Develop/dsh/.planning/clearview-0200-redesign-20261005/build-sha256.txt
```

Expected: 生成 `dsh-clearview-0.2.0.tgz`，三行 SHA256 写入记录文件。

- [ ] **Step 6: 提交**

```bash
git add -A
git commit -m "build: gate the 0.2.0 bundle on syntax and runtime externals

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: 真实宿主拦截验证（不安装）

**Files:**
- Create: `scripts/verify-live-reader.mjs`

**Interfaces:**
- Consumes: 运行中的 DSH（`http://127.0.0.1:3193`），首页内联的 `globalThis["__DSH_BOOT__"]` 清单（`entries[].id === 'dsh-clearview'` 的 `url`），本地 `lib/client.js`。
- Produces: `.perf-results/live/report.json` 与每个会话、每种条件的截图。

- [ ] **Step 1: 写验证脚本 `scripts/verify-live-reader.mjs`**

```js
// Real-host check: a fresh headless Chrome profile opens the live DSH page and
// receives the locally built reader bundle through CDP response interception.
// Nothing is installed and no message is sent; only existing sessions are opened.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const base = process.env.DSH_TEST_URL || 'http://127.0.0.1:3193';
const bundle = readFileSync(resolve(process.env.READER_BUNDLE || 'lib/client.js'));
const titles = (process.env.READER_SESSIONS || '').split('|').map(value => value.trim()).filter(Boolean);
const out = resolve(process.env.READER_LIVE_OUTPUT || '.perf-results/live');
// READER_NO_INTERCEPT=1 checks the bundle the host itself serves (after install).
const intercept = process.env.READER_NO_INTERCEPT !== '1';
if (!titles.length) throw new Error('Set READER_SESSIONS to "|"-separated session title prefixes.');
mkdirSync(out, { recursive: true });

const html = await (await fetch(base)).text();
const boot = JSON.parse(html.match(/globalThis\["__DSH_BOOT__"\] = (.*?);?<\/script>/s)[1].replace(/;$/, ''));
const entry = boot.entries.find(item => item.id === 'dsh-clearview');
if (!entry) throw new Error('dsh-clearview is missing from the boot manifest');
// Entry URLs use the combo form `plugins/??dsh-clearview/client.js&rev=…`. Only a
// request whose combo list is exactly this one file is replaced; a combined
// request that also carries other plugins is passed through and counted.
const isReaderOnly = url => {
  const list = decodeURIComponent(url).split('??')[1]?.split('&')[0];
  return list === 'dsh-clearview/client.js';
};

const profile = mkdtempSync(join(tmpdir(), 'clearview-live-'));
const chrome = spawn(process.env.CHROME_PATH || join(process.env.ProgramFiles || 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'),
  ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--window-size=1440,900', 'about:blank'],
  { stdio: 'ignore', windowsHide: true });
const delay = ms => new Promise(done => setTimeout(done, ms));
const report = { base, entry: entry.url, sessions: [], exceptions: [], consoleErrors: [], replacements: 0, comboPassedThrough: [] };
let ws;
try {
  let port;
  for (let i = 0; i < 100 && !port; i++) {
    try { port = Number(readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]); } catch {}
    if (!port) await delay(100);
  }
  if (!port) throw new Error('Chrome did not start');
  const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  ws = new WebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl);
  await new Promise((done, fail) => { ws.onopen = done; ws.onerror = fail; });
  let id = 0;
  const pending = new Map();
  const send = (method, params = {}) => new Promise((done, fail) => { const n = ++id; pending.set(n, { done, fail }); ws.send(JSON.stringify({ id: n, method, params })); });
  ws.onmessage = async event => {
    const message = JSON.parse(event.data);
    const waiter = pending.get(message.id);
    if (waiter) { pending.delete(message.id); message.error ? waiter.fail(new Error(message.error.message)) : waiter.done(message.result); }
    if (message.method === 'Runtime.exceptionThrown') report.exceptions.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') report.consoleErrors.push(message.params.args.map(arg => arg.value ?? arg.description ?? '').join(' ').slice(0, 500));
    if (message.method === 'Fetch.requestPaused') {
      const { requestId, request } = message.params;
      if (!isReaderOnly(request.url)) {
        report.comboPassedThrough.push(request.url);
        await send('Fetch.continueRequest', { requestId });
        return;
      }
      await send('Fetch.fulfillRequest', { requestId, responseCode: 200, body: bundle.toString('base64'),
        responseHeaders: [{ name: 'Content-Type', value: 'application/javascript; charset=utf-8' }, { name: 'Cache-Control', value: 'no-store' }] });
      report.replacements++;
    }
  };
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  const shot = async name => {
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(out, `${name}.png`), Buffer.from(data, 'base64'));
  };
  const until = async (expression, ms = 15000) => {
    for (let waited = 0; waited < ms; waited += 200) { if (await evaluate(expression)) return true; await delay(200); }
    return false;
  };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Browser.grantPermissions', { origin: new URL(base).origin, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] }).catch(() => {});
  if (intercept) await send('Fetch.enable', { patterns: [{ urlPattern: '*dsh-clearview/client.js*', requestStage: 'Request' }] });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: base });
  if (!await until("!!document.querySelector('[data-composer-seat]')", 30000)) throw new Error('DSH did not finish loading');

  const collect = `(() => {
    const root = document.querySelector('[data-dsh-clearview]');
    if (!root) return null;
    const all = selector => [...root.querySelectorAll(selector)];
    return {
      version: root.getAttribute('data-dsh-clearview'),
      turns: all('section[data-reader-turn]').length,
      panels: all('[data-reader-panel]').map(panel => panel.getAttribute('data-status')),
      blockErrors: all('[data-reader-block-error]').map(node => node.getAttribute('data-reader-block-error')),
      triggers: all('[data-reader-trigger]').map(node => node.getAttribute('data-reader-trigger')),
      records: [...new Set(all('[data-reader-record-kind]').map(node => node.getAttribute('data-reader-record-kind')))],
      footers: all('[data-reader-turn-footer]').length,
      deliverables: all('[data-reader-deliverables] button').length,
      answers: all('[data-reader-answer]').length,
      rewindSeats: all('[data-dshcp-rewind-seat="1"]').length,
      dark: document.body.hasAttribute('data-ds-dark-theme'),
    };
  })()`;
  const clickSession = title => evaluate(`(() => {
    const candidates = [...document.querySelectorAll('button, a, [role="button"], [role="treeitem"], li, div')]
      .filter(node => node.children.length <= 4 && node.textContent.trim().startsWith(${JSON.stringify(title)}));
    const target = candidates.sort((a, b) => a.textContent.length - b.textContent.length)[0];
    if (!target) return false;
    target.click();
    return true;
  })()`);
  const clickTab = label => evaluate(`(() => { const tab = [...document.querySelectorAll('[role="tab"]')].find(node => node.textContent.trim() === ${JSON.stringify(label)}); tab?.click(); return !!tab; })()`);
  const selectedTab = () => evaluate(`[...document.querySelectorAll('[role="tab"]')].find(node => node.getAttribute('aria-selected') === 'true')?.textContent.trim() ?? null`);

  for (const [index, title] of titles.entries()) {
    const name = `s${index + 1}`;
    const item = { title, opened: await clickSession(title) };
    report.sessions.push(item);
    if (!item.opened) continue;
    await delay(1500);
    await clickTab('阅读');
    item.readerMounted = await until("!!document.querySelector('[data-dsh-clearview] section[data-reader-turn]')");
    await delay(800);
    item.initial = await evaluate(collect);
    await shot(`${name}-bottom`);
    await evaluate("document.querySelector('[data-conversation-scroll]').scrollTop = 0");
    await delay(500);
    await shot(`${name}-top`);
    // Open the first panel that holds a tool row (clicking an already open
    // header would collapse it), then expand a tool row inside that panel.
    item.panelOpened = await evaluate(`(() => {
      const panels = [...document.querySelectorAll('[data-dsh-clearview] [data-reader-panel]')];
      const panel = panels.find(node => node.querySelector('[data-reader-disclosure][data-expanded="false"]')) ?? panels[0];
      if (!panel) return false;
      panel.setAttribute('data-live-check', 'panel');
      const header = panel.querySelector('[data-reader-disclosure][data-expanded="false"] > button');
      header?.click();
      return true;
    })()`);
    await delay(500);
    await evaluate("document.querySelector('[data-live-check=panel]')?.scrollIntoView({ block: 'start' })");
    await shot(`${name}-panel-open`);
    item.toolOpened = await evaluate(`(() => {
      const panel = document.querySelector('[data-live-check=panel]');
      panel?.querySelector('[data-reader-earlier]')?.click();
      const row = panel?.querySelector('[data-reader-tool-call] [data-disclosure-row]');
      row?.click();
      return !!row;
    })()`);
    await delay(500);
    item.toolDetails = await evaluate("!!document.querySelector('[data-reader-tool-details]')");
    await shot(`${name}-tool-open`);
    if (await evaluate("!!document.querySelector('[data-reader-inspect]')")) {
      await evaluate("document.querySelector('[data-reader-inspect]').click()");
      await delay(800);
      item.inspectTab = await selectedTab();
      await clickTab('阅读');
      await delay(800);
    }
    if (await evaluate("!!document.querySelector('[data-dsh-clearview] [data-reader-show-in-chat]')")) {
      await evaluate("document.querySelector('[data-dsh-clearview] [data-reader-show-in-chat]').click()");
      await delay(800);
      item.showInChatTab = await selectedTab();
      await clickTab('阅读');
      await delay(800);
    }
    // Footer actions on the last closed turn. Fork is only checked for being
    // available: clicking it would create a session.
    const footer = "[...document.querySelectorAll('[data-dsh-clearview] [data-reader-turn-footer]')].at(-1)";
    item.forkAvailable = await evaluate(`(() => { const button = ${footer}?.querySelector('[aria-label="从这里分支"]'); return button ? !button.disabled : null; })()`);
    item.copyReceipt = await evaluate(`(async () => {
      const footer = ${footer};
      const button = footer?.querySelector('[aria-label="复制回答"]');
      if (!button) return null;
      button.click();
      await new Promise(done => setTimeout(done, 400));
      return footer.querySelector('[data-reader-answer-actions] [role="status"]')?.textContent ?? '';
    })()`);
    for (const [key, selector] of [['deliverableOpened', '[data-reader-deliverables] button'], ['mentionOpened', '[data-reader-answer] button[aria-label^="打开 "]']]) {
      item[key] = await evaluate(`(() => { const target = document.querySelector('[data-dsh-clearview] ${selector}'); target?.scrollIntoView({ block: 'center' }); target?.click(); return !!target; })()`);
      if (item[key]) { await delay(900); await shot(`${name}-${key}`); }
    }
    await send('Emulation.setDeviceMetricsOverride', { width: 480, height: 900, deviceScaleFactor: 1, mobile: false });
    await delay(600);
    await shot(`${name}-narrow`);
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    for (const size of ['13px', '16px']) {
      await evaluate(`document.body.style.setProperty('--dsh-content-font-size', '${size}')`);
      await delay(400);
      await shot(`${name}-font-${size}`);
    }
    await evaluate("document.body.style.setProperty('--dsh-content-font-size', '14px')");
    for (const scheme of ['light', 'dark']) {
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
      await delay(600);
      item[`scheme-${scheme}`] = await evaluate("document.body.hasAttribute('data-ds-dark-theme')");
      await shot(`${name}-${scheme}`);
    }
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await delay(400);
    item.reducedMotion = await evaluate("document.querySelector('[data-dsh-clearview]')?.getAttribute('data-motion')");
    await send('Emulation.setEmulatedMedia', { features: [] });
    item.final = await evaluate(collect);
  }
} finally {
  try { ws?.close(); } catch {}
  chrome.kill();
}
const readerErrors = report.exceptions.concat(report.consoleErrors).filter(text => /clearview|data-reader|dsh-clearview/i.test(text));
report.pass = (!intercept || report.replacements > 0)
  && report.sessions.every(item => item.opened && item.readerMounted && item.initial?.version === '0.2.0' && item.initial.blockErrors.length === 0 && item.final?.blockErrors.length === 0)
  && readerErrors.length === 0;
report.readerErrors = readerErrors;
writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ pass: report.pass, replacements: report.replacements, sessions: report.sessions.map(item => ({ title: item.title, opened: item.opened, initial: item.initial })), readerErrors }, null, 2));
process.exit(report.pass ? 0 : 1);
```

- [ ] **Step 2: 选会话并运行**

先在原生界面侧栏里找会话标题（只读）：65 步的任务会话（标题以「【任务】 请创建一个可运行的」开头）、一个由定时任务或子代理触发的会话、一个含上下文压缩记录的会话、一个被中断的会话。有问答或计划记录的会话能找到也加上。

```bash
cd D:/Khabarovsk/K.Develop/dsh/staging/dsh-clearview-0200-20261005
READER_SESSIONS="【任务】 请创建一个可运行的|<定时任务会话标题前缀>|<压缩会话标题前缀>|<中断会话标题前缀>" node scripts/verify-live-reader.mjs
```

Expected: 输出 `"pass": true`，`replacements` ≥ 1，`comboPassedThrough` 为空（不为空说明宿主把 clearview 和别的插件合并成了一个请求，需要改成按模块边界替换后再跑）；每个会话 `initial.version` 为 `"0.2.0"`、`blockErrors` 为空；出现过的 `inspectTab` 为 `轨迹`、`showInChatTab` 为 `对话`；有收尾轮次的会话 `forkAvailable` 为 `true`（只检查，不点击）、`copyReceipt` 为 `已复制`；`deliverableOpened`、`mentionOpened` 对应的截图里右侧栏打开了文件；有用户气泡的会话 `rewindSeats` 大于 0；`.perf-results/live/` 下有截图。脚本不点阅读页的「动效」开关，因为它会写入偏好；动效关闭路径由减少动态效果的模拟覆盖。逐张查看截图，对照 spec 第 5 节核对：面板、行语法、交付卡片、浮动元素、窄屏、三种字号、深浅主题、减少动态效果。`turn-trigger` 会话里应看到 `triggers` 非空，并且没有「工具调用」灰卡。

如果 `scheme-light` 与 `scheme-dark` 读到的 `data-ds-dark-theme` 相同，说明宿主主题不跟随系统，脚本没法切换浅色。这时在报告里写明「浅色主题未在本轮验证」，并请用户在设置里临时切换主题后重跑一次。不要替用户改设置。

- [ ] **Step 3: 记录结果**

把 `report.json` 复制到 `D:/Khabarovsk/K.Develop/dsh/.planning/clearview-0200-redesign-20261005/live-report.json`，并在同目录 `verification.md` 写下：每个会话覆盖了哪些节点类型、哪些条件没验证到、发现并修复了什么。若这一步暴露缺陷，回到对应任务修复，提交后重跑本任务。

---

### Task 17: 流式与性能对比

**Files:**
- Modify: `tests/browser/reader-performance.tsx`

**Interfaces:**
- Consumes: `scripts/verify-reader-performance.mjs`（0.1.18 自带）、0.1.18 基线记录 `D:/Khabarovsk/K.Develop/dsh/.planning/clearview-perf-20260918/applied-browser/optimized.json`（frameP95 13.4ms、commitP95 1.4ms、framesOver25 5）。

- [ ] **Step 1: 让夹具适配新 DOM 与新 props**

`tests/browser/reader-performance.tsx`：

1. `props` 对象补上新内核会用到的字段：

```ts
    const props: any = { sessionId: 'fixture', useSession: sess.use, useChat: chat.use, useSessionPendingInteraction: pend.use, useStore: prefs.use, useSessions: sessions.use, actions, renderSlotChain,
      loadOlder: async () => { }, loadImage: async () => { throw Error('No image in fixture'); }, t: (key: any) => key, contextT: (key: any) => key,
      useProjection: () => undefined, jobsSource: { subscribe: () => () => { }, getSnapshot: () => ({ rows: {} }) }, watchJobs: () => () => { },
      openView: () => { }, viewRequest: null, completeViewRequest: () => { } };
```

2. 扫光检测改为原生 `TextShimmer` 的装饰层：

```ts
            const reader = host.querySelector<HTMLElement>('[data-dsh-clearview]')!, word = reader.querySelector('[data-reader-word][data-word-state="resolving"]'), shimmer = reader.querySelector('[data-shimmer] > [inert]');
```

```ts
                shimmerPreserved = !!shimmer && getComputedStyle(shimmer).display !== 'none';
```

3. 运行中较早的步骤被压缩，统计工具行前先展开：把

```ts
    check(host.querySelectorAll('[data-reader-tool-call]').length === 20, 'tool rows missing');
```

改为

```ts
    host.querySelector<HTMLButtonElement>('[data-reader-earlier]')?.click();
    await wait(300);
    check(host.querySelectorAll('[data-reader-tool-call]').length === 20, 'tool rows missing');
```

4. 回到最新控件换成浮动胶囊或圆钮：

```ts
    const jump = host.querySelector<HTMLButtonElement>('[data-reader-activity-pill], [data-reader-jump]');
```

- [ ] **Step 2: 确认宿主模块系统入口**

脚本靠 `window.__dshSidebarModuleSystem__` 取宿主的 react 与 primitives。先用一次性 CDP 求值确认 0.2.0 页面上它还在（`node -e` 打开 headless Chrome 访问 `http://127.0.0.1:3193` 后求值 `typeof window.__dshSidebarModuleSystem__?.import`）。如果不在，在页面上求值 `Object.keys(window).filter(k => k.startsWith('__'))` 找到 0.2.0 的模块系统对象，把 `scripts/verify-reader-performance.mjs` 里的等待条件和 `system.import(name)` 调用改成它，并在提交信息里写明。

- [ ] **Step 3: 跑三次，取中位数**

```bash
cd D:/Khabarovsk/K.Develop/dsh/staging/dsh-clearview-0200-20261005
for i in 1 2 3; do DSH_TEST_URL=http://127.0.0.1:3193 CLEARVIEW_PERF_OUTPUT=.perf-results/perf-$i node scripts/verify-reader-performance.mjs; done
```

Expected: 三次 `failures` 都为空，`heavyPreserved`、`shimmerPreserved`、`blurActive` 都为 `true`，`turns` 21、`tools` 20。三次的中位数满足：`frameP95` ≤ 15.4ms（基线 13.4 + 2）、`commitP95` ≤ 2.1ms（基线 1.4 × 1.5）、`framesOver25` ≤ 8（基线 5 + 3）。不满足时先用 `--trace` 采样定位，修复后重跑；不能放宽阈值。

- [ ] **Step 4: 记录并提交**

把三次结果与中位数写进 `D:/Khabarovsk/K.Develop/dsh/.planning/clearview-0200-redesign-20261005/perf.md`（注明这是隔离浏览器夹具，不代表桌面 WebView2 实机帧率）。

```bash
git add -A
git commit -m "test: run the reader performance fixture against the 0.2.0 layout

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 18: 文档

**Files:**
- Modify: `README.md`、`DESIGN.md`、`CHANGELOG.md`

- [ ] **Step 1: 更新 README.md**

- 「功能亮点」改写为：原生骨架 + 柔和层次的过程面板（状态、用时、步数、工具数、失败数一眼可见；运行中较早步骤压成一行；成功后收成一条）；统一行语法与原生 `StateDot`/`TextShimmer`；思考行与实时内凹块（跟随控制器不变）；轮次尾部的交付文件卡片、复制、分支、用时与用量；收尾正文的文件名链接；turn-trigger、问答、计划等 0.2.0 节点；右侧栏打开文件；阅读位置记忆。
- 安装一节：内核要求改为 DeepSeek Harness 0.2.0-rc.2（peer 精确钉版本）。
- 「从源码构建」：先 `npm run link:generation -- <generation>/packages`，再 `DSHX_HARNESS=… npm run build`；测试命令不变（`npm test`）。
- 新增「不支持」小节：点赞/点踩（只能经原生 `assistant-actions` slot 注入，阅读页拿不到）、交付文件的默认应用打开与在文件夹中显示、原生工作细节模式与轮次导航栏。
- 「测试」一节的数字改成本次 `npm test` 的实际总数。

- [ ] **Step 2: 更新 DESIGN.md**

保留现有「Content fidelity」「Lifecycle」「Long reasoning」「Reading and accessibility」「Extensions and safety」的约束，新增两节：

```markdown
## Process panel

One turn's process lives in a single hairline panel: a status header (state dot or native spinner, status text, elapsed time, step / tool / failure counts) and step-grouped rows in the native 24px row grammar. Steps that hold a single tool row merge into one range label. While a turn is not successfully closed, earlier steps condense into one summary row and only the latest step is shown in full; six or more consecutive tool calls fold all but the last three. A successful close collapses the panel to its header and leaves the answer in place; failures, interruptions, approvals and unresolved windows stay open. Mid-turn human input appears inside the panel at its chronological position.

## Motion tokens

Structural motion uses cubic-bezier(.2,.8,.2,1): 100ms hover, 200ms state swaps and floating surfaces, 260ms expand and collapse, 350ms word reveal with 1px blur. The only busy signals are the native TextShimmer on the panel status and the active row, and the native StateDot spinner. Heavy mode only enables off-screen turn optimization; visible motion is never degraded by content size. Reduced motion, motion off, forced colors and background tabs settle to the received content.
```

- [ ] **Step 3: 在 CHANGELOG.md 顶部加 0.2.0 条目**

逐条写清：接入 0.2.0-rc.2（peer 精确钉版本、类型对准 generation、PreparingToolCall 修复）；新节点（turn-trigger、问答、计划、通用卡片「在对话中查看」）；轮次尾部改用公开数据（交付卡片、复制、分支、用时用量，删除 DOM 注入统计行）；文件名链接、右侧栏打开文件、会话图片缓存、在轨迹中查看、阅读位置记忆；视觉重设计（过程面板、行语法、思考行、动效参数、圆角与字号跟随宿主）；移除项（集群卡片、彩色状态胶囊、三套自制 shimmer、透明度呼吸、三星图标、流内毛玻璃、composer-readability 与 turn-metrics-footer 两个 compat 模块）；验证记录（单元测试总数、真实宿主拦截验证、性能夹具中位数）。

- [ ] **Step 4: 提交**

```bash
git add -A
git commit -m "docs: describe the 0.2.0 reader, its process panel and motion tokens

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 19: 托管安装（publish 前必须征得用户确认）

**Files:**
- Create: `D:/Khabarovsk/K.Develop/dsh/.planning/clearview-0200-redesign-20261005/release/prepare-package.mjs`
- Create: `D:/Khabarovsk/K.Develop/dsh/.planning/clearview-0200-redesign-20261005/release/update.json`、`publish.json`

**Interfaces:**
- Consumes: `dsh-clearview-0.2.0.tgz`（Task 15）；IPC 工具 `D:/Khabarovsk/K.Develop/dsh/staging/input-clipboard-fix-20260921/ipc.mjs`（`plugins.update`、`plugins.publish`）与 `apply-published.mjs`（prepare → arm → commit 并等待就绪）；候选审查 `inspectPluginCandidate`（`D:/Khabarovsk/K.Develop/dsh/dsh-env/src/plugin-candidates.mjs`，只读）。这些脚本都以 `D:/Khabarovsk/K.Develop/dsh` 为工作目录。

- [ ] **Step 1: 核对当前状态**

```bash
cd D:/Khabarovsk/K.Develop/dsh
curl -s http://127.0.0.1:3193/dsh-env/status | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s.slice(0,s.lastIndexOf('}')+1));console.log(JSON.stringify({applied:j.appliedRevision,published:j.publishedRevision,pending:j.marketPublication?.pending,op:j.pluginOperation?.status,prep:j.runtimePreparation,lastError:j.lastError},null,2))})"
```

Expected: 没有进行中的插件操作或运行时准备，`lastError` 为空。记下 `appliedRevision` 作为 `baseRevisionId`。若有待应用的更新，先停下来告诉用户，不要继续。

- [ ] **Step 2: 准备候选包目录**

`release/prepare-package.mjs`（改自 `staging/input-clipboard-fix-20260921/prepare-release.mjs`：解出 tgz，把每个依赖 junction 到当前运行版 clearview 包或 generation 公共目录里的同名依赖）：

```js
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve('.planning/clearview-0200-redesign-20261005/release');
const local = path.resolve('dsh-env/.local/device-f');
const active = JSON.parse(await fs.readFile(`${local}/state/runtime.json`, 'utf8'));
const runtime = JSON.parse(await fs.readFile(`${active.generation}/runtime.json`, 'utf8'));
const out = path.join(root, 'clearview');
await fs.rm(out, { recursive: true, force: true });
await fs.mkdir(out, { recursive: true });
execFileSync('tar', ['-xzf', path.resolve('staging/dsh-clearview-0200-20261005/dsh-clearview-0.2.0.tgz'), '-C', out]);
const pkg = path.join(out, 'package');
const meta = JSON.parse(await fs.readFile(`${pkg}/package.json`, 'utf8'));
const installed = path.join(active.generation, runtime.links['packages/node_modules/dsh-clearview']);
for (const dep of Object.keys({ ...meta.dependencies, ...meta.peerDependencies })) {
  let target;
  try { target = await fs.realpath(path.join(installed, 'node_modules', dep)); }
  catch { target = await fs.realpath(path.join(active.generation, 'packages/node_modules', dep)); }
  const link = path.join(pkg, 'node_modules', dep);
  await fs.mkdir(path.dirname(link), { recursive: true });
  await fs.symlink(target, link, 'junction');
}
console.log(JSON.stringify({ source: pkg.replace(/\\/g, '/'), dependencies: Object.keys({ ...meta.dependencies, ...meta.peerDependencies }).length }));
```

```bash
cd D:/Khabarovsk/K.Develop/dsh
node .planning/clearview-0200-redesign-20261005/release/prepare-package.mjs
```

Expected: 输出 `source` 路径与依赖数；若某个 peer 在两处都找不到，脚本报错退出，此时停下来排查，不要手工补包。

- [ ] **Step 3: 生成更新候选并审查**

`release/update.json`：

```json
{"baseRevisionId":"<Step 1 记下的 appliedRevision>","packageName":"dsh-clearview","source":"<Step 2 输出的 source>","version":"0.2.0","profile":"web"}
```

```bash
node staging/input-clipboard-fix-20260921/ipc.mjs plugins.update .planning/clearview-0200-redesign-20261005/release/update.json
node staging/input-clipboard-fix-20260921/wait-operation.mjs plugin-operation
```

Expected: `plugin-operation` 状态为 `succeeded`，`method` 为 `plugins.update`，结果里有 `candidateId`。

审查候选（只读）：用 `inspectPluginCandidate(local, { candidateId })` 检查，并比对候选 runtime 里 `dsh-clearview` 包的 `lib/client.js` 与 `lib/dsh-clearview.js` 的 SHA256 和 Task 15 记录的一致（做法同 `staging/input-clipboard-fix-20260921/review-candidate.mjs`，把其中的 `release` 路径换成本次 `release/clearview/package`）。把结果写到 `release/candidate-reviewed.json`。

- [ ] **Step 4: STOP — 请用户确认后再 publish**

向用户报告：candidateId、两个文件的 hash 对比结果、`inspectPluginCandidate` 的结论，并说明 publish 会同步到 MEGA 共享库、第二台设备下次同步时也会收到。**得到用户明确同意之前，不执行下面的命令。**

- [ ] **Step 5: 发布并正常重启应用**

用户同意后：

```bash
echo '{"candidateId":"<candidateId>"}' > .planning/clearview-0200-redesign-20261005/release/publish.json
node staging/input-clipboard-fix-20260921/ipc.mjs plugins.publish .planning/clearview-0200-redesign-20261005/release/publish.json
node staging/input-clipboard-fix-20260921/apply-published.mjs plugin-<candidateId>
```

Expected: `apply-published.mjs` 依次打印 `Publication verified`、`Prepared generation`、`Committing managed normal restart`，最后输出 `ready: true` 的 JSON，`applied.revisionId` 等于 `plugin-<candidateId>`。

- [ ] **Step 6: 安装后核对**

1. 从 `http://127.0.0.1:3193` 首页的 `__DSH_BOOT__` 找到 `dsh-clearview` 的 URL，下载实际下发的 `client.js`，和 `lib/client.js` 比较内容（宿主可能追加聚合分号或改写 source map 链接，差异只允许这两类）。
2. 不拦截，直接对真实页面重跑 Task 16 的关键会话：`READER_NO_INTERCEPT=1 READER_SESSIONS="…" node scripts/verify-live-reader.mjs`，确认 `pass` 为 `true`、`version` 为 `0.2.0`、无 `blockErrors`。
3. 请用户在桌面端打开一个正在运行的会话看一眼流式效果；把结论写进 `verification.md`。第二台设备的升级不在本计划范围内，在 `verification.md` 里注明。





