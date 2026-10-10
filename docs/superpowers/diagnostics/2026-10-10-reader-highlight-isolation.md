# 流式思考持续发暗：CSS Highlight 接管冲突

## 复现与根因

0.3.4 正式包的 Blocks 使用通用 `data-streaming`。dsh-claude-style 的字符渐显引擎和规则会接管该标记，通过 `::highlight(dsh-claude-tok-0..23)` 将文本从20% alpha渐显。阅读视图又有独立的逐词时钟；文本叶子不断追加、重组时，宿主高亮与阅读动效叠加。

真实运行会话可复现：文字和所有祖先的computed opacity接近1、文字色正常，实际截图却持续暗淡。分别移除思考视口mask、强制文字opacity=1/filter=none，均不能消除该现象。移除通用标记并替换为阅读专有标记后，暗色真实会话恢复清晰。因此不能靠进一步降低模糊或缩短动画解决。

## 修正

Blocks仅输出 `data-reader-streaming`。它表达相同状态，但不会被宿主通用渐显接管。不改其他插件、宿主偏好或会话，不移除CSS Highlight注册表中的宿主条目。保留原思考profile（初始opacity0.8、180ms、blur1、无排队）、正文动效及128px限高跟随。

同时，整轮摘要改为仅1px底边、透明底、零圆角；文件卡片“再显示”按钮左右各8px内边距。

## 验证证据

工作树 `.perf-results/thought-readability/`：

- baseline / ancestors / isolation / paint：真实流式复现、祖先样式及单变量排除记录。
- highlight：通用标记替换的暗色隔离截图，恢复可读。
- red/optimized.json：真实CSS Highlight范围回归，阅读文本被染成rgba(1,2,3,0.2)，失败消息为“host highlight dimmed reader text despite normal element opacity”。
- green/optimized.json：同一范围与样式继续使对照文本变淡，阅读文本保持正常文字色；hostMarkerCount0、readerOwnsMarkertrue，failures空。快速流式6329个词采样、最低opacity0.8、futureStarts0、原文完整；动效开关两种情况下，限高128和回看均保留。
- actual-fixed/report.json：本地新bundle直接预览真实运行会话，宿主通用标记0，阅读标记1，文字与highlight计算色一致；769→769，创建0、profile清理完成。该次为浅色实机样本；另一次暗色新bundle补测因侧栏未找到会话而未覆盖，不计成功。暗色隔离实验和合成浏览器截图已覆盖。
- layout/report.json：真实已完成会话的功能case通过；折叠样式边宽0/0/1/0、透明底、radius0，按钮左右8px。深浅色、480px、折叠、卡片、复制等检查通过，阅读错误0、创建0、769→769。临时profile因EPERM未删除，使总readerPass为false；后续自动审批拒绝清理，未绕过。测试Chrome已退出。

386项测试、构建、bundle externals和browser syntax通过。测试命令为 `npm test`；浏览器回归为 `node scripts/verify-reader-performance.mjs --screenshots`，须设置DSH_TEST_URL与独立CLEARVIEW_PERF_OUTPUT。

修正仅在开发工作树，未发布。测试时正式环境由其他工作更新至generation d273eb76-0bb7-46eb-a866-d8242608944d；旧generation依赖链接失效，已仅将开发工作树13个宿主依赖重新链接到当前generation。未覆盖本次开始前已有的native-chat-compat.md修改。
