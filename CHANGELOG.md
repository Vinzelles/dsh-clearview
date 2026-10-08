# Changelog

## 0.2.1

视觉打磨：更安静的过程面板，合并连续工具调用，阅读流底部留白。只改展示。

### 合并连续工具调用

- 过程面板里连续的工具调用，以及 `/命令` 与手动压缩记录，满两条就合并成一行：标题沿用 0.1.18 的摘要（「使用了 N 个技能」「运行了 N 条命令」「进行了 N 次工具调用」「执行了 N 个操作」，以「，」连接），右侧是首个调用开始到最后一个调用结束的总用时，未知时不显示。
- 进行中的合并行带原生转圈和扫光，并在标题后接「正在 …」加正在执行的调用；有失败时显示红点和红色「N 次失败」，默认展开；其余默认收起，点击展开，成员行向内缩进一级。
- 思考、旁白、轮次中途的输入、通知和其他记录会打断合并；单个调用仍是原来的行。合并在「前 N 步」压缩之后、对可见的行进行，可以跨越步骤边界。
- 移除 0.2.0 的「连续 6 个以上工具调用只留最后 3 个」折叠及其「+N 次工具调用」行。

### 降噪

- 不再显示「步骤 N」小标题；步骤分组仍用于计数和「前 N 步」压缩行。
- 已完成的思考始终是一行（用时 · 首句预览 · 字数），点击查看全文，不再带 3 行预览内凹块。「折叠思考」现在表示进行中的思考也只显示一行；关闭时进行中的思考保持实时内凹块，跟随控制器不变。
- 未知工具的行标题由英文「Tool call」改为「工具调用」；通用行标题（搜索、读取、写入、编辑、代码）、Skill 行（技能）和 Cordis 运行控制标题也改为中文。工具名（如 Bash、Pwsh）和参数是数据，不翻译。

### 面板去容器

- 过程面板不再有背景、描边、阴影和圆角：头部是一行朴素的文字（展开箭头、状态点、状态 · 用时 · N 步 · N 次工具 · N 次失败），内容缩进 22px 直接接在下面。
- 出错、中断、等待只用头部状态点和状态文字颜色表示（错误红、等待蓝）。
- 兼容用的 DOM 约定不变：`[data-reader-disclosure][data-expanded] > button`、`data-reader-panel`、`data-status`、`data-reader-process`、`data-reader-earlier`。

### 底部留白

- 阅读列最后一个元素（例如「本会话文件改动」）与悬浮输入框之间留出 24px；不恢复 0.1.18 的测量式 min-height，悬浮状态位置不变。

## 0.2.0

阅读页对准 DeepSeek Harness 0.2.0-rc.2 重写：过程收进原生骨架的面板，轮次尾部改读公开数据。

### 接入 0.2.0-rc.2

- peer 依赖精确钉版本：`@deepseek-ai/cordis` 4.0.4、`react` 18.3.1，其余 `@deepseek-ai/dsh-*` 一律 0.2.0-rc.2。运行时外部依赖只剩 `react`、`react/jsx-runtime`、`@deepseek-ai/dsh-client-ui-primitives`，对其他宿主包只做类型导入。
- 类型对准 generation：新增 `npm run link:generation -- <generation>/packages`，把目标 generation 的宿主包链接进 `node_modules`，`typecheck` 与测试读取 0.2.0 的真实契约。
- 修复 `PreparingToolCall` 的类型错误：按 `phase` 区分，preparing 阶段没有参数，取空。
- 可选宿主服务（`sidebarRight`、`uiConversation`、`uiWorkspace`、`chatFileMentions`）只经 `ctx.get` 惰性读取，缺失时降级，不抛错。

### 新节点

- turn-trigger 开场：24px 行，按触发来源（定时任务、子代理、后台任务等）给出图标和标题，右侧「展开原文」。
- 已结束的轮次里，仍停在进行中状态的生命周期记录（模型重试、命令、压缩整理）显示为已落定的中性记录，不再有转圈和进行时文案。
- 修复宿主页面自带全局 `CSS` 字符串时，阅读页签恢复位置和视图请求聚焦抛出 `CSS.escape is not a function`：改用不依赖该全局的转义函数。
- 问答记录（`question-reply`）：显示问题与所选答案，未作答会标明。
- 已提交计划：记录行显示计划标题，展开为计划 Markdown。0.2.0 的 SubmittedPlan 没有审批状态，所以不显示审批状态。
- 通用卡片「在对话中查看」：未专门接入的记录类型可跳到原生对话页签定位。
- 轮次中途的补充消息和命令输入按时间位置显示在面板内，它们的撤回座位只在过程面板展开时存在；成功的斜杠命令输出显示在回答区，其生命周期行仍留在面板里。

### 轮次尾部改用公开数据

- 交付文件卡片读取轮次的 `deliverables` 公开数据，用时取轮次开始与结束时间，只有时间和用量来自 turn-tail 公开数据；复制回答取渲染后的回答文本，分支按公开的结束序号；删除向 DOM 注入统计行的 `turn-metrics-footer`。
- 分支按钮在 turn-tail 报告 `branchUnavailable` 时隐藏，否则与原生一致，从 `turn.end.seq` 分支。
- 交付卡片点击在右侧栏打开文件；数据缺失时不渲染。

### 文件、图片与导航

- 收尾正文里的文件名可点击，经 `chatFileMentions` 在右侧栏打开。
- 会话图片优先经 `uiConversation.imageUrl` 取地址；拿不到时退回 `readAttachment`，并按附件缓存生成的地址。
- 工具详情新增「在轨迹中查看」。
- 从其他页签发来的阅读定位请求，会话加载中先等待，加载完目标仍不存在就丢弃；折叠面板内的工具调用不会为此自动展开。
- 阅读位置记忆：切走再回来时恢复，按会话记录，只存在内存里。

### 视觉重设计

- 过程面板：细线面板，头部显示状态、用时、步数、工具数、失败数；凡是没有成功结束的轮次（进行中、出错、中断、等待操作、状态未知），较早的步骤都压成一行，只完整显示最新一步，点开「前 N 步」才展开；连续 6 个以上工具调用只留最后 3 个，任何面板状态都一样，进行中的调用不会被折叠。成功后收成一条，错误、中断、审批和未知状态保持展开。
- 统一行语法：工具、思考、记录都用原生 24px 行语法，状态点和进行中动效使用原生 `StateDot` / `TextShimmer`。
- 思考行与实时内凹块：已完成的思考是「思考了 N 秒 · 首句预览 · N 字」一行；「折叠思考」关闭时（默认）行下还有约 3 行（72px）的预览内凹块，开启后只剩这一行；进行中显示内凹块；跟随控制器保持不变。
- 动效参数统一：缓动 `cubic-bezier(.2,.8,.2,1)`，悬停 100ms、状态替换与浮层 200ms、展开收起 260ms、逐词渐显 350ms + 1px 模糊。
- 圆角与字号跟随宿主：圆角只用宿主 token，正文、过程行和元信息字号随宿主内容字号。
- 浮动元素：滚离底部时，运行中显示 28px 状态胶囊，空闲显示 34px 圆形「回到最新」。
- heavy 模式只启用离屏 `content-visibility`，不再降级任何可见动效。

### 移除

- 集群卡片（被步骤分组取代）。
- 彩色状态胶囊（被 `StateDot` 取代）。
- 三套自制 shimmer（思考、集群、工具行）。
- 所有透明度呼吸动画。
- 三星闪烁图标。
- 流内毛玻璃：流内元素不再使用 `backdrop-filter`。
- compat 模块 `composer-readability` 与 `turn-metrics-footer`，以及随之失效的工具状态胶囊、思考卡渐隐、失败去重等补丁样式。

