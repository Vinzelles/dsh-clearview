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
const sessions = store({ byId: { 'scroll-fixture': { cwd: 'C:/synthetic' } }, jobsBySession: {} });
const props: any = { sessionId: 'scroll-fixture', useChat: chat.use, useSession: session.use, useSessionPendingInteraction: pending.use,
  useStore: preferences.use, useSessions: sessions.use, useProjection: () => undefined,
  jobsSource: { subscribe: () => () => {}, getSnapshot: () => ({ rows: {} }) }, watchJobs: () => () => {},
  actions: { setMotion: (motion: boolean) => preferences.set({ ...preferences.get(), motion }),
    setExpanded: (key: string, open: boolean) => preferences.set({ ...preferences.get(), expanded: { ...preferences.get().expanded, [key]: open } }) },
  renderSlotChain: (_name: string, _owner: any, options: any) => options.fallback,
  loadImage: async () => '', loadOlder: async () => {}, openView: () => {}, viewRequest: null, completeViewRequest: () => {},
  contextT: (key: string) => key, t: (key: string) => key };

let toolCount = 0;
let seed: any = null;
function toolBlock(index: number, settled = false) {
  return { kind: 'tool-call', callId: `probe-call-${index}`, call: { name: 'read_file', argsRaw: JSON.stringify({ path: `src/probe-${index}.ts` }) },
    ...(settled ? { content: [{ type: 'text', text: '文件内容已读取。' }], isError: false, time: Date.now() } : { content: [] }),
    callTime: Date.now() - 100, subCalls: [] };
}
function publish() {
  const { history, user, active, historyTurn, activeTurn } = seed;
  flushSync(() => chat.set(chatOf([history, user, active, ...seed.tools], [historyTurn, activeTurn])));
}
function addTool(settled = false) {
  const index = toolCount++;
  const node = chatNode('tool-call', { root: toolBlock(index, settled) }, seed.activeTurn, 0);
  seed.tools.push(node);
  publish();
  return node.key;
}
function makeSeed(initialTools: number) {
  const historyTurn = turnLocation({ turn: 1, steps: [0], closingStep: 0 });
  const history = assistantNode(historyTurn, 0, [text(Array.from({ length: 40 }, (_, i) => `第 ${i + 1} 段历史正文，用于让会话本身可以滚动。`).join('\n\n'))]);
  const activeTurn = turnLocation({ turn: 2, status: 'open', steps: [0], start: Date.now() });
  const user = chatNode('user', { content: [{ type: 'text', text: '请执行一长串操作并保持最新结果可见。' }] }, activeTurn);
  const data = { turn: 2, step: 0, status: 'running', time: Date.now(), blocks: [{ kind: 'text', text: '开始执行批量操作。' }] };
  activeTurn.steps[0].data.set('assistant-step', data);
  const active = assistantNode(activeTurn, 0, data.blocks, 'running');
  const value = { history, user, active, historyTurn, activeTurn, tools: [] as any[] };
  seed = value;
  toolCount = 0;
  publish();
  for (let i = 0; i < initialTools; i++) addTool(i % 3 === 0);
  return value;
}

