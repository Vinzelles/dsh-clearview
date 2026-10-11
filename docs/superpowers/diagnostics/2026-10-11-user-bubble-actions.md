# 用户气泡操作区与全文图标

## 布局契约

- 外层 `data-reader-user-message` 承担消息锚点和 rewind 座位，内层 `data-reader-user-bubble` 承担气泡边框、背景和内边距。
- 复制和回退的操作区是外层座位的最后一个子元素，位于气泡下方。两按钮间距 4px，28px × 2 + 4px 能放在“继续”的 64px 气泡下方。
- 全文折叠按钮是气泡右下角的 24px 图标按钮，通过 `aria-label`、`title`、`aria-expanded` 和 `aria-controls` 表达操作。文本右侧预留 28px；按钮不再增加单独一行。
- 保留六行折叠、末尾渐隐、ResizeObserver 与字体加载后的测量。复制排除操作区及折叠控件，取完整消息。

## rewind 的真实宿主契约

当前宿主的 `dsh-rewind-plugin` client rev 为 `90a8c60a2d5d`。其 `actionsContainerOf` 找到座位中最后一个非 rewind 按钮，将按钮的父元素作为 portal 容器。

若气泡本身仍是座位，首次 ResizeObserver 检测到长消息后，React 会在兼容桥追加的复制操作区之后插入全文按钮。rewind 随后误把气泡当作操作区，回退按钮进入正文，还增加气泡高度。仅修改绝对定位 CSS 不能解决这个顺序问题。

将锚点放在外层消息容器，使全文按钮始终位于内层气泡，操作区始终处于气泡之后。`kindOf` 优先读取补充消息标记，并兼容旧的 meta 段落。

## 验收证据

证据根目录：`.perf-results/user-bubble-actions/`。

- `live-fixed/report.json`：已有会话 `#c78af51c`，本地 bundle 预览；阅读范围通过，阅读异常为 0。真实复制按钮取到完整内容，展开和收起正常，两个消息操作按钮均在气泡外。
- 气泡折叠高度 166px，展开高度 358px，再次收起为 166px；全文图标始终位于气泡内部并与文字区域共用最后一行。
- 深浅色边界、1440px/480px、13px/14px/16px 宿主字号、原生对话往返等已覆盖。只读拦截阻止宿主后台写入，因此整体宿主报告为 `uncovered`，不作为整宿主通过的证据。
- `fixture-fixed/optimized.json`：完整浏览器合成检查 failures 为空；长消息展开/收起保留完整内容，变为短消息后不再显示全文按钮。
- `short-layout/report.json`：将真实消息 DOM 在临时浏览器内克隆为“继续”，仅验证 CSS 几何；两种宽度 × 两种主题共四组通过。气泡 64×46px，复制和回退按钮均为 28px，距气泡下边缘 2px，无横向挤出。
- 真实会话、短消息几何两次检查均为会话数量 771 → 771，创建请求为 0，临时浏览器配置已移除。未点击回退按钮，不改变真实会话。
- 相关组件/样式/轮次测试 57 项通过；类型检查与构建、外部依赖检查、浏览器语法检查通过。

client.js SHA256：`122dace19867136ada966c1df0bd15979765bc5af81b58e397cd3d0fe0d34e81`。

本次只完成源码与预览验证，未发布、应用或合并。

检查结束后工作树另有工具行和问题记录的并行改动；本记录仅覆盖本次气泡修复，不作为这些改动的验收结论。

可重复命令（在功能工作树运行）：

```powershell
$env:DSHX_HARNESS='D:/Khabarovsk/K.Develop/deepseek-harness'
npm run build
node scripts/check-bundle-externals.mjs lib/client.js
node scripts/browser-syntax-gate.mjs lib/client.js
node --import ./tests/support/register.mjs --import tsx/esm --test tests/user-bubble.test.ts tests/records-opening.test.ts tests/style-contract.test.ts tests/turn-section.test.ts
$env:READER_NO_INTERCEPT='0'
$env:READER_SESSIONS='#c78af51c'
$env:READER_EXPAND='0923 5.5'
$env:READER_CONDITIONS='1'
$env:READER_LIVE_OUTPUT='.perf-results/user-bubble-actions/live-recheck'
node scripts/verify-live-reader.mjs
```