### 不支持

- 点赞 / 点踩：只能经原生 `assistant-actions` slot 注入，阅读页拿不到。
- 交付文件的默认应用打开与在文件夹中显示。
- 原生工作细节模式与轮次导航栏。
- 新行淡入：设计规格 6.2 第 6 条（实时到达的行 200ms 淡入加 4px 上移）在 0.2.0 没有实现；新行直接出现，只有文字保留逐词渐显。

### 验证记录

- 单元测试：`npm test` 273 项全部通过。
- 真实宿主（安装前，拦截替换 `dsh-clearview` 的 client.js，独立 Chrome profile，只读与导航；脚本点击了「复制回答」，无头 Chrome 可能因此写入真实系统剪贴板，并打开了右侧栏里的只读文件预览）：在一个可打开的会话（65 步任务会话）上，控制台 0 个错误、0 个 block 错误；480px 窄屏横向溢出已修复（「本会话文件改动」收起态头部）。
- 实机未覆盖的节点：turn-trigger、压缩记录、独立的问答记录（只覆盖到 `ask_user_question` 工具行）、命令与重试等记录行、中断与运行中轮次（因此也没有「前 N 步」压缩行、浮动运行胶囊、进行中的扫光和 `StateDot` ongoing）、计划、「在对话中查看」、真实浅色主题（只做过去掉深色标记的近似目检）。这些仍需在真实宿主确认。
- 性能夹具（隔离 headless Chrome，不是桌面 WebView2；21 轮、20 次工具调用、5 秒流式，各 3 次取中位数）：默认路径 frameP95 13.5 ms、commitP95 1.6 ms、framesOver25 为 8；这条路径把较早步骤压缩，测量窗口内不渲染它们，与 0.1.18 不是同口径。较早步骤展开的最坏情况为 13.4–13.5 / 1.6–1.7 / 7。0.1.18 基线为 13.4 / 1.4 / 5，来自另一次采集。阈值（frameP95 ≤ 15.4、commitP95 ≤ 2.1、framesOver25 ≤ 8）所有中位数都满足，但有两点要如实记下：展开变体的 commitP95（1.6–1.7）高于 0.1.18 基线 1.4，只是仍在 2.1 的上限内；默认路径 framesOver25 中位数 8 正好在上限。framesOver25 在这台机器上波动明显，不足以作对比结论；frameP95 与 commitP95 稳定。

## 0.1.18

- 阅读流按 chat/session/pending 域在宿主订阅边界选择数据，当前节点追加文字不再唤醒无关历史组件。分组保留稳定引用，本轮仅订阅自己的节点和轮次。
- 显式提供只读快照供统计行和兼容模块使用，不依赖 React 私有 fiber 存放完整快照；覆盖源缺席及恢复、旧版内嵌快照与新版拆分快照。
- 流式缓冲复用单个 rAF 循环；逐词动画完成后的包装回收合帧。保持原有词序、350ms 渐显、blur、缓冲时序和折叠曲线。
- 外层跟随缓存 ResizeObserver 测量结果；离屏轮次尺寸先集中读取再写入。保留手动滚动暂停、选择保护和回到最新。
- heavy 模式仅优化离屏布局，不再关闭 blur、shimmer 或状态模糊过渡。
- 新增结构选择、收尾合帧、显式快照回归及完整 Reader 浏览器夹具：21 轮短对话与 20 个工具步骤，使用实际宿主 React/原生组件，校验工具详情、滚动与最终文本。浏览器夹具不等同于桌面 WebView2 实机帧率验收。

## 0.1.17

- **修复部分设备上用户消息整条变成「此内容暂时无法在阅读页显示」**。用户消息的文本叶子
  原先直接渲染宿主 primitives 的 `MessageText`；阅读页对宿主展示组件的可用性与入参契约没有
  任何约束力——0.1.13 修过的同类事故（0.1.2 起 primitives 由内置默认值改为必传 `labels`，
  缺失即渲染期 TypeError）就是这样把整条座位吞成兜底文案的。用户消息**只**经过这一个宿主
  组件（助手消息走插件自带 Markdown 栈），所以宿主侧的差异恰好表现为「只有用户消息消失」。
  修复分四层：
  1. **文本叶子自持**：新增 `UserText`（`white-space: pre-wrap` + `word-break: break-word`，
     与原生 `.text` 等价，字号/行高继续继承气泡），用户消息路径不再引用任何宿主组件。
  2. **形状容错**：`contentBlocks` 迁入 `src/client/user-content.ts` 并按 unknown 归一——
     content 缺席/非数组/纯字符串、image 块缺 `attachment` 或 `attachmentId`、text 块无字符串
     正文，一律降级为可见记录或文本而不是抛错；`Blocks` 的 key 改用 `blockKey()`，附件缺失
     时给稳定占位，不再解引用 undefined。
  3. **图片占位兜底**：`ImageBlock` 在附件引用不可用或宿主未注入 `loadImage` 时直接走既有的
     「图片未能加载」占位分支（宁可显示占位，不再炸掉整条消息），且不再给出无意义的重试按钮。
  4. **兜底文案自带证据**：`BlockBoundary` 补 `componentDidCatch`——错误与组件栈落
     `console.error('[dsh-clearview] …')`，同一原因写到 `data-reader-block-error` 属性上。
     此前边界静默吞错，设备侧只能看到兜底文案，报告因此不可诊断。
  新增 `tests/user-content.test.ts` 7 项回归锁（归一化边界、key 占位、附件谓词、「用户文本
  不得再用宿主 MessageText」静态守卫、边界证据通道、图片降级分支）。
## 0.1.16

- **锁定 WebKit（macOS 13.7 / Safari 16.5）兼容基线，防 ES2025 语法复发**。macOS 13.7
  （Safari 16.5，JavaScriptCore 605.1.15）用户报告「ES2025 语法不支持」。排查结论：
  0.1.15 产物本身**不含**任何 ES2023+ 语法、也不含 ES2024/25 运行期 API——ES2025 的
  唯一新增语法 `using`/`await using` 声明（Safari 19 起支持，16.5 上解析期 SyntaxError，
  整条插件条不加载）、正则 `v`/`d` 标志字面量（Safari 18.1/26 起）、`Object.groupBy`、
  `Promise.withResolvers`、`Array.fromAsync`、Set 关系方法、`Float8Array`、iterator
  helpers 等逐项扫描均为零。因此若报错在 0.1.15 上复现，该语法只能来自宿主内核
  提供的种子/注入模块（内核侧构建目标问题，需携 console 原文与失败资源 URL 上报
  内核）；本版本为插件自身加三道保险，保证此类缺陷永不复发：
  1. **浏览器半边 target 钉死 es2022**（`tsdown.config.ts`）：devkit 适配器
     `externalClientBundle` 的 browser 默认值是 es2024，而 Safari 16.5 的语法上限
     是 ES2023（该版本未新增语法），钉 es2022 后未来任何 ES2023+ 语法（含 `using`）
     都会在构建期由 bundler 降级（esbuild 会改写为 try/finally + `__using` 助手，
     不依赖 `Symbol.dispose` 全局）；宿主半边（platform node，Node 22+）不受影响。
  2. **产物门禁** `scripts/browser-syntax-gate.mjs`：esbuild 以 target es2022 重发
     `lib/client.js`——输出出现 `__using`/`__callDispose`/`__knownSymbol` 助手即判定
     源含 `using` 声明；`new RegExp(..., "v")`（bundler 把 `v` 标志字面量改写成的运行
     期构造，Safari 16.5 上 TypeError）同样判败；并审计源中 ES2024/25 运行期 API
     的**直接使用**——这类 API 任何 bundler 都不转译，只能源码层规避，门禁只负责
     发现。`node scripts/browser-syntax-gate.mjs [lib/client.js]` 可独立运行。
  3. **回归锁** `tests/browser-target.test.ts` 2 项：产物门禁必须通过（未构建时跳过，
     与 client-store-resolution 产物锁同约定）+ `tsdown.config.ts` 必须保留
     `config.target = 'es2022'` 覆盖（防 devkit 适配器默认值或配置重构导致漂移）。
  另：`esbuild` 升为显式 devDependency（门禁依赖，此前仅经 tsx 间接可用）。