// Heavy-mode seed: enough closed turns for the perf guard's off-screen (content-visibility) path,
// plus a running batch whose answer text keeps growing — the closest model of a long real session.
let heavy: any = null;
function publishHeavy() {
  const { nodes, turns, tools } = heavy;
  flushSync(() => chat.set(chatOf([...nodes, ...tools], turns)));
}
function makeHeavySeed(historyTurns: number, initialTools: number) {
  const nodes: any[] = [];
  const turns: any[] = [];
  for (let i = 1; i <= historyTurns; i++) {
    const turn = turnLocation({ turn: i, steps: [0], closingStep: 0 });
    nodes.push(assistantNode(turn, 0, [text(Array.from({ length: 30 }, (_, k) => `第 ${i} 轮第 ${k + 1} 段历史正文，用于让会话超过离屏阈值并保持可读。`).join('\n\n'))]));
    turns.push(turn);
  }
  const activeTurn = turnLocation({ turn: historyTurns + 1, status: 'open', steps: [0], start: Date.now() });
  // The step payload is what marks the turn live: without it the batch renders as settled and
  // folds, so the body would never be a scroll region (and the probe would measure nothing).
  activeTurn.steps[0].data.set('assistant-step', { turn: historyTurns + 1, step: 0, status: 'running', time: Date.now(), blocks: [{ kind: 'text', text: '开始执行批量操作。' }] });
  nodes.push(chatNode('user', { content: [{ type: 'text', text: '请持续执行并保持最新输出可见。' }] }, activeTurn));
  nodes.push(assistantNode(activeTurn, 0, [text('开始执行批量操作。')], 'running'));
  // The active turn must join the timeline too, or its nodes never render as a live turn.
  heavy = { nodes, turns: [...turns, activeTurn], activeTurn, answer: '开始执行批量操作。', tools: [] as any[] };
  toolCount = 0;
  publishHeavy();
  for (let i = 0; i < initialTools; i++) addHeavyTool(i % 3 === 0);
}
function addHeavyTool(settled = false) {
  const index = toolCount++;
  const node = chatNode('tool-call', { root: toolBlock(index, settled) }, heavy.activeTurn, 0);
  heavy.tools.push(node);
  publishHeavy();
  return node.key;
}
function growHeavyAnswer(chars = 140) {
  heavy.answer += '持续生成的正文字符'.repeat(Math.ceil(chars / 9)).slice(0, chars);
  // Replace the active node instead of mutating it in place: the store compares identities.
  heavy.nodes[heavy.nodes.length - 1] = assistantNode(heavy.activeTurn, 0, [text(heavy.answer)], 'running');
  publishHeavy();
}

// The live batch is the last group in the transcript: earlier turns carry their own (possibly
// off-screen) groups, and a history group measures zero once content-visibility elides it.
function groupRow(): HTMLElement | null {
  // The live batch is the last *expanded* group: history turns carry their own groups, and a
  // settled one is folded to a zero-height body that measures nothing.
  const rows = [...host.querySelectorAll<HTMLElement>('[data-reader-group]')];
  return rows.filter(row => row.dataset.expanded === 'true').at(-1) ?? null;
}
function body(): HTMLElement | null { return groupRow()?.lastElementChild as HTMLElement | null ?? null; }
function bodyState() {
  const element = body();
  return element ? { top: element.scrollTop, max: Math.max(0, element.scrollHeight - element.clientHeight), sh: element.scrollHeight, ch: element.clientHeight, overflowY: getComputedStyle(element).overflowY, maxHeight: getComputedStyle(element).maxHeight } : null;
}
function hostState() {
  return { top: host.scrollTop, max: Math.max(0, host.scrollHeight - host.clientHeight),
    following: host.querySelector<HTMLElement>('[data-dsh-clearview]')?.dataset.readerFollowing, turns: host.querySelectorAll('[data-reader-turn]').length };
}
type Sample = { t: number; bodyTop: number; bodyMax: number; bodySh: number; bodyCh: number; bodyW: number; hostTop: number; hostMax: number; hostSh: number; hostW: number };
let recording = false;
let samples: Sample[] = [];
let started = 0;
function record() {
  if (!recording) return;
  const b = body(), h = hostState();
  if (b) samples.push({ t: performance.now() - started, bodyTop: b.scrollTop, bodyMax: Math.max(0, b.scrollHeight - b.clientHeight), bodySh: b.scrollHeight, bodyCh: b.clientHeight, bodyW: b.clientWidth, hostTop: host.scrollTop, hostMax: h.max, hostSh: host.scrollHeight, hostW: host.clientWidth });
  requestAnimationFrame(record);
}
function startRecording() { samples = []; started = performance.now(); recording = true; requestAnimationFrame(record); }
function stopRecording() { recording = false; return samples; }
function summarize(rows: Sample[]) {
  const tail = (row: Sample) => row.bodyMax - row.bodyTop;
  const tailGaps = rows.map(tail);
  const deltas = rows.slice(1).map((row, i) => tail(row) - tailGaps[i]);
  const bodyDeltas = rows.slice(1).map((row, i) => row.bodyTop - rows[i].bodyTop);
  const hostDeltas = rows.slice(1).map((row, i) => row.hostTop - rows[i].hostTop);
  let reversals = 0;
  for (let i = 1; i < bodyDeltas.length; i++) if (Math.sign(bodyDeltas[i]) !== 0 && Math.sign(bodyDeltas[i]) === -Math.sign(bodyDeltas[i - 1]) && Math.abs(bodyDeltas[i]) > 2) reversals++;
  let hostReversals = 0;
  for (let i = 1; i < hostDeltas.length; i++) if (Math.sign(hostDeltas[i]) !== 0 && Math.sign(hostDeltas[i]) === -Math.sign(hostDeltas[i - 1]) && Math.abs(hostDeltas[i]) > 2) hostReversals++;
  const widthChanges = rows.slice(1).filter((row, i) => row.bodyW !== rows[i].bodyW).length;
  // `scrollHeight` is rounded per element, so a fractional line box makes it wobble by one pixel
  // between frames. Only a real collapse (two pixels or more) is a shrink worth failing on.
  const shShrinks = rows.slice(1).filter((row, i) => row.bodySh <= rows[i].bodySh - 2).length;
  const widths = [...new Set(rows.map(row => row.bodyW))];
  // The page scrollbar appearing/disappearing reflows every row, which reads as flicker.
  const hostWidthChanges = rows.slice(1).filter((row, i) => row.hostW !== rows[i].hostW).length;
  const hostShrinks = rows.slice(1).filter((row, i) => row.hostSh <= rows[i].hostSh - 2).length;
  return { frames: rows.length, widthChanges, shShrinks, widths, hostWidthChanges, hostShrinks, tailGapMax: Math.max(...tailGaps), tailGapLast: tailGaps.at(-1), tailGapMin: Math.min(...tailGaps),
    bodyReversals: reversals, bodyDeltaMax: Math.max(...bodyDeltas.map(Math.abs)), hostReversals, hostDeltaMax: Math.max(...hostDeltas.map(Math.abs)),
    hostTailLast: rows.at(-1) ? rows.at(-1)!.hostMax - rows.at(-1)!.hostTop : null, samples: rows.filter((_, i) => i % 4 === 0) };
}

