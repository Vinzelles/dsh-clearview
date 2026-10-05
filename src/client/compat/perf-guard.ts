/**
 * 阅读视图负载守卫（原 patcher reader-perf-guard.js 内聚）。
 *
 * 度量阅读视图内容规模，超阈值时给根元素点亮 data-dshcp-heavy="on"，由
 * compat 样式优化已关闭轮次的离屏布局（保留 blur / shimmer）；回落到滞回下限以下自动恢复。
 * 度量口径全部是插件自己暴露的 DOM 数据属性（零侵入）：
 *   - 字符量：Σ [data-reader-text][data-shown-length]
 *   - 轮次数：section[data-reader-turn] 个数
 * 性能纪律：不用 MutationObserver，固定 2s 低频轮询（万级节点约 1-3ms，0.5Hz 可忽略）。
 * 滞回：进入 chars≥80000 或 sections≥40；退出 chars≤50000 且 sections≤25。
 *
 * 同一轮询顺带做 CV armed 管理（见 armRoot / cvArmSize）：compat 样式只对
 * data-cv-armed="1" 的已关闭轮次启用 content-visibility，而 armed 只在轮次
 * 真实高度可测（从未渲染的轮次保持完整布局）后才点亮，并把实测高度写进内联
 * contain-intrinsic-size —— 占位尺寸 = 真实尺寸，elide/render 交换尺寸中性，
 * 消除「向上滚动时 CV 占位跳变 + 原生 scroll anchoring 错误补偿」造成的视口
 * 向上跳变。
 */

const ON_CHARS = 80000;
const OFF_CHARS = 50000;
const ON_SECTIONS = 40;
const OFF_SECTIONS = 25;
const POLL_MS = 2000;

/** compat 样式声明的离屏占位回退高度（px）。 */
export const CV_PLACEHOLDER = 480;

/**
 * 为已测得真实高度的已关闭轮次生成 contain-intrinsic-size 值；高度与占位回退
 * 不可区分（或未测得）时返回 null = 不 armed。
 *
 * 为什么必须「先测得、再离屏」：从未渲染的轮次若以 480px 占位参与
 * content-visibility 交换，向上滚动手势中途占位 → 真实高度（数千 px）的跳变
 * 会让原生 scroll anchoring 按交换引发的重排错误补偿，把视口拽到更靠上
 * （实测每次交换 ~146px 反向位移；内联精确高度后 18 步上滚 0 跳变）。
 * `contain-intrinsic-size: auto` 的「记住上次高度」在当前 Chromium 的后续
 * 滚动轮次里不可靠（占位回退仍复现），所以armed 时必须把高度固定进内联样式。
 */
export function cvArmSize(measured: number, placeholder: number = CV_PLACEHOLDER): string | null {
  if (!Number.isFinite(measured) || measured <= 0) return null;
  if (Math.abs(measured - placeholder) <= 1) return null;
  return `auto ${Math.round(measured)}px`;
}

/**
 * 点亮（或刷新）一个阅读根下所有可离屏轮次的 armed 状态。
 * 选择器与 compat CSS 镜像：已关闭、且不是最后两个 section（活跃尾部永不离屏）。
 * 未 armed 的轮次从不被离屏，其 offsetHeight 恒为真实高度 —— 用户向上滚动读到
 * 它时已完整布局（无跳变）；armed 后即使再离屏，占位 = 真实尺寸（交换中性）。
 * 已 armed 轮次仅在渲染高度变化 >4px 时刷新内联尺寸；离屏状态测得的是钉住的
 * 占位值（与 data-cv-armed-size 相等），自然被跳过。
 */
function armRoot(root: HTMLElement): void {
  const sections = root.querySelectorAll<HTMLElement>('section[data-reader-turn]');
  const last = sections.length - 2;
  const updates: { el: HTMLElement; h: number; size: string }[] = [];
  for (let i = 0; i < last; i++) {
    const el = sections[i];
    if (el.getAttribute('data-reader-turn-state') !== 'closed') continue;
    const h = el.offsetHeight;
    const size = cvArmSize(h);
    if (!size) continue;
    const stored = el.getAttribute('data-cv-armed-size');
    if (stored !== null && Math.abs(Number(stored) - h) <= 4) continue;
    updates.push({ el, h, size });
  }
  // All size reads precede writes: arming one turn cannot invalidate layout
  // before measuring the next. A large history pays at most one read phase.
  for (const { el, h, size } of updates) {
    el.setAttribute('data-cv-armed', '1');
    el.setAttribute('data-cv-armed-size', String(Math.round(h)));
    el.style.containIntrinsicSize = size;
  }
}

function measure(root: HTMLElement): { chars: number; sections: number } {
  let chars = 0;
  const texts = root.querySelectorAll<HTMLElement>('[data-reader-text][data-shown-length]');
  for (let i = 0; i < texts.length; i++) {
    const n = Number(texts[i].getAttribute('data-shown-length'));
    if (isFinite(n) && n > 0) chars += n;
  }
  const sections = root.querySelectorAll('section[data-reader-turn]').length;
  return { chars, sections };
}

function syncRoot(root: HTMLElement): void {
  const load = measure(root);
  let heavy = root.getAttribute('data-dshcp-heavy') === 'on';
  if (!heavy && (load.chars >= ON_CHARS || load.sections >= ON_SECTIONS)) heavy = true;
  else if (heavy && load.chars <= OFF_CHARS && load.sections <= OFF_SECTIONS) heavy = false;
  const next = heavy ? 'on' : 'off';
  if (root.getAttribute('data-dshcp-heavy') !== next) {
    root.setAttribute('data-dshcp-heavy', next);
    try { console.info(`[dsh-clearview:perf-guard] reader ${next} (chars=${load.chars}, sections=${load.sections})`); } catch { /* 忽略 */ }
  }
  root.setAttribute('data-dshcp-load', `${load.chars}:${load.sections}`);
}

export function apply(_ctx: any): () => void {
  const work = () => {
    // 阅读视图不可见（切到原生「对话/轨迹」、会话未挂载）时不做任何度量与重排。
    if (document.hidden) return;
    const roots = document.querySelectorAll<HTMLElement>('[data-dsh-clearview]');
    for (let i = 0; i < roots.length; i++) {
      // armRoot 必须每 tick 跑：轮次高度可以只由展开/折叠变化（字符量不变），
      // 跳过它会留下过期的 contain-intrinsic-size，向上滚动时占位跳变。
      try { armRoot(roots[i]); syncRoot(roots[i]); } catch { /* 单根失败忽略 */ }
    }
  };
  work();
  const timer = setInterval(work, POLL_MS);
  try { console.info('[dsh-clearview:perf-guard] applied'); } catch { /* 忽略 */ }
  return () => clearInterval(timer);
}
