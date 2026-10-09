# dsh-clearview 0.3.0: Claude Code Desktop 对话流

日期：2026-10-09
状态：规格与实施计划已获用户确认，实施后验收中
原型：`proto/clearview-030-cc-flow` 分支（80d89f9）中的 `prototype/cc-flow.prototype.html` 和 `prototype/shot-*.png`，只作参考，不进 main。

## 1. 背景与证据

0.2.1 安装后，用户反馈阅读页「可读性还是很差，甚至还不如官方原版的对话流」。同会话、同时刻对比（2026-10-09，三个已完成会话 + 一个 7 分钟运行中会话，各 42 帧）的结论：

- 已完成轮次：官方 0.2.0 已经做到「过程收起、回答留下」和轮次尾部操作，0.2.x 的原始卖点基本被宿主吸收。
- 过程区：官方是「说明段落正文 + 一行灰色动词摘要」交替；0.2.1 把说明压成 13px 三级灰，每行堆英文思考预览、字数、毫秒、英文工具描述，失败自动展开红色输出块。
- 运行中：0.2.1 把较早步骤连同说明折成「前 N 步」，运行时看不到故事；长指令占 40% 屏幕；头部 5 个数字和浮动「正在处理」条重复且遮挡。0.2.1 唯一优势是实时思考流式全文与平滑跟随，官方只有一行截断的「思考 · …」。

用户确认的用途：**看正在跑的一轮** 和 **整体观感更好**；方向：**全面模仿 Claude Code Desktop 的对话流，配色与字体也与 Claude 一致**。

## 2. 目标与验收

目标：「阅读」页签按 Claude Code Desktop（Code 页签）对话流的结构、配色、字体和动效重做。

成功标准：

1. 运行中：任何时刻一屏内能看出已经做了什么（说明段落始终在场）、正在做什么（底部状态行）、在想什么（实时思考）、有没有失败（红色标记），不需要点开任何东西。
2. 已完成：从上到下读说明段落即可读懂过程，最终回答紧随其后；工具细节默认收起，点开可查。
3. 外观：深浅色、字体、行距、灰阶与原型截图一致（原型即验收参照）。
4. 不比官方「对话」页签更乱：同一会话并排截图对比时，阅读页每屏的可读文字不少于官方，且没有额外数字堆叠。
5. 宿主与数据：只改展示；不发消息、不改会话、不改设置；兼容层与回退行为保持。

非目标：

- 不翻译、不摘要、不改写模型输出（英文说明照原样显示）。
- 不改官方「对话 / 轨迹」页签，不改输入框、审批、模型选择。
- 不随插件分发 Anthropic 字体文件。

## 3. 设计

### 3.1 版面

- 无「过程面板」：一轮是一条按时间顺序的单列，没有容器、外框、头部和「前 N 步」。
- 列宽沿用宿主阅读列（约 742px），底部 24px 留白保留。
- 一轮结束后不收起正文（取消 0.2.x「成功后收成一条、只留回答」）。工具组默认收起，见 3.2。

### 3.2 行语法

