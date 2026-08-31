/**
 * 阅读视图负载守卫（原 patcher reader-perf-guard.js 内聚）。
 *
 * 度量阅读视图内容规模，超阈值时给根元素点亮 data-dshcp-heavy="on"，由
 * compat 样式降级最贵的逐词 blur / shimmer；回落到滞回下限以下自动恢复。
 * 度量口径全部是插件自己暴露的 DOM 数据属性（零侵入）：
 *   - 字符量：Σ [data-reader-text][data-shown-length]
 *   - 轮次数：section[data-reader-turn] 个数
 * 性能纪律：不用 MutationObserver，固定 2s 低频轮询（万级节点约 1-3ms，0.5Hz 可忽略）。
 * 滞回：进入 chars≥80000 或 sections≥40；退出 chars≤50000 且 sections≤25。
 */

const ON_CHARS = 80000;
const OFF_CHARS = 50000;
const ON_SECTIONS = 40;
const OFF_SECTIONS = 25;
const POLL_MS = 2000;

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
    try { console.info(`[dsh-better-display:perf-guard] reader ${next} (chars=${load.chars}, sections=${load.sections})`); } catch { /* 忽略 */ }
  }
  root.setAttribute('data-dshcp-load', `${load.chars}:${load.sections}`);
}

export function apply(_ctx: any): () => void {
  const work = () => {
    const roots = document.querySelectorAll<HTMLElement>('[data-dsh-better-display]');
    for (let i = 0; i < roots.length; i++) {
      try { syncRoot(roots[i]); } catch { /* 单根失败忽略 */ }
    }
  };
  work();
  const timer = setInterval(work, POLL_MS);
  try { console.info('[dsh-better-display:perf-guard] applied'); } catch { /* 忽略 */ }
  return () => clearInterval(timer);
}
