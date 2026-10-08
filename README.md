# dsh-clearview

> A modern reading view for DeepSeek Harness: native process details, live reasoning, smooth transition, and clean final answers.

全面美化DSH对话流，使界面看起来更美观、现代、流畅。插件为会话流提供一个独立的 **「阅读」** 页签：执行时按真实顺序呈现原生步骤、思考和进度；一轮成功结束后收起过程，只留下最终回答。原版「对话 / 轨迹」、输入框、模型选择、工具与审批系统全部保留。
> 本插件基于 https://github.com/aa2246740/dsh-better-display 改造，以前端工程师的理解进行重新优化。

<img width="1727" height="869" alt="comp_clean_text" src="https://github.com/user-attachments/assets/c8378763-17a3-4cc5-ae67-0421bc193519" />
<img width="1818" height="1098" alt="comparison_dark_off_on_clean" src="https://github.com/user-attachments/assets/74a9b25e-02ec-462c-80e1-0b28813484f8" />



**只改展示，不改 Agent、SDK、提示词、模型设置或会话记录。**

## 功能亮点

- **过程面板**：一轮的过程是一行朴素的头部加缩进的内容，没有外框、背景和阴影。头部一眼可见状态、用时、步数、工具数和失败数；凡是没有成功结束的轮次（进行中、出错、中断、等待操作、状态未知），较早的步骤都压成一行，只完整显示最新一步，点开「前 N 步」才展开；连续的工具调用（和 `/命令`、手动压缩记录）满两条就合并成一行「进行了 N 次工具调用」等摘要，右侧显示总用时，进行中有扫光，有失败时默认展开，否则点击展开。成功结束后整块收成一条，回答留在原处。错误、中断、审批和未知终止状态保持展开。
- **统一行语法**：工具、思考、记录都用原生 24px 行语法，状态点和进行中动效直接用宿主原生的 `StateDot` / `TextShimmer`；圆角与字号跟随宿主。技能 / 读取 / Bash、上下文来源、文件路径和原始详情仍然可读，详情放在内凹块里，可「在轨迹中查看」。
- **思考行与实时内凹块**：思考以一行呈现（用时、首句预览、字数），已完成的思考始终只有这一行，点击查看全文。进行中的思考显示实时内凹块；「折叠思考」开启后，进行中的思考也只显示一行。rAF 连续跟随（EMA 速度匹配 + 比例项收敛，稳态零可见滞后），滚动、聚焦或选字暂停，点击「回到最新」恢复。跟随控制器与 0.1.x 相同。
- **轮次尾部**：每个已结束的轮次（含出错、中断）末尾给出交付文件卡片（点击在右侧栏打开）、复制回答、从这里分支，以及时间 · 用时 · 用量。交付文件来自轮次的 `deliverables` 公开数据，用时取轮次的开始与结束时间，只有时间和用量来自 turn-tail；复制取渲染后的回答文本，不再向 DOM 注入统计行。
- **收尾正文的文件名链接**：回答里提到的文件名可点击，在右侧栏打开。
- **0.2.0 新节点**：turn-trigger 开场（24px 行，带「展开原文」；定时任务、子代理、后台任务等触发来源）、问答记录、已提交计划、通用卡片「在对话中查看」；轮次中途的补充消息和命令输入按时间位置显示在面板内（它们的撤回座位只在过程面板展开时存在，面板收起后不显示）；成功的斜杠命令输出显示在回答区，其生命周期行仍在面板里。
- **阅读位置记忆**：切走再回来时恢复到离开时的位置，按会话记录，只存在内存里，刷新页面后不保留。
- **克制动效**：新文字按源顺序逐词渐显，历史不重新打字，遵守系统减少动态效果；heavy 模式只启用离屏 `content-visibility`，不会降级可见动效。
- **原生内容回退**：保留 Markdown、代码、表格、公式、链接、图片与 DSH 原生工具结果组件；不执行模型生成的 HTML / JavaScript。
- **兼容层内聚**（`src/client/compat/`）：保留阅读视图配套的滚动锚定、`dsh-rewind` 兼容桥、收尾总结防折叠、负载守卫 heavy 离屏布局优化与离屏轮次 `content-visibility`，运行时经 `<style id="dsh-clearview-compat">` 注入，挂插件 fiber 生命周期，可重入。0.2.0 起 composer 可读性与轮次统计行两个模块已移除。

