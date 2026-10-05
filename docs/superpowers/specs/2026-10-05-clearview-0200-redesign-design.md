# dsh-clearview 0.2.0：接口对齐与视觉重设计

> 2026-10-05 · dsh-clearview 阅读页
>
> 需求：插件基于旧内核开发，当前环境已升级到 DeepSeek Harness 0.2.0-rc.2（桌面 0.20.0）。先核查阅读视图在新内核上是否完整、是否对齐最新接口，再重新设计视觉样式。
>
> 本文汇总已逐节确认的设计（第 1–6 节），作为实施计划的唯一依据。可视化稿见 `.superpowers/brainstorm/709-1791176877/content/`（`direction.html`、`b-states.html`）。

## 1. 现状核查结论

### 1.1 版本与源码

- 运行中的是 `0.1.18-dsh020.1`，位于 generation `40e2b640…/packages/e3e7503fddde1a801e391543`。它来自 Official-017 适配包，2026-10-02 升级时只用 `adapt/repin.mjs` 改钉了 peer 版本，没有针对 0.2.0 改代码。
- 本仓库 `dsh-clearview/` 停在 0.1.17，比运行版本旧，40 多个文件不同（运行版多出 `reader-selection.ts`、`settlement-batch.ts`、`icons017.tsx`、`native017/`、`compat/pending-status.ts` 等）。
- 0.1.18 的两次修复（clearview-perf、input-clipboard-fix）都是直接改 `lib/client.js` 打补丁，再同步改 `src`。

### 1.2 已验证项

- 在 scratchpad 里搭类型沙箱（`tc020/`），把运行版 `src` 链接到 0.2.0-rc.2 的真实包上跑 `tsc`：只有 1 个错误，即 `tool-call-model.ts:219` 访问的 `PreparingToolCall.argsRaw` 在 0.2.0 不存在。运行时有 `?? ''` 兜底，不会崩溃。
- 在 `http://127.0.0.1:3193` 打开一个 65 步的会话，和原生「对话」页签对照：渲染、过程折叠展开、PTC 嵌套子调用都正常，控制台没有报错，也没有触发兜底卡片。

### 1.3 缺口

1. `turn-trigger`（定时任务、子代理回报、Job、目标唤醒等非人工触发的轮次）走 `GenericCallCard`，被显示成「工具调用」灰卡，该轮也没有开场。这一条是代码推断，没在页面上复现。
2. 插件节点 `question-reply`、`submitted-plan`、`agent-teams`、`workflow-run` 只有通用卡片或简化卡片。
3. 轮次尾部缺少原生的交付文件卡片、点赞/点踩、分支、用量入口（页面对照已确认）。统计行靠 `compat/turn-metrics-footer` 做 DOM 注入，并且要 hover 才显示。
4. 收尾正文里的文件名没有链接（原生通过 `chatFileMentions` 实现）。
5. 没有使用的新接口：`conversation.view` 的 owner props（`inspectCall`、`openView`/`viewRequest`）、会话级图片 URL 缓存、用户消息的 `referenceLabels`/`skillNames`、阅读位置恢复。
6. `rewind-bridge`、`turn-metrics-footer`、`memory-tail-keep` 依赖宿主的 DOM 和类名，比较脆弱。
7. 阅读页正文写死 16/28，忽略了宿主的字号设置 `--dsh-content-font-size`；原生正文是 14/24。

### 1.4 结构性限制

0.2.0 的 ui-slots 规则是「声明即认领」，已声明的子 slot 只有声明方可以渲染。`conversation.chat.node`、`conversation.chat.turnTail`、`conversation.chat.assistant-actions`、`conversation.chat.commandview` 都由原生 Chat 视图声明，阅读页作为兄弟视图无法渲染这些扩展点，也不能重复声明。对齐只能靠公开数据和公开服务。

## 2. 已确认的决策

