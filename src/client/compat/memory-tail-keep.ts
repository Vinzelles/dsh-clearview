/**
 * 防止轮次收尾总结被自动折叠吞掉（原 patcher reader-memory-tail-keep.js 内聚）。
 *
 * 问题：环境装有 memory-evolve 类记忆插件时，每轮结束前模型追加 memory/dtodo 工具
 * 调用，结果后常多出一个很短的「确认」步骤。阅读视图在轮次 closed+completed 后默认
 * 收起「执行过程」，只保留 turn-tail 认定的最终答案（最后一个含文本步骤）可见——当
 * 该步骤恰是收尾确认时，真正的总结（含 memory 工具调用的前一步）被当作过程叙述收起。
 *
 * 判定（依据会话快照实时数据，不看 DOM 猜）：只处理可见窗口里最近一个 closed+completed
 * 轮次；若 closing 之前存在步骤 s：s 含 memory/dtodo/skill_manage 工具调用、s 可见文本
 * ≥40 字、且 closing 比 s 短 → 判定「答案被收尾确认顶掉」→ 点击插件 Disclosure 展开该轮
 * 执行过程（走其 React 状态并持久化）。
 *
 * 数据通道：从阅读视图根元素上溯 React fiber 读取祖先组件 hook 中的会话快照（纯读取）。
 * 快照解析复用轮统计行的 normalizeSnapshot 双形态归一：0.1.1 命中 session 完整快照
 * （chat 内嵌）；0.1.2 session 瘦身后命中 useChat 快照本体（nodes/timeline 顶层）。
 * 旧的 v.chat.* 判定在 0.1.2 上命中不了任何钩子状态，本模块会静默失效（0.1.14 修复）。
 *
 * 性能纪律：fiber 快照 WeakMap + 5s TTL 缓存；每轮次判定一次后打 dataset 标记跳过；
 * 观察者 rAF 合帧 + 300ms 节流。
 * 幂等/边界：展开后不再触碰；用户手动点过该轮过程按钮后永久让位；不触碰原生视图。
 */

import { normalizeSnapshot, type SnapshotView } from './turn-metrics-footer.js';

const HOUSEKEEPING: Record<string, 1> = {
  memory: 1, memory_suggest: 1, memory_review_status: 1,
  dtodo: 1, skill_manage: 1,
};
const MIN_SUMMARY_CHARS = 40;
const SNAP_TTL = 5000;
const MIN_INTERVAL = 300;

function textLength(blocks: any): number {
  if (!blocks) return 0;
  let n = 0;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b && b.kind === 'text' && typeof b.text === 'string') n += b.text.length;
  }
  return n;
}

function resolveSnapshot(root: HTMLElement): SnapshotView | null {
  const keys = Object.keys(root);
  let fiberKey: string | null = null;
  for (const k of keys) { if (k.indexOf('__reactFiber$') === 0) { fiberKey = k; break; } }
  if (!fiberKey) return null;
  let f: any = (root as any)[fiberKey];
  let hops = 0;
  while (f && hops < 300) {
    if (f.tag === 0 || f.tag === 1 || f.tag === 2) {
      let hook = f.memoizedState;
      let guard = 0;
      while (hook && guard < 300) {
        const normalized = normalizeSnapshot(hook.memoizedState);
        if (normalized) return normalized;
        hook = hook.next;
        guard++;
      }
    }
    f = f.return;
    hops++;
  }
  return null;
}

const snapCache = new WeakMap<HTMLElement, { snap: SnapshotView | null; at: number }>();
function cachedSnapshot(root: HTMLElement): SnapshotView | null {
  const c = snapCache.get(root);
  const now = Date.now();
  if (c && c.snap && now - c.at < SNAP_TTL) return c.snap;
  const snap = resolveSnapshot(root);
  snapCache.set(root, { snap, at: now });
  return snap;
}

function isMemoryTailTurn(turn: any, closing: any): boolean {
  const closingLen = textLength(closing.blocks);
  const steps = turn.steps || [];
  let hiddenLen = -1;
  for (let i = 0; i < steps.length; i++) {
    const st = steps[i];
    if (!st || st.step >= closing.step) continue;
    const ad = st.data ? st.data.get('assistant-step') : null;
    if (!ad || !ad.blocks) continue;
    let housekeeping = false;
    for (let j = 0; j < ad.blocks.length; j++) {
      const b = ad.blocks[j];
      if (b && b.kind === 'tool-call' && HOUSEKEEPING[b.name]) { housekeeping = true; break; }
    }
    if (housekeeping) {
      const len = textLength(ad.blocks);
      if (len > hiddenLen) hiddenLen = len;
    }
  }
  return hiddenLen >= MIN_SUMMARY_CHARS && closingLen < hiddenLen;
}

