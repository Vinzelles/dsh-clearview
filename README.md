# dsh-clearview

> A modern reading view for DeepSeek Harness: clear prose, consistent process rows, grouped operations and smooth live thinking.

插件为 DSH 提供一个独立的 **「阅读」** 页签，以清晰、统一、流畅为目标：正文、思考与工具过程分层呈现，连续操作合并，展开细节按需阅读。0.3.2 起不再以完整还原其他应用为目标。原版「对话 / 轨迹」、输入框、模型选择、工具与审批系统全部保留。
> 本插件基于 https://github.com/aa2246740/dsh-better-display 改造，以前端工程师的理解进行重新优化。

**只改展示，不改 Agent、SDK、提示词、模型设置或会话记录。**

## 功能亮点

- **清晰的对话层级**：运行中按时间顺序展示说明、思考和操作。完成后以单行「已完成」摘要收起过程，最终回答保留；可随时展开过程，手动选择和正在选读的内容受到保护。正文跟随宿主字号，以颜色和段落间距区分层级，阅读区域背景透明。
- **连续操作合并为一行**：工具调用（`todo_write`、`dispatch` 除外）与 `/命令`、手动压缩记录，满两条合成「运行了 N 条命令，写入了 N 个文件」这类摘要（运行了 / 读取了 / 写入了 / 编辑了 / 搜索了 / 访问了 / 使用了 / 调用了 / 执行了），有失败时行尾红色「· N 次失败」。运行中展开，结束后自动收起，你手动展开过的不收。
- **统一过程行**：思考、工具组、单次工具与记录共用行高、缩进、箭头和正体字重，默认不加框；展开或悬停使用轻底色。统一「展开 / 收起」提示，避免一排排加粗长条。细节块保留输出、参数、搜索结果、红绿 diff 和「在轨迹中查看」。
- **限高思考区**：实时与展开后的思考都在 128px 区域内保留完整原文。连续跟随新文字，滚动、聚焦或选字后暂停；工具到来或进入下一步时保留回看位置，可「结束回看」或「回到最新」。减少动态效果时直接跟到末尾。
- **运行中状态行**：小型活动环、扫光动词和次要计时；等待操作、中断、出错各有对应状态，中断与出错为红色。
- **用户气泡与计划**：用户消息是右侧气泡，超过六行截断，「展开全文 / 收起」放在撤回座位之外；轮次中途的补充输入是较小的气泡；`todo_write` 显示为勾选清单卡片。
- **一致的字体和表面**：正文与过程使用无衬线字体，代码保留等宽字体；用主次色阶与留白组织信息。沿用已适配的深浅色基础和本机可选字体，缺失时回退系统字体，字体文件不随包分发。工具详情、记录与计划共享局部表面样式，阅读背景透明。
- **轮次尾部**：每个已结束的轮次（含出错、中断）末尾给出交付文件卡片（点击在右侧栏打开）、本会话文件改动、复制回答、从这里分支，以及时间 · 用时 · 用量。交付文件来自轮次的 `deliverables` 公开数据，用时取轮次的开始与结束时间，只有时间和用量来自 turn-tail；复制取渲染后的回答文本，不向 DOM 注入统计行。
- **收尾正文的文件名链接**：回答里提到的文件名可点击，在右侧栏打开。
- **阅读位置记忆**：切走再回来时恢复到离开时的位置，按会话记录，只存在内存里，刷新页面后不保留。
- **克制动效**：新文字按源顺序逐词渐显，历史不重新打字，遵守系统减少动态效果；heavy 模式只启用离屏 `content-visibility`，不会降级可见动效。
- **原生内容回退**：保留 Markdown、代码、表格、公式、链接、图片与 DSH 原生工具结果组件；不执行模型生成的 HTML / JavaScript。
- **兼容层内聚**（`src/client/compat/`）：保留滚动锚定、`dsh-rewind` 兼容桥、heavy 离屏布局优化与离屏轮次 `content-visibility`。过程折叠由渲染器实现，最终回答始终保留，不依赖旧的收尾防折叠 DOM 补丁。

没有收到 reasoning 的消息不会被补写或推测思考；插件不翻译、摘要或重新解释原始 Think 文本。

## 安装（dsh-market / dsh plugin）

需要已安装、可正常工作的 DeepSeek Harness 0.2.0-rc.2（插件的 peer 依赖精确钉在该版本：`@deepseek-ai/cordis` 4.0.4、`react` 18.3.1，其余 `@deepseek-ai/dsh-*` 均为 0.2.0-rc.2）。在市场页面找到本插件，或直接执行：

```sh
dsh plugin --profile web add github:Vinzelles/dsh-clearview
```

也可以直接把这句话发给你的 DSH：

> 帮我安装 https://github.com/Vinzelles/dsh-clearview 这个插件