| # | 决策 | 结论 |
|---|---|---|
| 1 | 接入方式 | 保留独立「阅读」页签，用公开数据和服务补齐缺口；不改成原生对话视图的皮肤 |
| 2 | 视觉痛点 | 全部要改：和新版原生不统一、过程区杂乱、质感不精致、动效不现代 |
| 3 | 视觉方向 | B「原生骨架 + 柔和层次」：行语法、字号、颜色和原生一致；整个过程收进一个发丝描边的柔和面板 |
| 4 | 运行态 | 较早的步骤压成「前 N 步」一行，只完整展开当前步骤（规则见第 5.2 节第 3 条）；面板头部是唯一的忙碌信号 |
| 5 | 完成态 | 成功后面板收成一条，保留步数、工具数和失败数 |
| 6 | 异常态 | 失败、中断、等待操作时不收起；描边换成状态色，失败行直接带出错误摘要 |
| 7 | 浮动元素 | 运行中滚离底部时显示 28px 胶囊；空闲滚离底部时显示原生同款 34px 圆钮。**取代** 2026-09-04 运行状态条设计里「不做胶囊造型、常驻底部」的决定 |
| 8 | 正文字号 | 跟随宿主的 `--dsh-content-font-size`（默认 14/24） |

## 3. 基线、版本与构建

1. 把运行版 `0.1.18-dsh020.1` 的 `src` 同步回本仓库作为基线。覆盖前，先把 0.1.17 的 `src`、`tests`、`lib` 和 `dsh-clearview-0.1.15.tgz`、`dsh-clearview-0.1.16.tgz` 备份到 `D:/Khabarovsk/K.Develop/dsh/.planning/clearview-0200-redesign-20261005/baseline-0.1.17/`。
2. 版本改为 `0.2.0`，peer 精确钉到 `0.2.0-rc.2`（与运行版 package.json 的 peer 集合一致，`@deepseek-ai/cordis` 为 `4.0.4`，`react` 为 `18.3.1`）。根节点的 `data-dsh-clearview` 改为从 package.json 读取。
3. 新增 `scripts/link-generation-dependencies.mjs`：按包名在指定 generation 的 `packages/` 下查找，并 junction 到本仓库的 `node_modules`（覆盖第 1.2 节沙箱里用到的 13 个 `@deepseek-ai/*` 包）。`@types/react`、`typescript` 等开发依赖继续用本地已有版本。`npm run typecheck` 必须 0 错误。
4. 打包继续用 `D:/Khabarovsk/K.Develop/deepseek-harness`（0.1.1-rc.1 检出）里的 `tools/dshx/src/client-build.js` 适配器，运行版就是证据：它打出的产物能在 0.2.0 上加载。新代码对宿主包只做 `import type`；运行时外部依赖仍然只有 `react`、`react/jsx-runtime`、`@deepseek-ai/dsh-client-ui-primitives`。`scripts/browser-syntax-gate.mjs` 继续把产物限制在 es2022。
5. 安装走 dsh-env 托管候选流程：准备 → inspect → publish → 正常重启应用。publish 会同步到共享库，执行前单独请用户确认。不直接改 generation。
6. `.gitignore` 加上 `.superpowers/`。

## 4. 接口对齐范围

### 4.1 要补的

**新节点类型**

1. `turn-trigger`：作为该轮开场，放在用户气泡的位置。显示来源图标和标题，原文可以展开，并参与轮次分组。来源到标题/图标的映射在 `turn-trigger.ts` 里本地实现，不对 ui-chat 做值导入。
2. `question-reply`：问答卡片，列出每个问题和已选答案。数据形状按 `QuestionReplyData`（`questions`、`answers`、`text` 兜底）。
3. `submitted-plan`：计划卡片，包含标题、Markdown 正文的折叠预览和审批状态，数据形状按 `SubmittedPlan`。
4. `agent-teams`、`workflow-run` 和未知类型：保留通用卡片，加「在对话中查看」。它复用 `entry.tsx` 已绑定的原生 ConversationStore，调用 `setView('chat')`。原生 Chat 不消费节点级的 `viewRequest`，所以只切换页签，不定位到具体节点。

