import React, { useRef, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { Reader } from 'fixture-source/Reader.tsx';
import { injectCompatStyles } from 'fixture-source/compat/styles.ts';
import { assistantNode, chatNode, chatOf, text, turnLocation } from '../support/chat-fixture.ts';

const failures: string[] = [];
const check = (value: unknown, message: string) => { if (!value) failures.push(message); };
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const frame = () => new Promise<number>(resolve => requestAnimationFrame(resolve));
// Existing Reader lifecycle checks use a ~3px tail budget for subpixel layout.
const TAIL_BUDGET = 3;
function store(initial: any) {
  let value = initial;
  const listeners = new Set<() => void>();
  return { get: () => value, set(next: any) { value = next; listeners.forEach(fn => fn()); },
    use(select: any, equal: any = Object.is) {
      const cache = useRef<{ has: boolean; value: any }>({ has: false, value: undefined });
      const snapshot = () => { const next = select(value); if (!cache.current.has || !equal(cache.current.value, next)) cache.current = { has: true, value: next }; return cache.current.value; };
      return useSyncExternalStore(fn => { listeners.add(fn); return () => { listeners.delete(fn); }; }, snapshot, snapshot);
    },
  };
}
const host = document.createElement('div');
document.body.removeAttribute('data-ds-dark-theme');
host.dataset.conversationScroll = '';
host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;overflow:auto;background:white;color:#222;--dsh-content-font-size:14px;--dsh-composer-height:0px';
document.body.append(host);
const root = createRoot(host);
injectCompatStyles();
const chat = store(chatOf([], []));
const session = store({ running: true, queue: [], pendingSubmissions: [], openState: 'loaded', hasMore: false, loadingOlder: false, openError: null });
const pending = store(new Map());
const preferences = store({ motion: true, expanded: {} });
const sessions = store({ byId: { 'status-fixture': { cwd: 'C:/synthetic' } }, jobsBySession: {} });
const props: any = { sessionId: 'status-fixture', useChat: chat.use, useSession: session.use, useSessionPendingInteraction: pending.use,
  useStore: preferences.use, useSessions: sessions.use, useProjection: () => undefined,
  jobsSource: { subscribe: () => () => {}, getSnapshot: () => ({ rows: {} }) }, watchJobs: () => () => {},
  actions: { setMotion: (motion: boolean) => preferences.set({ ...preferences.get(), motion }),
    setExpanded: (key: string, open: boolean) => preferences.set({ ...preferences.get(), expanded: { ...preferences.get().expanded, [key]: open } }) },
  renderSlotChain: (_name: string, _owner: any, options: any) => options.fallback,
  loadImage: async () => '', loadOlder: async () => {}, openView: () => {}, viewRequest: null, completeViewRequest: () => {},
  contextT: (key: string) => key, t: (key: string) => key };

const paragraphs = Array.from({ length: 45 }, (_, i) => `第 ${i + 1} 段。正在检查会话、整理代码并验证结果。文字不断输出，处理指示器应当保持稳定。\n\n`).join('');
const markdown = Array.from({ length: 25 }, (_, i) => `### 检查 ${i + 1}\n\n- 读取实现，检查边界。\n- 保留完整正文及动画。\n\n\`\`\`ts\nconst result = ${i};\nconsole.log(result);\n\`\`\`\n\n`).join('');
type Sample = { at: number; y: number; bottom: number; height: number; top: number; max: number; status: string; connected: boolean; following: string | undefined };
let lastSamples: Sample[] = [];
const trackEvents: Array<{ type: string; top: number; target: string }> = [];
let current: { history: any; user: any; active: any; historyTurn: any; activeTurn: any; source: string; sessionId: string };
function sample(start: number): Sample | null {
  const line = host.querySelector<HTMLElement>('[data-reader-status-line][data-phase=running]');
  if (!line) return null;
  const box = line.getBoundingClientRect();
  return { at: performance.now() - start, y: box.top, bottom: box.bottom, height: box.height, top: host.scrollTop,
    max: host.scrollHeight - host.clientHeight, status: line.textContent ?? '', connected: line.isConnected,
    following: host.querySelector<HTMLElement>('[data-dsh-clearview]')?.dataset.readerFollowing };
}
function append(value: string) {
  current.source += value;
  const node = { ...current.active, data: { ...current.active.data, blocks: [text(current.source)] } };
  flushSync(() => chat.set(chatOf([current.history, current.user, node], [current.historyTurn, current.activeTurn])));
}
async function drained(followingExpected = true) {
  let stable = 0;
  for (let i = 0; i < 250; i++) {
    const node = host.querySelector<HTMLElement>('[data-reader-turn="2"] [data-reader-text]');
    const complete = Number(node?.dataset.shownLength) === current.source.length;
    const settled = !followingExpected || host.scrollHeight - host.clientHeight - host.scrollTop <= TAIL_BUDGET;
    if (complete && settled) {
      stable++;
      if (stable >= 6) return true;
    } else stable = 0;
    await wait(20);
  }
  return false;
}
async function runCase(name: string, source: string, motion: boolean) {
  flushSync(() => root.render(null));
  const historyTurn = turnLocation({ turn: 1, steps: [0], closingStep: 0 });
  const history = assistantNode(historyTurn, 0, [text('已有正文，保留历史阅读位置。\n\n'.repeat(80))]);
  const activeTurn = turnLocation({ turn: 2, status: 'open', steps: [0], start: Date.now() });
  const user = chatNode('user', { content: [{ type: 'text', text: '检查实现' }] }, activeTurn);
  const active = { ...assistantNode(activeTurn, 0, [text('开始检查。\n\n')], 'running'), key: 'streaming-body' };
  preferences.set({ motion, expanded: {} });
  chat.set(chatOf([history, user, active], [historyTurn, activeTurn]));
  flushSync(() => root.render(<Reader {...props} sessionId={`status-${name}`} />));
  await document.fonts.ready;
  await wait(350);
  for (let i = 0; i < 100 && host.scrollTop <= 100; i++) await wait(20);
  check(!!sample(0), `${name}: running status missing`);
  check(host.scrollTop > 100, `${name}: workload did not overflow the conversation`);
  const samples: Sample[] = [];
  const started = performance.now();
  let recording = true;
  const record = () => { const value = sample(started); if (value) samples.push(value); if (recording) requestAnimationFrame(record); };
  requestAnimationFrame(record);
  // Normal paragraphs and list/code boundaries, in short bursts; no writable host session.
  const stride = 18;
  for (let i = stride; i < source.length + stride; i += stride) {
    const node = { ...active, data: { ...active.data as any, blocks: [text(source.slice(0, i))] } };
    flushSync(() => chat.set(chatOf([history, user, node], [historyTurn, activeTurn])));
    await wait(10);
  }
  current = { history, user, active, historyTurn, activeTurn, source, sessionId: `status-${name}` };
  const complete = await drained();
  check(complete, `${name}: visible text and follow did not settle`);
  recording = false;
  await frame();
  lastSamples = samples;
  const positions = samples.filter(row => row.at > 250);
  const ys = positions.map(row => row.y);
  const reversals = positions.slice(1).filter((row, i) => row.y - positions[i].y < -2).length;
  const maxStep = Math.max(0, ...positions.slice(1).map((row, i) => Math.abs(row.y - positions[i].y)));
  const range = Math.max(...ys) - Math.min(...ys);
  const tailGap = host.scrollHeight - host.clientHeight - host.scrollTop;
  check(range <= 2, `${name}: running status vertical range ${range.toFixed(2)}px exceeds 2px`);
  check(tailGap <= TAIL_BUDGET, `${name}: follow failed to finish at the bottom (${tailGap}px)`);
  const easedFrames = positions.filter(row => row.max - row.top > 2).length;
  if (motion) check(easedFrames > 0, `${name}: body scroll easing was removed`);
  return { name, motion, updates: Math.ceil(source.length / stride), samples, range, maxStep, reversals, tailGap, complete, easedFrames };
}
(window as any).runClearviewPerformance = async () => {
  const cases = [];
  for (const [name, source, motion] of [['paragraphs', paragraphs, true], ['markdown', markdown, true], ['motion-off', paragraphs, false]] as const) cases.push(await runCase(name, source, motion));
  flushSync(() => preferences.set({ ...preferences.get(), motion: true }));
  await wait(100);
  return { failures, cases };
};
(window as any).statusFollow = {
  trackControl() {
    const control = document.createElement('div'); control.id = 'track-control';
    control.style.cssText = 'position:fixed;left:0;top:0;width:180px;height:150px;overflow-y:scroll;z-index:2147483647;background:#eee;scrollbar-width:auto;scrollbar-gutter:stable';
    const child = document.createElement('div'); child.style.height = '1000px'; child.textContent = '原生滚动条输入对照'; control.append(child);
    document.body.append(control); control.scrollTop = 850;
    const rect = control.getBoundingClientRect();
    return { x: rect.right - 7, y: rect.top + 40, before: control.scrollTop };
  },
  afterControl(before: number) {
    const control = document.getElementById('track-control')!;
    const after = control.scrollTop; control.remove();
    const moved = before - after > 100;
    check(moved, 'Native scrollbar positive control must page up before exercising reader input');
    return { after, moved };
  },
  wheelPoint: () => { const r = host.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; },
  async afterWheel() {
    const pausedTop = host.scrollTop;
    const line = host.querySelector<HTMLElement>('[data-reader-status-tail]')!;
    const paused = host.querySelector<HTMLElement>('[data-dsh-clearview]')?.dataset.readerFollowing === 'false';
    const normalFlow = getComputedStyle(line).position === 'static';
    append('\n\n回看时到达的新内容，不应该拉走读者。'.repeat(12));
    const complete = await drained(false);
    const drift = Math.abs(host.scrollTop - pausedTop);
    check(paused && normalFlow && complete && drift <= 1, 'Native wheel: follow/sticky status did not release or reading position moved');
    const button = host.querySelector<HTMLElement>('[data-reader-jump]')!;
    const box = button?.getBoundingClientRect();
    const jumpPoint = box ? { x: box.left + box.width / 2, y: box.top + box.height / 2 } : null;
    const hit = !!jumpPoint && button.contains(document.elementFromPoint(jumpPoint.x, jumpPoint.y));
    check(!!box?.height && hit, 'Native wheel: resume button missing or not hittable');
    return { paused, normalFlow, complete, drift, hit, jumpPoint };
  },
  async afterJump() {
    append('\n\n恢复跟随后的新内容。'.repeat(12));
    const complete = await drained();
    const topGap = host.scrollHeight - host.clientHeight - host.scrollTop;
    const following = host.querySelector<HTMLElement>('[data-dsh-clearview]')?.dataset.readerFollowing === 'true';
    const sticky = getComputedStyle(host.querySelector<HTMLElement>('[data-reader-status-tail]')!).position === 'sticky';
    check(complete && topGap <= TAIL_BUDGET && following && sticky, 'Native resume: latest/follow/sticky status did not restore');
    return { complete, topGap, following, sticky };
  },
  async selection() {
    const target = host.querySelector<HTMLElement>('[data-reader-turn="2"] [data-reader-text]')!;
    const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
    const node = walker.nextNode()!;
    const range = document.createRange(); range.setStart(node, 0); range.setEnd(node, Math.min(5, node.textContent!.length));
    const selection = document.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    await wait(50);
    const selected = selection.toString();
    const pausedTop = host.scrollTop;
    append('\n\n选区仍需保留。'.repeat(35));
    await drained(false);
    const preserved = selection.toString() === selected && selected.length > 0;
    const drift = Math.abs(host.scrollTop - pausedTop);
    const jumpVisible = !!host.querySelector('[data-reader-jump]');
    check(preserved && drift <= 1 && jumpVisible, 'Selection guard: text/scroll protection or visible resume affordance failed');
    selection.removeAllRanges();
    return { preserved, drift, jumpVisible };
  },
  async attention() {
    host.querySelector<HTMLElement>('[data-reader-jump]')?.click();
    flushSync(() => pending.set(new Map([[current.sessionId, { kind: 'approval' }]])));
    await wait(250);
    const warning = host.querySelector<HTMLElement>('[data-reader-attention]');
    const line = host.querySelector<HTMLElement>('[data-reader-status-tail]')!;
    const released = !line.hasAttribute('data-reader-status-docked') && getComputedStyle(line).position === 'static';
    const box = warning?.getBoundingClientRect();
    const visible = !!box && box.top >= 0 && box.bottom <= innerHeight;
    check(released && visible, 'Pending attention must release the dock so its notice cannot be covered');
    flushSync(() => pending.set(new Map()));
    await wait(150);
    return { released, visible };
  },
  async viewRequest() {
    host.querySelector<HTMLElement>('[data-reader-jump]')?.click();
    const target = host.querySelector<HTMLElement>('[data-reader-turn="1"] [data-reader-key]')!;
    let completed = false;
    props.viewRequest = { view: 'reader', focus: target.dataset.readerKey };
    props.completeViewRequest = () => { completed = true; };
    flushSync(() => root.render(<Reader {...props} sessionId={current.sessionId} />));
    await wait(150);
    const pausedTop = host.scrollTop;
    append('\n\n跳转到早先正文后仍然收到新内容。'.repeat(15));
    await drained(false);
    const drift = Math.abs(host.scrollTop - pausedTop);
    const detached = host.querySelector<HTMLElement>('[data-dsh-clearview]')?.dataset.readerFollowing === 'false';
    check(completed && detached && drift <= 1, 'Explicit reader viewRequest was treated as passive layout and pulled back to the tail');
    props.viewRequest = null;
    flushSync(() => root.render(<Reader {...props} sessionId={current.sessionId} />));
    return { completed, detached, drift };
  },
  async trackPoint() {
    host.querySelector<HTMLElement>('[data-reader-jump]')?.click();
    host.id = 'status-follow-scroll-port';
    const style = document.createElement('style');
    style.textContent = '#status-follow-scroll-port { scrollbar-width: auto !important; scrollbar-gutter: stable !important; } #status-follow-scroll-port::-webkit-scrollbar { width: 16px !important; display: block !important; } #status-follow-scroll-port::-webkit-scrollbar-thumb { background: #777 !important; }';
    document.head.append(style);
    host.style.scrollbarWidth = 'auto';
    host.style.scrollbarGutter = 'stable';
    host.style.setProperty('overflow-y', 'scroll', 'important');
    host.tabIndex = -1;
    host.focus({ preventScroll: true });
    await wait(200);
    const rect = host.getBoundingClientRect();
    const gutter = host.offsetWidth - host.clientWidth - host.clientLeft * 2;
    check(gutter > 0, 'Native track: scrollbar gutter missing');
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'scroll']) host.addEventListener(type, event => trackEvents.push({ type, top: host.scrollTop, target: (event.target as HTMLElement).tagName }));
    return { x: rect.right - Math.max(2, gutter / 2), y: rect.top + rect.height * .25, gutter, top: host.scrollTop,
      scrollbar: { width: getComputedStyle(host, '::-webkit-scrollbar').width, display: getComputedStyle(host, '::-webkit-scrollbar').display,
        overflowY: getComputedStyle(host).overflowY, padding: getComputedStyle(host).padding, zoom: getComputedStyle(host).zoom,
        offsetWidth: host.offsetWidth, clientWidth: host.clientWidth, rect: rect.toJSON() } };
  },
  async afterTrack(beforeTop: number) {
    await wait(100);
    const pausedTop = host.scrollTop;
    const moved = beforeTop - pausedTop > 100;
    append('\n\n滚动条轨道上翻页后继续收到新内容。'.repeat(15));
    const complete = await drained(false);
    const drift = Math.abs(host.scrollTop - pausedTop);
    const detached = host.querySelector<HTMLElement>('[data-dsh-clearview]')?.dataset.readerFollowing === 'false';
    check(moved && complete && detached && drift <= 1, 'Native scrollbar track: page-up must detach and retain reading position through growth');
    return { moved, complete, detached, drift, beforeTop, pausedTop, events: trackEvents };
  },
  dragPoints() {
    const rect = host.getBoundingClientRect();
    const gutter = host.offsetWidth - host.clientWidth - host.clientLeft * 2;
    const track = host.clientHeight - 2 * gutter;
    const thumb = Math.max(20, track * host.clientHeight / host.scrollHeight);
    const travel = track - thumb;
    const x = rect.right - gutter / 2;
    return { x, from: rect.top + gutter + thumb / 2 + travel * host.scrollTop / (host.scrollHeight - host.clientHeight),
      to: rect.top + gutter + thumb / 2 + travel, beforeTop: host.scrollTop, max: host.scrollHeight - host.clientHeight };
  },
  async afterDrag() {
    await wait(200);
    const beforeGrowth = { top: host.scrollTop, max: host.scrollHeight - host.clientHeight,
      following: host.querySelector<HTMLElement>('[data-dsh-clearview]')?.dataset.readerFollowing };
    append('\n\n向下拖动滚动条回到底部后，应继续跟随。'.repeat(10));
    const complete = await drained();
    const following = host.querySelector<HTMLElement>('[data-dsh-clearview]')?.dataset.readerFollowing === 'true';
    const tailGap = host.scrollHeight - host.clientHeight - host.scrollTop;
    check(following && complete && tailGap <= TAIL_BUDGET, 'Native scrollbar drag to bottom must resume follow through subsequent growth');
    return { following, complete, tailGap, beforeGrowth, events: trackEvents };
  },
  async latestTurn() {
    host.querySelector<HTMLElement>('[data-reader-jump]')?.click();
    const laterTurn = turnLocation({ turn: 3, steps: [0], closingStep: 0 });
    const later = assistantNode(laterTurn, 0, [text('后续轮次正文应保持可见。\n\n'.repeat(8))]);
    const active = { ...current.active, data: { ...current.active.data, blocks: [text(current.source)] } };
    flushSync(() => chat.set(chatOf([current.history, current.user, active, later], [current.historyTurn, current.activeTurn, laterTurn])));
    await wait(200);
    const line = host.querySelector<HTMLElement>('[data-reader-turn="2"] [data-reader-status-tail]')!;
    const released = !line.hasAttribute('data-reader-status-docked') && getComputedStyle(line).position === 'static';
    check(released, 'Only the latest turn may dock its running tail; earlier open turns must remain in flow');
    append('');
    await drained();
    return { released };
  },
};
(window as any).prepareClearviewScreenshot = async (theme: string) => {
  host.querySelector<HTMLElement>('[data-reader-jump]')?.click();
  document.body.toggleAttribute('data-ds-dark-theme', theme === 'dark');
  host.style.background = theme === 'dark' ? '#141413' : 'white';
  await wait(100);
  const line = host.querySelector<HTMLElement>('[data-reader-status-tail]')!;
  const style = getComputedStyle(line);
  const reader = host.querySelector<HTMLElement>('[data-dsh-clearview]')!;
  return { theme, samples: lastSamples.length, status: sample(0), overflow: host.scrollWidth - host.clientWidth,
    docked: line.hasAttribute('data-reader-status-docked'), background: style.backgroundColor, surface: getComputedStyle(host).backgroundColor,
    shadow: style.boxShadow, readerBackground: getComputedStyle(reader).backgroundColor };
};
(window as any).clearviewPerformanceFailures = () => failures;
