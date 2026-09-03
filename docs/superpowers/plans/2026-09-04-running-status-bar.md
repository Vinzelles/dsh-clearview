# 运行状态条（Running Activity Bar）实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 阅读页在对话流运行期间，底部常驻一个「阶段 + 秒级计时」悬浮矩形条（非胶囊），告知流仍在进行；离开底部淡出、回到底部恢复，并提供「回到最新」按钮。

**架构：** 新增纯函数模块 `turn-activity.ts`（从会话快照派生最新运行活动 → `{phase, key, since}`），配 `use-turn-activity.ts` hook（订阅 + 秒级 setInterval + 引用比较防重渲染）；`Reader.tsx` 渲染 `ActivityBar`，复用 `useReadingScroll` 返回的 `detached`/`jump` 实现淡出与跳转。GroupStatus 的运行分支改调共享 label 函数，两处口径一致。

**技术栈：** TypeScript + React 18 + node:test（`--import tsx/esm`）+ DSH client runtime store（`useSession`）。

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `src/client/turn-activity.ts`（新建） | 纯函数：`latestOpenTurn`（选最新 open 轮次）、`turnPhaseOf`（阶段+起始时刻）、`activityLabel`（阶段→文案）、`phaseKeyOf`（阶段稳定 key） |
| `tests/turn-activity.test.ts`（新建） | 上述纯函数的单元测试 |
| `src/client/use-turn-activity.ts`（新建） | hook：`useSession` 订阅 → 派生 → 1s `setInterval` → 引用比较 → `{label, seconds, key}` |
| `src/client/Reader.tsx`（修改） | 渲染 `<ActivityBar>`；`GroupStatus` 运行分支复用 `activityLabel` |
| `src/client/Reader.module.css`（修改） | `.activityBar` 样式（矩形毛玻璃条、淡出态、reduced-motion / data-motion=off） |

## 关键接口（先定稿，任务间保持一致）

```ts
// turn-activity.ts
export type ActivityPhase =
  | 'thinking' | 'output' | 'tool' | 'waiting' | 'processing' | 'idle';
export interface TurnActivity { phase: ActivityPhase; key: string; since: number | null }
export interface TurnSnapshot {
  status?: 'open' | 'closed' | 'unknown';
  steps?: readonly { step: number; data: Map<string, unknown> }[];
}
export function latestOpenTurn(
  turn: TurnSnapshot | undefined, pending: number, chat: ChatConversationViewNode[],
): { turn: TurnSnapshot; step: number; phase: ActivityPhase; since: number | null; key: string } | null;
export function turnPhaseOf(turn: TurnSnapshot, pending: number): ActivityPhase;
export function activityLabel(phase: ActivityPhase): string; // thinking→正在思考, output→正在输出, tool→正在使用工具, waiting→等待你的操作, processing→正在处理, idle→''
export function phaseKeyOf(turn: TurnSnapshot, step: number, since: number | null): string;
export function formatSeconds(seconds: number): string; // 1分20秒 / 34秒 / <1 秒
```

> 类型注：`chat` 参数传入已排序的节点快照（`Reader` 内已有 `visibleOrder` 派生），`steps` 用 `turn.steps` 的公开结构（`{ step, data: Map }`），`assistant-step` 数据经 `data.get('assistant-step')` 读取。

---

### 任务 1：纯函数 `turn-activity.ts` + 单元测试

**文件：**
- 创建：`src/client/turn-activity.ts`
- 测试：`tests/turn-activity.test.ts`

- [ ] **步骤 1：编写失败的测试**

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  activityLabel, formatSeconds, latestOpenTurn, phaseKeyOf, turnPhaseOf,
} from '../src/client/turn-activity.ts';

const step = (n: number, blocks: unknown[]) => ({
  step: n, data: new Map([['assistant-step', { status: 'running', blocks, time: 1000 }]]),
});
const reasoning = { kind: 'reasoning', text: 'x' };
const text = { kind: 'text', text: 'y' };
const tool = { kind: 'tool-call', callId: 'call-1' };

test('turnPhaseOf: running steps map to phases', () => {
  assert.equal(turnPhaseOf({ status: 'open', steps: [step(0, [reasoning, tool])] }, 0), 'tool');
  assert.equal(turnPhaseOf({ status: 'open', steps: [step(0, [reasoning])] }, 0), 'thinking');
  assert.equal(turnPhaseOf({ status: 'open', steps: [step(0, [text])] }, 0), 'output');
  assert.equal(turnPhaseOf({ status: 'open', steps: [step(0, [tool])] }, 0), 'tool');
  assert.equal(turnPhaseOf({ status: 'open', steps: [step(0, [tool])] }, 1), 'waiting');
  assert.equal(turnPhaseOf({ status: 'closed', steps: [step(0, [reasoning])] }, 0), 'idle');
  assert.equal(turnPhaseOf(undefined, 0), 'idle');
});