**轮次尾部**（改用公开数据，删除 DOM 注入）

5. 交付文件卡片：读 `turn.data.get('deliverables')?.presented`，按收尾之前每个路径最近的一次声明去重，保留首次出现的顺序。点卡片在右侧栏预览。
6. 「本会话文件改动」：保留现有的聚合逻辑，按新视觉重做；点文件改为在侧栏预览。
7. 操作行：复制、分支、时间 · 用时 · 用量。
   - 分支调用 `ctx.sessions.fork({ sessionId, atSeq: turn.end.seq, increaseTitle: true })`，成功后执行 `ctx.uiWorkspace.openSession(childId)`，和原生一致。
   - 用量读 `turn.data.get('turn-tail')?.tokenUsage`；没有这项数据时不显示。
8. 收尾正文的文件名链接：调用 `ctx.chatFileMentions?.forClosing({ turn, seq, openFile }, sessionId)`，把返回的 `MarkdownFileMentions` 交给阅读页的 Markdown 渲染器，给行内代码加链接。

**工具与消息**

9. 工具详情里加「在轨迹中查看」，使用 owner prop 里的 `inspectCall(callId)`；拿不到这个 prop 时不显示。
10. 打开文件统一改为右侧栏预览：`ctx.sidebarRight.openResource(fileAddressFor(sessionId, cwd, path))`。地址规则照搬原生的 `fileAddressFor` / `sessionFileAddress`（`dsh-resource://file/session/<sessionId>/<path>`）。没有 `sidebarRight` 时，退回现在的 `openWorkspacePath` 用系统默认程序打开。
11. 用户气泡下方显示 `referenceLabels`、`skillNames`。
12. 图片改用 `ctx.uiConversation.imageUrl(sessionId, attachment)`；拿不到时退回 `readAttachment`。
13. 修复 `PreparingToolCall` 的类型错误：按 `phase` 区分，preparing 阶段的参数取空。
14. 阅读位置：切走再回来时恢复。按会话记录锚点 key 和偏移量，只存在内存的 Map 里。

**compat 层**

15. 删除 `compat/turn-metrics-footer.ts`（由第 7 条取代）。`compat/composer-readability.ts` 先确认 0.2.0 的 composer 里还有没有统计行分隔符；没有就删除。
16. 保留并实测 `rewind-bridge`（对接 0.2.0 的 rewind 0.15.0）、`memory-tail-keep`、`perf-guard`、`locale-bridge`、`session-snapshot`。perf-guard 只做离屏布局优化，不降级动效（见第 6.4 节）。

### 4.2 不补的（写进 README）

- 点赞/点踩：它只通过 `conversation.chat.assistant-actions` 注入，没有公开服务。
- 交付文件的「用默认应用打开」和「在文件夹中显示」。
- 原生的工作细节模式（Compact/Standard/Detailed/Verbose）和轮次导航栏。
- 配额提示：它是全局浮层，不受阅读页影响。

## 5. 视觉系统

### 5.1 基础规则

- **字号**：正文 `var(--dsh-content-font-size, 14px)`，行高 `calc(24px + var(--dsh-content-font-delta, 0px))`。过程行用 `var(--dsh-content-font-size-secondary, 13px)`，行高 24。元信息 12/18。
- **颜色**：只用 `--dsw-alias-*` token。状态色底统一 10%（和原生 Tag 一致），去掉手调的 `rgba(255,255,255,.08)` 混色。
- **圆角**收敛为四档，并加 `corner-shape: round`：

  | 圆角 | token | 用在哪里 |
  |---|---|---|
  | 8 | `--dsw-radius-sm` | 行、按钮 |
  | 12 | `--dsw-radius-md` | 内凹块：思考、代码、原始数据、错误摘要 |
  | 16 | `--dsw-radius-lg` | 过程面板、交付卡片、图片 |
  | 20 | `--dsw-radius-xl` | 用户气泡 |

  现在的 6/7/10 全部去掉。