async function mount() {
  flushSync(() => root.render(null));
  makeSeed(4);
  flushSync(() => root.render(<Reader {...props} sessionId="scroll-fixture" />));
  await document.fonts.ready;
  await wait(400);
  for (let i = 0; i < 100 && host.scrollTop <= 100; i++) await wait(20);
}
async function mountHeavy(historyTurns = 44, initialTools = 6) {
  flushSync(() => root.render(null));
  makeHeavySeed(historyTurns, initialTools);
  flushSync(() => root.render(<Reader {...props} sessionId="scroll-fixture" />));
  await document.fonts.ready;
  // The perf guard polls every 2s: two ticks to flag heavy and arm the closed turns.
  await wait(2600);
  for (let i = 0; i < 120 && host.scrollTop <= 100; i++) await wait(20);
  host.scrollTop = host.scrollHeight;
  await wait(160);
}
async function appendAndWatch(count: number, gap = 45) {
  startRecording();
  for (let i = 0; i < count; i++) { addTool(false); await wait(gap); }
  await wait(260);
  return summarize(stopRecording());
}

(window as any).runClearviewPerformance = async () => {
  await mount();
  const initial = { body: bodyState(), host: hostState(), region: host.querySelectorAll('[data-reader-group] [role="region"]').length };
  check(!!body(), 'process body missing');
  check(host.scrollTop > 100, 'conversation did not overflow');
  const stream = await appendAndWatch(18);
  const afterStream = { body: bodyState(), host: hostState() };
  // Regression: a group that mounts already open used to stand its follow down on the first
  // layout effect and never move again, so the capped body showed the batch's first rows forever.
  check(stream.bodyDeltaMax > 0, 'the capped process body never moved while the batch streamed');
  check(stream.tailGapLast <= TAIL_BUDGET, 'the capped process body did not follow the batch tail');
  const point = (() => { const box = body()!.getBoundingClientRect(); return { x: box.left + box.width / 2, y: box.top + box.height / 2 }; })();
  return { failures, initial, stream, afterStream, bodyPoint: point, geometry: { host: host.getBoundingClientRect().toJSON(), body: body()!.getBoundingClientRect().toJSON() }, bodyComputed: { overflowY: getComputedStyle(body()!).overflowY, maxHeight: getComputedStyle(body()!).maxHeight, scrollbarWidth: getComputedStyle(body()!).scrollbarWidth } };
};

