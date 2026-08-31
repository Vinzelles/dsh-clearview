# Changelog

## 0.1.1（本地迁移版）

- **性能修复（阅读视图长会话滚动掉帧根治）**：逐词渐显的 `<span data-reader-word>`
  在动画 settle 后由组件自行渲染为纯文本（React 干净卸载该 span），稳态只保留
  ~350ms 动画前沿的少量 span。实测 43 步会话滚动：longtask 50-200ms×55 → 0，
  maxDelta 117-400ms → 17ms；流式 5680 字期间 span 稳定在 48-101。
- **内聚原 dsh-custom-patcher 的 13 个阅读视图配套补丁**（`src/client/compat/`）：
  composer 布局/毛玻璃标记、memory 收尾展开、思考跟随追赶与渐隐修正、轮次统计行、
  rewind 兼容桥、工具失败去重、短思考样式、离屏轮次 content-visibility +
  负载守卫 heavy 降级。样式经 `<style id="dsh-better-display-compat">` 注入
  head 末尾（保持原优先级语义），JS 模块由插件 apply 启动并挂 ctx.effect 生命周期。
- 插件自 `deepseek-harness/my-plugins/` 迁移至 `dsh/dsh-better-display` 独立维护。

## 0.1.0

First public release of the accepted reading-view plugin, published as `dsh-better-display`.

- Native context and tool details with source-ordered, unmodified reasoning.
- Bounded long-reasoning cards with two-line following, expanded follow and manual pause/resume.
- Successful-turn process folding with a separate final answer.
- Source-ordered text reveal and quiet busy-state shimmer.
- Stable status typography and compact disclosure spacing.
- Native content fallbacks and a trusted-plugin block extension slot.
- 42 regression tests; no changes to DSH Agent, SDK, providers or core.