## 0.1.15

- **未接入记录统一降级为「工具调用」默认卡片**。此前阅读页遇到本构建未接入的记录
  类型（如 AgentTeams 投射的 `agent-teams` 节点、更新内核新增的 kind、append-surface
  未认领的兜底记录）会显示「此记录类型暂未接入阅读页 / 未识别的会话记录」的
  `css.unknown` 灰盒，读起来像阅读页自身的缺口。现在这些记录一律渲染为默认提示卡
  （`NoticeCard` info 样式，与命令记录/工作流记录同款）：标题「工具调用」，meta 保留
  记录类型（unknown kind 时取 payload 的 `type` 或节点 id，记录仍可辨识），展开即见
  原始记录 JSON（`RecordJson`，与其余卡片同一「卡片唯一可展开」节奏）。新增 DOM 标记
  `data-reader-generic-call`；`command-input` 无文本的回退路径共用同一组件。
- **修复 0.1.2 内核上插件「启动即失败」（启动页 Failed to load plugins）**。0.1.14 的
  结论「0.1.2 由 client-modules 的 compat 种子同名承接 `dsh-client-runtime/client`」
  **不成立**：0.1.2-rc.1 的启动壳只预置 8 个平台种子（react、react/jsx-runtime、
  react-dom、react-dom/client、`@deepseek-ai/cordis`、`@deepseek-ai/dsh-client-store`、
  `@deepseek-ai/dsh-client-ui-slots`、`@deepseek-ai/dsh-client-ui-primitives`），
  既没有 runtime 包、也没有它的 compat 别名。当时「看起来能用」只是因为该机内核文件被
  手工打过一次 compat 补丁——内核重装/升级（profile 的 node_modules 是指向内核的
  junction）即失效，插件立刻退回
  `client-modules: require("@deepseek-ai/dsh-client-runtime/client") missed the module table`。
  该错误是**bundle 级硬失败**而非局部降级：值导入被客户端构建提升成工厂顶部一次写死的
  `require`，宿主模块表答不上来时整条 loader entry 的导入抛错，插件全部功能不加载。
  修复：`store.ts` 不再静态导入 `defineStore`，改在懒 CJS 工厂作用域内用模块表解析器
  逐条 `try/catch` 查表——`@deepseek-ai/dsh-client-store`（0.1.2+ 平台种子）优先，
  `@deepseek-ai/dsh-client-runtime/client`（0.1.1 真实预载模块）兜底，两条都缺失才抛出
  写明尝试记录的明确错误；类型侧仍走 `import type`（编译期擦除，不产生 require）。
  构建产物因此只剩 react、react/jsx-runtime、`@deepseek-ai/dsh-client-ui-primitives`
  三个双版本共有外部依赖（0.1.1 与 0.1.2/0.1.3 的种子表交集的子集）。
  验证方式不再依赖「有人说能用」：把本机内核**恢复为未打补丁的 0.1.2-rc.1 原版**后，
  用 headless Chrome 真实启动 Web UI——`dsh-clearview` 五个 compat 补丁
  （composer-readability / memory-tail-keep / perf-guard / rewind-bridge /
  turn-metrics-footer）全部 applied，无任何 loader 报错；恢复打补丁内核后同样零回归
  （两条路径都实测过）。`npm test` 150 项全绿。
  新增 `tests/client-store-resolution.test.ts` 回归锁 3 项：① src/client 禁止对已删包做
  值导入（TS 编译器 API 判定，`import type` 与内联 `{ type X }` 放行）；② 引擎解析表必须
  两个拼写齐全且新平台拼写在前（防止宿主另装同名 compat 种子时抢在真实引擎之前）；
  ③ 构建产物不得再出现写死的 legacy require。三项均做过反向验证（重新引入值导入后
  测试确实报 `store.ts: { defineStore }` 失败）。
  另注：同环境里 `@dsh-external/dsh-prompt-enhancer`，以及 dsh-tavily / dsh-notification
  等插件仍对已删除的 runtime 包做值导入，属同一类缺陷，需各自仓库按同样方式修；
  本仓库的改动只覆盖 dsh-clearview 自身，不再需要任何内核侧补丁。
- **0.1.5-rc.2 内核实测通过**。0.1.5-rc.2 的平台种子表扩到 9 项（新增
  `@deepseek-ai/dsh-client-ui-dockkit`），本插件依赖的三项外部（react、
  react/jsx-runtime、`@deepseek-ai/dsh-client-ui-primitives`）与 store 引擎的
  首选拼写 `@deepseek-ai/dsh-client-store` 仍在表内；用 headless Chrome 实启
  Web UI 复核：插件正常加载，五个 compat 补丁（composer-readability /
  memory-tail-keep / perf-guard / rewind-bridge / turn-metrics-footer）全部
  applied，compat 样式注入成功，无任何 loader 报错。槽位
  `conversation.view` / `conversation.session` / `conversation.input.dock` 与
  `entriesOfSlot` 在该版内核中同样齐备。

## 0.1.14

- **全面兼容性核查补漏：`JsonBlock` 与 `CodeBlock` 的同族「必传文案」缺口**。对插件
  功能全集 × 0.1.2 实际契约逐项复核时发现，0.1.13 只修了带 `labels` 形参的组件，
  同批 cordis-free 迁移还有两处改了别的形参名：
  1. **`JsonBlock.truncatedLabel` 从「有内置默认」变为必传**。0.1.2 删除了
     0.1.1 的 `defaultTruncatedLabel`（`… 已截断，共 N 字符`），展开态正文超
     20000 字符时无守卫直调 `truncatedLabel(s.length)` → TypeError →
     BlockBoundary 兜底卡。0.1.13 的「JsonBlock 不受影响」结论**有误**（当时
     只按 labels 契约排查）。受影响调用点：工具失败卡原始数据（argsRaw 大文件
     写入极易超 2 万字符）、未接入类型回退卡 ×2。修复：`primitive-labels.ts`
     新增 `JSON_TRUNCATED`（与 0.1.1 内置默认逐字一致）；`labeled-blocks.tsx`
     新增 `JsonBlockL` 包装（0.1.1 该形参同名且可选，直传两版安全，无需
     spread）；四处裸 `<JsonBlock>` 全部接入（`ContextBody` 为原生抄写件，
     本就走 seat `t('json.truncated')`，已合规）。
  2. **`CodeBlock` 的 `copyLabel`/`copiedLabel` 从内置默认变为必传**。0.1.2 删除
     0.1.1 内置的「复制/复制成功」（`streaming` 新形参可选，不传即非流式路径，
     无崩溃）；插件 markdown 渲染器传的是 `context.codeLabels?.copyLabel`（可
     选链）——主渲染路径恒有 CODE_LABELS 不受影响，但任何未带 codeLabels 的
     渲染上下文会出空白复制按钮（静默降级）。修复：渲染器内显式回退到与 0.1.1
     内置一致的「复制/复制成功」。
  新增 `tests/primitives-copy-contract.test.ts` 回归锁（裸 JsonBlock 静态守卫、
  codeLabels 回退断言、JSON_TRUNCATED 与原生 zh 模板逐字一致）3 项。
