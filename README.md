# dsh-clearview

> A modern reading view for DeepSeek Harness: native process details, live reasoning, smooth transition, and clean final answers.

全面美化DSH对话流，使界面看起来更美观、现代、流畅。插件为会话流提供一个独立的 **「阅读」** 页签：执行时按真实顺序呈现原生步骤、思考和进度；一轮成功结束后收起过程，只留下最终回答。原版「对话 / 轨迹」、输入框、模型选择、工具与审批系统全部保留。
> 本插件基于 https://github.com/aa2246740/dsh-better-display 改造，以前端工程师的理解进行重新优化。

<img width="1727" height="869" alt="comp_clean_text" src="https://github.com/user-attachments/assets/c8378763-17a3-4cc5-ae67-0421bc193519" />
<img width="1818" height="1098" alt="comparison_dark_off_on_clean" src="https://github.com/user-attachments/assets/74a9b25e-02ec-462c-80e1-0b28813484f8" />



**只改展示，不改 Agent、SDK、提示词、模型设置或会话记录。**

## 功能亮点

- **原生过程可见**：思考、工具调用和中途说明保持源顺序；Skill / Read / Bash、上下文来源、文件路径和原始详情仍然可读。
- **长思考卡片**：原文放进带边缘淡出的轻卡片，rAF 连续跟随（EMA 速度匹配 + 比例项收敛，稳态零可见滞后）；展开后继续跟随；滚动、聚焦或选字暂停，点击「回到最新」恢复并清除阅读器内选区/焦点。
- **成功才收起**：只有成功结束的整轮才折叠执行过程；错误、中断、审批和未知终止状态不会被当成成功隐藏。
- **克制动效**：忙碌态文字 shimmer，新文字按源顺序逐词渐显；历史不重新打字，遵守系统减少动态效果；`liveFloor` 仅保留正在显现的词包装，历史内容按节点订阅，完成词按帧统一收尾。
- **原生内容回退**：保留 Markdown、代码、表格、公式、链接、图片与 DSH 原生工具结果组件；不执行模型生成的 HTML / JavaScript。
- **兼容层内聚**（`src/client/compat/`）：原 `dsh-custom-patcher` 的 13 个阅读视图配套补丁已全部并入——composer 可读性、轮次统计行、`dsh-rewind` 兼容桥、收尾总结防折叠、负载守卫 heavy 离屏布局优化（保留 blur/shimmer）、离屏轮次 `content-visibility` 等，运行时经 `<style id="dsh-clearview-compat">` 注入，挂插件 fiber 生命周期，可重入。

没有收到 reasoning 的消息不会被补写或推测思考；插件不翻译、摘要或重新解释原始 Think 文本。

## 安装（dsh-market / dsh plugin）

需要已安装、可正常工作的 DeepSeek Harness。在市场页面找到本插件，或直接执行：

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
# 1. 克隆并安装依赖
git clone https://github.com/Vinzelles/dsh-clearview.git
cd dsh-clearview
node scripts/link-harness-dependencies.mjs "$DSHX_HARNESS"

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

## 设计与安全边界

- 基于公开会话投影的呈现层：不读取私有 provider 日志、不改写提示词、不篡改模型设置。
- `dsh-clearview.block` 是供受信任插件使用的 chain slot，公开 owner 类型为 `ReaderBlockOwner`；未知内容有安全兜底和独立错误边界。**这不是完整的 MCP Apps 或 Generative UI 实现**；交互应用仍需单独的协议、沙箱和权限边界。
- 本仓库不包含模型凭据、会话导出、用户截图、本机配置或试用环境。

设计约束见 [DESIGN.md](DESIGN.md)，版本说明见 [CHANGELOG.md](CHANGELOG.md)。

## 测试

单元测试覆盖：流式顺序与轮次边界、异常保留、长思考两行跟随、Unicode/组合 emoji、Markdown/GFM/公式、流式缓冲、阅读保护守卫（选区/焦点暂停与「回到最新」浮现）、`dsh-rewind` 隐藏契约、执行集群聚合与运行状态条派生、执行失败并入报错卡片（合并判定与退出码恢复）。安装后仍需在真实宿主验证，不能把单元测试通过当作页面已加载。

## 许可与致谢

本项目原创代码使用 [MIT](LICENSE)。原生展示与 Markdown 部分来自 DeepSeek Harness（MIT）；动效参考 Jakub Antalik 的 [Transitions.dev](https://transitions.dev/) 免费 Streaming text、Thinking states 和 Reasoning stream 配方（未打包其演示库或 Pro 内容）。第三方代码保留各自许可，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
