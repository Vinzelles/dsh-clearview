import React, { useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { TurnSection } from 'fixture-source/TurnSection.tsx';
import { ReaderActionsContext } from 'fixture-source/reader-context.ts';
import { createCompatSessionHook } from 'fixture-source/compat/session-snapshot.ts';
import readerCss from 'fixture-source/Reader.module.css';
import { assistantNode, chatNode, chatOf, reasoning, settledTool, text, turnLocation } from '../support/chat-fixture.ts';

// Exercise actual streaming-to-history rendering, without any writable session or model request.
const failures: string[] = [];
const check = (value: unknown, message: string) => { if (!value) failures.push(message); };
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const host = document.createElement('div');
host.style.cssText = 'position:fixed;inset:0;overflow:auto;z-index:2147483647;background:white;padding:24px';
document.body.append(host);
const root = createRoot(host);
const listeners = new Set<() => void>();
let chat = chatOf([], []);
const session = { sessionId: 'thought-fixture', openState: 'ready', running: true, pendingSubmissions: [] };
const pending = new Map();
const hook = createCompatSessionHook({ sessionId: session.sessionId,
  useSession: (select: any) => select(session), useSessionPendingInteraction: (select: any) => select(pending),
  useChat: (select: any) => select(useSyncExternalStore(callback => { listeners.add(callback); return () => { listeners.delete(callback); }; }, () => chat)),
} as any);
let motion = true;
let iteration = 0;
let expanded: Record<string, boolean> = {};
let pinnedKeys: string[] = [];
const source = Array.from({ length: 24 }, (_, index) => `第 ${index + 1} 行思考：检查数据、验证边界，并保留完整推理内容。`).join('\n');
const renderProps = { renderSlotChain: (_name: string, _props: unknown, value: { fallback: unknown }) => value.fallback, loadImage: async () => '' };
function draw() {
  flushSync(() => { listeners.forEach(callback => callback()); root.render(<ReaderActionsContext.Provider value={{ motion }}>
    <main key={iteration} className={readerCss.root} data-dsh-clearview="fixture" data-motion={motion ? 'on' : 'off'} style={{ maxWidth: 748, margin: '0 auto' }}>
      <TurnSection {...renderProps as any} sessionId={session.sessionId} useSession={hook} contextT={(key: string) => key}
        useStore={(select: any) => select({ expanded })} actions={{ setMotion: () => {}, setExpanded: (key: string, open: boolean) => { expanded = { ...expanded, [key]: open }; draw(); } }}
        group={{ key: 'turn:1', turn: 1, keys: [...chat.order] }} pinnedKeys={pinnedKeys} rewindHidden={new Set<number>()} rewindSpans={[]} />
    </main>
  </ReaderActionsContext.Provider>); });
}
function seed() {
  const turn = turnLocation({ status: 'open', steps: [1], start: Date.now() - 2000 });
  const user = chatNode('user', { content: [{ type: 'text', text: '检查实现' }] }, turn);
  const assistant = { ...assistantNode(turn, 1, [reasoning(source)], 'running'), key: 'thought-a' };
  chat = chatOf([user, assistant], [turn]); iteration++; expanded = {}; pinnedKeys = []; draw();
  return { turn, user, assistant };
}
function finish(kind: string, seedData: ReturnType<typeof seed>) {
  const { turn, user, assistant } = seedData;
  const settled = { ...assistant, data: { ...assistant.data as any, status: 'settled', blocks: [reasoning(source), ...(kind === 'body' ? [text('正文开始，思考区域仍应留出阅读时间。')] : [])] } };
  const later = kind === 'tools' ? chatNode('tool-call', { root: settledTool('after-thought', 'read_file', { path: 'src/main.ts' }) }, turn, 1)
    : kind === 'next' ? { ...assistantNode(turn, 2, [reasoning('下一段思考开始。')], 'running'), key: 'thought-b' } : null;
  if (kind === 'closed') {
    const completed = turnLocation({ status: 'closed', reason: 'completed', steps: [1], closingStep: 1, start: Date.now() - 2000, end: Date.now() });
    const final = { ...settled, data: { ...settled.data, blocks: [reasoning(source), text('本轮完成。')] }, location: { kind: 'step', turn: completed, step: completed.steps[0] } };
    chat = chatOf([{ ...user, location: { kind: 'turn', turn: completed } } as any, final as any], [completed]);
  } else chat = chatOf([user, settled, ...(later ? [later] : [])], [turn]);
  draw();
}

const thoughtGroup = () => host.querySelector<HTMLElement>('[data-reader-group="group:thought-a:0"]')!;
async function openThoughtGroup() {
  if (thoughtGroup().getAttribute('data-expanded') !== 'true') {
    thoughtGroup().querySelector<HTMLButtonElement>('[data-reader-line] > button')!.click(); await wait(350);
  }
}

(window as any).runClearviewPerformance = async () => {
  const cases = [];
  for (const kind of ['body', 'tools', 'next', 'closed', 'off']) {
    motion = kind !== 'off';
    const initial = seed(); await wait(250);
    const seat = host.querySelector<HTMLElement>('[data-reader-live-seat][data-reader-key="thought-a:0"]');
    const port = seat?.querySelector<HTMLElement>('[data-reader-reasoning-scroll]');
    check(!!port && port.clientHeight === 128, `${kind}: capped streaming viewport missing`);
    const top = port?.scrollTop;
    finish(kind === 'off' ? 'body' : kind, initial); await wait(80);
    const retained = !!port && port.isConnected && host.querySelector('[data-reader-key="thought-a:0"] [data-reader-reasoning-scroll]') === port;
    const readable = retained && port!.clientHeight === 128 && port!.textContent === source && Math.abs(port!.scrollTop - top!) <= 1;
    check(retained && readable, `${kind}: thinking disappears/remounts immediately at completion`);
    if (!retained) { cases.push({ kind, retained, readable }); continue; }
    await wait(1100);
    const grace = port!.isConnected && port!.closest('[data-ud-motion="reader-collapse-size"]')!.getBoundingClientRect().height > 100;
    check(grace, `${kind}: no reading grace period`);
    const heights: number[] = [];
    const start = performance.now();
    while (performance.now() - start < 2600) {
      heights.push(port!.closest('[data-ud-motion="reader-collapse-size"]')?.getBoundingClientRect().height ?? 0);
      await new Promise(requestAnimationFrame);
    }
    const smooth = heights.some(height => height > 1 && height < 100);
    let row = host.querySelector<HTMLElement>('[data-reader-key="thought-a:0"] [data-reader-reasoning]');
    const folded = row ? row.getAttribute('data-expanded') === 'false' : thoughtGroup().getAttribute('data-expanded') === 'false';
    check(folded && (motion ? smooth : !smooth), `${kind}: completed thinking must honor the folding motion preference`);
    if (kind === 'closed') { host.querySelector<HTMLButtonElement>('[data-reader-turn-disclosure]')?.click(); await wait(300); }
    await openThoughtGroup();
    row = host.querySelector<HTMLElement>('[data-reader-key="thought-a:0"] [data-reader-reasoning]');
    row?.querySelector<HTMLButtonElement>('[data-reader-line] > button')?.click(); await wait(350);
    const fullText = row?.querySelector('[data-reader-reasoning-text]')?.textContent === source;
    check(fullText, `${kind}: manually reopening loses thought content`);
    if (kind === 'body') { await wait(2700); check(row?.getAttribute('data-expanded') === 'true', 'Manual reopening must not start another auto-collapse timer'); }
    cases.push({ kind, retained, readable, grace, smooth, folded, fullText, heights });
  }
  motion = true;
  const reading = [];
  for (const interaction of ['hover', 'focus', 'selection']) {
    const initial = seed(); await wait(250);
    const seat = host.querySelector<HTMLElement>('[data-reader-live-seat][data-reader-key="thought-a:0"]')!;
    const port = seat.querySelector<HTMLElement>('[data-reader-reasoning-scroll]')!;
    const top = port.scrollTop;
    if (interaction === 'hover') seat.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: null }));
    else if (interaction === 'focus') port.focus({ preventScroll: true });
    else {
      const range = document.createRange(); range.selectNodeContents(port.querySelector('[data-reader-reasoning-text]')!);
      const selection = document.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
      pinnedKeys = ['thought-a:0']; draw();
    }
    finish('tools', initial); await wait(2800);
    const body = port.closest('[data-ud-motion="reader-collapse-size"]')!;
    const retained = port.isConnected && body.getBoundingClientRect().height > 100 && port.textContent === source && Math.abs(port.scrollTop - top) <= 1;
    check(retained, `${interaction}: reading intent did not prevent auto-collapse`);
    if (interaction === 'selection') { check(document.getSelection()?.toString() === source, 'Completion changed the real selected text'); document.getSelection()?.removeAllRanges(); pinnedKeys = []; draw(); }
    if (interaction === 'hover') seat.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: host }));
    port.blur();
    const control = seat.querySelector<HTMLButtonElement>('[data-reader-line] > button')!;
    control.focus(); control.click(); await wait(350);
    const explicitFold = seat.querySelector('[data-reader-reasoning]')?.getAttribute('data-expanded') === 'false';
    check(explicitFold, `${interaction}: explicit close was overridden by reading focus`);
    reading.push({ interaction, retained, explicitFold });
  }
  flushSync(() => root.render(null));
  return { cases, reading, failures };
};
(window as any).prepareClearviewScreenshot = async (theme: string) => {
  document.body.toggleAttribute('data-ds-dark-theme', theme === 'dark');
  host.style.background = theme === 'dark' ? '#141413' : '#fff';
  motion = true; const initial = seed(); await wait(250); finish('tools', initial); await wait(500);
  return { phase: host.querySelector('[data-thought-phase]')?.getAttribute('data-thought-phase'), viewport: host.querySelector('[data-reader-reasoning-scroll]')?.clientHeight, overflow: host.scrollWidth - host.clientWidth };
};
let hoverPort: HTMLElement | null = null;
(window as any).prepareThoughtHover = async () => {
  motion = true; const initial = seed(); await wait(250); finish('tools', initial); await wait(100);
  hoverPort = host.querySelector<HTMLElement>('[data-reader-key="thought-a:0"] [data-reader-reasoning-scroll]');
  const box = hoverPort!.getBoundingClientRect(); return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
};
(window as any).inspectThoughtHover = () => {
  const row = host.querySelector<HTMLElement>('[data-reader-key="thought-a:0"] [data-reader-reasoning]');
  const port = row?.querySelector<HTMLElement>('[data-reader-reasoning-scroll]');
  return { expanded: row?.getAttribute('data-expanded') ?? thoughtGroup().getAttribute('data-expanded'), phase: row?.getAttribute('data-thought-phase') ?? 'group-folded', originalConnected: !!hoverPort?.isConnected,
    viewport: port?.clientHeight ?? 0, fullText: port?.textContent === source };
};
(window as any).thoughtControlPoint = async () => {
  await openThoughtGroup();
  const control = host.querySelector<HTMLElement>('[data-reader-key="thought-a:0"] [data-reader-line] > button')!;
  const box = control.getBoundingClientRect(); const x = box.left + 20, y = box.top + box.height / 2;
  return { x, y, hit: document.elementFromPoint(x, y)?.closest('button') === control };
};
(window as any).clearviewPerformanceFailures = () => [...failures];