- **修复 memory-tail-keep（收尾总结防吞）在 0.1.2 上静默失效**。该补丁与 0.1.11
  修复前的轮统计行共用旧的 `v.chat.nodes` fiber 快照判定——0.1.2 会话快照瘦身后
  命中不了任何钩子状态（merged 快照在闭包计算、不在任何 hook memoizedState），
  快照恒为 null，「真总结被收尾确认步骤顶掉」的回归防护自 0.1.9 起实际处于失效
  状态。修复：复用 `turn-metrics-footer.normalizeSnapshot` 双形态归一（0.1.1
  session 完整快照 / 0.1.2 useChat 快照本体），~5 行改动，两版兼容。
- **退役 composer-readability 的死半边**：`--dshcp-canvas-solid` 画布色变量的
  计算（getComputedStyle 每 5s + 主题 MutationObserver ×2）在插件内外均无消费
  者——唯一用途「回到最新」药丸实底早在兼容样式合并时并入插件主体。删除该计算
  与两个主题观察者，统计行标记保留不动。
  其余核查结论（节点 kind 全集、快照形状、locale 桥、槽位 props、服务注入、
  compat DOM 锚点、工具证据契约）见本轮审计记录，未发现新的必现缺陷。

## 0.1.13

- **修复折叠区展开即显示「此内容暂时无法在阅读页显示」**（首发于模型重试卡：折叠
  正常、点开展开即失败）。0.1.2 的 primitives 把这批展示组件的本地化文案从内置
  默认值改为**必传 `labels` prop**：`JsonTree`（复制菜单/节点 aria）、
  `TerminalBlock`（运行态/折叠/复制）、`ReadBlock`、`DiffBlock`、`SearchBlock`、
  `WebBlock`、`MarkdownText`（代码块复制/脚注）——缺失时渲染期直接 TypeError，
  被座位级 `BlockBoundary` 吞成兜底文案。原生各包都经 `xxxBlockLabels(t)` 提供，
  而阅读页一直不传（0.1.1 全部有内置默认值，所以从未暴露）。这些组件又都在折叠
  区内懒挂载，故只在点开瞬间炸。修复：
  1. 新增 `native/primitive-labels.ts`：与原生 0.1.2 zh 词典逐条一致的 7 组
     labels 常量（模块级常量保证引用稳定）。
  2. 新增 `native/labeled-blocks.tsx` 包装层：`ReadBlock/DiffBlock/SearchBlock/
     WebBlock` 在 0.1.1 没有 labels 形参（TS 拒绝多余 prop），包装内部 spread
     附加（0.1.1 运行时忽略、0.1.2 必需）；`TerminalBlockL` 支持个别字段覆盖
     （失败态 `done: '失败'` 语义保留）；`MarkdownTextL` 补代码块复制/脚注 chrome。
  3. 全部调用点接入：模型重试卡的 `JsonTree`、工具卡的输入 JSON 树（含「全部
     输入字段」）、终端/读文件/差异/搜索/Web 卡、命令结果 Markdown。
  排查结论：`JsonBlock`（命令/压缩/工作流/未知节点记录卡）两版都不需要 labels，
  不受影响——问题只限于上述带 chrome 的展示组件。新增 4 项 labels 契约单测。

## 0.1.12

- **修复上下文注入行在 0.1.2 上显示原始键名（message.contextInjection）**。0.1.2 的
  fold-product 把上下文注入行从 ui-conversation 迁进 ui-chat，一批词典键
  （`message.contextInjection` / `message.contextRecall` / `message.context.*` /
  `message.unknownBlock` / `json.truncated`，共 14 个）随之从 `'conversation'` NS
  迁到 ui-chat 的 `'chat'` NS；阅读页的 `t` seat 绑定注册时声明的 `'conversation'`
  NS，0.1.2 上这些键查不到，seat 按缺失约定回显键名。修复：新增 locale 兼容桥
  （`compat/locale-bridge.ts`），在 `useCompatReaderProps` 统一包装 `t`——
  0.1.1 seat 命中原样透传零开销；0.1.2 键名回显时回退内置中文词典（文案与原生
  0.1.2 zh 逐条一致），`{param}` 模板就地插值；词典外的真实未知键仍回显不吞错。
  新增 5 项单测（回显回退、实 seat 透传、未知键、缺参占位、词典无缺口校验）。

## 0.1.11

- **修复阅读页轮次统计行在 0.1.2 上整体失效，并补上 0.1.2 的 token 用量统计**。
  阅读视图接管渲染后原生收尾行消失，compat 层的 `turn-metrics-footer` 从阅读器根
  元素沿 React fiber 上溯读取会话快照再注入统计行——但它的判定
  （`hook 状态.chat.nodes`）只认 0.1.1 的完整 session 快照；0.1.2 session 快照瘦身
  后 `chat` 移到独立的 `useChat` 钩子（顶层就是 nodes/timeline），旧判定命中不了
  任何钩子状态，快照解析恒为 null，统计行从 0.1.2 起整段消失。修复：
  1. 快照解析双形态归一（`normalizeSnapshot`）：0.1.1 内嵌 chat + 顶层
     `turnTimings`，0.1.2 顶层 chat + `legacy.turnTimings` 兼容切片，统一收敛成
     `{ chat, turnTimings }` 读取面；瘦身后既无内嵌 chat 也无顶层 nodes 的
     session 切片安全跳过。新增 8 项单测覆盖两版形态、无效载荷与 NaN 边界。
  2. 顺带对齐原生新统计：0.1.2 的 turn-tail 数据新增 `tokenUsage`（聚合各次模型
     尝试的精确计数），原生从 hover 文案改成「用量 N tok / 用时」两个 pill；阅读页
     统计行按字段存在性插入「用量 9.4M tok」（紧凑计量与原生 `formatTokens` 同
     规则：<1k 原值、<1M 一位小数 K、其余一位小数 M），0.1.1 无该字段自动缺席。
  3. 修复测试暴露的旧边界：轮次时间非法（NaN）时会渲染出「用时 NaN秒」，补
     `isFinite` 守卫，缺证据的轮次不渲染统计行。

## 0.1.10