test('latestOpenTurn selects the newest open turn and derives since/key', () => {
  const chat = [
    { kind: 'assistant-step', data: { status: 'running', blocks: [reasoning], time: 1000 } },
  ] as never[];
  const result = latestOpenTurn(
    { status: 'open', steps: [step(0, [reasoning])] }, 0, chat,
  );
  assert.equal(result?.phase, 'thinking');
  assert.equal(result?.since, 1000);
  assert.equal(typeof result?.key, 'string');
  assert.equal(latestOpenTurn({ status: 'closed' }, 0, chat), null);
});

test('activityLabel maps phases to stable copy', () => {
  assert.equal(activityLabel('thinking'), '正在思考');
  assert.equal(activityLabel('output'), '正在输出');
  assert.equal(activityLabel('tool'), '正在使用工具');
  assert.equal(activityLabel('waiting'), '等待你的操作');
  assert.equal(activityLabel('processing'), '正在处理');
  assert.equal(activityLabel('idle'), '');
});

test('formatSeconds renders duration', () => {
  assert.equal(formatSeconds(0), '不到 1 秒');
  assert.equal(formatSeconds(5), '5 秒');
  assert.equal(formatSeconds(80), '1 分 20 秒');
  assert.equal(formatSeconds(3600), '60 分钟');
});