function sectionKey(section: HTMLElement, closing: any): string {
  return `${section.getAttribute('data-reader-turn')}:${closing ? closing.step : '?'}`;
}

export function apply(_ctx: any): () => void {
  let timer: ReturnType<typeof setInterval> | null = null;
  let observer: MutationObserver | null = null;
  let scheduled = false;
  let running = true;
  let lastRun = 0;
  let trailing: ReturnType<typeof setTimeout> | 0 = 0;
  let syntheticClick = false;
  const currentUserDecided: Record<string, boolean> = {}; // 用户点过过程按钮 → 永久让位

  function ensureUserClickListener(section: HTMLElement, key: string): void {
    if ((section as any).__dshcpTailKeepBound) return;
    (section as any).__dshcpTailKeepBound = true;
    const disc = section.querySelector('[data-reader-disclosure]');
    if (!disc) return;
    const btn = disc.querySelector('button') as HTMLButtonElement | null;
    if (!btn || typeof btn.addEventListener !== 'function') return;
    btn.addEventListener('click', () => {
      if (syntheticClick) { syntheticClick = false; return; }
      currentUserDecided[key] = true;
    });
  }

  function handle(root: HTMLElement, snap: any): void {
    const sections = Array.prototype.slice.call(root.querySelectorAll('section[data-reader-turn]')) as HTMLElement[];
    let candidate: HTMLElement | null = null; // DOM 顺序 = 会话顺序 → 最后一个未判定的 closed+completed
    for (const s of sections) {
      if (s.dataset.dshcpTailChecked === '1') continue;
      if (s.getAttribute('data-reader-turn-state') === 'closed' && s.getAttribute('data-reader-turn-result') === 'completed') candidate = s;
    }
    if (!candidate) return;
    const turnNum = Number(candidate.getAttribute('data-reader-turn'));
    if (!isFinite(turnNum)) { candidate.dataset.dshcpTailChecked = '1'; return; }
    const turn = snap.chat.timeline.turns.get(turnNum);
    if (!turn || !turn.data) return; // 快照未含该轮 → 下 tick 重试
    const tail = turn.data.get('turn-tail');
    const closing = tail && tail.closing;
    if (!closing) return; // turn-tail 未就绪 → 重试
    const key = sectionKey(candidate, closing);
    if (currentUserDecided[key]) { candidate.dataset.dshcpTailChecked = '1'; return; }
    if (!isMemoryTailTurn(turn, closing)) { candidate.dataset.dshcpTailChecked = '1'; return; }
    ensureUserClickListener(candidate, key);
    const disc = candidate.querySelector('[data-reader-disclosure]');
    if (!disc) return; // Disclosure 未渲染 → 重试
    if (disc.getAttribute('data-expanded') !== 'false') { candidate.dataset.dshcpTailChecked = '1'; return; } // 已展开 → 完成
    const btn = disc.querySelector('button') as HTMLButtonElement | null;
    if (!btn) return;
    syntheticClick = true;
    try { btn.click(); } catch { /* 忽略 */ }
    syntheticClick = false;
    candidate.dataset.dshcpTailChecked = '1';
  }

  const work = () => {
    if (!running) return;
    lastRun = Date.now();
    const roots = Array.prototype.slice.call(document.querySelectorAll('[data-dsh-clearview]')) as HTMLElement[];
    for (const root of roots) {
      try { const snap = cachedSnapshot(root); if (snap) handle(root, snap); } catch { /* 单根失败忽略 */ }
    }
  };
  const schedule = () => {
    if (!running || scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      if (!running) return;
      const wait = MIN_INTERVAL - (Date.now() - lastRun);
      if (wait > 0) { if (!trailing) trailing = setTimeout(() => { trailing = 0; work(); }, wait); }
      else work();
    });
  };
  const startObserver = () => {
    if (observer || !running) return;
    observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
  };
  work();
  timer = setInterval(() => {
    if (!document.querySelector('[data-dsh-clearview]')) { work(); return; }
    startObserver();
    if (timer) { clearInterval(timer); timer = null; }
  }, 1500);

  const cleanup = () => {
    if (!running) return;
    running = false;
    if (timer) { clearInterval(timer); timer = null; }
    if (trailing) clearTimeout(trailing);
    if (observer) observer.disconnect();
  };
  try { console.info('[dsh-clearview:memory-tail-keep] applied'); } catch { /* 忽略 */ }
  return cleanup;
}