- **接入 0.1.2 新增节点与条件触发的老节点，消除对话流中的「此记录类型暂未接入阅读页」卡片**。
  0.1.2 的 fold-product 重构给对话流新增了两类投影（每个模型请求一条 `system-prompt`、
  每个轮次一条 `turn-process` 控制节点），阅读页此前对二者都不识别，整页渲染成一排
  兜底卡；`command-input`（`/goal` 命令输入）与 `workflow-run`（持久工作流运行）是
  0.1.1 就有的条件触发类型，同样未接入。现在的处理：
  1. **`turn-process` → 不渲染**：阅读页有自己的「执行过程」Disclosure（用时统计 +
     分步状态），原生的折叠控制器在阅读页语义上完全冗余，返回 null 不产生卡片。
  2. **`system-prompt` → 新增「系统提示词」折叠行**（`native/SystemPromptRow`）：与
     上下文注入行同一套 24px 头部节奏与 141px 代码视口几何，展开显示请求的完整系统
     提示词（保留真实换行，超 20000 字符截断并标注总量）；空提示词按原生投影同样
     跳过。布局上，按 0.1.2 的锚点顺序 system-prompt 排在开场 user 之前，TurnGroup
     新增 preamble 段把它们渲染在过程 Disclosure 之上，开场输入保持原生位置。
  3. **`command-input` → 用户消息样式块**：meta「命令输入」+ 等宽原文（原生为右对齐
     等宽气泡，阅读页沿用现有用户块几何）；载荷不可读时回退原始记录卡。
  4. **`workflow-run` → 汇总记录卡**：标题 + 状态（运行中/已完成/已失败/已取消/已中断）
     + 子会话与阶段计数，原始快照一键展开；失败态用错误色调。子会话的嵌套回放仍以
     原生对话为准，阅读页不做深回放。
  5. **`unknown` → 保留显式卡片**但改文案为「未识别的会话记录：{事件类型}」，不再与
     上面的已接入类型共用「暂未接入」措辞；其他已知 kind 的载荷不可读时，回退到
     带「暂未接入」提示的原始记录卡（不会静默吞掉记录）。
  载荷读取全部走防御性窄化（`src/client/node-payloads.ts`，新增 5 项测试），任何
  不可读载荷都回退而不是抛错；不依赖节点 kind 的版本归属，0.1.1 / 0.1.2 通用。

## 0.1.9

- **兼容 DSH 0.1.2（保留 0.1.1）：修复核心更新后插件整体失效**。0.1.2 的客户端
  平台重组把 0.1.1 的 `dsh-client-runtime` 拆掉了：会话快照瘦身（`chat` 时间线与
  `pending` 待处理交互从 `useSession` 快照中拆出，改为 ui-chat 提供的 `useChat`
  与 ui-session 提供的 `useSessionPendingInteraction` 两个标准钩子）；原生会话
  store 的 persist 键从 `dsh.conversation.chat` 收敛为 `dsh.conversation`（触发
  入口绑定校验 `isChatStore` 失败抛错，整个「阅读」页注册事务回滚）；`workspaces`
  服务不再携带 `openPath`/`listDirectory`（改挂 `remote.session.openWorkspacePath`
  与 `remote.directoryPicker.list`）。三项全部按特性检测修复：
  1. 新增 `compat/session-snapshot.ts`：入口处把 0.1.2 拆分的 `useChat` /
     `useSessionPendingInteraction` 合成回 0.1.1 形状的 `props.useSession`，
     阅读页全部下游代码继续读 `snapshot.chat` / `snapshot.pending`；0.1.1 缺
     这两个钩子时零开销透传（钩子身份稳定，不破坏子组件 memo）。
  2. `entry.tsx` 的原生 store 识别放宽为 persist 前缀 `dsh.conversation` +
     `setView` 动作（两版共有的稳定身份），不再因键名收敛抛错。
  3. `index.tsx` 的 `openFile` / `listDirNames` 按服务形状探测：0.1.1 走
     `workspaces.openPath` / `workspaces.listDirectory`，0.1.2 走
     `remote.session.openWorkspacePath` / `remote.directoryPicker.list`；`inject`
     补声明 `remote`（两版都提供的根级服务）。
  另外：`store.ts` 恢复从 `@deepseek-ai/dsh-client-runtime/client` 导入
  `defineStore`——0.1.1 是真实预载模块，0.1.2 由 client-modules 的 compat 种子
  同名承接（内部转发 `dsh-client-store` 引擎），是唯一在两版都可解析的取径；
  半成品迁移改用的 `@deepseek-ai/dsh-client-store` 在 0.1.1 上不存在（模块表无
  此种子词、dshx 打包纯度门也会拒绝），已回退。新增
  `tests/` 覆盖不变，122 项测试全绿；构建产物外部依赖仅剩 react、
  `dsh-client-ui-primitives`、`dsh-client-runtime/client` 三个双版本共有种子。

## 0.1.8

- **修复「一直停在最底部、结束时却出现回到最新按钮且位置有偏移」**：阅读视图的
  「阅读守卫」里 `focused()` 此前把**任意**位于阅读器内、持有 DOM 焦点的元素都当作
  暂停自动跟随的依据。但用户在阅读中点一下任意控件（展开/收起过程的 Disclosure、
  过程/工具页签、可滚动的思考卡片 `tabIndex=0`）就会留下「偶然焦点」，它并非用户
  正在键盘操作，却会静默暂停跟随——末尾的内容追加便拉开真实偏移，回合结束时活动条
  消失、跳转坞（`detached && !activity.key`）随之出现，点下去才看见位置其实偏了。
  修复：`focused()` 收窄为**仅文本编辑面**（textarea / 文本 input / contenteditable）
  才视为焦点守卫；阅读器内本无文本输入，故偶然焦点不再停摆跟随，视口继续贴底，
  偏移与误报的跳转坞消失。文本选择守卫（`selected()`）与决策表不变（选中文本时仍
  应暂停跟随），97 项测试全绿。DOM 复现：聚焦 Disclosure 按钮后底部追加 400px 内容，
  修复前 gap 444/视口停摆/跳转坞出现，修复后 gap≈0/视口贴底/无跳转坞。
- **修复思考卡片吞掉滚轮导致「鼠标在主流程区滚动无反应」**：`.reasonViewport`
  （思考卡片视口，`overflow: auto` 的嵌套垂直滚动区）此前设了
  `overscroll-behavior-y: contain`。当滚轮落在这个视口的顶部或底部滚动边缘时，
  滚轮事件被完全吞掉（既不滚动卡片、也不回传外层阅读器滚动区），实测
  outerDelta=0；而多轮会话里几乎每轮都有思考卡片、且思考内容常超出 224px
  折叠预览（或 560px 展开上限）形成可滚动视口，主流程大面积出现滚轮死区——
  表现为「鼠标处于 mainFlow 区域时滚动无反应、必须移到两侧空白才能滚动」，
  是否触发取决于鼠标位置与卡片内部滚动位置，故非必现。修复：去掉该
  `contain`，边缘滚轮按嵌套滚动惯例回传外层（实测恢复 -100 量级回传，与
  `.toolRaw`、`pre`、上下文注入块等其他嵌套滚动区一致），CSS 处加了注释防止
  回归。
- **修复长会话向上滚动时滚动位置突然跳到更上方（content-visibility 占位跳变 + 原生 scroll anchoring 误补偿）**：重会话（内容规模或轮次数超阈值）下 perf-guard 点亮 `data-dshcp-heavy`，已关闭轮次以 `content-visibility: auto` 离屏渲染；但从未渲染过的轮次使用 480px 回退占位。向上滚动读历史时，滚动手势中途发生占位 → 真实高度（数千 px）的交换，原生 scroll anchoring 的锚点位于交换盒内部或相邻处，会按「交换引发的重排」做补偿，把视口拽到明显更早的位置（用户报告的「向上滚动时突然跑到上方得多的位置」；真实环境实测每次交换步 ~146px 反向跳变，且 `contain-intrinsic-size: auto` 的「记住上次高度」在当前 Chromium 的后续滚动轮次里不可靠——占位回退仍复现，多次上滚反复触发）。修复：只有真实高度已测得的轮次才参与离屏渲染——perf-guard 的 2s 低频轮询为已关闭轮次点亮 `data-cv-armed` 并把实测高度写入内联 `contain-intrinsic-size`（CSS 规则相应加上 `[data-cv-armed="1"]` 门控）；从未渲染的轮次保持完整布局（真实几何，向上滚进入时不发生尺寸跳变），已渲染轮次再离屏时占位 = 真实尺寸，elide/render 交换尺寸中性。真实环境实测：修复前 18 步上滚在交换步出现 -146px 跳变，修复后 18 步 0 跳变，重会话的离屏渲染收益保持不变。新增 `tests/cv-arm.test.ts` 覆盖 `cvArmSize` 边界。

