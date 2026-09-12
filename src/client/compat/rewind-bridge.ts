/**
 * 阅读视图 × dsh-rewind 兼容桥（原 patcher rewind-reader-bridge.js 内聚）。
 *
 * 问题：阅读视图接管会话流渲染后，用户消息座位（div[data-reader-anchor]
 * [data-reader-key]）缺少 dsh-rewind 客户端（RewindPortals）依赖的 DOM 契约：
 *   [data-chat-flow-kind="user|steering"][data-chat-anchor-key]  ← 座位
 *   [data-time-hover-root]                                       ← messageRoot
 *   messageRoot.lastElementChild = 含至少一个 <button> 的容器    ← actions
 * 于是 collectTargets 永远返回空：撤回按钮不渲染；且原生复制按钮在阅读视图里
 * 本就不存在，用户消息 hover 时看不到任何按钮。
 *
 * 本模块：
 *   1. 监视阅读视图新出现的用户/steering 座位；
 *   2. 补上 data-chat-anchor-key / data-chat-flow-kind（key 取 data-reader-key；
 *      kind 由「补充消息」meta 行判定）；
 *   3. 座位内追加 [data-time-hover-root] > actions 行（含复制按钮）——既满足
 *      rewind 挂载条件，也恢复阅读视图缺失的复制按钮；
 *   4. 座位 childList 变化触发 RewindPortals 自带观察者，把撤回按钮 portal 进
 *      actions 行；撤回后其隐藏逻辑同样作用于该座位。
 *
 * 幂等：每座位仅处理一次（dataset.dshcpRewindSeat）；座位被 React 重建后观察者
 * 再次处理。不触碰原生「对话/轨迹」视图。
 *
 * 性能纪律：不对每个 addedNode 跑复合选择器子树扫描；观察范围收窄到阅读视图根
 * （见 reader-root.ts：原 body 级 childList+subtree 观察在流式渲染时每帧触发），
 * 任何 childList 变化只置脏 + rAF 合帧 + 300ms 节流。
 */

import { observeReaderRoot, watchReaderRoots } from './reader-root.js';

const SEAT_SELECTOR = 'div[data-reader-anchor][data-reader-key]:not(article)';
const MIN_INTERVAL = 300;

const COPY_SVG = [
  '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">',
  '<rect x="5.25" y="5.25" width="8.5" height="8.5" rx="1.6" stroke="currentColor" stroke-width="1.4"/>',
  '<path d="M10.75 5.5V3.85a1.6 1.6 0 0 0-1.6-1.6H3.85a1.6 1.6 0 0 0-1.6 1.6v5.3a1.6 1.6 0 0 0 1.6 1.6h1.65" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
  '</svg>',
].join('');

/** kind：steering 座位有「补充消息」meta 段落（class 含 _meta），否则 user。 */
function kindOf(seat: HTMLElement): string {
  const first = seat.firstElementChild;
  if (first && first.tagName === 'P' && first.className && String(first.className).indexOf('meta') !== -1) return 'steering';
  return 'user';
}

/** 纯文本：克隆座位并移除我们追加的 hover-root，取其文本。 */
function seatText(seat: HTMLElement): string {
  const clone = seat.cloneNode(true) as HTMLElement;
  const ours = clone.querySelector('[data-dshcp-rewind-root]');
  if (ours) ours.remove();
  return (clone.textContent || '').replace(/\s+/g, ' ').trim();
}

function fallbackCopy(text: string): boolean {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch { return false; }
}

function writeClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    return navigator.clipboard.writeText(text).then(() => true, () => fallbackCopy(text));
  }
  return Promise.resolve(fallbackCopy(text));
}

function ensureSeat(seat: HTMLElement): void {
  if (seat.dataset.dshcpRewindSeat === '1') return;
  const key = seat.dataset.readerKey;
  if (!key) return;
  seat.setAttribute('data-chat-anchor-key', key);
  seat.setAttribute('data-chat-flow-kind', kindOf(seat));
  let root = seat.querySelector('[data-time-hover-root]');
  if (!root) {
    root = document.createElement('div');
    root.setAttribute('data-time-hover-root', '');
    root.setAttribute('data-dshcp-rewind-root', '');
    root.className = 'dshcp-rewind-reader-root';

    const actions = document.createElement('div');
    actions.className = 'dshcp-rewind-reader-actions';
    actions.setAttribute('aria-label', '消息操作');

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'dshcp-rewind-reader-action';
    copyBtn.setAttribute('aria-label', '复制');
    copyBtn.title = '复制';
    copyBtn.innerHTML = COPY_SVG;
    copyBtn.addEventListener('click', () => {
      const text = seatText(seat);
      if (!text) return;
      void writeClipboard(text);
      copyBtn.classList.add('is-copied');
      setTimeout(() => copyBtn.classList.remove('is-copied'), 900);
    });

    actions.appendChild(copyBtn);
    root.appendChild(actions);
    seat.appendChild(root);
  }
  seat.dataset.dshcpRewindSeat = '1';
}

export function apply(_ctx: any): () => void {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return () => { /* no-op */ };
  let running = true;
  const stopRoot = new Map<HTMLElement, () => void>();

  const scan = (root: HTMLElement) => {
    if (!running) return;
    try { root.querySelectorAll<HTMLElement>(SEAT_SELECTOR).forEach(ensureSeat); } catch { /* 隔离单根异常 */ }
  };

  const stopWatch = watchReaderRoots(
    root => {
      stopRoot.set(root, observeReaderRoot(root, () => scan(root), MIN_INTERVAL));
      // 座位可能先于观察器挂载（React 提交后兼容层才拿到根）：延迟补扫两次，
      // 覆盖「进入阅读页时已有历史座位」的情形，之后完全由观察器驱动。
      setTimeout(() => scan(root), 3000);
      setTimeout(() => scan(root), 10000);
    },
    root => { stopRoot.get(root)?.(); stopRoot.delete(root); },
  );

  const cleanup = () => {
    if (!running) return;
    running = false;
    stopWatch();
    for (const stop of stopRoot.values()) stop();
    stopRoot.clear();
  };
  try { console.info('[dsh-clearview:rewind-bridge] applied'); } catch { /* 忽略 */ }
  return cleanup;
}
