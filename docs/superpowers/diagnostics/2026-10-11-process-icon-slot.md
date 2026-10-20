# 过程行共用图标槽位

用户要求：过程行开头同时显示折叠箭头和操作图标显得冗余，改为类似原版的同槽位切换。

## 实现

对照宿主 `packages/client/ui-primitives/src/DisclosureRow.tsx` 与对应 CSS：收起时显示操作图标，悬停时换成箭头，展开时箭头常驻。

阅读视图的共享 `Line` 使用一个 16px grid 槽位叠放操作图标和箭头，100ms 透明度切换。键盘 `:focus-visible` 也显示箭头；收起箭头向右，展开旋转向下。无展开能力的静态行只显示操作图标，没有占位箭头。

沿用原生 button 的整行点击、`aria-expanded`、`aria-controls` 和键盘激活，不添加额外嵌套按钮。失败色加在共享槽位上，切换后仍保持红色。关闭动效或系统减少动态效果时直接切换。

修改范围是共用该组件的思考、工具组、单次工具、普通记录与触发通知行。整轮完成摘要、独立异常提示和文件卡片保留其各自控件。

## 验证

2026-10-11：

- 共享行、工具行、工具组和样式契约专项测试 37 / 37 通过；完整测试执行记录 399 / 399 通过。
- 构建、bundle externals 和 browser syntax gate 通过。
- 使用正式宿主 React/primitives，在合成记录中验证实际 ToolRow、ThoughtRow、ToolGroupRow、RecordRow 和静态 Line；未发送模型消息或创建会话。
- 使用原生 CDP 鼠标移动、点击及 Tab / Enter / Space 输入。13 个步骤覆盖 hover、整行展开/收起、展开后移出仍显示箭头、键盘焦点、失败色、静态行、关闭动效与系统减少动态效果。
- 两个 glyph 中心重合，只占 16px；各步骤文字 x 坐标保持 290px。鼠标及键盘展开/收起的 `aria-expanded` 和箭头方向对应一致。
- 深浅色 1280px、深色 480px 截图通过，横向溢出 0px，异常与断言失败均为 0。
- 验证前后会话清单 774 → 774，ID 哈希一致；测试 Chrome 与临时 profile 已清理。

命令：

```powershell
$env:DSH_TEST_URL='http://127.0.0.1:3193'
$env:CLEARVIEW_PERF_OUTPUT='.perf-results/process-icons-20261011'
node scripts/verify-reader-performance.mjs --process-icons --screenshots
```

浏览器证据、构建日志和完整测试日志位于 `.perf-results/process-icons-20261011/`。2026-10-11 的结果属于本地实现与合成浏览器验收；当时没有发布或应用该变更，也没有把该次交互验收表述为新的性能对照。

2026-10-12：共用图标已随 ClearView 0.3.8 发布并应用。正式环境验收通过，详见 [0.3.8 发布记录](./2026-10-12-release-038.md)。
