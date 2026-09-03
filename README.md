# dsh-clearview

让 DeepSeek Harness 的长任务更好读。

执行时看得到原生步骤、思考和进度；完成后把过程收起来，留下最终回答。独立的 **「阅读」** 页签，保留原版「对话 / 轨迹」、输入框、模型选择、工具和审批。

**v0.1.1 · 本地维护版（基于 v0.1.0）。只改展示，不改 Agent、SDK、提示词、模型设置或会话记录。**

## 本地维护改动（0.1.1，2026-08-31）

本副本从 `deepseek-harness/my-plugins/` 迁移到 `dsh/dsh-clearview` 独立维护（上游以
`.bak-20260831` 留档）。相对上游新增两块内容：

1. **逐词 span 性能修复**（`src/client/word-motion.tsx`）：`<span data-reader-word>`
   渐显结束后由组件自行渲染为纯文本、React 干净卸载该 span，稳态只保留 ~350ms
   动画前沿。修复长会话（数万词）滚动掉帧（实测 maxDelta 117-400ms → 17ms、
   longtask 清零）。
2. **阅读视图兼容层**（`src/client/compat/`）：原以 `dsh-custom-patcher` 客户端补丁
   形式存在的 13 个配套修复已全部内聚——composer 布局/毛玻璃标记、memory 收尾
   展开、思考跟随追赶与渐隐修正、轮次统计行补回、rewind 兼容桥、工具失败去重、
   短思考样式、离屏轮次 content-visibility、负载守卫 heavy 降级。样式注入
   `<style id="dsh-clearview-compat">`；JS 模块由客户端 `apply` 经
   `startCompat(ctx)` 启动，可重入（宿主 boot handoff 二次 apply 先销毁上一实例）。

本机构建（不重启宿主，刷新页面即生效）：

```sh
cd /d/Khabarovsk/K.Develop/dsh/dsh-clearview
DSHX_HARNESS=/d/Khabarovsk/K.Develop/deepseek-harness npm run build
```

profile（`~/.dsh/profiles/web`）经 `link:` 与 junction 指向本目录；
`deepseek-harness/my-plugins/dsh-clearview` 已改为指向本目录的 junction，
任何仍按旧路径访问的工具/服务器都能解析。

## 使用体验

- **执行中**：思考、工具和中途说明保持真实顺序。Skill / Read / Bash、上下文来源、文件路径和原始详情仍然可读。
- **长思考**：原文放进有边缘淡出的轻卡片，每次平滑跟随两行。展开后继续跟随；滚动、聚焦或选字暂停，点击「跟随最新」恢复。
- **完成后**：成功结束整轮才收起过程，保留最终回答。随时展开查看完整记录。错误、中断、审批和未知终止状态不会被当成成功隐藏。
- **克制动效**：忙碌状态文字 shimmer，新文字按源顺序渐显。历史不重新打字；遵守系统减少动态效果，选区和手动阅读优先。
- **原生内容**：保留 Markdown、代码、表格、公式、链接、图片，以及 DSH 的工具结果组件。不执行模型生成的 HTML / JavaScript。

没有收到 reasoning 的消息不会补写或推测思考。插件不翻译、摘要或重新解释原始 Think 文本。

## 安装

需要已安装、可正常工作的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 和 [DSHX External](https://github.com/aa2246740/dsh-external-plugin-devkit)。本版本针对 DSH `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e` 的公开会话 API 验证；升级宿主后请重新检查兼容性。

Node.js 需要 `^22.19.0 || >=24`。以下构建复用你明确指定的 Harness 的现有依赖，不下载另一份宿主，也不改宿主源码。

```sh
# 替换为你的实际目录和正在运行的 Web 端口。
export DSHX_HARNESS=/absolute/path/to/deepseek-harness
export DSH_HOME=/absolute/path/to/your/dsh-home
export DSH_WEB_PORT=3080

git clone https://github.com/Vinzelles/dsh-clearview.git "$DSHX_HARNESS/my-plugins/dsh-clearview"
cd "$DSHX_HARNESS/my-plugins/dsh-clearview"

node scripts/link-harness-dependencies.mjs "$DSHX_HARNESS"
npm test
npm run build

dshx check dsh-clearview --harness "$DSHX_HARNESS"
dshx activation-plan dsh-clearview --change new-client --harness "$DSHX_HARNESS"
dshx activate-new-client dsh-clearview --profile web --port "$DSH_WEB_PORT" --harness "$DSHX_HARNESS"
```

检查与激活命令必须全部成功。首次安装不需要重启 DSH；**刷新或重新打开 Web 页面**后选择「阅读」。在当前 DSH 地址后加 `?reader=1` 可进入阅读一次，不会覆盖之后主动选择的页签。新会话默认进入阅读。

`DSH_HOME` 选择用户配置，`--harness` 选择代码目录，两者不能互相替代。激活失败时先处理命令报告的原因，不要手工补写 profile 和 patch。

激活命令接受插件名，不接受绝对源码路径。因此把仓库放在 `my-plugins/dsh-clearview`；这是 DSHX 的外部插件目录，不是 DSH 核心源码目录。

正式使用请保持插件目录存在：profile 通过链接读取它。老的 `dsh-reader` 试用插件应保持禁用；两者不要同时启用，因为它们使用同一个原生「阅读」视图位置。

### 更新与回退

更新已有客户端时，拉取源码、重新构建并通过 `dshx check`，用 `activation-plan --change client` 核对更新方式，再验证实际页面。不要为客户端动效更新重启宿主。

想立即对照原版，直接选择「对话」；记录、模型和输入框一直由 DSH 持有。完整停用或移除请走 DSH / DSHX 的插件管理流程，不要删除仍被 profile 链接的源码目录。

## 开发与边界

```sh
npm test
npm run typecheck
DSHX_HARNESS=/absolute/path/to/deepseek-harness npm run build
```

42 项单元测试覆盖顺序、轮次结束、异常保留、两行跟随、Unicode、Markdown 和流式缓冲。安装后仍需检查真实宿主行为，不能把单元测试通过当作页面已加载。

`dsh-clearview.block` 是供受信任插件使用的 chain slot，公开 owner 类型为 `ReaderBlockOwner`。未知内容有安全兜底和独立错误边界。**这不是完整的 MCP Apps 或 Generative UI 实现**；交互应用仍需要单独的协议、沙箱和权限边界。

设计约束见 [DESIGN.md](DESIGN.md)，版本说明见 [CHANGELOG.md](CHANGELOG.md)。本仓库不包含模型凭据、会话导出、用户截图、本机配置或试用环境。

## 致谢与许可

原生展示与 Markdown 部分来自 DeepSeek Harness（MIT）。动效参考 Jakub Antalik 的 [Transitions.dev](https://transitions.dev/) 免费 Streaming text、Thinking states 和 Reasoning stream，用于本插件内的实际会话内容；没有打包其演示库或 Pro 内容。

本项目原创代码使用 [MIT](LICENSE)。第三方代码保留各自许可，尤其 Transitions.dev 配方适用其产品使用条款，不能把整个动效库重新包装分发。详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