- **新增「本会话文件改动」面板：会话结束后在对话流末尾按 新增／修改／删除 三类汇总**：
  阅读视图在对话流最底部（回合结束后出现）展示一个只读汇总卡片，把本会话实际发生
  的文件变更按三类分组列出，路径用相对路径（越出会话工作区时保留绝对路径并折叠），
  点击路径按会话 cwd 解析后交给工作区打开器打开。分类基于工具调用证据而非猜测：
  `write`/`str_replace_editor` 等文件工具的创建/更新结果视图（「Created file」/
  「Updated file」文本、空 diffs 元数据）判新增或修改；`edit` 恒为修改；无视图时回退
  参数里的文件路径（默认修改）；删除没有专用文件工具，只能来自终端命令——对
  `rm/Remove-Item/del/git rm` 等移除动词与 `mv/Move-Item/git mv` 移动（两路径才计：删源
  + 增目标）做成功命令的词法解析（失败命令、动态变量、通配、根目录等一律不计），
  并按路径净状态折叠（先建后删=净零不显示、最后删除=删除、首次创建=新增、否则
  修改）。宁缺勿错：无法判定的调用不计入，未知工具默认修改而非新增。可见性与
  对话流一致地收敛：对话执行中、有排队消息、本会话有后台任务（运行/停止中）或
  窗口仍在加载时整卡卸载，回合结束且无运行内容时淡入出现；窗口未覆盖全部历史时
  标注「仅已加载记录」，被回滚（rewind）隐藏的轮次不计入（与可见转写一致）。
  无任何文件改动时显示「无文件改动」。纯展示，不改动对话流原有内容与交互；新增
  `tests/file-changes.test.ts` 22 项（分类、shell 词法、净状态折叠、路径相对化等）。
- **补齐非命令类单行操作执行时的状态动画**：工具行的状态呼吸（状态徽标脉冲 + 摘要扫光）
  此前只挂在 `running` 相位上。终端命令执行期长，扫光可见；而 write/edit 的大部分可见
  时间处于 `preparing`（模型正在流式生成工具输入，写文件时即整个文件内容），read/搜索等
  的真实执行耗时又在毫秒级——`running` 一闪而过，这些行只剩一个小圆点在呼吸，观感上
  「没有动画」。现在两个在途相位（preparing/running）共用同一套状态动效，与行底色高亮
  （本就覆盖两相位）对齐；`data-motion=off` 与 `prefers-reduced-motion` 降级清单同步
  补上 preparing 选择器。

## 0.1.7

- **失败的执行只出现一次：所有工具失败都并入报错卡片**：任何工具执行失败
  （终端 bash/pwsh、搜索 grep/glob、文件修改 edit/write、网页、读取等）都不再
  出现「工具行（失败徽标）+ 报错卡片」两处展示同一次执行；失败时工具行并入
  报错卡片——卡片主体直接复用工具行的 `toolDetails` 布局（账本行 + 结果/输入/
  原始数据三个页签），结果页签呈现执行结果与失败文本，输入页签呈现提交的
  参数，原始数据页签呈现完整记录；无需再为失败单独拼一套内容。退出状态优先取
  meta/结果视图中的退出码，缺失时从失败文本里恢复（如「exit 2」），两者都没有
  也不显示「已完成」，改为「失败」状态。执行中或未失败的工具行不受影响。
- **报错卡片主体复用工具详情布局**：卡片展开后的内容不再是单独拼装的
  「完整记录」，而是与工具行展开区共用的 `toolDetails` 布局（同一套页签与
  12px 间距节奏），卡片内去掉行对齐缩进，观感保持一致。
- **命令/上下文整理记录卡片与卡片家族统一**：命令执行与上下文整理记录不再
  是「状态行 + 状态行 + 独立展开按钮」的多行样式，改为与其他提示卡片相同的
  「单行摘要 + 整行直接展开」结构——摘要行（箭头 + 标题 + 说明 + 展开提示）
  可整行点击，展开后直接呈现记录内容（只读记录块，卡片内不再有第二个展开层级）；
  生命周期状态由标题文字配色传达（执行中蓝色呼吸、成功绿色、失败红色），
  不再使用独立状态圆点行。
- **折叠卡片箭头统一为 SVG，停止提示并入主流程**：报错/提示卡片（工具执行
  失败、本轮错误、长度限制提示等）折叠标题里的「▸」字符替换为阅读器统一的
  SVG 箭头（与过程展开箭头同款，展开时旋转 90°，关闭动效时同步停用过渡）；
  「本轮已停止」等状态提示移入主对话流内部，成为流程间距与滚动锚点的一部分。
- **动效打磨（不改视觉与架构，参数级优化 + 补齐遗漏）**：
  - 过程展开/收起现在是高度 + 透明度成对出现（`ProcessFragment`
    WAAPI 关键帧加 opacity，260ms 统一缓动），收起不再是生硬裁掉；
  - 操作集群的详情区展开/收起补上同语言动画（新增 `CollapseBody`，
    与过程展开同节奏；padding 移入内层，首尾帧不跳变）；
  - 审批提示、运行状态条、「回到最新」药丸的实时出现补上 220ms
    淡入 + 上浮 6px（新增 `MountFade`，transform/opacity only；
    历史挂载直达终态、不重播，退出直接卸载）；
  - 缓动统一为 `cubic-bezier(.22,1,.36,1)`：thinking 状态切换、
    图片淡入、状态条、报错/提示卡片箭头（160ms ease → 200ms 统一曲线）；
  - 活跃脉冲柔化：工具圆点与集群/命令呼吸谷值 .25/.28 → .55，
    长时间运行不再"闪烁"；
  - 补齐 hover/active 过渡（160ms）：文本按钮、开关、过程展开、
    集群头、思考折叠行、工具页签、历史按钮、复制按钮与关闭按钮；
    可按压元素加轻微 press 缩放（0.9–0.92），图片预览 backdrop 淡入；
  - 降级路径全覆盖：`data-motion=off` / `prefers-reduced-motion` 下
    所有新增过渡与进入动画均为 `transition: none`、直达终态。

## 0.1.6

- **运行状态条**：
  - 对话流运行期间底部常驻「阶段 + 计时」矩形悬浮条（正在思考/正在输出/正在使用工具/等待你的操作，秒级计时、步骤切换归零；计时基于步骤的真实事件时间戳，切换会话不重置、空闲后不发消息不误计）；
  - 滚动离开底部时淡出、回到底部恢复，附「回到最新」按钮（复用跟随跳转）；
  - 仅存在运行中轮次时显示，无运行轮次/等待操作时文案与计时相应切换。
- **折叠思考动态摘要**：
  - 思考进行中从 1 秒开始动态计数，结束后定格；
  - 折叠态摘要追加「共 N 个字符」；
  - 思考进行中与单条命令/工具执行中的文字增加透明度呼吸动画。
- **顶部开关重做**：
  - 左侧原先的“阅读 · 原始记录完整保留”说明文字替换为「折叠思考」开关；
  - 开启后每段思考默认折叠为「思考了 N 秒」，可单独展开/收起；
  - 右侧「动效」改为真正的拨动开关样式，状态一目了然。
- **原版思考图标**：思考段标题「思考」前增加 DeepSeek 原生
  `IconThinkOutline` 图标。
