/**
 * 悬浮 composer 可读性辅助（原 patcher reader-composer-readability.js 内聚）。
 *
 * 配合 composer-layout 样式（两处都不加大块实底）：
 *   1. 画布色变量：把 body 实际画布色解析成 --dshcp-canvas-solid 挂到 <html>
 *      （小面积元素如「回到最新」药丸补实用），主题切换自动重算；rgba() 按
 *      浏览器画布规则预合成白底，解析失败保留 CSS 侧 rgb(17,17,17) 兜底。
 *   2. 统计行标记：底部统计行容器类名带构建 hash，CSS 无法稳定命中；用分隔符
 *      span（[class*="_sep"]）反查父容器打 data-dshcp-stats-row 标记，供局部
 *      毛玻璃使用。React 重建该行后由观察者重新标记。
 *
 * 性能纪律：getComputedStyle(body) 只在 <html>/<body> 属性变化时重算 + 5s 兜底；
 * [class*="_sep"] 子串选择器全扫经 rAF 合帧 + 500ms 节流，已标记时一次早退。
 */

const VAR_NAME = '--dshcp-canvas-solid';
const STATS_THROTTLE = 500;

interface Rgb { r: number; g: number; b: number; a: number }

function parseRgb(s: string | null): Rgb | null {
  if (!s) return null;
  const m = String(s).match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const p = m[1].split(/[\s,/]+/).filter(x => x !== '').map(parseFloat);
  if (p.length < 3 || p.some(isNaN)) return null;
  return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
}

function syncCanvasVar(): void {
  try {
    const body = parseRgb(getComputedStyle(document.body).backgroundColor);
    if (!body) return;
    let solid: string;
    if (body.a >= 1) {
      solid = `rgb(${Math.round(body.r)}, ${Math.round(body.g)}, ${Math.round(body.b)})`;
    } else {
      const mix = (c: number) => Math.round(c * body.a + 255 * (1 - body.a));
      solid = `rgb(${mix(body.r)}, ${mix(body.g)}, ${mix(body.b)})`;
    }
    if (document.documentElement.style.getPropertyValue(VAR_NAME) !== solid) {
      document.documentElement.style.setProperty(VAR_NAME, solid);
    }
  } catch { /* 静默 */ }
}

function tagStatsRow(): void {
  try {
    const seat = document.querySelector('[data-composer-seat]');
    if (!seat) return;
    if (seat.querySelector('[data-dshcp-stats-row]')) return; // 已标记
    const seps = seat.querySelectorAll('[class*="_sep"]');
    if (seps.length < 2) return;
    const row = seps[0].parentElement;
    if (!row || row === seat) return;
    let count = 0;
    for (let i = 0; i < seps.length; i++) { if (seps[i].parentElement === row) count++; }
    if (count < 2) return;
    row.setAttribute('data-dshcp-stats-row', '');
  } catch { /* 静默 */ }
}

export function apply(_ctx: any): () => void {
  let scheduled = false;
  let lastRun = 0;
  let trailing: ReturnType<typeof setTimeout> | 0 = 0;

  const work = () => { lastRun = Date.now(); tagStatsRow(); };
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      const wait = STATS_THROTTLE - (Date.now() - lastRun);
      if (wait > 0) { if (!trailing) trailing = setTimeout(() => { trailing = 0; work(); }, wait); }
      else work();
    });
  };

  syncCanvasVar();
  work();
  let domObserver: MutationObserver | null = null;
  let themeObserver: MutationObserver | null = null;
  try {
    domObserver = new MutationObserver(schedule);
    domObserver.observe(document.body, { childList: true, subtree: true });
    themeObserver = new MutationObserver(() => syncCanvasVar());
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] });
    themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class', 'style'] });
  } catch { /* 观察者不可用时靠轮询兜底 */ }
  const timer = setInterval(() => { syncCanvasVar(); work(); }, 5000);

  const cleanup = () => {
    clearInterval(timer);
    if (trailing) clearTimeout(trailing);
    if (domObserver) domObserver.disconnect();
    if (themeObserver) themeObserver.disconnect();
  };
  try { console.info('[dsh-clearview:composer-readability] applied'); } catch { /* 忽略 */ }
  return cleanup;
}
