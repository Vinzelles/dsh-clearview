# 0.3.9 样式调整与验收

## 问题与处理

- 代码卡片：实机中外层 `.md-code-block` 和 Markdown 通用 `pre` 规则各画一圈边框，内外圆角也不一致。保留外框，内部 `pre` 无边框，上角为 0，下角和语言栏采用 9px 内圆角，外圆角为 10px。保留原生高亮、复制和 sticky 语言栏。
- 字体：原版正文使用宿主 `--dsh-claude-font-prose`，界面使用 `--dsw-font-family`，代码使用 `--dsh-claude-font-code`；旧阅读视图覆盖为自己的字体栈。0.3.9 改为继承这些选择，移除会产生别名循环的宿主字体覆盖；正文仍采用宿主字号，本机为 14px。
- 补充消息：右对齐过去依赖 Opening 的外层 flex，而中途 InputBubble 没有该外层。现在 UserBubble 自身通过 `margin-inline-start: auto` 右对齐，保留原位置、六行折叠和复制/回退座位。
- 思考：过去会切断操作 run。现在连续 reasoning 和操作进入同一个过程组，保留源顺序；正文、补充输入、问答、计划及异常仍是边界。只有思考的组也有稳定 group key，工具到来时不替换思考的 DOM 父级。

限高 128px、跟随、滚动暂停、选区/焦点保护、2.4 秒阅读宽限均保留。组在思考仍被回看时保持展开；显式关闭释放保留座位。手动重新展开历史思考不会启动自动关闭。历史回看与真正的 live seat 使用不同标记。

## 审查修复

审查发现：活动思考的秒针通过 `liveStatus → renderThought → renderItem` 影响旧组 memo。计时已下沉到独立 `LiveStatusLine`，传入开始时间、阶段和标签等标量，父 TurnSection 不再订阅秒针。原来的 elapsed 格式抽取成 `elapsedTimeLabel`，保留缺失时间、逆序时间和分钟边界行为。

只读审查回放覆盖思考内/尾部状态 × running/waiting，逐场景推进三次秒针，父组件更新数为 0，旧 renderer 引用和 memo 保持稳定。另有 56 项定向验证和时间边界断言。已复核关闭审查发现的问题。

## 隔离

开发中发现原工作区出现另一项回退可见性修改。将本次明确拥有的变更迁移到独立分支 `feat/clearview-039-refinement`，以 `5f69a95` 为基线；按哈希和反向补丁撤回原区本次变更，保留另一项回退源文件、测试与脚本扩展。本包不包含那项并发修改。

工作区：`D:/Khabarovsk/K.Develop/dsh/staging/dsh-clearview-039-refinement-20261012`。依赖通过 node_modules junction 复用现有宿主链接，未下载另一份依赖。基线 398 项通过、2 项因未构建 bundle 跳过；构建本次版本后完整 409 / 409 通过，无跳过。

## 验证

- TypeScript 构建、运行时 externals 检查和浏览器语法门禁通过；客户端仅外置 React、React JSX runtime 和原生 UI primitives。
- 深浅色 × 宽/窄列的真实组件验证通过：三种代码卡片内部边框均为 0，外框 1px；补充消息右边缘误差 0px；正文/UI/代码字体栈与宿主令牌一致；思考在组内、历史与实时视口均保持 128px。
- 思考收尾专项通过，包括工具到来、下一步、轮次结束、关闭动效、悬停/聚焦/选区保留、阅读宽限及鼠标实际展开/收起。
- 完整合成长对话通过：流式历史正文额外渲染数 0，frame P95 13.5ms，commit P95 约 1.1ms。快速思考文本最低不透明度 0.8，无未来排队时间；原有 blur / shimmer 和 heavy 模式策略保留。
- 三个真实已有会话的本地 bundle 预览通过，`readerPass=true`，阅读错误为 0；字号、正文层级、分组、工具详情、消息折叠、复制和阅读/对话回切均正常。该脚本整体宿主门禁仍标记未覆盖/受阻：没有真实完成计划勾选，且只读保护阻止宿主后台写入。因此不将 CLI 退出码 2 表述为整个宿主通过。
- 所有浏览器检查未发送模型消息、未创建会话；会话清单 780 → 780，ID 哈希一致，测试 Chrome 和 profile 已移除。

字体栈相同不等同于首选字体已经加载。报告保留 FontFace 状态和 CDP platformFonts 字形证据，未宣称本机已强制使用某个特定字体。真实桌面新生成一轮的吞吐仍未实测。

## 证据与命令

追加整轮折叠条调整：状态点与折叠箭头共用一个 16px grid 槽位，收起空闲时显示状态点，悬停/键盘聚焦切换为箭头，展开后保持向下箭头。保留成功/异常颜色、整行按钮、统计和原有过程控制。100ms 切换支持关闭动效及 reduced-motion。

追加验证：412 / 412 测试通过，构建、外部依赖与浏览器语法门禁通过。`turn-summary-icons/optimized.json` 使用真实鼠标和键盘输入验证悬停、打开、移出、关闭、Tab/Enter/Space、异常颜色、关闭动效及 reduced-motion；箭头和状态点中心重合，文字位移 0px。深浅色和 480px 窄屏截图无横向溢出，错误和失败均为 0。会话清单 780 → 780，ID 哈希不变，测试 Chrome/profile 已移除。此次为真实宿主 primitives 加载下的合成组件检查，没有将本地版本发布或应用。

工作区 `.perf-results/`：`tests.log`、`build.log`、`style/optimized.json`、`reader/optimized.json`、`thought/optimized.json`、`live-final/report.json`、`artifact.json` 和 `package/dsh-clearview-0.3.9.tgz`。以下在该工作区执行：

```powershell
npm test
$env:DSHX_HARNESS='D:/Khabarovsk/K.Develop/deepseek-harness'
npm run build
node scripts/check-bundle-externals.mjs lib/client.js
node scripts/browser-syntax-gate.mjs lib/client.js
$env:DSH_TEST_URL='http://127.0.0.1:3193'
$env:CLEARVIEW_PERF_OUTPUT='.perf-results/style'
node scripts/verify-reader-performance.mjs --style-refinement --screenshots
```

客户端 SHA-256：`9685d75b500a57a29bd6d372a33cbdf80d5e3e2cbe3703bbd8693981bac6d69e`。后端 SHA-256：`e4069d190c1a3a91a83a90ccbfb9aad92abeccf5687ea57fc4acbbc7beb78efb`，与 0.3.8 一致。

0.3.9 已本地打包，没有调用 plugins.publish 或 runtime.commit，没有合并主分支或推送。临时 npm 缓存递归清理被自动审批拒绝（blocked by policy），该目录已保留，未换用其他工具重试。
