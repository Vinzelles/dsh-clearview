# Changelog

## 0.1.2

- **思考卡片自动跟随三处视觉问题根治（延迟 / 结束未到底 / 滚动反弹）**：
  - 跟随循环改为自适应步进（`reasoningAdvance`）：滞后 ≤4 行保留原 2 行 / 840ms
    平滑节拍；滞后 >4 行时直接滑向实时尾部（400–1800ms，随时长距离缩放），
    120ms 后重新评估——快速流式（100+ tok/s）不再稳定欠一段，追赶节奏内聚于
    插件自身，无外部 DOM 观察者竞争。
  - 思考结束（换步骤 / 轮次结束 / 过程折叠）时若仍处于跟随态，把剩余滞后滑到
    尾部（420/600ms）再交接原生滚动，卡片不再定格在滞后位置；滑移过程中
    滚轮 / 选择 / 点击 / 焦点会把它取消在当前已绘制位置，交互不丢帧。
  - 步骤进行中 in-flight 目标实时钳制到当前尾部：内容收缩（重排 / 折叠 /
    视口 resize）时视口不再越过转录末尾再回滚——「滚动反弹」的另一来源。
  - 视口 resize 不再冻结跟随（改为重新瞄准目标）；首步与恢复跟随从 840ms
    等待缩到 200ms，新流一出现即开始跟随。
  - 移除外部 `compat/reasoning-catchup.ts` DOM 补丁：其 400ms 滑移与插件步进
    竞争同一轨道，滑移常进行到一半被插件下一步 `transition:none` 掐断
    （「猛地窜 → 急停 → 爬两行 → 再窜」的观感来源），由循环内追赶完全替代。

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