- **层次**：过程面板 = `box-shadow: 0 0 0 .5px var(--dsw-alias-border-l3), var(--dsw-shadow-lv1)`，底色为 `--dsw-alias-bg-layer-1` 约 72%。浮层用 `--dsw-elevation-panel`。流内元素一律不用 `backdrop-filter`。

### 5.2 组件

1. **用户气泡**：和原生同款（底色 `--dsw-specific-bubble`，20 圆角，14/22，内边距 10/16）。引用和 skill 标签放在气泡下方一行，13px，三级文字色。插话（steering）在面板内按时间位置显示为小气泡（13/20，右对齐）。
2. **turn-trigger 开场行**：24px 行，图标、标题（二级色，字重 500）、「展开原文」。
3. **过程面板**：
   - 头部：左侧是状态点或转圈、状态文字（13px，字重 500）、用时（等宽数字）；右侧是中性 Tag 的步数、工具数，红色 Tag 的失败数，最右是折叠箭头。
   - 主体：顶部 0.5px 分隔线，内边距 8/14/12，用步骤小标题（11/20，caption 色）分组：
     - 每个步骤第一行之前显示「步骤 n」。
     - 连续多个「只有一行工具调用、没有思考也没有正文」的步骤合并成一个范围标题「步骤 a–b」，避免长轮次里小标题刷屏。
   - 「前 N 步」压缩：
     - 适用场景：面板展开，并且轮次没有成功完成（运行中、出错、中断、等待操作）。此时只完整显示最新一步，之前的步骤压成一行。
     - 行文案：「前 N 步 · 统计」。统计按工具类别计数（读取 N 个文件 / 运行 N 条命令 / 写入 N 个文件 / 搜索 N 次 / 联网 N 次 / N 次其他工具），只取非零的前三项。
     - 点击后就地展开，并且本轮内一直保持展开。
     - 成功完成后，用户手动展开面板时显示全部步骤，不压缩。
   - 连续工具调用折叠：同一步里连续 ≥6 个工具调用时，只显示最后 3 个，之前的折成「+N 次工具调用」一行放在这一组最前面。正在进行的调用始终可见。
4. **过程行**（统一语法）：
   - 结构：24px 高；16px 图标位（图形 14px）、标题、2px 圆点分隔、摘要（caption 色，超长省略）、行尾信息（12px，等宽数字）。
   - 悬停：8 圆角、`interactive-bg-hover` 底色，图标换成箭头。
   - 进行中：图标换成 `StateDot ongoing`，摘要套 `TextShimmer`。
   - 失败：`StateDot error`，标题和行尾变红色，行尾显示退出码。
   - 子调用缩进 22px。
   - 展开详情：缩进 22px，放在内凹块里（`--dsw-alias-markdown-code-block`，12 圆角）。结果/输入/原始数据三个 12px 文字页签，外加「在轨迹中查看」。
5. **思考**：
   - 已完成：一行「思考了 N 秒 · 首句预览」，展开后是内凹块，最高 240px 可滚动。
   - 进行中：内凹块最高 128px（13/21 约 6 行），只保留顶部 26px 渐隐，跟随控制器不变。
   - 「暂停跟随 / 展开阅读」改成悬停时出现在内凹块右上角的两个图标按钮。
   - 取消现在带边框和毛玻璃的思考卡片。
   - 「折叠思考」开关的含义：开 = 已完成的思考只留一行；关 = 显示前 3 行预览。
6. **错误与记录**：
   - 失败行下面跟错误摘要内凹块：`color-mix(in srgb, error 8%, code-block)`，等宽 12/18。
   - 命令、上下文压缩、重试、未知记录都是面板内的行，配状态点，展开看原始记录。