| 节点 | 呈现 |
|---|---|
| 用户消息 | 右侧气泡，`bg-300`，圆角 12px，sans 15px/1.6；超过 6 行截断，「展开全文」切换 |
| 轮次中途补充消息 / 命令输入 | 同样的右侧气泡（较小），按时间位置出现在流里；撤回座位常驻（不再依赖面板展开） |
| 说明文字（中途旁白）与最终回答 | 同一正文样式：serif 16px/1.6，`text-100`，Markdown 正常渲染 |
| 工具组 | 连续 ≥2 个操作项（工具调用、`command`、`manual-compaction` 记录）合成一行：`›` + 图标 + 动词摘要，例「运行了 2 条命令，写入了 4 个文件」；有失败时行尾红色「· N 次失败」。默认收起；正在运行的组展开，结束后自动收起（用户手动展开过的不收） |
| 单个操作项 / 组内成员 | 一行：图标 + 中文动词 + 目标，例「编辑 src/textures.js +2 −1」「运行 `npm run build`」「读取任务输出 pwsh-3 已完成」；点开显示细节块 |
| 细节块 | 圆角 10px、`bg-200`、细边框、mono 12.5px：命令输出、参数、搜索结果；编辑类显示红绿 diff（文件名 + `+a −d` 头）；错误输出红色字 |
| 思考 | 一行「思考了 41 秒」，点开为灰色 serif 斜体全文（左侧细竖线）；不显示字数、不显示首句预览 |
| 子代理 | 一行「子代理 · <描述>」，点开嵌套其工具行；失败红色 |
| 计划 / 待办 | 若宿主计划工具负载带条目：勾选清单卡片，原地更新（完成项划线变灰、当前项加粗）；否则按普通操作行 |
| 失败 | 只在行内标红（图标红 + 「失败」），不自动展开 |
| 通知 / 重试 / 压缩等记录 | 灰色单行，沿用现有记录语义，套用本行语法 |
| 触发来源（定时 / 子代理 / 后台任务等） | 轮次开头一行灰色说明，保留「展开原文」 |

工具组摘要用词（按类计数，「，」连接，顺序按首次出现）：运行了 N 条命令 / 读取了 N 个文件 / 写入了 N 个文件 / 编辑了 N 个文件 / 搜索了 N 次 / 使用了 N 个技能 / 读取了任务输出 / 调用了 N 次工具（其余）/ 执行了 N 个操作（记录项）。

### 3.3 运行中

- 轮次末尾一行状态：橙色 ✻（`accent-brand`，缓慢旋转）+ 扫光动词 + 灰色计时，例「✻ 思考中… 13 分 42 秒 · 已思考 1 分 42 秒」「✻ 正在编辑 buildings.js… 16 分 24 秒」「✻ 等待你的操作」。
- 正在生成的思考：状态行下方流式显示灰色 serif 斜体全文，最多约 6 行可见、顶部渐隐，沿用现有跟随控制器（EMA 平滑跟随、滚动 / 聚焦 / 选字暂停、「回到最新」恢复）。思考结束后收成「思考了 N 秒」一行。
- 取消：过程面板头部状态与计数、浮动状态条（`FloatingStatus`）、「折叠思考」开关。「回到最新」按钮保留，改为 Claude 样式的圆形下箭头。
- 出错 / 中断：状态行变为红色「已中断」/「出错」+ 原因一行。

### 3.4 已完成

- 不收起；最后的说明段落与最终回答连续呈现。
- 轮次尾部：交付文件 chip（点击在右侧栏打开）、本会话文件改动 chip、复制 / 分支图标、时间 · 用时 · 用量（灰色 12.5px）。

### 3.5 配色

取自本机 Claude Desktop（2.26454.2）`[data-theme=claude][data-mode=dark|light]`，以 HSL 三元组写入插件 CSS 变量（`--cc-*`），随宿主深浅色切换（宿主 `body[data-ds-dark-theme]`）：

- 深色：bg-000 `60 2.1% 18.4%`、bg-100 `60 2.7% 14.5%`（页面）、bg-200 `30 3.3% 11.8%`、bg-300 `60 2.6% 7.6%`（用户气泡）、text-100 `48 33.3% 97.1%`、text-300 `50 9% 73.7%`、text-500 `48 4.8% 59.2%`、border-300 `51 16.5% 84.5%`（以 15% 透明度用）、danger-000 `0 98.4% 75.1%`、success-000 `97 59.1% 46.1%`。
- 浅色：bg-000 `0 0% 100%`、bg-100 `48 33.3% 97.1%`、bg-200 `53 28.6% 94.5%`、bg-300 `48 25% 92.2%`、text-100 `60 2.6% 7.6%`、text-300 `60 2.5% 23.3%`、text-500 `51 3.1% 43.7%`、border-300 `30 3.3% 11.8%`、danger-100 `0 56.2% 45.4%`、success-100 `103 72.3% 26.9%`。
- 品牌橙 accent-brand `15 63.1% 59.6%`，只用于运行中的 ✻。
- 阅读页根元素铺 `bg-100` 背景，覆盖宿主阅读区背景；侧栏、顶栏、输入框属于宿主，不改。

