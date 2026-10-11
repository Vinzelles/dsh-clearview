# 轮次摘要文字垂直对齐

## 原因与修复

`TurnDisclosure.module.css` 的按钮已经使用 `align-items: center`，但文字字号不一致：状态为 13px，统计为 12.5px，窄屏统计为 11px。相同的 20px 行框并不保证文字基线相同。

在已安装的 0.3.5 中，以已有会话 `#c78af51c` 测量，1440px 和 480px 下统计文字基线均比状态高 1px。

按钮统一使用 `--cv-process-size`，状态和统计继承同一字号及 20px 行高。保留状态的 500 字重、统计的 400 字重，以及底边、图标、单行省略和折叠交互。窄屏只缩小间距，不再单独缩小统计文字。

## 验证

浏览器通过请求拦截加载本地构建，仅操作已有会话的本地折叠状态，不发送消息或创建会话。

- 1440px、480px × 深浅色 × 字号偏移 -1/0/+2px，共 12 组，文字基线差与前两个字的 Range 中心差均为 0px；摘要没有横向溢出。
- 实际点击展开、收起后仍对齐。
- 会话数量 770 → 770，创建请求为 0，阅读错误为 0，临时浏览器配置已移除。
- 构建、外部依赖检查、浏览器语法检查通过；已有样式契约与轮次组件测试 41/41 通过。

测量方式：在各文字 span 内临时插入宽高为 0、`vertical-align: baseline` 的 inline-block，以其 top 读取文字基线，随即移除；另用 Range 检查文字几何。只比较元素行框中心会漏掉原问题。

证据：`.perf-results/summary-alignment/baseline/report.json`、`fixed/report.json` 和两组截图。baseline 检查实际已安装 bundle；fixed 检查本地构建预览。本次未发布或应用新版本。

本地构建 client.js SHA256：`35b1a4bfa81547bd85619db5beab3df4dc8a8ffde0760323a383a28525aff155`。

复核命令：

```powershell
$env:DSHX_HARNESS='D:/Khabarovsk/K.Develop/deepseek-harness'
npm run build
node scripts/check-bundle-externals.mjs lib/client.js
node scripts/browser-syntax-gate.mjs lib/client.js
node --import ./tests/support/register.mjs --import tsx/esm --test tests/style-contract.test.ts tests/turn-section.test.ts
```
