/**
 * 阅读视图补回「轮次统计行」（原 patcher reader-turn-metrics-footer.js 内聚）。
 *
 * 原生「对话」视图每轮结束后的 turn-tail 行 hover 显示「时间 · 用时 · 首 token ·
 * tok/s」。阅读视图接管渲染后 MainNode 对 turn-tail 节点直接 return null——整行消失。
 * 本模块从阅读视图根元素上溯 React fiber 读取祖先组件（ConversationRoot 的
 * useSession(s=>s)）hook 中的会话快照（纯读取，不写业务数据；fiber 不可用时静默无效），
 * 对每个 closed 且有 turn-tail.closing 的轮次 section 追加 .dshcp-turn-footer，
 * hover/focus 淡入（样式见 compat）。格式与原生 message-chrome.ts 一致。
 *
 * 性能纪律：fiber 快照按根 WeakMap + 5s TTL 缓存（每 tick 不再全树遍历）；closed
 * 轮统计文本静态，渲染成功后打 dataset 标记后续跳过（只进行中轮每 tick 刷新）；
 * 扫描 rAF 合帧 + 300ms 节流。
 */

const FOOTER_CLASS = 'dshcp-turn-footer';
const SNAP_TTL = 5000;
const MIN_INTERVAL = 300;

function pad2(n: number): string { return (n < 10 ? '0' : '') + n; }

function fmtClock(time: number): string | null {
  if (typeof time !== 'number' || !isFinite(time)) return null;
  const d = new Date(time);
  const n = new Date();
  const clock = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  if (d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate()) return clock;
  const date = d.getFullYear() === n.getFullYear()
    ? `${d.getMonth() + 1}月${d.getDate()}日`
    : `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  return `${date} ${clock}`;
}
function fmtRun(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}分${pad2(s)}秒` : `${s}秒`;
}
function fmtLatencySeconds(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  return s < 10 ? String(Math.round(s * 10) / 10) : String(Math.round(s));
}
function fmtTokensPerSecond(tps: number): string {
  const c = Math.max(0, tps);
  return c >= 10 ? String(Math.round(c)) : String(Math.round(c * 10) / 10);
}

function isSessionSnapshot(v: any): boolean {
  return v && typeof v === 'object'
    && v.chat && typeof v.chat === 'object'
    && v.chat.nodes && typeof v.chat.nodes.get === 'function'
    && v.chat.timeline && typeof v.chat.timeline.turns === 'object'
    && typeof v.chat.timeline.turns.get === 'function';
}

function resolveSnapshot(root: HTMLElement): any {
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
        if (isSessionSnapshot(hook.memoizedState)) return hook.memoizedState;
        hook = hook.next;
        guard++;
      }
    }
    f = f.return;
    hops++;
  }
  return null;
}

const snapCache = new WeakMap<HTMLElement, { snap: any; at: number }>();
function cachedSnapshot(root: HTMLElement): any {
  const c = snapCache.get(root);
  const now = Date.now();
  if (c && c.snap && now - c.at < SNAP_TTL) return c.snap;
  const snap = resolveSnapshot(root);
  snapCache.set(root, { snap, at: now });
  return snap;
}

function footerText(section: HTMLElement, snap: any): string | null {
  const turnNum = Number(section.getAttribute('data-reader-turn'));
  if (!isFinite(turnNum)) return null;
  const turn = snap.chat.timeline.turns.get(turnNum);
  if (!turn || turn.status !== 'closed' || !turn.data) return null;
  const tail = turn.data.get('turn-tail');
  if (!tail || !tail.closing) return null;
  const parts: string[] = [];
  const clock = fmtClock(tail.closing.time);
  if (clock) parts.push(clock);
  let runMs: number | null = null;
  try {
    const tt = snap.turnTimings ? snap.turnTimings.get(turnNum) : null;
    if (tt && tt.startTime != null && tt.endTime != null) runMs = tt.endTime - tt.startTime;
  } catch { /* 形状异常跳过 */ }
  if (runMs == null && turn.start && turn.end && typeof turn.start.time === 'number' && typeof turn.end.time === 'number') {
    runMs = turn.end.time - turn.start.time;
  }
  if (runMs != null) parts.push(`用时 ${fmtRun(runMs)}`);
  if (typeof tail.ttftMs === 'number') parts.push(`首 token ${fmtLatencySeconds(tail.ttftMs)}秒`);
  if (typeof tail.tokensPerSecond === 'number') parts.push(`${fmtTokensPerSecond(tail.tokensPerSecond)} tok/s`);
  return parts.length >= 2 ? parts.join(' · ') : null;
}

function upsertFooters(root: HTMLElement, snap: any): void {
  const sections = Array.prototype.slice.call(root.querySelectorAll('section[data-reader-turn]')) as HTMLElement[];
  for (const section of sections) {
    const closed = section.getAttribute('data-reader-turn-state') === 'closed';
    if (closed && section.dataset.dshcpFooterDone === '1') continue; // 静态文本已渲染
    let el = section.querySelector('.' + FOOTER_CLASS) as HTMLElement | null;
    let text: string | null = null;
    try { text = footerText(section, snap); } catch { text = null; }
    if (text == null) { if (el) el.remove(); continue; }
    const hosts = section.querySelectorAll('[class*="answerActions"]');
    const host = hosts.length ? hosts[hosts.length - 1] : section;
    if (!el) {
      el = document.createElement('span');
      el.className = FOOTER_CLASS;
      host.appendChild(el);
    } else if (el.parentNode !== host) {
      host.appendChild(el); // 迁移：answerActions 行重建或轮次状态变化
    }
    if (el.textContent !== text) el.textContent = text;
    if (closed) section.dataset.dshcpFooterDone = '1';
  }
}

export function apply(_ctx: any): () => void {
  let timer: ReturnType<typeof setInterval> | null = null;
  let observer: MutationObserver | null = null;
  let scheduled = false;
  let running = true;
  let lastRun = 0;
  let trailing: ReturnType<typeof setTimeout> | 0 = 0;

  const work = () => {
    if (!running) return;
    lastRun = Date.now();
    const roots = Array.prototype.slice.call(document.querySelectorAll('[data-dsh-clearview]')) as HTMLElement[];
    for (const root of roots) {
      try { const snap = cachedSnapshot(root); if (snap) upsertFooters(root, snap); } catch { /* 单根失败忽略 */ }
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
  try { console.info('[dsh-clearview:turn-metrics-footer] applied'); } catch { /* 忽略 */ }
  return cleanup;
}
