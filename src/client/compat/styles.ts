/**
 * 阅读视图兼容样式（原 dsh-custom-patcher patches/client 下 7 个 reader 与 rewind
 * 前缀的 CSS 补丁，随插件迁移内聚）。按原文件名顺序合并，运行时注入
 * <style id="dsh-clearview-compat">（追加到 <head> 末尾，同优先级后声明胜出，
 * 与原 patcher 注入语义一致）。
 *
 * 包含：
 *  - reader-composer-layout.css      悬浮输入框布局适配（回到最新药丸）
 *  - reader-perf-long-content.css    离屏轮次 content-visibility + 重载降级（heavy 标记）
 *  - reader-reasoning-follow.css     思考跟随态底部渐隐修正
 *  - reader-reasoning-plain.css      短思考引用式左竖线
 *  - reader-tool-error-dedup.css     工具失败重复错误详情去重
 *  - rewind-reader-bridge.css        rewind 兼容桥 actions 行样式
 */

export const COMPAT_CSS = `/* ==== reader-tool-state.css ==== */
/* 确保工具状态徽标不残留旧构建的半圆药丸样式，统一为工具行同款圆角矩形。 */
[data-dsh-clearview] [class*="toolState"] {
  border-radius: 6px !important;
  padding: 2px 8px !important;
}

/* ==== reader-scroll-anchor.css ==== */
/* 对话滚动容器交给原生 scroll anchoring 负责脱离底部后的位置保持；
 * 插件不再叠加手动锚点补偿，避免滚动历史时被二次锚定拽跳。 */
[data-conversation-scroll] {
  overflow-anchor: auto;
}

/* ==== reader-composer-layout.css ==== */
/* 阅读视图 × 悬浮输入框布局适配：不给任何大块区域加实底（保持原生透底美学）。
 *   1. 「回到最新」按钮 sticky bottom 抬到输入框正上方（原生 12px 会被悬浮输入框盖住）；
 *   2. 按钮视觉已并入插件主体（与运行状态条同款毛玻璃，见 Reader.module.css .jump），
 *      不再需要 canvas-solid 实底补丁。 */

[data-dsh-clearview] [class*="jumpDock"] {
  bottom: calc(var(--dsh-composer-height, 152px) + 12px) !important;
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
 *    与统计行集中在视口底部附近）。
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

/* ==== reader-reasoning-follow.css ==== */
/* 跟随态只保留顶部渐隐，底部不再渐隐（否则最新一行被遮罩淡掉）；
 * 手动阅读态不受影响（插件按 data-edges 自行切换）。 */

[data-dsh-clearview] [data-reader-reasoning-card][data-following=true] [data-reader-reasoning-scroll] {
  -webkit-mask-image: linear-gradient(transparent 0, black var(--reason-fade), black 100%) !important;
  mask-image: linear-gradient(transparent 0, black var(--reason-fade), black 100%) !important;
}

/* ==== reader-reasoning-plain.css ==== */
/* 短思考（未形成卡片）：不加容器，降低存在感，避免和正文混淆。 */

[data-dsh-clearview] [data-reader-reasoning-card][data-overflow=false][data-expanded=false] [class*="reasonPlain"] {
  opacity: 0.72;
  color: var(--dsw-alias-label-tertiary);
}

/* ==== reader-tool-error-dedup.css ==== */
/* 工具失败时同一结果被呈现三次；隐藏红色提示条下方重复的完整错误文本。
 * 注意 Blocks 每块套了一层 data-slot 包装（display:contents 不改层级），选择器必须写全。
 * 完整详情未丢失：工具卡片展开后的页签与标题摘要仍在。 */

[data-dsh-clearview] div[role="alert"] + div > div[data-slot="dsh-clearview.block"] > div[data-reader-text] {
  display: none !important;
}

/* ==== rewind-reader-bridge.css ==== */
/* rewind 兼容桥：座位内追加 [data-time-hover-root] > actions 行（复制按钮 +
 * rewind 撤回按钮 portal）。actions 行绝对定位 top:100% 移出气泡视觉框，座位
 * margin-bottom 预留空间；28px 圆形描边图标与原生 .action 一致。 */

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
  gap: 10px;
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