7. **回答**：沿用原生 Markdown；和面板间距 16；中断时显示 quiet 色调的「已停止」Tag。
8. **轮次尾部**：
   - 交付卡片：16 圆角、0.5px `border-l3` 描边、32px 图标底块（暗色主题 5% 白，亮色主题 50% 白）。单个占一行，多个两列，超过 4 个时折叠。
   - 操作行：28px 图标按钮（复制、分支），右侧是时间 · 用时 · 用量（12px，caption 色，等宽数字）。
9. **本会话文件改动**：
   - 收起时是一行，新增、修改、删除分别用 success、info、danger 色调的 Tag。
   - 展开后是和过程面板同款的面板，文件按操作分组，用路径行展示（目录弱化，文件名主色），点击在侧栏预览。
10. **浮动元素**：
    - 运行中且滚离底部：28px 胶囊，内容是 `StateDot ongoing` + 状态 + 计时 + ↓。
    - 空闲且滚离底部：34px 圆钮。
    - 两者都用 `--dsw-alias-button-floating-fill` 加 `--dsw-elevation-panel`，位置在 composer 上方。
11. **等待操作提示**：面板样式，蓝色发丝描边，13px 文字。
12. **工具栏**：右上角两个安静的文字开关（折叠思考、动效），12px。
13. **主题**：全部走 token。深色和浅色都要验收。

### 5.3 移除

- 集群卡片 `clusterBlock` 和 `groupOperationalFlow` 的集群输出（被步骤分组取代）。
- 彩色状态胶囊 `toolState`（被 StateDot 取代）。
- 自制 shimmer：`.think::before`、集群/工具/思考行的 background-clip 方案。
- 所有透明度呼吸动画。
- 三星闪烁图标。
- 流内所有 `backdrop-filter`。

## 6. 动效系统

### 6.1 参数

集中定义为根节点的 CSS 变量，组件只引用变量。

| 用途 | 时长 | 缓动 |
|---|---|---|
| 悬停、按下的颜色和底色 | 100ms | ease |
| 状态文字替换、浮层出现、状态点切换、新行出现 | 200ms | `cubic-bezier(.2,.8,.2,1)` |
| 展开与收起（高度 + 透明度）、箭头旋转、中途说明退场 | 260ms | `cubic-bezier(.2,.8,.2,1)` |
| 新文字逐词渐显 | 350ms，1px 模糊，词间 60ms，最多排队 240ms | 保留现有 `WORD_MOTION` |

### 6.2 实现

1. **扫光**：直接用 ui-primitives 的 `TextShimmer`（双层反向 transform，合成层动画，1.5s，延迟 0.3s）。只用在三处：面板头部的状态文字、正在进行那一行的摘要、「思考中」标签。
2. **进行中 / 状态点**：直接用 ui-primitives 的 `StateDot`。
3. **状态文字替换**：沿用 `StatusText` 的双副本切换。旧文字上移 4px 淡出，新文字从下方 4px 淡入，200ms，间隔 50ms，模糊 1px。
4. **展开与收起**：全部统一到 `CollapseBody`（WAAPI）。新接入的有文件改动面板、错误摘要、记录行、「前 N 步」和「+N 次工具调用」。
5. **成功结束**：面板主体 260ms 收起；转圈 200ms 淡变成绿点；状态文字走替换动画；计数直接更新。
6. **新出现的行**：只对实时到达的行做 200ms 淡入加 4px 上移。历史内容和切回会话时静态，不重放。
7. **浮动胶囊**：出现 200ms；标签变化时宽度 200ms 过渡（沿用 `useContentWidth`）。
8. **滚动跟随**：思考跟随控制器（`reasoning-follow.ts`）和主滚动跟随（`useReadingScroll`）不改。

### 6.3 删除

`tool-state-pulse`、`dsh-cluster-active-pulse`、`thinkShimmer`、`dsh-cluster-active-shimmer`、`activity-twinkle`，以及徽标和标题上的透明度呼吸。