async function heavyRun(options: any = {}) {
  const { count = 26, gap = 10, anchor = null, cv = true } = options;
  await mountHeavy();
  host.style.overflowAnchor = anchor ?? '';
  if (!cv) host.querySelectorAll('[data-cv-armed]').forEach((el: any) => { el.dataset.cvArmed = '0'; });
  const perf = () => {
    const element = document.querySelector<HTMLElement>('[data-dsh-clearview]');
    return { heavy: element?.getAttribute('data-dshcp-heavy') ?? null, load: element?.getAttribute('data-dshcp-load') ?? null,
      armed: document.querySelectorAll('[data-cv-armed="1"]').length };
  };
  const jump = host.querySelector<HTMLButtonElement>('[data-reader-jump], [data-reader-activity-pill]');
  jump?.click();
  host.scrollTop = host.scrollHeight;
  const element = body();
  if (element) element.scrollTop = element.scrollHeight;
  await wait(220);
  // Instrument the page: a reversal is only explainable with the order of scroll events and the
  // live section's height changes in hand.
  const events: any[] = [];
  const sizes: any[] = [];
  const t0 = performance.now();
  const onScroll = () => events.push({ t: Math.round(performance.now() - t0), top: host.scrollTop, sh: host.scrollHeight, ch: host.clientHeight });
  host.addEventListener('scroll', onScroll, { passive: true });
  const liveTurn = [...host.querySelectorAll<HTMLElement>('[data-reader-turn]')].at(-1);
  const ro = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const box = (entry.target as HTMLElement).getBoundingClientRect();
      sizes.push({ t: Math.round(performance.now() - t0), h: Math.round(box.height), top: host.scrollTop, max: host.scrollHeight - host.clientHeight });
    }
  });
  if (liveTurn) ro.observe(liveTurn);
  const start = { body: bodyState(), host: hostState(), perf: perf() };
  startRecording();
  for (let i = 0; i < count; i++) { addHeavyTool(i % 4 === 0); growHeavyAnswer(140); await wait(gap); }
  await wait(420);
  const raw = stopRecording();
  ro.disconnect();
  host.removeEventListener('scroll', onScroll);
  const summary = summarize(raw);
  const end = { body: bodyState(), host: hostState(), perf: perf(), textLen: heavy.answer.length };
  return { options: { count, gap, anchor, cv }, start, summary, end, frames: raw, events: events.slice(0, 500), sizes: sizes.slice(0, 400) };
}