装完刷新或重新打开 Web 页面，在原有页签旁选择「阅读」。在当前 DSH 地址后加 `?reader=1` 可单次进入阅读，不会覆盖之后主动选择的页签；新会话默认进入阅读。

> **字体**：安装了 Claude Desktop（Windows）时，插件可从本机读取无衬线与等宽字体，经只读路由提供，不随包分发。未安装或非 Windows 时回退系统字体，功能不受影响。

> 老的 `dsh-reader` 试用插件应保持禁用：两者占用同一个原生「阅读」视图位置，不要同时启用。

## 从源码构建

Node.js 需要 `^22.19.0 || >=24`。构建复用你明确指定的 Harness（`DSHX_HARNESS`）的现有依赖，不下载另一份宿主，也不改宿主源码。

```sh
# 1. 克隆并链接依赖（先把目标 generation 的宿主包链接进 node_modules，类型和测试读取 0.2.0 的真实契约）
git clone https://github.com/Vinzelles/dsh-clearview.git
cd dsh-clearview
npm run link:generation -- <generation>/packages

# 2. 测试与构建
npm test
npm run typecheck
DSHX_HARNESS=/absolute/path/to/deepseek-harness npm run build

# 3. 检查激活方式（纯客户端改动可刷新页面；首次启用字体路由涉及服务端）
dshx check dsh-clearview --harness "$DSHX_HARNESS"
dshx activation-plan dsh-clearview --change new-client --harness "$DSHX_HARNESS"
dshx activate-new-client dsh-clearview --profile web --port "$DSH_WEB_PORT" --harness "$DSHX_HARNESS"
```

本地维护时，profile（`~/.dsh/profiles/web`）通过 `link:` 指向本仓库，`deepseek-harness/my-plugins/dsh-clearview` 是同一目录的 junction。激活命令接受插件名，不接受绝对源码路径。

### 更新与回退

更新已有客户端时，拉取源码、重新构建，用 `dshx activation-plan --change client` 核对更新方式，再验证实际页面。纯客户端动效更新只需刷新；0.3.0 新增字体服务路由，首次安装需按宿主给出的服务端激活计划处理。使用 dsh-env 管理的环境，应通过候选审核、发布与运行时应用流程更新，不能改写正在运行的 generation。想立即对照原版，直接选择「对话」；记录、模型和输入框一直由 DSH 持有。

## 不支持

- **点赞 / 点踩**：宿主只允许经原生 `assistant-actions` slot 注入，阅读页拿不到该入口。
- **交付文件的「默认应用打开」和「在文件夹中显示」**：阅读页只能在右侧栏打开交付文件。
- **原生「工作细节」模式**：阅读页用自己的对话流，不接入该模式。
- **原生轮次导航栏**：阅读页不提供。
- **新行淡入**：设计规格 6.2 第 6 条（实时到达的行 200ms 淡入加 4px 上移）在 0.2.0 没有实现；新行直接出现，只有文字保留逐词渐显。

## 设计与安全边界

- 基于公开会话投影的呈现层：不读取私有 provider 日志、不改写提示词、不篡改模型设置。
- `dsh-clearview.block` 是供受信任插件使用的 chain slot，公开 owner 类型为 `ReaderBlockOwner`；未知内容有安全兜底和独立错误边界。**这不是完整的 MCP Apps 或 Generative UI 实现**；交互应用仍需单独的协议、沙箱和权限边界。
- 本仓库不包含模型凭据、会话导出、用户截图、本机配置或试用环境。

设计约束见 [DESIGN.md](DESIGN.md)，版本说明见 [CHANGELOG.md](CHANGELOG.md)。

## 测试

`npm test` 当前共 370 项。覆盖：流式顺序与轮次边界、整轮过程折叠与保留回答、异常保留、思考行与实时思考跟随、Unicode/组合 emoji、Markdown/GFM/公式、流式缓冲、阅读保护守卫（选区/焦点暂停与「回到最新」浮现）、`dsh-rewind` 隐藏契约、操作分组与合并、计划更新与失败、字体路由恢复、浏览器只读请求拦截、状态行、用户气泡、轮次尾部数据、turn-trigger 与记录行、视图请求与阅读位置、样式契约、浏览器语法与运行时外部依赖门禁。安装后仍需在真实宿主验证，不能把单元测试通过当作页面已加载。

## 许可与致谢

本项目原创代码使用 [MIT](LICENSE)。原生展示与 Markdown 部分来自 DeepSeek Harness（MIT）；动效参考 Jakub Antalik 的 [Transitions.dev](https://transitions.dev/) 免费 Streaming text、Thinking states 和 Reasoning stream 配方（未打包其演示库或 Pro 内容）。第三方代码保留各自许可，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
