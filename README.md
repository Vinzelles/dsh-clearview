# dsh-clearview

> A Claude Code Desktop style reading view for DeepSeek Harness: one chronological transcript, grouped operations, live thinking, and Claude colors and fonts.

全面美化DSH对话流，使界面看起来更美观、现代、流畅。插件为会话流提供一个独立的 **「阅读」** 页签：按真实顺序把一轮呈现为 Claude Code Desktop 式的对话流：说明、合并后的操作行、思考和最终回答连续排列，运行中底部有状态行与实时思考。原版「对话 / 轨迹」、输入框、模型选择、工具与审批系统全部保留。
> 本插件基于 https://github.com/aa2246740/dsh-better-display 改造，以前端工程师的理解进行重新优化。

**只改展示，不改 Agent、SDK、提示词、模型设置或会话记录。**

## 功能亮点

- **Claude Code Desktop 式对话流**：一轮是一条按时间顺序的单列，没有过程面板、头部计数和「前 N 步」；轮次结束后不收起正文，中途说明与最终回答共用同一套衬线正文。
- **连续操作合并为一行**：工具调用（`todo_write`、`dispatch` 除外）与 `/命令`、手动压缩记录，满两条合成「运行了 N 条命令，写入了 N 个文件」这类摘要（运行了 / 读取了 / 写入了 / 编辑了 / 搜索了 / 访问了 / 使用了 / 调用了 / 执行了），有失败时行尾红色「· N 次失败」。运行中展开，结束后自动收起，你手动展开过的不收。
- **单行语法**：图标 + 中文动词 + 目标，编辑显示 +a −d，不显示用时；失败只在行内标红，不自动展开。点开是细节块（命令输出、参数、搜索结果、红绿 diff），可「在轨迹中查看」。
- **思考**：已完成的思考是一行「思考了 N 秒」，点开看灰色衬线斜体全文。运行中的思考在状态行下方实时流式显示，rAF 连续跟随（EMA 速度匹配 + 比例项收敛），滚动、聚焦或选字暂停，点击「回到最新」恢复；减少动态效果时直接跳到末尾。跟随控制器与 0.1.x 相同。
- **运行中状态行**：轮次末尾是橙色 ✻、扫光动词和「计时 · 已思考」；等待操作、中断、出错各有对应状态，中断与出错为红色。
- **用户气泡与计划**：用户消息是右侧气泡，超过六行截断，「展开全文 / 收起」放在撤回座位之外；轮次中途的补充输入是较小的气泡；`todo_write` 显示为勾选清单卡片。
- **Claude 配色与字体**：配色取自 Claude Desktop，随宿主深浅色切换，宿主别名在阅读页内重映射，嵌入的宿主组件跟随同一套颜色；字体（正文衬线、界面无衬线、代码等宽）读取本机 Claude Desktop，缺失时回退 Georgia / 系统字体，字体文件不随包分发。
- **轮次尾部**：每个已结束的轮次（含出错、中断）末尾给出交付文件卡片（点击在右侧栏打开）、本会话文件改动、复制回答、从这里分支，以及时间 · 用时 · 用量。交付文件来自轮次的 `deliverables` 公开数据，用时取轮次的开始与结束时间，只有时间和用量来自 turn-tail；复制取渲染后的回答文本，不向 DOM 注入统计行。
- **收尾正文的文件名链接**：回答里提到的文件名可点击，在右侧栏打开。
- **阅读位置记忆**：切走再回来时恢复到离开时的位置，按会话记录，只存在内存里，刷新页面后不保留。
- **克制动效**：新文字按源顺序逐词渐显，历史不重新打字，遵守系统减少动态效果；heavy 模式只启用离屏 `content-visibility`，不会降级可见动效。
- **原生内容回退**：保留 Markdown、代码、表格、公式、链接、图片与 DSH 原生工具结果组件；不执行模型生成的 HTML / JavaScript。
- **兼容层内聚**（`src/client/compat/`）：保留阅读视图配套的滚动锚定、`dsh-rewind` 兼容桥、负载守卫 heavy 离屏布局优化与离屏轮次 `content-visibility`，运行时经 `<style id="dsh-clearview-compat">` 注入，挂插件 fiber 生命周期，可重入。0.3.0 起收尾总结防折叠模块已移除（不再有折叠）。

没有收到 reasoning 的消息不会被补写或推测思考；插件不翻译、摘要或重新解释原始 Think 文本。

## 安装（dsh-market / dsh plugin）

需要已安装、可正常工作的 DeepSeek Harness 0.2.0-rc.2（插件的 peer 依赖精确钉在该版本：`@deepseek-ai/cordis` 4.0.4、`react` 18.3.1，其余 `@deepseek-ai/dsh-*` 均为 0.2.0-rc.2）。在市场页面找到本插件，或直接执行：

```sh
dsh plugin --profile web add github:Vinzelles/dsh-clearview
```

也可以直接把这句话发给你的 DSH：

> 帮我安装 https://github.com/Vinzelles/dsh-clearview 这个插件

装完刷新或重新打开 Web 页面，在原有页签旁选择「阅读」。在当前 DSH 地址后加 `?reader=1` 可单次进入阅读，不会覆盖之后主动选择的页签；新会话默认进入阅读。

> **字体**：想要 Claude 的字体，需要本机安装 Claude Desktop（Windows）；插件从它的安装目录读取字体并经只读路由提供，不随包分发。未安装或非 Windows 时自动回退到 Georgia / 系统字体，功能不受影响。

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

`npm test` 当前共 364 项，全部通过。覆盖：流式顺序与轮次边界、异常保留、思考行与实时思考跟随、Unicode/组合 emoji、Markdown/GFM/公式、流式缓冲、阅读保护守卫（选区/焦点暂停与「回到最新」浮现）、`dsh-rewind` 隐藏契约、操作分组与合并、计划更新与失败、字体路由恢复、浏览器只读请求拦截、状态行、用户气泡、轮次尾部数据、turn-trigger 与记录行、视图请求与阅读位置、样式契约、浏览器语法与运行时外部依赖门禁。安装后仍需在真实宿主验证，不能把单元测试通过当作页面已加载。

## 许可与致谢

本项目原创代码使用 [MIT](LICENSE)。原生展示与 Markdown 部分来自 DeepSeek Harness（MIT）；动效参考 Jakub Antalik 的 [Transitions.dev](https://transitions.dev/) 免费 Streaming text、Thinking states 和 Reasoning stream 配方（未打包其演示库或 Pro 内容）。第三方代码保留各自许可，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