test('phaseKeyOf is stable for same phase and changes across phases', () => {
  const a = phaseKeyOf({ status: 'open', steps: [step(0, [reasoning])] }, 0, 1000);
  const b = phaseKeyOf({ status: 'open', steps: [step(0, [reasoning])] }, 0, 1000);
  const c = phaseKeyOf({ status: 'open', steps: [step(1, [text])] }, 1, 1000);
  assert.equal(a, b);
  assert.notEqual(a, c);
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`npm test -- --test-name-pattern turn-activity`
预期：FAIL——`Cannot find module '../src/client/turn-activity.ts'`

- [ ] **步骤 3：编写最少实现代码**

```ts
import type { AssistantChatData } from '@deepseek-ai/dsh-client-ui-conversation/client';
import type { ChatConversationViewNode, TurnLocation } from '@deepseek-ai/dsh-client-runtime/client';

export type ActivityPhase =
  | 'thinking' | 'output' | 'tool' | 'waiting' | 'processing' | 'idle';

export interface TurnActivity { phase: ActivityPhase; key: string; since: number | null }

export interface TurnSnapshot {
  status?: 'open' | 'closed' | 'unknown';
  steps?: readonly { step: number; data: Map<string, unknown> }[];
}

const activePhases: readonly ActivityPhase[] = ['thinking', 'output', 'tool'];

function latestAssistant(turn: TurnSnapshot): { step: number; data: AssistantChatData } | null {
  for (let i = (turn.steps?.length ?? 0) - 1; i >= 0; i--) {
    const s = turn.steps![i];
    const data = s.data.get('assistant-step') as AssistantChatData | undefined;
    if (data) return { step: s.step, data };
  }
  return null;
}

export function turnPhaseOf(turn: TurnSnapshot | undefined, pending: number): ActivityPhase {
  if (!turn || turn.status !== 'open') return 'idle';
  if (pending > 0) return 'waiting';
  const current = latestAssistant(turn);
  if (!current) return 'processing';
  const last = current.data.blocks.at(-1);
  if (current.data.status === 'running' && last?.kind === 'tool-call') return 'tool';
  if (last?.kind === 'reasoning') return 'thinking';
  if (last?.kind === 'text') return 'output';
  return 'processing';
}

export function latestOpenTurn(
  turn: TurnSnapshot | undefined,
  pending: number,
  _chat: readonly ChatConversationViewNode[],
): { turn: TurnSnapshot; step: number; phase: ActivityPhase; since: number | null; key: string } | null {
  const phase = turnPhaseOf(turn, pending);
  if (phase === 'idle') return null;
  const current = latestAssistant(turn!);
  const step = current?.step ?? 0;
  const since = current
    ? (current.data.blocks.at(-1)?.kind === 'tool-call'
        ? (current.data.blocks.at(-1) as { callTime?: number }).callTime ?? current.data.time
        : current.data.time)
    : null;
  return { turn: turn!, step, phase, since, key: phaseKeyOf(turn!, step, since) };
}

export function activityLabel(phase: ActivityPhase): string {
  switch (phase) {
    case 'thinking': return '正在思考';
    case 'output': return '正在输出';
    case 'tool': return '正在使用工具';
    case 'waiting': return '等待你的操作';
    case 'processing': return '正在处理';
    case 'idle': return '';
  }
}

export function phaseKeyOf(turn: TurnSnapshot, step: number, _since: number | null): string {
  // Phase identity: turn status + step + the latest block's kind. Timing
  // changes (since) intentionally do not reset the bar's seconds — only a
  // phase/step change does.
  const latest = (turn.steps ?? []).find(s => s.step === step);
  const data = latest?.data.get('assistant-step') as AssistantChatData | undefined;
  const kind = data?.blocks.at(-1)?.kind ?? 'none';
  return `${turn.status ?? 'open'}:${step}:${kind}`;
}

export function formatSeconds(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 1) return '不到 1 秒';
  if (s < 60) return `${s} 秒`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return rest ? `${m} 分 ${rest} 秒` : `${m} 分钟`;
}
```

> 注：`phaseKeyOf` 用 `turn.status + step + 是否有 assistant 步骤` 作为阶段身份（阶段判定本身来自 `turnPhaseOf`）。`latestOpenTurn` 的 `_chat` 参数预留节点快照位（本期不依赖节点遍历，仅用 turn 结构）。

- [ ] **步骤 4：运行测试验证通过**

运行：`npm test`
预期：PASS（全部 66 + 新增 5 通过）

- [ ] **步骤 5：Commit**

```bash
git add src/client/turn-activity.ts tests/turn-activity.test.ts
git commit -m "feat: pure turn-activity derivation for the running activity bar"
```

---

### 任务 2：hook `use-turn-activity.ts`

**文件：**
- 创建：`src/client/use-turn-activity.ts`

- [ ] **步骤 1：编写 hook（hook 无独立纯逻辑，依赖任务 1 的纯函数，直接实现）**

```ts
import { useEffect, useMemo, useState } from 'react';
import type { ChatStore } from '@deepseek-ai/dsh-client-ui-conversation/client';
import {
  activityLabel, latestOpenTurn, type ActivityPhase, type TurnSnapshot,
} from './turn-activity.js';

export interface ActivityView {
  label: string;
  seconds: number | null; // null = 等待操作/无计时
  key: string | null;     // null = 无活动（不渲染）
  phase: ActivityPhase;
}

const IDLE: ActivityView = { label: '', seconds: null, key: null, phase: 'idle' };

export function useTurnActivity(
  useSession: ChatStore['useSession'],
): ActivityView {
  const [now, setNow] = useState(() => Date.now());
  // The selector reads only raw snapshot data (never derives with `now`), so
  // it re-runs only when the store actually changes.
  const raw = useSession(snapshot => {
    const chat = snapshot.chat as { timeline: { turns: Map<number, TurnSnapshot> } };
    const pending = (snapshot as { pending?: unknown[] }).pending?.length ?? 0;
    let latest: TurnSnapshot | undefined;
    for (const turn of chat.timeline.turns.values()) {
      if (turn.status === 'open') latest = turn;
    }
    return { turn: latest, pending };
  });
  // Seconds tick: 1s interval. The derivation below re-runs only when `now`
  // or the raw snapshot changes; the bar re-renders at most once per second.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return useMemo<ActivityView>(() => {
    const result = latestOpenTurn(raw.turn, raw.pending, []);
    if (!result) return IDLE;
    const seconds = result.phase === 'waiting' || result.since == null
      ? null
      : Math.max(0, Math.floor((now - result.since) / 1000));
    return { label: activityLabel(result.phase), seconds, key: result.key, phase: result.phase };
  }, [raw, now]);
}
```

- [ ] **步骤 2：typecheck 验证**

运行：`npm run typecheck`
预期：PASS（无类型错误）

- [ ] **步骤 3：Commit**

```bash
git add src/client/use-turn-activity.ts
git commit -m "feat: useTurnActivity hook for 1s-granular running activity"
```

---

### 任务 3：渲染 `ActivityBar` + 接线 `Reader.tsx`

**文件：**
- 修改：`src/client/Reader.tsx`（顶部 import、`Reader` 内渲染、`GroupStatus` 复用 label）

- [ ] **步骤 1：在 `Reader` 组件内接入 hook 与浮层**

在 `Reader` 函数内（`const motion = useMotionAllowed(...)` 之后）加：

```tsx
const activity = useTurnActivity(props.useSession);
```

在渲染区、`{scroll.detached && <div className={css.jumpDock}>...}` **之前**插入：

```tsx
{activity.key && (
  <div className={css.activityBar} data-detached={scroll.detached ? 'true' : undefined}
    data-phase={activity.phase} data-ud-check="reader-activity-bar" role="status">
    <span className={css.activityText} data-reader-activity-label>{activity.label}</span>
    {activity.seconds !== null && (
      <span className={css.activityTimer} data-reader-activity-timer>{formatSeconds(activity.seconds)}</span>
    )}
    <button type="button" className={css.activityJump} aria-label="回到最新" title="回到最新" onClick={scroll.jump}>
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M8 3v10m-4-4 4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>
  </div>
)}
```

import 区补充：

```tsx
import { useTurnActivity } from './use-turn-activity.js';
import { formatSeconds } from './turn-activity.js';
```

- [ ] **步骤 2：typecheck 验证**

运行：`npm run typecheck`
预期：PASS（无类型错误）

- [ ] **步骤 3：Commit**

```bash
git add src/client/Reader.tsx
git commit -m "feat: render the running activity bar in the reader (fade + jump)"
```

> 说明：`GroupStatus` 的组级文案（含「正在准备工具输入」「正在准备回复」等细节）保持不变，不强制与全局条共用 label——两者粒度不同（组级 vs 全局），共享单一 `activityLabel` 映射即可，不引入 `preparing` 等组级文案到全局条。

---

### 任务 4：样式 `Reader.module.css`

**文件：**
- 修改：`src/client/Reader.module.css`（`.jumpDock` 附近插入）

- [ ] **步骤 1：新增 `.activityBar` 样式（矩形毛玻璃条，非胶囊）**

在 `.jumpDock` 规则前插入：

```css
/* Running activity bar: quiet rectangular glass strip, not a pill. */
.activityBar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px 8px 14px;
  margin: 2px 0 10px;
  border: 1px solid color-mix(in srgb, var(--dsw-alias-border-l2) 80%, rgba(255, 255, 255, 0.08));
  border-radius: 6px;
  background: color-mix(in srgb, var(--dsw-alias-bg-module-platform) 78%, transparent);
  backdrop-filter: blur(6px);
  color: var(--dsw-alias-label-secondary);
  font-size: 13px;
  line-height: 20px;
  transition: opacity 200ms ease, transform 200ms ease;
}
.activityText { font-weight: 500; color: var(--dsw-alias-label-primary); white-space: nowrap; }
.activityTimer { font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-secondary); white-space: nowrap; }
.activityJump {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  margin-left: auto;
  padding: 0;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}
.activityJump:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
/* Content left the bottom: fade out but stay clickable/visible enough. */
.activityBar[data-detached] { opacity: 0.25; transform: translateY(2px); }
```

在 `[data-motion=off]` 与 `@media (prefers-reduced-motion: reduce)` 两条规则内各追加：

```css
.activityBar { transition: none; }
```

- [ ] **步骤 2：typecheck + 冒烟**

运行：`npm run typecheck`
预期：PASS

- [ ] **步骤 3：Commit**

```bash
git add src/client/Reader.module.css
git commit -m "style: rectangular glass activity bar with detached fade"
```

---

### 任务 5：文档收尾

**文件：**
- 修改：`CHANGELOG.md`（0.1.6 段新增条目）、`README.md`（测试计数 66 → 71）

- [ ] **步骤 1：更新 CHANGELOG.md**

在 0.1.6 小节顶部追加：

```markdown
- **运行状态条**：
  - 对话流运行期间底部常驻「阶段 + 计时」矩形悬浮条（正在思考/正在输出/正在使用工具/等待你的操作，秒级计时、阶段切换归零）；
  - 滚动离开底部时淡出、回到底部恢复，附「回到最新」按钮（复用跟随跳转）；
  - 仅存在运行中轮次时显示，无运行轮次/等待操作时文案与计时相应切换。
```

- [ ] **步骤 2：更新 README.md**

`65 项单元测试` → `71 项单元测试`（新增 turn-activity 5 项）。

- [ ] **步骤 3：全量验证**

运行：`npm test` 与 `npm run typecheck`
预期：全部 PASS

- [ ] **步骤 4：Commit**

```bash
git add CHANGELOG.md README.md
git commit -m "docs: record running activity bar in changelog and test counts"
```

---

## 自检对照（规格 → 任务）

- 常驻悬浮 / 阶段+计时 / 阶段各自计时、切换归零 → 任务 1（`since`/`phaseKeyOf`）+ 任务 2（秒级 tick）+ 任务 3（浮层）
- 独立 hook 派生 + 全局条文案集中于 `activityLabel` → 任务 1 `activityLabel` + 任务 2 hook（GroupStatus 组级文案保持不变，不做强行统一）
- 秒级 setInterval、值不变不重渲染 → 任务 2（引用比较 + `useMemo`）
- 等待操作清空计时 → 任务 1（`waiting` 计时 null）+ 任务 2（`seconds: null`）
- 矩形非胶囊、4~6px 圆角、毛玻璃 → 任务 4
- 按钮复用 `scroll.jump` → 任务 3（`onClick={scroll.jump}`）
- 离开底部淡出、回到底部恢复 → 任务 3（`data-detached`）+ 任务 4
- 仅运行中轮次显示 → 任务 1（`idle` → null）+ 任务 3（`activity.key &&`）
- 边界：时间戳缺失不崩 → 任务 1（`since ?? null` → 不显示计时）；加载历史/会话失败不显示 → 由既有渲染条件天然满足