### 6.4 关闭与降级

- `data-motion=off`、`prefers-reduced-motion`、`forced-colors`、`document.hidden`：所有动画停止，内容直接到位。
- perf-guard 进入重负载：只启用离屏轮次的 `content-visibility` 优化，扫光、逐词模糊、状态过渡和展开收起都保持不变。这是 0.1.18 性能优化时已经做出的决定（`compat/styles.ts` 注释「heavy 只控制离屏布局优化」），性能夹具也在断言它；本次不改变。
- 约束：同一时刻最多「每个面板 1 处 + 正在进行的 1 行」在扫光；循环动画只动 transform 或 opacity。

## 7. 代码结构

### 7.1 文件

纯逻辑模块保持原位。视图层按组件拆开，每个组件配自己的 CSS module；`Reader.module.css` 只保留 token 和根布局。

| 文件 | 职责 | 状态 |
|---|---|---|
| `Reader.tsx` | 根：工具栏、轮次列表、浮动元素挂载 | 瘦身 |
| `TurnSection.tsx` | 一轮：开场 → 过程面板 → 回答 → 尾部 | 新增，接替 `TurnGroup` |
| `ProcessPanel.tsx` | 面板头部、步骤分组、「前 N 步」、「+N 次工具调用」 | 新增，取代 `OperationalClusterBlock` |
| `ProcessRow.tsx` | 统一行语法（工具、记录、错误） | 新增 |
| `ToolDetails.tsx` | 展开详情、页签、在轨迹中查看 | 从 `ToolActivity.tsx` 拆出 |
| `ReasoningRow.tsx` | 已完成思考行和实时内凹块，跟随控制器原样迁入 | 取代 `ReasoningCard.tsx` |
| `NodeCards.tsx` | turn-trigger、问答、计划、通用卡片 | 新增 |
| `TurnFooter.tsx` | 交付卡片、复制、分支、元信息 | 新增 |
| `FloatingStatus.tsx` | 运行胶囊、回到最新圆钮 | 从 `Reader.tsx` 拆出 |
| `process-steps.ts` | 纯函数：阅读流 → 步骤模型（分组、计数、压缩、状态） | 新增，取代 `groupOperationalFlow` |
| `turn-trigger.ts` | 触发来源 → 标题、图标 | 新增 |
| `host.ts` | 宿主能力适配：侧栏打开、分支、图片 URL、文件名链接、切换到对话 | 新增 |
| `compat/turn-metrics-footer.ts` | DOM 注入的统计行 | 删除 |

`motion.tsx`、`word-motion.tsx`、`word-timeline.ts`、`stream-buffer.ts`、`streaming.tsx`、`reasoning-follow.ts`、`reading-follow.ts`、`markdown/*` 基本不动。`markdown/render.tsx` 增加 `fileMentions` 参数。

### 7.2 数据流

1. 宿主钩子 `useSession` / `useChat` / `useSessionStatus` → `compat/session-snapshot` 的域选择器。结构选择器（`reader-selection.ts`）只在结构变化时重算分组；节点座位按 key 单独订阅。
2. 每轮：`timeline.turns.get(turn)` → `readerFlow` → `process-steps` → `ProcessPanel`。
3. 尾部：同一个轮次位置的 `data.get('turn-tail')` 和 `data.get('deliverables')`。
4. 宿主动作：统一经过 `host.ts`，通过 `ReaderInjected` 注入组件；`inspectCall` 从 `conversation.view` 的 owner props 取。

### 7.3 错误处理

- 每个节点座位保留 `BlockBoundary`（`console.error` 输出，并标记 `data-reader-block-error`）。
- `sidebarRight`、`chatFileMentions`、`uiConversation`、`uiWorkspace` 声明为可选注入，缺失时按第 4.1 节降级，不抛错。
- 分支失败：在操作行旁边显示一行错误文字，停留 5 秒。
- 宿主数据一律按 unknown 防御读取（沿用 `node-payloads.ts`）。未知节点类型显示通用卡片。
- 轮次状态未知（窗口从半轮开始）：面板显示中性的「执行过程」，不自动收起。