没有收到 reasoning 的消息不会被补写或推测思考；插件不翻译、摘要或重新解释原始 Think 文本。

## 安装（dsh-market / dsh plugin）

需要已安装、可正常工作的 DeepSeek Harness 0.2.0-rc.2（插件的 peer 依赖精确钉在该版本：`@deepseek-ai/cordis` 4.0.4、`react` 18.3.1，其余 `@deepseek-ai/dsh-*` 均为 0.2.0-rc.2）。在市场页面找到本插件，或直接执行：

```sh
dsh plugin --profile web add github:Vinzelles/dsh-clearview
```

也可以直接把这句话发给你的 DSH：

> 帮我安装 https://github.com/Vinzelles/dsh-clearview 这个插件

装完刷新或重新打开 Web 页面，在原有页签旁选择「阅读」。在当前 DSH 地址后加 `?reader=1` 可单次进入阅读，不会覆盖之后主动选择的页签；新会话默认进入阅读。

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

# 3. 检查并激活（无需重启宿主，刷新页面即生效）
dshx check dsh-clearview --harness "$DSHX_HARNESS"
dshx activation-plan dsh-clearview --change new-client --harness "$DSHX_HARNESS"
dshx activate-new-client dsh-clearview --profile web --port "$DSH_WEB_PORT" --harness "$DSHX_HARNESS"
```

本地维护时，profile（`~/.dsh/profiles/web`）通过 `link:` 指向本仓库，`deepseek-harness/my-plugins/dsh-clearview` 是同一目录的 junction。激活命令接受插件名，不接受绝对源码路径。

### 更新与回退

更新已有客户端时，拉取源码、重新构建，用 `dshx activation-plan --change client` 核对更新方式，再验证实际页面。不要为客户端动效更新重启宿主。想立即对照原版，直接选择「对话」；记录、模型和输入框一直由 DSH 持有。

## 不支持

- **点赞 / 点踩**：宿主只允许经原生 `assistant-actions` slot 注入，阅读页拿不到该入口。
- **交付文件的「默认应用打开」和「在文件夹中显示」**：阅读页只能在右侧栏打开交付文件。
- **原生「工作细节」模式**：阅读页用自己的过程面板，不接入该模式。
- **原生轮次导航栏**：阅读页不提供。
- **新行淡入**：设计规格 6.2 第 6 条（实时到达的行 200ms 淡入加 4px 上移）在 0.2.0 没有实现；新行直接出现，只有文字保留逐词渐显。

## 设计与安全边界

- 基于公开会话投影的呈现层：不读取私有 provider 日志、不改写提示词、不篡改模型设置。
- `dsh-clearview.block` 是供受信任插件使用的 chain slot，公开 owner 类型为 `ReaderBlockOwner`；未知内容有安全兜底和独立错误边界。**这不是完整的 MCP Apps 或 Generative UI 实现**；交互应用仍需单独的协议、沙箱和权限边界。
- 本仓库不包含模型凭据、会话导出、用户截图、本机配置或试用环境。

设计约束见 [DESIGN.md](DESIGN.md)，版本说明见 [CHANGELOG.md](CHANGELOG.md)。

## 测试

`npm test` 当前共 301 项，全部通过。覆盖：流式顺序与轮次边界、异常保留、思考行与长思考跟随、Unicode/组合 emoji、Markdown/GFM/公式、流式缓冲、阅读保护守卫（选区/焦点暂停与「回到最新」浮现）、`dsh-rewind` 隐藏契约、步骤分组、工具调用合并与面板状态、轮次尾部数据、turn-trigger 与记录行、视图请求与阅读位置、样式契约、浏览器语法与运行时外部依赖门禁。安装后仍需在真实宿主验证，不能把单元测试通过当作页面已加载。

## 许可与致谢

本项目原创代码使用 [MIT](LICENSE)。原生展示与 Markdown 部分来自 DeepSeek Harness（MIT）；动效参考 Jakub Antalik 的 [Transitions.dev](https://transitions.dev/) 免费 Streaming text、Thinking states 和 Reasoning stream 配方（未打包其演示库或 Pro 内容）。第三方代码保留各自许可，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
