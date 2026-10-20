# 原版对话兼容故障诊断

2026-10-10。正式环境是 ClearView 0.3.3，DSH core 0.2.0-rc.2 / Desktop 0.22.4；generation `eaab9006-9929-49de-9d3b-b3d42b1ddd35`。以下修正仅作用于临时浏览器中的资源响应/DOM，未改正式包、会话或管理器状态。

## 输入框消失

与 ClearView 的页签注册顺序有关，但隐藏规则和错误判断在 `dsh-claude-style` 0.12.0。其 composer adapter 取 tablist 中第一个 tab，假设它就是原版对话。ClearView 的阅读页签 order=-5，位于对话前面，因此切到对话时被误判为不应显示输入框。

实际命中的规则：

```css
body[data-dsh-claude-style][data-dsh-claude-composer-active][data-dsh-claude-composer-hidden] [data-composer-seat] {
  display: none !important;
}
```

已有会话 #c78af51c 的只读对照：启用 ClearView 时对话 composer display=none、高度0；仅把 ClearView client 替换为空模块时 display=flex。移除 ClearView compat style 仍为none，排除它的CSS隐藏输入框。

隔离验证将 adapter 的判断改为读取当前选中tab，并识别对话/阅读；正常对话和阅读→对话往返均恢复flex。此验证使用本机已知标签，正式修正应优先订阅宿主稳定view标识，避免依赖tab排序或语言文本。修正应落到 dsh-claude-style；不在ClearView中强制显示所有composer，也不交换页签顺序掩盖问题。

## 原版过程不能折叠

独立于ClearView。禁用ClearView后，原版摘要aria-expanded能切换；收起时215个过程节点都有hidden="until-found"，但仍各占320px。样式所有者为 `<style data-plugin="dsh-tauri-ui">`：

```css
[data-chat-flow] > [data-chat-anchor-key] {
  content-visibility: auto;
  contain-intrinsic-size: auto 320px;
}
```

该性能优化覆盖了hidden-until-found的原生隐藏语义。隔离修正为：

```css
[data-chat-flow] > [data-chat-anchor-key]:not([hidden]) {
  content-visibility: auto;
  contain-intrinsic-size: auto 320px;
}
```

修正后折叠的215项均不占高度；展开后215项恢复。应在dsh-tauri-ui的原始性能规则中修正，避免增加插件间样式覆盖链。

## 证据与边界

开发工作树 `.perf-results/native-audit/` 下：

- `enabled-session/report.json` 与 `disabled-session/report.json`：ClearView启用/禁用对照。
- `rules/report.json`：输入框命中规则。
- `fold-disabled/report.json`、`fold-rules/report.json`、`fold-owner/report.json`：隐藏属性、几何、覆盖规则和所有者。
- `companion-fixes/report.json`：两处修正同时启用，composerPatch/foldPatch为true，折叠0可见/展开215可见，阅读往返正常。

所有对照均用临时Chrome配置、请求阶段只读拦截，未发送模型消息、创建会话或提交设置。会话数767→767，创建0，临时profile已移除。宿主后台写请求被阻止，故这些结果不是整个宿主所有功能通过的声明。用户已确认所有会话和工作区都有相同症状；以上使用已知会话复现，故障规则作用于所有会话。

初次诊断时，正式环境中的两个故障尚未修复。此次ClearView仅把overflow-anchor兼容规则限定到含阅读根节点的scroller，作为样式作用域收敛；它不是上述故障的修正。

## 后续修复与应用（2026-10-10）

用户授权验证后直接发布、应用。现已应用 batch-e17769f1-6df8-4d50-a7df-3de5ab29f85e（generation d273eb76-0bb7-46eb-a866-d8242608944d）。dsh-claude-style 0.12.0+native-chat.1 根据挂载的chat/read表面判断输入框，不依赖首个页签或语言标签；dsh-tauri-ui保留桌面绑定1.0.0版本，以native-chat-fold-v1元数据和哈希标记not([hidden])修正。ClearView0.3.4包原样保留。

安装后实际资源与审核哈希一致，两个工作区的215/85个过程均可折叠、展开和再次折叠；原版与阅读输入框、往返及其他页签隔离通过。会话767→767、创建0、浏览器异常0，所有预览替换关闭。证据与可重复补丁在../../../../native-chat-compat-20261010/，部署收据为该目录deployment.json。未发送模型消息。

发布时另外确认当前管理器批量API缺少desktopExe参数，使用隔离修正版公开API完成全部验证后发布，再经IPC确认成功与正常重启。当前管理器工具分发未升级；后续通用批量更新仍需该工具接口修正。
