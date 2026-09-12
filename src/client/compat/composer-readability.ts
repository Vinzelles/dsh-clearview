/**
 * 悬浮 composer 可读性辅助（原 patcher reader-composer-readability.js 内聚）。
 *
 * 统计行标记：底部统计行容器类名带构建 hash，CSS 无法稳定命中；用分隔符
 * span（[class*="_sep"]）反查父容器打 data-dshcp-stats-row 标记，供局部
 * 毛玻璃使用。React 重建该行后由观察者重新标记。
 *
 * （画布色变量 --dshcp-canvas-solid 的计算已于 0.1.14 退役：唯一消费者
 * 「回到最新」药丸早已并入插件主体自带实底，插件内外均无该变量的读取点。）
 *
 * 性能纪律：原来在 body 上做 childList+subtree 全树观察，流式渲染时每帧触发，
 * 只为标记一个统计行；改为只观察 composer 座位子树（座位很小），并且只在座位
 * 尚未出现时才观察 body 的顶层 childList（每次进入会话最多几次回调）。
 */

const STATS_THROTTLE = 500;

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

  work();
  let seatObserver: MutationObserver | null = null;
  let seat: Element | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  const watchSeat = () => {
    seat = document.querySelector('[data-composer-seat]');
    if (!seat) return false;
    if (!seatObserver) {
      seatObserver = new MutationObserver(schedule);
      seatObserver.observe(seat, { childList: true, subtree: true });
    }
    if (timer) { clearInterval(timer); timer = null; }
    return true;
  };
  if (!watchSeat()) timer = setInterval(() => { if (watchSeat()) { schedule(); } }, 5000);

  const cleanup = () => {
    if (timer) { clearInterval(timer); timer = null; }
    if (trailing) clearTimeout(trailing);
    if (seatObserver) seatObserver.disconnect();
  };
  try { console.info('[dsh-clearview:composer-readability] applied'); } catch { /* 忽略 */ }
  return cleanup;
}