这推翻 0.2.x 的「只用宿主 token」约束：阅读页内一律用 `--cc-*`，不再引用 `--dsw-*` 颜色。

### 3.6 字体

与 Claude 相同的分工与回退：

- 正文（说明、回答、思考）：`anthropic-serif, Georgia, "Times New Roman", "PingFang SC", "Microsoft YaHei", serif`（中文落到雅黑，同 Claude）。
- 界面（气泡、灰色行、状态行、尾部）：`anthropic-sans, ui-sans-serif, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif`。
- 代码：`anthropic-mono, ui-monospace, "Cascadia Mono", Consolas, monospace`。

字体来源（不随包分发）：插件服务端通过宿主 `webServer.register` 注册只读前缀路由 `/dsh-clearview/fonts/`，只响应三个固定名字（`sans.woff2`、`serif.woff2`、`mono.woff2`）。服务端在 `%LOCALAPPDATA%\AnthropicClaude\app-*\resources\ion-dist\assets\v1\` 中选版本号最大的目录，解析其中 CSS 的 `@font-face`（`anthropic-sans` / `anthropic-serif` / `anthropic-mono` 的 normal 字重）得到实际文件名，再读文件回应（`font/woff2`，长缓存）。找不到时返回 404，客户端自然落到回退栈。客户端在注入样式中声明 `@font-face` 指向该路由。非 Windows 或未装 Claude Desktop 时同样回退。

### 3.7 动效

- 新文字逐词渐显（现有 reveal ledger），历史不重放。
- 状态行动词扫光、✻ 旋转；工具组 / 细节 / 思考展开收起用高度过渡。
- 全部遵守系统「减少动态效果」；heavy 模式仍只启用离屏 `content-visibility`。

## 4. 数据与组件

### 4.1 纯派生：`transcript-model.ts`（新）

输入一轮的节点序列（现有 store/projection 产物），输出扁平条目序列：

`Narration | ToolGroup | ToolItem | Thought | SubAgent | Plan | Record | Notice | MidTurnInput | Trigger`

- 分组只合并时间上相邻的操作项；思考、说明、中途输入、通知、子代理打断分组。
- 组内只有 1 项时输出 `ToolItem`。
- 组键：`group:<首成员 key>`，展开状态按键记忆，跨重渲稳定。
- 组状态：`running`（任一成员 preparing/running）、`failedCount`、按类计数（供摘要）。
- 计划条目：从计划工具的参数 / 结果中解析清单；解析失败时退化为 `ToolItem`。

替换 `process-steps.ts` 中的 `groupSteps`、`groupOperations`、`mergeThoughts`、`formatOperationClusterSummary`（摘要词改为 3.2 的新词表）。

### 4.2 组件

- 新：`TranscriptTurn`（替代 `ProcessPanel` + `TurnSection` 的过程部分）、`ToolGroupRow`（替代 `ClusterRow`）、`StatusLine`（替代 `FloatingStatus` 与面板头部状态）、`LiveThought`（由 `ReasoningRow` 的实时部分改出，复用 `reasoning-follow.ts`）、`UserBubble`（含 6 行截断）、`PlanCard`、`cc-theme.css`（`--cc-*` 变量与字体栈）。
- 改：`ToolRow`、`ToolDetails`、`RecordRows`、`Opening`、`TurnFooter`、`FileChanges`、`MarkdownText` 换成新行语法与 `--cc-*`；`tool-call-model.ts` 的行标题改为动词（运行 / 读取 / 写入 / 编辑 / 搜索 …），工具名与参数仍按数据原样显示。
- 删：`ProcessPanel`、`ClusterRow`、`FloatingStatus`、「折叠思考」开关及其偏好读取、`groupSteps` 的「前 N 步」、`mergeThoughts`、`rememberOpened`、旁白专用样式；兼容层 `memory-tail-keep.ts`（防收尾总结被折叠，已无折叠）。
- 服务端 `dsh-clearview.ts`：可选注入 `webServer`，注册字体路由；无 `webServer` 时跳过（Electron/测试环境）。仍不触碰提供者、工具、会话或权限。

### 4.3 兼容 DOM 契约

保留：`data-dsh-clearview`（版本）、`section[data-reader-turn]`、`data-reader-turn-state`、`data-reader-turn-result`、`data-reader-key`、`data-reader-text[data-shown-length]`、`data-reader-anchor`、`data-reader-answer`、`data-dshcp-rewind-root` / `data-dshcp-rewind-seat`、`data-dshcp-heavy`、`data-dshcp-load`。

新增（供验证脚本）：`data-reader-group`（`data-group-state` running/settled、`data-expanded`）、`data-reader-status-line`、`data-reader-live-thought`、`data-reader-user-bubble`（`data-clamped`）。

删除：`data-reader-panel`、`data-reader-process`、`data-reader-earlier`、`data-reader-cluster`、`data-reader-narration`、`data-reader-activity-pill`、面板头部的 `data-reader-disclosure`（`perf-guard` 不依赖它；`memory-tail-keep` 随之删除）。

## 5. 边界情况

- 很长的轮次（数百个操作项）：分组后行数可控；离屏轮次 `content-visibility` 保留；派生做记忆化，流式更新只重算末尾段。
- 运行中的组在用户展开后结束：保持展开（用户意图优先）。
- 没有任何说明文字的轮次：只有工具组与回答，仍按时间顺序。
- 没收到 reasoning 的消息：不显示思考行，不补写。
- 等待审批：状态行「等待你的操作」，审批 UI 仍在宿主输入区。
- 窄宽度（≤480px）：气泡最大宽 90%，行内目标文字省略号截断，不横向滚动。
- 字体路由 404 / 加载慢：`font-display: swap`，回退栈不跳行高（serif 回退用 Georgia，行高固定 1.6）。
- 浅色主题：全部颜色走 `--cc-*` 浅色值，含 diff 与错误块。

## 6. 测试与验收

- 单元：`transcript-model`（分组、打断、单项、键稳定、计数、失败、运行中、计划解析与退化、摘要词）；字体路由（版本目录选择、CSS 解析、白名单、404）；`UserBubble` 截断；样式契约（阅读页内无 `--dsw-*` 颜色引用、无 backdrop-filter、字体栈、横向溢出递归扫描）。
- 构建门禁：`npm test`、`npm run typecheck`、`DSHX_HARNESS=… npm run build`、`check-bundle-externals`、`browser-syntax-gate`。
- 实机（只读，沿用 `verify-live-reader.mjs` 的安全约束，更新选择器）：三个已完成会话 + 一个运行中会话，深浅色、窄宽度；截图与原型对照；0 个 reader 异常、0 个 blockErrors、无 session/create。
- 运行中对照：用户发起一轮任务后，用双浏览器录制脚本（对话 / 阅读同步截图）对照第 2 节成功标准 1、4。
- 性能：与 0.2.1 同口径对比长会话首屏与流式更新耗时，不回退。

## 7. 版本与文档

- 版本 0.3.0（package.json、version.ts）。
- CHANGELOG 0.3.0；README / DESIGN 改写为新对话流说明，删除过程面板、折叠思考、前 N 步、浮动状态条的描述；注明字体来自本机 Claude Desktop、不随包分发。
- 原型与截图放在临时分支 `proto/clearview-030-cc-flow`，不进 main。

## 8. 实施中需核实

- 宿主计划 / 待办工具的负载形状（决定 `PlanCard` 能否解析条目）。
- 宿主深浅色切换属性在 0.2.0 是否仍为 `body[data-ds-dark-theme]`。
- `webServer` 在 DSH 桌面（Tauri）模式下是否同样存在（页面由 3193 提供，预期存在）。
