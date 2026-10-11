/**
 * 阅读视图兼容样式（原 dsh-custom-patcher patches/client 下 7 个 reader 与 rewind
 * 前缀的 CSS 补丁，随插件迁移内聚）。按原文件名顺序合并，运行时注入
 * <style id="dsh-clearview-compat">（追加到 <head> 末尾，同优先级后声明胜出，
 * 与原 patcher 注入语义一致）。
 *
 * 包含：
 *  - reader-scroll-anchor.css        对话滚动容器交给原生 scroll anchoring
 *  - reader-perf-long-content.css    已关闭旧轮次的离屏渲染（heavy 标记）
 *  - rewind-reader-bridge.css        rewind 兼容桥 actions 行样式
 *
 * 0.2.0 起移除：工具状态胶囊、回到最新药丸定位、思考卡渐隐/短思考、失败去重、
 * 统计行（这些表面已由组件自身样式承担）。
 */

export const COMPAT_CSS = `/* ==== reader-scroll-anchor.css ==== */
/* 对话滚动容器交给原生 scroll anchoring 负责脱离底部后的位置保持；
 * 插件不再叠加手动锚点补偿，避免滚动历史时被二次锚定拽跳。 */
[data-conversation-scroll]:has([data-dsh-clearview]) {
  overflow-anchor: auto;
}

/* ==== reader-perf-long-content.css ==== */
/* 长会话性能：
 * 1) 离屏轮次跳过渲染（content-visibility:auto）。关键约束：只有「高度已知」的
 *    轮次才参与离屏渲染（data-cv-armed，由 perf-guard 在轮次渲染后点亮，并把实测
 *    高度写进内联 contain-intrinsic-size）。从未渲染的轮次保持完整布局（真实几何，
 *    向上滚动进入时不会发生 480px 占位 → 真实高度的尺寸跳变）；已渲染轮次再离屏时
 *    占位尺寸 = 真实尺寸，elide/render 交换尺寸中性。背景：带 480px 回退占位的 CV
 *    交换若发生在滚动手势中途、且锚点位于交换盒内/旁，原生 scroll anchoring 会按
 *    「交换引发的重排」错误补偿，把视口拽到更靠上的位置（用户报告的「向上滚动突然
 *    跳到更上方」）。实测：未 armed 时交换步跳变 ~146px；armed（内联精确高度）后
 *    18 步上滚 0 跳变。只作用于「已关闭且不是最后两轮」的 section：进行中的轮次永远
 *    完整渲染；最后两轮保持渲染（tail-keep 需要点击最近一轮 Disclosure，rewind 桥
 *    与回合页脚集中在视口底部附近）。
 * 2) heavy 只控制离屏布局优化；可见文字的 blur、shimmer、状态过渡和折叠效果
 *    与轻负载完全相同，不按内容规模降级。 */

/* Only armed turns opt into off-screen rendering: never-rendered turns keep
 * true geometry (no placeholder swap, no scroll-anchoring surprise), and armed
 * turns carry their measured height inline so elision stays size-neutral.
 * The 480px fallback covers only the armed-but-unpinned edge case. */
[data-dsh-clearview][data-dshcp-heavy="on"] section[data-reader-turn][data-reader-turn-state="closed"][data-cv-armed="1"]:not(:last-of-type):not(:nth-last-of-type(2)) {
  content-visibility: auto;
  contain-intrinsic-size: auto 480px;
}

/* ==== rewind-reader-bridge.css ==== */
/* rewind 兼容桥：座位内追加 [data-time-hover-root] > actions 行（复制按钮 +
 * rewind 撤回按钮 portal）。actions 行绝对定位 top:100% 移出气泡视觉框，座位
 * margin-bottom 预留空间；定位座位包含完整气泡，短消息的操作区也不进入气泡。
 * 28px 圆形描边图标与原生 .action 一致。 */

[data-dsh-clearview] div[data-dshcp-rewind-seat="1"] {
  position: relative;
  margin-bottom: 30px;
}

[data-dsh-clearview] .dshcp-rewind-reader-root {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 2px;
  display: flex;
  justify-content: flex-end;
}

[data-dsh-clearview] .dshcp-rewind-reader-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
  height: 28px;
}

[data-dsh-clearview] .dshcp-rewind-reader-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 6px;
  border: none;
  border-radius: 28px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
}

[data-dsh-clearview] .dshcp-rewind-reader-action:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-secondary);
}

[data-dsh-clearview] .dshcp-rewind-reader-action.is-copied svg {
  stroke: var(--dsw-alias-success-color, var(--dsw-alias-label-primary));
}
`;

const STYLE_ID = 'dsh-clearview-compat';

/** 注入/更新兼容样式容器（追加到 head 末尾保证优先级；重复调用幂等更新）。 */
export function injectCompatStyles(): void {
  if (typeof document === 'undefined') return;
  let el = document.getElementById(STYLE_ID);
  if (!el) {
    el = document.createElement('style');
    el.id = STYLE_ID;
    el.setAttribute('data-plugin', 'dsh-clearview');
    document.head.appendChild(el);
  }
  if (el.textContent !== COMPAT_CSS) el.textContent = COMPAT_CSS;
}
