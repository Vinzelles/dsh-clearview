# 表格双重边框修复

## 根因与范围

已安装 0.3.10 的 dsh-claude-style 主题通过 `[class*=tableScroll]` 给表格容器画外框。阅读视图同时给每个单元格画底边，最后一行底边与容器底框叠加。三列表格截图中的双重底线来自两个边框绘制者。

以不可变已安装包为基线，保留 0.3.10 的完整视觉改动和回退可见性修复；没有编辑另一个会话正在修改的开发目录。版本准备为 0.3.11。

容器统一绘制 1px 外框，内层 table 不绘制外边框或阴影，清零内部 margin，并保持 table 布局。最后一行移除底边；只有表头的表格同样由容器提供底框。其他行分隔线、表头底色、表格间距及横向滚动策略保留。字体和字号没有改变。

## 浏览器证据

使用真实宿主 React 和主题，注入合成 Markdown 测试内容，没有发送模型消息或创建会话。覆盖 9 类表格 × 16 种宽度/字号/流式/主题条件，以及深浅色和 480px 截图。

- 修复前：已安装源码的 171 次表格检查均检测到重复末行底边；浏览器异常为 0。三列表格的容器底边与末行单元格底边均为 1px。
- 修复后：171 次检查通过，错误和断言失败为 0。容器底边为 1px，内层 table 外边框和末行单元格底边为 0。末行与容器下沿仅相隔外框本身。
- 继续验证表格与后续段落、列表和引用之间的间距；末尾表格无额外外部留白。窄屏内容在表格内部滚动，外层页面无横向溢出。
- 会话清单 780 → 780，ID 哈希一致。实机宿主验证所创建的 Chrome 进程和 profile 已清理。

此前在宿主未启动时做过离线复现：实际 Markdown 渲染器加已安装主题的表格 CSS，16 种条件中 40 处重复底边。其临时 Chrome profile 清理先遇到 Windows EPERM，随后单独清理被自动审批拒绝，目录已保留；没有以其他工具或命令重试。离线证据不替代上述真实主题验证。

离线临时脚本和 HTML 的非递归清理同样被自动审批拒绝（blocked by policy），保留在 `.perf-results`，没有重试。这些文件不包含用户会话内容，不纳入插件包。

最终 420 / 420 单元测试、TypeScript 构建、运行时外部依赖检查和浏览器语法门禁通过。

## 命令与交付边界

在隔离工作区 `staging/dsh-clearview-039-refinement-20261012` 执行：

```powershell
$env:DSH_TEST_URL='http://127.0.0.1:3193'
$env:CLEARVIEW_PERF_OUTPUT='.perf-results/table-frame-after'
node scripts/verify-reader-performance.mjs --table-spacing --screenshots
$env:DSHX_HARNESS='D:/Khabarovsk/K.Develop/deepseek-harness'
npm run build
node scripts/check-bundle-externals.mjs lib/client.js
node scripts/browser-syntax-gate.mjs lib/client.js
npm test
```

修复前/后的报告和截图位于 `.perf-results/table-frame-before` / `table-frame-after`。该修复仅在本地准备，没有调用 plugins.publish 或 runtime.commit。