- **命令与压缩合并为同一张执行卡片**：`/compact` 等手动压缩命令与普通命令
  一起参与操作集群聚合，不再被拆成两张独立的“执行过程”卡片。
- **压缩整理提示更明显并与记录合并**：「上下文已整理，原始记录仍保留」不再
  作为过程外的独立提示，而是与「压缩记录」（或手动压缩命令记录）合并进同一张
  过程卡片；提示文字也更醒目。

- **阅读视图样式微调**：
  - 短思考不再用独立容器包裹并降低存在感，避免与正文混淆；
  - 思考卡片顶部留白略增；
  - 思考卡片底部 padding 调小，减少底部留白；
  - `toolState` 从药丸样式改为与工具行一致的圆角矩形，并预留更多内边距；
  - 去除操作集群卡片的阴影；
  - 执行中的单条命令块文本也使用与多命令卡片相同的透明度呼吸动画；
  - 执行过程右侧补出留白，避免边框轻微截断；
  - 「回到最新」改为无文字的居中圆形图标按钮，风格与整体更统一。
- **错误/重试类信息统一为可展开卡片**：
  - 工具与命令失败收纳为一张默认折叠的错误卡片，不再叠加红色横幅和重复错误文本；
  - 本轮错误、输出长度限制、模型重试记录等原先“提示横幅 + 单独详情/末尾说明”
    的场景统一成可展开卡片，展开后才显示具体信息。
- **命令记录折叠态显示结论文本**：`命令记录` 默认为收起时现在会直接显示
  命令的 `outcome.text`（例如 `/compact` 的压缩摘要），无需展开 JSON 即可看到
  命令结果；展开后仍保留完整原始记录。

- **单条命令/工具执行状态更明显**：工具行现在始终显示状态徽标
  （执行中 / 已返回 / 已完成 / 失败 / 中断），执行中为蓝色呼吸指示，
  成功为绿色徽标；单条命令记录也增加「执行中… / 已完成」状态行，
  不再需要从 JSON 或小字里辨认结果。
- **思考卡片区分长短状态**：长思考/可展开思考保留磨砂玻璃背景与模糊；
  短思考（未溢出、未展开）保持纯透明、无磨砂无阴影；同时增加卡片内边距，
  让思考文本与边框之间更透气。

- **执行集群动画与命令块微调**：
  - 集群摘要的 React key 改为基于首条操作记录，数字增长时不再重挂载组件，
    进行中的透明度/扫光动画不会从头重播；
  - 命令执行块和工具行 `nativeToolRow` 左侧都增加一点内边距，视觉上更透气。
- **模型重试/压缩记录纳入折叠过程**：模型重试卡片和自动压缩记录不再在
  对话总结/结束后外露，与其他命令/工具过程卡片一致，收敛到可折叠的
  执行过程区域；正文只保留简短的“已整理”提示。
- **执行集群失败提示**：当集群中的命令、工具调用或操作有失败时，
  集群外层摘要右侧显示红色「· N 个失败」，一眼可识别失败数量。
- **修复两个会话流滚动问题**：
  - 向上滚动已完成会话时不再随机跳到上一条用户消息：移除对话级手动锚点
    补偿，改由原生 `overflow-anchor` 负责脱离底部后的位置稳定；同时把
    离屏 `content-visibility` 限制在 heavy 大会话，普通会话保持完整布局，
    避免渲染尺寸估算与二次锚定互相竞争；
  - 用户发送新消息后自动滚到底部：检测到新增用户消息时立即回到最新，
    无需再手动滚动查看自己刚发的消息和 agent 回复。
- **修复从最新处小幅/间断向上滚动后被重新拽回底部**：
  - 旧逻辑把「距底部 < 72px」直接当作「想跟随」：向上滚一小段（停在 72px 内）
    或滚到一半停下，滚动事件会把跟随意图重新固定，下一条流式内容增长立刻
    把视图拉回底部；
  - 现在跟随意图只由明确的向下手势恢复（滚轮/键盘/触摸，且滚动实际落到底部
    范围内）；向上经过底部范围、以及无手势的滚动事件（如原生滚动锚定调整）
    保持当前意图，不再重新固定跟随；
  - 向下按键（PageDown / End / ArrowDown / 空格）与触摸下滑现在也能主动
    回到底部恢复跟随；「回到最新」按钮/状态条跳转仍是显式恢复入口；
  - 手动滚动（滚轮平滑滚动、触控板甩动、滚动条拖动）落到底部范围后
    「回到最新」会正常隐藏：向下手势意图跨越多个滚动事件保持存活，
    由真正落入底部范围的那条事件恢复跟随；滚动条拖动通过 pointer 事件
    识别（滚轮事件不覆盖该通道）。
- **修复与 dsh-rewind 插件冲突**：阅读视图此前不感知 rewind 的隐藏契约，
  会继续显示撤回后的旧消息以及 `/rewind` 内部探针/成功命令记录（重复的
  「执行过程 · 命令记录」）。现在按 rewind 公开的 `hiddenSeqsOf` 语义
  过滤阅读视图，撤回区间内的用户/助手/工具/命令行统一隐藏，只显示回退后
  仍在对话流上的内容。
- **修复切换会话后思考卡片从头部重播滚动**：重新进入正在运行的对话时，
  新挂载的思考卡片原生滚动容器默认在顶部，自动跟随会从第一条思考开始
  一路滚到底。现在首次进入跟随且已存在溢出内容时，直接定位到当前实时
  尾部，只有真正新增的内容才驱动滚动，不再整卡回放造成卡顿。
  后台标签恢复时也会直接启动跟随并定位到实时尾部。
- **根治对话流"静默停跟"（在底部但新内容不再滚动、也不出现「回到最新」，
  手动滚动才见按钮、点了又复发）**：
  - 定位（无头 Chrome + CDP 复现回路，真实 `useReadingScroll` + 760px/s
    增长，三种差分场景）：跟随循环与 ResizeObserver 被两个**阅读保护守卫**
    （reader 内的非折叠选区、reader 内元素焦点）拦停时不产生任何 scroll
    事件——`detached` 永远停在 false，暂停完全静默。触发面很大：复制/
    双击/Ctrl+F 留下的选区；点击代码块、思考卡、工具面板（均为
    `tabIndex=0` 可聚焦滚动区）或展开/复制按钮留下的焦点。
  - 复发的机制（harness 实测）：Chrome 的按钮 mousedown **不清除**既有
    选区，`jump()` 也不清——点「回到最新」滚到底后，下一次内容增长立刻
    再被同一条选区拦停。焦点守卫可自愈（按钮卸载焦点归 body），
    选区守卫不能，故"点了又继续出现"。
  - 修复（决策抽为纯模块 `reading-follow.ts`，hook 只剩接线）：
    守卫拦停且读者仍声称在底部时，内容超出 72px 即**自动浮现**
    「回到最新」药丸（暂停从此可见、有出口）；`jump()` 作为显式恢复
    指令，清除 reader 内的选区与焦点（composer 等外部焦点不动）；
    跟随收敛到底时收起浮现的药丸。选区存在时仍冻结锚点稳定
    （陈旧锚点写入会拖走读者正在选的文本），焦点不阻塞已脱离底部
    读者的锚点稳定——语义与原实现一致。
  - 回归锁：决策表 5 组测试（无守卫语义不变 / 选区冻结锚定 / 焦点不
    阻塞稳定 / 超阈浮现 / 阈内静默），全套 55/55 通过；harness 三场景
    修复前红（gap 980/948 无药丸；点药丸后 gap 再涨至 1030）修复后绿
    （药丸自动浮现，点击后恢复跟随 gap<72，对照组不变）。

