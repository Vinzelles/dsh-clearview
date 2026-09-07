/**
 * 阅读视图补回「轮次统计行」（原 patcher reader-turn-metrics-footer.js 内聚）。
 *
 * 原生「对话」视图每轮结束后的收尾行展示轮次统计（0.1.1 hover 文案「时间 · 用时 ·
 * 首 token · tok/s」；0.1.2 改为「用量 N tok」「用时」两个统计 pill + 明细弹层）。
 * 阅读视图接管渲染后 MainNode 对 turn-tail 节点直接 return null——整行消失。
 * 本模块从阅读视图根元素上溯 React fiber 读取 hook 状态里的会话快照（纯读取，不写
 * 业务数据；fiber 不可用时静默无效），对每个 closed 且有 turn-tail.closing 的轮次
 * section 追加 .dshcp-turn-footer，hover/focus 淡入（样式见 compat）。格式对齐原生。
 *
 * 快照解析跨版本归一（normalizeSnapshot）：
 *   0.1.1  ConversationRoot 的 useSession(s=>s) 状态即完整快照（chat 内嵌，
 *          turnTimings 顶层）；
 *   0.1.2  session 快照瘦身，chat 移到独立的 useChat 钩子（顶层 nodes/timeline，
 *          turnTimings 退到 legacy 兼容切片）——旧的「v.chat.nodes」判定在 0.1.2
 *          上命中不了任何钩子状态，这正是 0.1.9 后统计行失效的根因。
 * token 用量是 0.1.2 turn-tail 数据新增的 tokenUsage 载荷（聚合各次模型尝试的
 * 精确计数），0.1.1 没有该字段——按特性检测插入「用量 N tok」，两版通用。
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
/** 原生 formatTokens 的紧凑计量：<1k 原值，<1M 一位小数 K，其余一位小数 M。 */
export function fmtCompactTokens(value: number): string {
  const scaled = (v: number) => v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10);
  if (value < 1e3) return String(Math.round(value));
  if (value < 1e6) return `${scaled(value / 1e3)}K`;
  return `${scaled(value / 1e6)}M`;
}

/** 归一化后的快照读取面：两种版本形态都收敛到 chat（nodes/timeline）+ turnTimings。 */
export interface SnapshotView {
  chat: {
    timeline: { turns: Map<number, any> };
    nodes: { get(key: string): any };
  };
  turnTimings?: Map<number, { startTime: number; endTime?: number }> | null;
}

/**
 * 把一个 hook 状态归一成 SnapshotView，形状不符返回 null：
 * 0.1.1 完整 session 快照（chat 内嵌，turnTimings 顶层）；0.1.2 chat 快照本体
 * （nodes/timeline 顶层，turnTimings 在 legacy 兼容切片里）。session 瘦身后的
 * 0.1.2 session 切片（无 chat 无 nodes）两种形态都不匹配，安全跳过。
 */
export function normalizeSnapshot(v: unknown): SnapshotView | null {
  if (!v || typeof v !== 'object') return null;
  const rec = v as Record<string, unknown>;
  const chat = (rec.chat ?? rec) as Record<string, unknown> | null | undefined;
  if (!chat || typeof chat !== 'object') return null;
  const nodes = chat.nodes as { get?: unknown } | undefined;
  const timeline = chat.timeline as { turns?: unknown } | undefined;
  if (!nodes || typeof nodes.get !== 'function') return null;
  const turns = timeline?.turns as { get?: unknown } | undefined;
  if (!turns || typeof turns.get !== 'function') return null;
  const legacy = chat.legacy as { turnTimings?: unknown } | undefined;
  const turnTimings = (rec.turnTimings ?? legacy?.turnTimings) as SnapshotView['turnTimings'];
  return { chat: chat as SnapshotView['chat'], turnTimings: turnTimings ?? undefined };
}

/**
 * 一个轮次的统计文本：时钟 · 用时 · 用量 · 首 token · tok/s（至少两项才成行）。
 * 用量与首 token/tok/s 均按字段存在性插入，0.1.1（无 tokenUsage）与 0.1.2 通用。
 */
export function footerTextForTurn(snap: SnapshotView, turnNum: number): string | null {
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
  if (runMs == null && turn.start && turn.end
    && typeof turn.start.time === 'number' && isFinite(turn.start.time)
    && typeof turn.end.time === 'number' && isFinite(turn.end.time)) {
    runMs = turn.end.time - turn.start.time;
  }
  if (runMs != null && isFinite(runMs)) parts.push(`用时 ${fmtRun(runMs)}`);
  const usage = tail.tokenUsage as { totalTokens?: unknown } | undefined;
  if (usage && typeof usage.totalTokens === 'number' && isFinite(usage.totalTokens) && usage.totalTokens > 0) {
    parts.push(`用量 ${fmtCompactTokens(usage.totalTokens)} tok`);
  }
  if (typeof tail.ttftMs === 'number') parts.push(`首 token ${fmtLatencySeconds(tail.ttftMs)}秒`);
  if (typeof tail.tokensPerSecond === 'number') parts.push(`${fmtTokensPerSecond(tail.tokensPerSecond)} tok/s`);
  return parts.length >= 2 ? parts.join(' · ') : null;
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
  if (c && now - c.at < SNAP_TTL) return c.snap;
  const snap = resolveSnapshot(root);
  snapCache.set(root, { snap, at: now });
  return snap;
}

function upsertFooters(root: HTMLElement, snap: SnapshotView | null): void {
  if (!snap) return;
  const sections = Array.prototype.slice.call(root.querySelectorAll('section[data-reader-turn]')) as HTMLElement[];
  for (const section of sections) {
    const closed = section.getAttribute('data-reader-turn-state') === 'closed';
    if (closed && section.dataset.dshcpFooterDone === '1') continue; // 静态文本已渲染
    let el = section.querySelector('.' + FOOTER_CLASS) as HTMLElement | null;
    const turnNum = Number(section.getAttribute('data-reader-turn'));
    let text: string | null = null;
    try { text = isFinite(turnNum) ? footerTextForTurn(snap, turnNum) : null; } catch { text = null; }
    if (text == null) { if (el) el.remove(); continue; }
    // The footer deliberately lives inside the answer's actions row, next to
    // the copy button — that is the native "时间 · 用时" seat. When the row is
    // absent the section fallback keeps it on screen (copy-row absence is
    // itself a bug the reader fixes separately: CopyAnswer must render on the
    // last body segment, even when the step ends with a trailing think).
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
      try { upsertFooters(root, cachedSnapshot(root)); } catch { /* 单根失败忽略 */ }
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
