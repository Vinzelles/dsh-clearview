# 问答回看组件

用户要求：问答界面已经结束后，回看时直接读到当时的问题与用户答案。此次只改变 `ask_user_question` 历史工具记录的展示。

## 数据与展示

- 对照宿主 `dsh-user-questions/lib/types/types.d.ts` 以及 `packages/interaction/tool-ask-user/src/index.ts`：问题来自工具输入 `questions`，结果是文本块内的 JSON `answers`，通过 `id` 对应；`selected` 与 `custom` 可同时存在。
- 默认展示问题全文与用户答案；不使用选项提交控件。多选逐项展示，自由文本保留换行和原始文字。
- 不与普通工具合并。整轮过程折叠后，问答记录与最终回答一同保留可见。
- 问题背景和选项按需展开；原始记录沿用工具输入、结果、原始数据三个页签，初始显示原始数据。保留调用 ID 对应的轨迹入口。
- 缺失答案 ID 不按数组位置猜测。重复 ID、无效输入/结果、失败和中断明确显示异常或缺失状态。
- 使用现有字体、字号、主次色阶、边框、圆角与局部表面变量。问题与答案使用紧凑标签列，340px 以下改为标签纵向排列。

## 本地验证

2026-10-11：

- `npm run build` 通过（含 TypeScript 检查）。
- bundle externals 与 browser syntax gate 通过。
- `npm test`：396 / 396，通过。
- 新增 10 项问答专项测试：ID 配对、逆序结果、多选/自定义文字、空答案、缺失/重复 ID、畸形数据、失败/中断、HTML 转义、工具分组边界、完整轮次折叠后可见。
- `verify-reader-performance.mjs --question-record --screenshots` 使用正式宿主的 React 与 primitives，在独立浏览器中渲染合成历史会话。未发送消息、回答问题或创建会话。会话清单 771 → 771，ID 哈希一致；异常与断言失败均为 0，测试 Chrome/profile 已清理。
- 实际点击原始记录展开/收起、问题选项展开/收起与轨迹入口。等待回答→已回答更新保留已打开的原始记录与焦点；关闭动效后仍可读。
- 1280px 深色/浅色及 480px 深色截图与 computedStyle 检查通过：答案与问题色阶不同，正文 14px，横向溢出 0px，整轮折叠时问答仍可见。

运行：

```powershell
$env:DSH_TEST_URL='http://127.0.0.1:3193'
$env:CLEARVIEW_PERF_OUTPUT='.perf-results/question-record-20261011'
node scripts/verify-reader-performance.mjs --question-record --screenshots
```

证据位于 `.perf-results/question-record-20261011/optimized.json`、`unit-tests.log` 和三张截图。这是本地代码及合成浏览器验证；未发布该改动，未声称已在桌面实际历史记录中完成验收，也未进行新的性能计时对照。

## 紧凑布局调整

用户反馈组件过大后，合并标题、状态和原始记录/轨迹入口到顶部一行，移除独立底栏。问题分组标题嵌入问题原文前，不再另占一行；多选答案自动并排换行，补充文字紧接答案。原问题背景与选项移入原始记录的展开区域，默认只保留问答。

保持正文 14px 与全部原文，以减小间距和辅助信息占用压缩组件。使用同一合成记录进行前后测量：1280px 深浅色均从 463.22px 降至 195.75px（减少 57.7%），480px 深色从 577.72px 降至 216.75px（减少 62.5%）。这些数字只对应该两问题、多选和补充文字示例，不代表所有历史记录的固定高度。

再次构建、bundle externals、browser syntax gate 和 396 项测试通过。实际浏览器中原始记录、问题选项与轨迹入口检查通过，等待→已回答保留焦点与展开状态；深浅色与窄屏无横向溢出、异常和断言失败均为 0。本次浏览器检查会话清单 772 → 772、ID 哈希一致，测试进程及 profile 已清理。

前后证据分别位于 `.perf-results/question-record-compact-before-20261011/optimized.json` 与 `.perf-results/question-record-compact-20261011/optimized.json`（含截图、构建和测试日志）。此调整仍未发布。