## 0.1.5

- **根治长思考段流式掉帧（170 tok/s 数秒后帧率随长度阶梯减半 → 全程恒定）**：
  - 定位（无头 Chrome + CDP 复现回路，差分开关）：滚动跟随循环无辜；主因是
    **reveal 渲染路径对 live 段落每帧全量处理**——逐帧 setState 触发整段所有
    `<Word>` 组件重渲染 + `Intl.Segmenter` 整段重分词 + 段落切分全文扫描，
    每帧 O(n)、累计 O(n²)，与"越往后越掉帧"完全吻合（段落 memo 只保护
    已完成段，单段思考无段可保护）。
  - 修复：`WordTimeline.liveFloor(now)` 二分出生时间线得到揭示前沿偏移；
    `ReasonSegment` 只把 `[liveFloor, 段尾)` 的前沿窗口渲染为动画组件，
    已完成的 settled 前缀渲染为纯文本（字节不变，前沿随时间单调推进，
    窗口大小只由动画时长决定、与段落总长无关）。前沿切割永不拆下前引号
    （回拉粘住），标点与词共享出生区间、天然不拆。
  - 段落切分改为 append-only 缓存：每帧只从上一个边界重扫，已完成段保持
    字符串引用不变，memo 真正命中、零重渲染。`MotionMarkdown` 正文路径
    同步窗口化。
  - 实测（同一 harness，40s / 9.4k 字符单段）：修复前 s16 起 p95 26.7ms、
    s26 起 p50 26.7ms、s39 出现 93ms 长任务；修复后全程 p50 13.3ms /
    p95 13.5ms、零长任务；reveal 前沿 span 稳定 ~80 个，动画不受影响。
  - 回归锁：`liveFloor` 前沿推进 / 前引号回拉 / 窗口字节保真 / 长段窗口
    有界四组新测试（50/50 通过）。

## 0.1.4

- **长思考卡片性能根治（淡出与滚动随内容变长而卡顿 → O(1)）**：
  - 跟随不再用 transform 轨道：rAF 循环逐帧写视口原生 `scrollTop`。原生滚动
    按视口分块光栅化，成本与转录总长无关；同时删除 `will-change: transform`
    ——它把整条轨道提升为单个巨型合成层，内容越长每帧合成/遮罩合成越贵，
    正是「卡成 PPT」的主因。
  - 循环内零布局读取：`tail` / `clientHeight` / 溢出与渐隐边缘全部由
    ResizeObserver 缓存刷新，逐帧只做算术 + 一次 scrollTop 写入；不再
    `getComputedStyle` + `DOMMatrix` 回读绘制位置（原生滚动下位置即真值）。
  - manual/transform 双模式、wheel handoff preventDefault 补偿、CSS 滑移
    交接等机器整体删除：视口始终是原生滚动容器，滚轮/触摸/键盘天然生效；
    程序写入与用户滚动用「上次程序写入值回读」精确区分，误判即暂停。
  - 结束滑移复用同一控制器逐帧收敛到尾部（不再是 CSS transition +
    transitionend 令牌），交互取消简化为停止写入；清理 `--reason-ease`、
    reduced-motion 轨道规则等死样式。

## 0.1.3

- **思考卡片跟随改为连续速度匹配滚动（无延迟匀速，替代步进 + 追赶）**：
  - 移除 2 行 / 840ms 离散步进与追赶滑移，跟随循环改为单个 rAF 控制器
    （`followAdvance`）逐帧写轨道 transform：内容增长速率 EMA 前馈 + 比例项
    收敛残余滞后。稳定流式下视口速度精确等于内容生长速度（滞后 → 0，
    观感即连续匀速），突发 / 恢复跟随以限速（≤2000px/s）平滑补差。
  - 位置每帧钳制在实时尾部：永不越过转录末尾、不回弹；内容收缩时重新
    瞄准而非冻结；停流后控制器自动归位并挂起循环，下次增长由 ResizeObserver
    唤醒（空闲零开销）。
  - 节流 / 后台恢复的帧间隔被钳制，回前台从当前位置限速续滚，不整段跳跃。
  - 结束滑移（420/600ms 到底再交接原生滚动）与交互取消语义保留不变；
    清理 `--reason-step` / `--reason-hold` / `--reason-lines` 死变量。

## 0.1.2

- **思考卡片自动跟随三处视觉问题根治（延迟 / 结束未到底 / 滚动反弹）**：
  - 跟随循环改为自适应步进（`reasoningAdvance`）：滞后 ≤4 行保留原 2 行 / 840ms
    平滑节拍；滞后 >4 行时直接滑向实时尾部（400–1800ms，随时长距离缩放），
    120ms 后重新评估——快速流式（100+ tok/s）不再稳定欠一段，追赶节奏内聚于
    插件自身，无外部 DOM 观察者竞争。
  - 思考结束（换步骤 / 轮次结束 / 过程折叠）时若仍处于跟随态，把剩余滞后滑到
    尾部（420/600ms）再交接原生滚动，卡片不再定格在滞后位置；滑移过程中
    滚轮 / 选择 / 点击 / 焦点会把它取消在当前已绘制位置，交互不丢帧。
  - 步骤进行中 in-flight 目标实时钳制到当前尾部：内容收缩（重排 / 折叠 /
    视口 resize）时视口不再越过转录末尾再回滚——「滚动反弹」的另一来源。
  - 视口 resize 不再冻结跟随（改为重新瞄准目标）；首步与恢复跟随从 840ms
    等待缩到 200ms，新流一出现即开始跟随。
  - 移除外部 `compat/reasoning-catchup.ts` DOM 补丁：其 400ms 滑移与插件步进
    竞争同一轨道，滑移常进行到一半被插件下一步 `transition:none` 掐断
    （「猛地窜 → 急停 → 爬两行 → 再窜」的观感来源），由循环内追赶完全替代。

## 0.1.1（本地迁移版）

- **性能修复（阅读视图长会话滚动掉帧根治）**：逐词渐显的 `<span data-reader-word>`
  在动画 settle 后由组件自行渲染为纯文本（React 干净卸载该 span），稳态只保留
  ~350ms 动画前沿的少量 span。实测 43 步会话滚动：longtask 50-200ms×55 → 0，
  maxDelta 117-400ms → 17ms；流式 5680 字期间 span 稳定在 48-101。
- **内聚原 dsh-custom-patcher 的 13 个阅读视图配套补丁**（`src/client/compat/`）：
  composer 布局/毛玻璃标记、memory 收尾展开、思考跟随追赶与渐隐修正、轮次统计行、
  rewind 兼容桥、工具失败去重、短思考样式、离屏轮次 content-visibility +
  负载守卫 heavy 降级。样式经 `<style id="dsh-clearview-compat">` 注入
  head 末尾（保持原优先级语义），JS 模块由插件 apply 启动并挂 ctx.effect 生命周期。
- 插件自 `deepseek-harness/my-plugins/` 迁移至 `dsh/dsh-clearview` 独立维护。

## 0.1.0

First public release of the accepted reading-view plugin, published as `dsh-clearview`.

- Native context and tool details with source-ordered, unmodified reasoning.
- Bounded long-reasoning cards with two-line following, expanded follow and manual pause/resume.
- Successful-turn process folding with a separate final answer.
- Source-ordered text reveal and quiet busy-state shimmer.
- Stable status typography and compact disclosure spacing.
- Native content fallbacks and a trusted-plugin block extension slot.
- 42 regression tests; no changes to DSH Agent, SDK, providers or core.