### 7.4 store

沿用 `dsh.reader.v1`（`expanded`、`motion`、`collapseThinking`），字段不变，只调整 `collapseThinking` 的语义。阅读位置只存在内存里。

## 8. 验证

1. **基线**：同步源码后，先让现有测试在 0.1.18 源码上全部通过。缺的测试从 `.planning/clearview-perf-20260918` 找回，找不回的按 0.1.18 的行为补上。在此之前不动视觉代码。
2. **单元测试**：
   - `process-steps`：分组、计数、两种压缩阈值，六种状态（运行中、成功、中断、出错、等待操作、未知）。
   - `turn-trigger`：各种来源和兜底。
   - `host.ts`：文件地址和原生 `fileAddressFor` 对拍（相对路径、工作区内绝对路径、Windows 盘符、UNC、`./` 前缀）。
   - 尾部数据：`tokenUsage` 格式化，`presented` 去重和顺序，数据缺失时不渲染。
   - `PreparingToolCall` 的 phase 处理；compat 删除后不再注入 DOM。
3. **静态检查**：对 0.2.0 generation 包跑 `npm run typecheck`，0 错误；`browser-syntax-gate` 通过；产物运行时外部依赖只有三个。
4. **真实宿主（安装前）**：用无头 Chrome 加独立 profile 打开 3193，只把 `dsh-clearview` 的 client.js 响应拦截替换成新构建。
   - 会话：65 步会话、turn-trigger 会话、上下文压缩记录、中断轮次；有问答或计划记录的会话能找到就一起测。
   - 条件：深色和浅色主题、≤480px 宽度、宿主字号 13/14/16、减少动态效果、动效关。
   - 交互：面板、工具详情、在轨迹中查看、在对话中查看、侧栏打开文件、文件名链接、复制。分支只验证能调起流程，除非用户同意，否则不实际创建分支会话。
   - 证据：控制台 0 错误、`data-reader-block-error` 为 0，留截图和 JSON。
5. **流式与性能**：用 clearview-perf 的 probe fixture 模拟分片到达，检查逐词渐显、思考跟随、成功后的收起动画和浮动胶囊。和 0.1.18 对比，帧时间 p50/p95 不劣化，流式期间没有 long task，扫光数量符合第 6.4 节的约束。如果要在真实模型上跑一轮，先请用户确认。
6. **安装后**：核对实际下发的 bundle 和构建产物 hash 一致、`data-dsh-clearview="0.2.0"`，并在桌面端复查第 4 项里的关键项。第二台设备的升级不在本次范围内。
7. **文档**：更新 README（功能和「不支持」清单）、DESIGN.md（过程面板契约、动效规格）、CHANGELOG 0.2.0 条目。

## 9. 实施时需要先确认的点

这些在设计阶段只核对到「接口存在」，实施计划的第一步要用代码或页面确认：

1. cordis 4.0.4 客户端插件的可选注入写法，以及 dshx 适配器 `assertClientCordisInject` 对这种写法的校验。
2. `ctx.sessions.fork` 和 `ctx.uiWorkspace.openSession` 在 `conversation.view` 条目所在的上下文里能否拿到。
3. `ctx.chatFileMentions.forClosing` 所需的 `TurnTailOwnerProps.turn`（`TurnLocation`）能否从阅读页拿到的 `timeline.turns` 直接传入。
4. `SubmittedPlan` 的字段和审批状态取值。
5. 0.2.0 的 composer 里是否还有 `[class*="_sep"]` 统计行（决定 `composer-readability` 的去留）。
6. rewind 0.15.0 在阅读页上的撤回行为。
7. `.planning/clearview-perf-20260918` 里是否保存着 0.1.18 的完整测试与 probe。
