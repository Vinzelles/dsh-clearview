# 思考结束后的阅读停留与平滑收起

## 原因

原实现将流式思考放在轮次底部的独立 `LiveSegment` 中。正文、工具或下一段思考出现后，未被选区、焦点或滚动回看保留的段落会立即从 liveSeats 移除，再在过程区挂载默认关闭的 `ThoughtRow`。因此原视口被卸载，既没有收起动画，也没有阅读最后几行的时间。

浏览器回放的 `red/optimized.json` 对正文、工具、下一段思考三种切换均复现了原视口立即断开，且没有脚本异常。

## 修复后的契约

- 思考段在过程流内使用同一座位、同一个 `ThoughtRow` 和视口，完成后不换父容器或重新挂载。流式状态行仍在活动思考内容前面；没有活动思考时显示轮次底部状态行。
- 只有本次进入阅读视图后实际流式显示过的段落获得 2400ms 阅读停留；历史段落默认折叠。
- 停留结束后使用现有 `CollapseBody` 的 260ms 高度与透明度过渡收起。关闭动效时保留停留时间，但直接收起。
- 悬停、焦点、滚动回看、选中文字阻止自动收起；移开鼠标、离开焦点或解除选区后重新计时，明确点击“结束回看”或收起则立即执行动画。
- 手动重新展开是独立选择，不再计时自动关闭。原有 128px 视口、自动跟随、回看位置与选区保护保留。
- 收尾停留期间不强制重新滚到末尾；手动展开最新步骤仍支持原有跟随，历史步骤不跟随。
- 整轮完成时，保留段落直到思考收起动画完成，再允许已完成过程折叠。`CollapseBody.onCloseComplete` 在真正结束关闭时释放保留状态，动画取消或反向展开不会提前释放。

## 验证

证据根目录：`.perf-results/thought-settlement/`。

- `final/optimized.json`：正文、工具、下一段思考、整轮完成、动效关闭五种切换通过；同一视口在完成后保持内容、128px 高度与滚动位置。四种动效场景均采到 14 个收起过程中间高度帧，动效关闭为 0 个。
- 悬停、焦点、真实选区三个阅读场景均超过自动收起时限仍保持展开，明确点击收起仍可关闭。
- 同一报告的 `pointerInteraction` 使用原生 CDP 鼠标移动、点击：悬停 2.8 秒后原视口仍连接；离开后自动收起；实际点击能够重新展开全文及关闭，命中检查通过。
- 深浅色及 480px 截图均为 grace 阶段、视口 128px，横向溢出 0。
- `reader-regression/optimized.json`：整体浏览器流式与生命周期检查 failures 为空，历史正文额外渲染为 0，焦点、选区、手动滚动位置、关闭/开启动效的跟随检查通过。它对应最后一处“手动打开最新步骤可跟随”兼容调整之前；该行为由最终单测与专用浏览器回放再次覆盖。
- `live-final/report.json`：实际宿主已有会话加载最终本地构建，阅读范围通过，版本/折叠/复制/对话往返等覆盖检查通过；没有阅读异常。整体宿主为 `uncovered`，原因包括只读守卫阻止后台写入及会话缺少部分记录种类。
- 最终专用回放与已有会话预览均为会话清单 772 → 772，未创建会话，测试 Chrome 及配置已清理。没有发送模型消息、执行回退或创建分支。
- 全量单测 396/396 通过，类型检查与构建、外部依赖检查、浏览器语法检查通过。

最终 client.js SHA256：`592c5d54ecb3b0ae11b451d258d9f69ff31212a1422311e8c3307b99ce86508f`，与已有会话预览实际替换的 bundle 相同。

未发布或应用；新生成模型流式消息的原生桌面实机验收仍需安装后进行。本次保留其他任务的未提交改动。

复核命令（在功能工作树）：

```powershell
npm test
$env:DSHX_HARNESS='D:/Khabarovsk/K.Develop/deepseek-harness'
npm run build
node scripts/check-bundle-externals.mjs lib/client.js
node scripts/browser-syntax-gate.mjs lib/client.js
$env:DSH_TEST_URL='http://127.0.0.1:3193'
$env:CLEARVIEW_PERF_OUTPUT='.perf-results/thought-settlement/recheck'
node scripts/verify-reader-performance.mjs --thought-settlement --screenshots
```
