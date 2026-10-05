/**
 * 阅读视图根观察者与 fiber 快照缓存（compat 三模块共用）。
 *
 * 背景（性能）：compat 层原有三个 `MutationObserver` 都挂在 `document.body` 上做
 * `childList + subtree` 全树观察。阅读视图流式渲染时每个 chunk 都会插入/替换文本
 * 节点，观察者回调因此每帧触发多次；三个回调各自再用 `[class*="_sep"]` 之类子串
 * 选择器全树扫描、并对每个轮次读 `offsetHeight`（强制布局），代价随会话长度线性增长
 * ——这正是「处于插件视图时 CPU 明显升高」的主要来源之一。
 *
 * 本模块把观察范围收窄到阅读视图根元素本身：三个模块真正要处理的 DOM 变化（轮统计
 * 行插入、收尾步骤探测、用户座位补齐）全部发生在 `[data-dsh-clearview]` 子树内；
 * 根不存在（未进阅读视图）时不观察、不做任何工作——阅读视图不可见时插件的兼容层
 * 应当是零成本的。子树观察器随根元素出现/消失自动挂载/卸载（React 切页时根被卸载）。
 *
 * 根元素的「出现/消失」发现：阅读根不是 body 的直接子节点——会话视图切换时 React
 * 在深层容器里挂载/卸载它。若只观察 body 的 `childList`（无 subtree），运行中切换
 * 到阅读视图的根永远发现不了（rewind 桥/统计行/收尾防吞随之整段失效）。但也不能在
 * body 上做全树观察：阅读流式渲染的每个 chunk 都在根子树里产生 childList 变化，会
 * 以每帧数次触发根扫描。因此根发现交给阅读器组件本身：Reader 挂载/卸载根时广播
 * `dsh-clearview:compat-reader-mount` / `-unmount` 自定义事件，`watchReaderRoots`
 * 只监听事件 + 启动时补扫一次已存在的根（兼容层晚于阅读根挂载时）。body 的直接
 * 子级 childList 观察仅作兜底（portal 直挂 body 等罕见情形），不做 subtree，流式
 * 期间零成本。
 *
 * `resolveSnapshot` 的 fiber 上溯（最多 300 层 × 每层 300 个 hook）结果按根元素缓存，
 * 并在缓存命中时跳过整棵上溯；TTL 只作为兜底，快照引用变化立即失效。
 */

/** Reader 组件在阅读根挂载/卸载时广播的事件（detail = 根元素）。 */
export const READER_COMPAT_MOUNT_EVENT = 'dsh-clearview:compat-reader-mount';
/** Reader 组件在阅读根挂载/卸载时广播的事件（detail = 根元素）。 */
export const READER_COMPAT_UNMOUNT_EVENT = 'dsh-clearview:compat-reader-unmount';

export const READER_ROOT_SELECTOR = '[data-dsh-clearview]';

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

/** 从阅读视图根元素上溯 React fiber，读取祖先 hook 里的会话快照（纯读取）。 */
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
const snapshotReaders = new WeakMap<HTMLElement, () => unknown>();

export function registerReaderSnapshot(root: HTMLElement, read: () => unknown): () => void {
  snapshotReaders.set(root, read);
  return () => { if (snapshotReaders.get(root) === read) snapshotReaders.delete(root); snapCache.delete(root); };
}
const SNAP_TTL = 5000;

/**
 * 缓存的 fiber 快照：同一根元素上 5s 内复用上一次的上溯结果（fiber 上溯最坏
 * 300 层 × 300 个 hook，是全树扫描之外最贵的一步）。会话快照本身在每次 store
 * 更新时都会换引用，但上溯结果仍指向同一批会话对象，5s 窗口足以覆盖一帧的所有
 * 消费者，也不会让「切会话后根元素复用」读到陈旧数据（根卸载时缓存随 WeakMap
 * 一并失效）。
 */
export function cachedSnapshot(root: HTMLElement): SnapshotView | null {
  const read = snapshotReaders.get(root);
  if (read) return normalizeSnapshot(read());
  const cached = snapCache.get(root);
  const now = Date.now();
  if (cached && now - cached.at < SNAP_TTL) return cached.snap;
  const snap = resolveSnapshot(root);
  snapCache.set(root, { snap, at: now });
  return snap;
}

/** 阅读视图根出现/消失时回调（每根一次）。返回清理函数。 */
export function watchReaderRoots(
  onAppear: (root: HTMLElement) => void,
  onDisappear?: (root: HTMLElement) => void,
): () => void {
  const live = new Set<HTMLElement>();
  const add = (root: HTMLElement) => {
    if (!(root instanceof HTMLElement) || live.has(root)) return;
    live.add(root);
    try { onAppear(root); } catch { /* 单个回调失败不阻塞其余根的发现 */ }
  };
  const remove = (root: HTMLElement) => {
    if (!live.has(root)) return;
    live.delete(root);
    try { onDisappear?.(root); } catch { /* 同上 */ }
  };
  // Reader 组件在挂载/卸载阅读根时广播事件（见 Reader.tsx）；这是运行中切换
  // 阅读视图时唯一的可靠发现通道（根深挂在会话容器里，body childList 看不到）。
  const onMount = (event: Event) => { add((event as CustomEvent<HTMLElement>).detail); };
  const onUnmount = (event: Event) => { remove((event as CustomEvent<HTMLElement>).detail); };
  // 兜底 1：兼容层启动时阅读根可能已存在（apply 晚于 Reader 挂载）。
  // 同步也做差集回收：没有收到 -unmount 事件就被整体卸载的根（例如会话面板
  // 直接销毁、没有走 Reader 的 effect 清理）在此被移除，观察器不会泄漏。
  const sync = () => {
    const current = document.querySelectorAll<HTMLElement>(READER_ROOT_SELECTOR);
    const seen = new Set<HTMLElement>();
    for (let index = 0; index < current.length; index++) { const root = current[index]!; seen.add(root); add(root); }
    for (const root of [...live]) if (!seen.has(root)) remove(root);
  };
  sync();
  document.addEventListener(READER_COMPAT_MOUNT_EVENT, onMount);
  document.addEventListener(READER_COMPAT_UNMOUNT_EVENT, onUnmount);
  // 兜底 2：观察 body 直接子级的增删（portal 直挂 body 等罕见情形）。不做
  // subtree：阅读流式渲染的 chunk 变化都在根子树里，交给 observeReaderRoot。
  const observer = new MutationObserver(sync);
  observer.observe(document.body, { childList: true });
  return () => {
    observer.disconnect();
    document.removeEventListener(READER_COMPAT_MOUNT_EVENT, onMount);
    document.removeEventListener(READER_COMPAT_UNMOUNT_EVENT, onUnmount);
    live.clear();
  };
}

/**
 * 观察一个阅读视图根内部的 childList 变化，rAF 合帧 + 节流后执行 `work`。
 * 与原来 body 级观察的语义一致，只是把范围收窄到根子树。
 */
export function observeReaderRoot(root: HTMLElement, work: () => void, minInterval = 300): () => void {
  let scheduled = false;
  let lastRun = 0;
  let trailing: ReturnType<typeof setTimeout> | 0 = 0;
  const run = () => { lastRun = Date.now(); work(); };
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      const wait = minInterval - (Date.now() - lastRun);
      if (wait > 0) { if (!trailing) trailing = setTimeout(() => { trailing = 0; run(); }, wait); }
      else run();
    });
  };
  const observer = new MutationObserver(schedule);
  observer.observe(root, { childList: true, subtree: true });
  run();
  return () => { observer.disconnect(); if (trailing) clearTimeout(trailing); };
}