let checkpoint = 0;
const notes: any = {};
(window as any).scrollProbe = {
  mark() { const element = body()!; checkpoint = element.scrollTop; return { top: checkpoint, max: element.scrollHeight - element.clientHeight }; },
  async afterWheel(label = '') {
    await wait(250);
    const element = body()!;
    const moved = checkpoint - element.scrollTop;
    const box = element.getBoundingClientRect();
    // A wheel spent inside the capped body never moves the page, so it must not detach the
    // page follow: releasing there was the silent stall the reader met after switching back.
    check(hostState().following === 'true', `a wheel inside the process body detached the page follow (${label})`);
    const after = { moved, top: element.scrollTop, max: element.scrollHeight - element.clientHeight, hostTop: host.scrollTop, hostMax: host.scrollHeight - host.clientHeight,
      growing: await appendAndWatch(4) };
    return { checkpoint, moved, after, hostFollowing: hostState().following, box: box.toJSON() };
  },
  async establishTail() {
    const element = body()!;
    element.scrollTop = element.scrollHeight;
    await wait(120);
    const adopted = { top: element.scrollTop, max: element.scrollHeight - element.clientHeight, region: groupRow()?.querySelectorAll('[role="region"]').length };
    const growing = await appendAndWatch(4);
    check(growing.tailGapLast <= TAIL_BUDGET, 'an adopted process body stopped following its tail');
    return { adopted, growing, after: bodyState() };
  },
  async remountFollow() {
    const before = { body: bodyState(), host: hostState() };
    flushSync(() => root.render(null));
    await frame();
    flushSync(() => root.render(<Reader {...props} sessionId="scroll-fixture" />));
    await wait(300);
    const mounted = { body: bodyState(), host: hostState(), turns: host.querySelectorAll('[data-reader-turn]').length };
    const growing = await appendAndWatch(4);
    // Regression: returning to a running session re-mounts the open group; the body must park at
    // its tail again instead of the top, and keep following while the batch streams.
    check(!!mounted.body && mounted.body.max - mounted.body.top <= TAIL_BUDGET, 'the re-mounted process body parked away from its tail');
    check(growing.tailGapLast <= TAIL_BUDGET, 'the re-mounted process body did not follow new members');
    return { before, mounted, growing, after: { body: bodyState(), host: hostState() } };
  },
  // Anchoring is only switched off while the reader owns scrollTop: detached reading still relies
  // on the native anchoring to hold its seat while content above changes size.
  async anchoring() {
    host.dispatchEvent(new WheelEvent('wheel', { deltaY: -300, bubbles: true, cancelable: true }));
    await wait(220);
    const detached = { following: hostState().following, anchor: getComputedStyle(host).overflowAnchor };
    const jump = host.querySelector<HTMLButtonElement>('[data-reader-jump], [data-reader-activity-pill]');
    jump?.click();
    await wait(260);
    const attached = { following: hostState().following, anchor: getComputedStyle(host).overflowAnchor, top: host.scrollTop, max: host.scrollHeight - host.clientHeight };
    check(detached.following === 'false', 'a wheel on the page itself did not detach the follow');
    check(detached.anchor === 'auto', 'scroll anchoring stayed off after the reader detached');
    check(attached.following === 'true', 'the jump-to-latest control did not re-attach the follow');
    check(attached.anchor === 'none', 'scroll anchoring was not switched off while the reader follows the tail');
    return { detached, attached };
  },
  async burst(count = 26, gap = 8) {
    const jump = host.querySelector<HTMLButtonElement>('[data-reader-jump], [data-reader-activity-pill]');
    jump?.click();
    host.scrollTop = host.scrollHeight;
    const element = body();
    if (element) element.scrollTop = element.scrollHeight;
    await wait(180);
    const start = { body: bodyState(), host: hostState() };
    startRecording();
    for (let i = 0; i < count; i++) { addTool(false); await wait(gap); }
    await wait(420);
    return { start, summary: summarize(stopRecording()), frames: samples, after: { body: bodyState(), host: hostState() } };
  },
  async heavyNoAnchor(count = 26, gap = 10) { return heavyRun({ count, gap, anchor: 'none' }); },
  async heavyNoCv(count = 26, gap = 10) { return heavyRun({ count, gap, cv: false }); },
  async heavy(count = 26, gap = 10) {
    const result = await heavyRun({ count, gap });
    const { summary, start, frames } = result;
    check(start.perf.heavy === 'on', 'heavy mode never turned on (the content-visibility path was not exercised)');
    check(start.perf.armed > 0, 'no closed turn was armed for off-screen rendering');
    check(summary.hostReversals === 0, 'page scroll reversed ' + summary.hostReversals + ' times while streaming under content-visibility');
    check(summary.widthChanges === 0, 'content width changed during the stream (a scrollbar appeared or disappeared)');
    check(summary.shShrinks === 0, 'the process body scrollHeight shrank during the stream');
    check(summary.hostWidthChanges === 0, 'the page content width changed during the stream (page scrollbar toggled)');
    check(summary.hostShrinks === 0, 'the page scrollHeight shrank during the stream');
    check(summary.hostTailLast <= TAIL_BUDGET, 'page follow lost the bottom while streaming under content-visibility');
    return result;
  },
  hostDom() {
    const scrollers = [...document.querySelectorAll<HTMLElement>('[data-conversation-scroll]')].filter(el => el !== host);
    const reader = document.querySelector<HTMLElement>('[data-dsh-clearview]');
    return { scrollers: scrollers.map(el => ({ ch: el.clientHeight, sh: el.scrollHeight, top: el.scrollTop })), chatFollowing: document.querySelectorAll('[data-chat-following-tail]').length,
      readerRoots: document.querySelectorAll('[data-dsh-clearview]').length, readerFollowing: reader?.getAttribute('data-reader-following') ?? null,
      statusBottom: reader ? getComputedStyle(reader).getPropertyValue('--reader-status-bottom') : '',
      realGroups: document.querySelectorAll('[data-reader-group]').length, bodyInline: body()?.getAttribute('style') ?? null };
  },
  async wheelFromTop() {
    const element = body()!;
    element.scrollTop = element.scrollHeight;
    await wait(120);
    const box = element.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2, top: element.scrollTop, max: element.scrollHeight - element.clientHeight };
  },
  state() { return { body: bodyState(), host: hostState(), notes }; },
};
(window as any).clearviewPerformanceFailures = () => failures;
(window as any).prepareClearviewScreenshot = async () => ({ ok: true });
