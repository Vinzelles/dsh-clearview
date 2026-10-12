# 表格与后续正文间距

## 原因与修复

阅读视图的 Markdown 表格由 `.tableScroll` 包裹。原规则没有底部外边距，后续段落上边距又为零，因此实测间距为 0px。

在滚动容器增加 `margin-bottom: .75em`，与段落间距一致。既有最后一个块的外边距归零规则继续生效。字号、表格横向滚动和滚动条占位规则未修改。

## 验证

在工作目录 `D:/Khabarovsk/K.Develop/dsh/staging/dsh-clearview-0200-20261005` 运行：

```powershell
$env:DSH_TEST_URL='http://127.0.0.1:3193'
$env:CLEARVIEW_PERF_OUTPUT='.perf-results/table-spacing/after'
node scripts/verify-reader-performance.mjs --table-spacing --screenshots
node --import ./tests/support/register.mjs --import tsx/esm --test tests/style-contract.test.ts
```

浏览器使用宿主 React 与实际 Markdown 渲染器，内容为合成数据；只读策略保护运行环境。16 组主题、字号、列宽、流式状态组合，共 80 项布局检查通过；19 项现有样式检查通过。

- 修复前，表格后段落、列表及引用正文间距均为 0px；对应 64 项检查失败。
- 修复后，14px 字号间距为 10.5px，16px 字号为 12px。
- 1280px 深浅色及 480px 深色截图已核对。宽表格在窄屏只产生容器内部横向溢出，没有页面溢出。
- 位于正文末尾的表格底部外边距仍为 0px。
- 浏览器异常为零。验证前后会话均为 775 个，ID 摘要相同。

证据保留在 `.perf-results/table-spacing/{before,after}/optimized.json` 和 `after/running-*.png`。测试 Chrome 和临时浏览器配置均已清理。

## 交付状态

本次为本地样式修复，未发布或应用新版本。正式环境仍为已安装的 0.3.7。
