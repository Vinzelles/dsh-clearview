/**
 * 阅读视图兼容样式（原 dsh-custom-patcher patches/client 下 7 个 reader 与 rewind
 * 前缀的 CSS 补丁，随插件迁移内聚）。按原文件名顺序合并，运行时注入
 * <style id="dsh-better-display-compat">（追加到 <head> 末尾，同优先级后声明胜出，
 * 与原 patcher 注入语义一致）。
 *
 * 包含：
 *  - reader-composer-layout.css      悬浮输入框布局适配（回到最新药丸/统计行毛玻璃）
 *  - reader-perf-long-content.css    离屏轮次 content-visibility + 重载降级（heavy 标记）
 *  - reader-reasoning-follow.css     思考跟随态底部渐隐修正
 *  - reader-reasoning-plain.css      短思考引用式左竖线
 *  - reader-tool-error-dedup.css     工具失败重复错误详情去重
 *  - reader-turn-metrics-footer.css  轮次统计行视觉（hover 淡入）
 *  - rewind-reader-bridge.css        rewind 兼容桥 actions 行样式
 */

export const COMPAT_CSS = `/* ==== reader-composer-layout.css ==== */
/* 阅读视图 × 悬浮输入框布局适配：不给任何大块区域加实底（保持原生透底美学）。
 *   1. 「回到最新」按钮 sticky bottom 抬到输入框正上方（原生 12px 会被悬浮输入框盖住）；
 *   2. 按钮药丸自身补实（画布色由 composer-readability 解析为 --dshcp-canvas-solid）；
 *   3. 底部统计行容器局部毛玻璃（容器由 JS 标记 [data-dshcp-stats-row]，
 *      类名带构建 hash，CSS 无法稳定命中）。 */

[data-dsh-better-display] [class*="jumpDock"] {
  bottom: calc(var(--dsh-composer-height, 152px) + 12px) !important;
}

[data-dsh-better-display] [class*="jumpDock"] [class*="jump"] {
  background: var(--dshcp-canvas-solid, rgb(17, 17, 17)) !important;
}

[data-composer-seat] [data-dshcp-stats-row] {
  backdrop-filter: blur(10px) saturate(1.2);
  -webkit-backdrop-filter: blur(10px) saturate(1.2);
  border-radius: 8px;
  padding-top: 2px;
  padding-bottom: 2px;
}

/* ==== reader-perf-long-content.css ==== */
/* 长会话性能：
 * 1) 离屏轮次跳过渲染（content-visibility:auto + contain-intrinsic-size auto 记住
 *    上次真实高度）。只作用于「已关闭且不是最后两轮」的 section：进行中的轮次永远
 *    完整渲染；最后两轮保持渲染（tail-keep 需要点击最近一轮 Disclosure，rewind 桥
 *    与统计行集中在视口底部附近）。
 * 2) 重载降级（data-dshcp-heavy，由 perf-guard 按内容规模点亮）：逐词 WAAPI 动画去
 *    blur（!important 作者样式按 CSS Cascade 压过 WAAPI 关键帧，opacity 渐显保留）；
 *    忙碌态 shimmer 停掉（display:none 后基色文字仍可见）。思考卡片跟随与过程展开
 *    高度动画是核心体验，不降级。 */

[data-dsh-better-display] section[data-reader-turn][data-reader-turn-state="closed"]:not(:last-of-type):not(:nth-last-of-type(2)) {
  content-visibility: auto;
  contain-intrinsic-size: auto 480px;
}

[data-dsh-better-display][data-dshcp-heavy="on"] [data-reader-word],
[data-dsh-better-display][data-dshcp-heavy="on"] [data-reader-atom] {
  filter: none !important;
}

[data-dsh-better-display][data-dshcp-heavy="on"] [data-ud-motion="reader-thinking-state"][data-active="true"] [data-reader-shimmer]::before {
  display: none !important;
}

[data-dsh-better-display][data-dshcp-heavy="on"] [data-ud-motion="reader-thinking-state"] [data-reader-status-copy] {
  filter: none !important;
}

/* ==== reader-reasoning-follow.css ==== */
/* 跟随态只保留顶部渐隐，底部不再渐隐（否则最新一行被遮罩淡掉）；
 * 手动阅读态不受影响（插件按 data-edges 自行切换）。 */

[data-dsh-better-display] [data-reader-reasoning-card][data-following=true] [data-reader-reasoning-scroll] {
  -webkit-mask-image: linear-gradient(transparent 0, black var(--reason-fade), black 100%) !important;
  mask-image: linear-gradient(transparent 0, black var(--reason-fade), black 100%) !important;
}

/* ==== reader-reasoning-plain.css ==== */
/* 短思考（未形成卡片）加引用式左竖线 + 次级色，形成独立"思考段"视觉语言。 */

[data-dsh-better-display] [data-reader-reasoning-card][data-overflow=false][data-expanded=false] [class*="reasonPlain"] {
  color: var(--dsw-alias-label-secondary);
  border-left: 2px solid var(--dsw-alias-border-l1);
  padding: 2px 0 2px 12px;
  border-radius: 1px;
}

/* ==== reader-tool-error-dedup.css ==== */
/* 工具失败时同一结果被呈现三次；隐藏红色提示条下方重复的完整错误文本。
 * 注意 Blocks 每块套了一层 data-slot 包装（display:contents 不改层级），选择器必须写全。
 * 完整详情未丢失：工具卡片展开后的页签与标题摘要仍在。 */

[data-dsh-better-display] div[role="alert"] + div > div[data-slot="dsh-better-display.block"] > div[data-reader-text] {
  display: none !important;
}

/* ==== reader-turn-metrics-footer.css ==== */
/* 轮次统计行（由 turn-metrics-footer 注入 .dshcp-turn-footer）：14px 三级文字色；
 * 有 hover 能力的设备默认透明、hover/focus 淡入 80ms；触屏常显。只切 opacity 不切 display。 */

[data-dsh-better-display] .dshcp-turn-footer {
  display: inline-flex;
  align-items: center;
  min-width: 0;
  font-size: var(--dsh-content-font-size, 14px);
  line-height: calc(24px + var(--dsh-content-font-delta, 0px));
  color: var(--dsw-alias-label-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

[data-dsh-better-display] section[data-reader-turn] > .dshcp-turn-footer {
  margin-top: 4px;
  padding-left: 12px;
}

@media (hover: hover) {
  [data-dsh-better-display] .dshcp-turn-footer {
    opacity: 0;
    transition: opacity 80ms ease;
  }

  [data-dsh-better-display] section[data-reader-turn]:hover .dshcp-turn-footer,
  [data-dsh-better-display] section[data-reader-turn]:focus-within .dshcp-turn-footer {
    opacity: 1;
  }
}

/* ==== rewind-reader-bridge.css ==== */
/* rewind 兼容桥：座位内追加 [data-time-hover-root] > actions 行（复制按钮 +
 * rewind 撤回按钮 portal）。actions 行绝对定位 top:100% 移出气泡视觉框，座位
 * margin-bottom 预留空间；28px 圆形描边图标与原生 .action 一致。 */

[data-dsh-better-display] div[data-dshcp-rewind-seat="1"] {
  position: relative;
  margin-bottom: 30px;
}

[data-dsh-better-display] .dshcp-rewind-reader-root {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 2px;
  display: flex;
  justify-content: flex-end;
}

[data-dsh-better-display] .dshcp-rewind-reader-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  height: 28px;
}

[data-dsh-better-display] .dshcp-rewind-reader-action {
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

[data-dsh-better-display] .dshcp-rewind-reader-action:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-secondary);
}

[data-dsh-better-display] .dshcp-rewind-reader-action.is-copied svg {
  stroke: var(--dsw-alias-success-color, var(--dsw-alias-label-primary));
}
`;

const STYLE_ID = 'dsh-better-display-compat';

/** 注入/更新兼容样式容器（追加到 head 末尾保证优先级；重复调用幂等更新）。 */
export function injectCompatStyles(): void {
  if (typeof document === 'undefined') return;
  let el = document.getElementById(STYLE_ID);
  if (!el) {
    el = document.createElement('style');
    el.id = STYLE_ID;
    el.setAttribute('data-plugin', 'dsh-better-display');
    document.head.appendChild(el);
  }
  if (el.textContent !== COMPAT_CSS) el.textContent = COMPAT_CSS;
}
