/**
 * 思考卡片自动跟随「追赶」（原 patcher reader-reasoning-catchup.js 内聚）。
 *
 * 根因：ReasoningCard 自动跟随按固定节拍推进（每 840ms 一步、每步 2 行 ≈57px/s），
 * 且设计上不跨未读行追赶；思考流式常见 100+ tok/s（≈120px/s），跟随速率追不上
 * 内容增速，视口与最新内容稳定欠着一段；步骤结束时定格在滞后位置。
 *
 * 修复（只在外围补偿，不改插件内部节拍）：卡片处于跟随态（data-following=true）、
 * transform 模式、且插件自身步进动画空闲（无 data-reasoning-moving）时，若滞后
 * >96px（4 行），把轨道以 400ms 缓动滑到 tail；插件下一步从 paintedOffset()（读
 * 实时 transform）继续，天然衔接。滞后 ≤96px 完全不干预（保留 2 行平滑步进观感）。
 * 手动阅读态/暂停态/无卡片短思考不处理。配套样式见 compat 的 reasoning-follow 段。
 *
 * 性能纪律：观察者回调 rAF 合帧 + 200ms 节流；每轮先 querySelector 存在性早退
 * （跟随中卡片至多一张，无卡片时零开销），再做带 getComputedStyle/DOMMatrix 的处理。
 */

const CATCH_GAP = 96;
const EASE = 'cubic-bezier(.22,1,.36,1)';
const MIN_INTERVAL = 200;
const FOLLOWING_SELECTOR = '[data-dsh-better-display] [data-reader-reasoning-card][data-following=true]';

function tailOf(port: HTMLElement, text: HTMLElement): number {
  return Math.max(0, text.offsetHeight - port.clientHeight);
}
function paintedOf(track: HTMLElement): number {
  const t = getComputedStyle(track).transform;
  if (!t || t === 'none') return 0;
  try { return Math.abs(new DOMMatrixReadOnly(t).m42); } catch { return 0; }
}

function handleCard(card: HTMLElement): void {
  if (card.getAttribute('data-following') !== 'true') return;
  if (card.getAttribute('data-overflow') !== 'true') return;
  const port = card.querySelector<HTMLElement>('[data-reader-reasoning-scroll]');
  const track = card.querySelector<HTMLElement>('[data-reader-reasoning-track]');
  const text = card.querySelector<HTMLElement>('[data-reader-reasoning-text]');
  if (!port || !track || !text) return;
  if (port.dataset.reasoningMoving === 'true') return;    // 插件步进动画进行中，不打断
  if (port.dataset.reasoningMode !== 'transform') return; // 只管自动跟随态
  const tail = tailOf(port, text);
  const gap = tail - paintedOf(track);
  if (gap <= CATCH_GAP) return;
  track.style.transition = `transform 400ms ${EASE}`;
  track.style.transform = `translateY(-${tail}px)`;
}

export function apply(_ctx: any): () => void {
  let scheduled = false;
  let lastRun = 0;
  let trailing: ReturnType<typeof setTimeout> | 0 = 0;
  let observer: MutationObserver | null = null;

  const work = () => {
    lastRun = Date.now();
    try {
      if (!document.querySelector(FOLLOWING_SELECTOR)) return; // 存在性早退
      document.querySelectorAll<HTMLElement>(FOLLOWING_SELECTOR).forEach(card => {
        try { handleCard(card); } catch { /* 单卡失败忽略 */ }
      });
    } catch { /* 查询失败忽略 */ }
  };
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      const wait = MIN_INTERVAL - (Date.now() - lastRun);
      if (wait > 0) { if (!trailing) trailing = setTimeout(() => { trailing = 0; work(); }, wait); }
      else work();
    });
  };

  work();
  try {
    observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-following', 'data-edges'] });
  } catch { /* 观察者不可用忽略 */ }

  const cleanup = () => {
    if (trailing) clearTimeout(trailing);
    if (observer) observer.disconnect();
  };
  try { console.info('[dsh-better-display:reasoning-catchup] applied'); } catch { /* 忽略 */ }
  return cleanup;
}
