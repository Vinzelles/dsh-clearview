import React, { useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { TurnSection } from 'fixture-source/TurnSection.tsx';
import { ReaderActionsContext } from 'fixture-source/reader-context.ts';
import { createCompatSessionHook } from 'fixture-source/compat/session-snapshot.ts';
import readerCss from 'fixture-source/Reader.module.css';
import { assistantNode, chatNode, chatOf, reasoning, settledTool, text, toolCall, turnLocation } from '../support/chat-fixture.ts';

// Native primitives/React, synthetic session data, and the same host theme as the real conversation.
const failures: string[] = [];
const check = (value: unknown, message: string) => { if (!value) failures.push(message); };
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const host = document.createElement('div');
host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;overflow:auto;padding:24px;box-sizing:border-box;background:white';
document.body.append(host);
const root = createRoot(host);
const listeners = new Set<() => void>();
let chat = chatOf([], []);
const session = { sessionId: 'style-fixture', openState: 'ready', running: false, pendingSubmissions: [] };
const pending = new Map();
const hook = createCompatSessionHook({ sessionId: session.sessionId,
  useSession: (select: any) => select(session), useSessionPendingInteraction: (select: any) => select(pending),
  useChat: (select: any) => select(useSyncExternalStore(callback => { listeners.add(callback); return () => listeners.delete(callback); }, () => chat)),
} as any);
let expanded: Record<string, boolean> = {};
let iteration = 0;
let width = 900;
let motion = false;
const thought = Array.from({ length: 25 }, (_, i) => `第 ${i + 1} 行：保留限高滚动，思考与工具在同一过程组中按时间阅读。`).join('\n');
const answer = '## 运行方式\n\n```bash\nnpm install\nnpm run dev\n```\n\n打开：\n\n```text\nhttp://127.0.0.1:4173\n```\n\n生产构建：\n\n```bash\nnpm run build\nnpm run preview\n```';
const props = { renderSlotChain: (_name: string, _props: unknown, value: { fallback: unknown }) => value.fallback, loadImage: async () => '' };
function draw() {
  flushSync(() => { listeners.forEach(callback => callback()); root.render(<ReaderActionsContext.Provider value={{ motion }}>
    <main key={iteration} className={readerCss.root} data-dsh-clearview="style-fixture" data-motion={motion ? 'on' : 'off'} style={{ width: '100%', maxWidth: width, margin: '0 auto' }}>
      <TurnSection {...props as any} sessionId={session.sessionId} useSession={hook} contextT={(key: string) => key}
        useStore={(select: any) => select({ expanded })} actions={{ setMotion: () => {}, setExpanded: (key: string, open: boolean) => { expanded = { ...expanded, [key]: open }; draw(); } }}
        group={{ key: 'turn:1', turn: 1, keys: [...chat.order] }} pinnedKeys={[]} rewindHidden={new Set<number>()} rewindSpans={[]} />
    </main>
  </ReaderActionsContext.Provider>); });
}
function seedCompleted() {
  const end = Date.now();
  const turn = turnLocation({ status: 'closed', reason: 'completed', steps: [1, 2], closingStep: 2, start: end - 10000, end });
  const user = chatNode('user', { content: [{ type: 'text', text: '请检查运行方式。' }] }, turn);
  const first = { ...assistantNode(turn, 1, [reasoning(thought), toolCall('one', 'bash', { command: 'npm install' })]), key: 'first' };
  const one = chatNode('tool-call', { root: settledTool('one', 'bash', { command: 'npm install' }) }, turn, 1);
  const two = chatNode('tool-call', { root: settledTool('two', 'bash', { command: 'npm run build' }) }, turn, 1);
  const steering = chatNode('steering', { content: [{ type: 'text', text: '补充：保留完整正文和所有原有动作。' }] }, turn, 1);
  const last = { ...assistantNode(turn, 2, [reasoning(thought), text(answer)]), key: 'last' };
  chat = chatOf([user, first, one, two, steering, last], [turn]); session.running = false;
  expanded = { 'process:style-fixture:turn:1': true }; iteration++; draw();
}
const group = () => host.querySelector<HTMLElement>('[data-reader-group="group:first:0"]')!;
const normalize = (value: string) => value.replace(/[\s"']/g, '').toLowerCase();
function inspect(label: string) {
  const main = host.querySelector('main')!;
  const bodyStyle = getComputedStyle(document.body);
  const prose = host.querySelector('[data-reader-answer] p')!;
  const ui = host.querySelector('[data-reader-user-message]')!;
  const cards = [...host.querySelectorAll<HTMLElement>('.md-code-block')].map(card => {
    const pre = card.querySelector('pre')!;
    const s = getComputedStyle(pre), outer = getComputedStyle(card);
    const banner = getComputedStyle(card.firstElementChild!);
    check(outer.borderTopWidth === '1px' && s.borderWidth === '0px', `${label}: code card has overlapping borders`);
    check(s.borderTopLeftRadius === '0px' && s.borderBottomLeftRadius === '9px' && banner.borderTopLeftRadius === '9px', `${label}: code card corner mismatch`);
    check(normalize(s.fontFamily) === normalize(bodyStyle.getPropertyValue('--dsh-claude-font-code')), `${label}: code font differs from native conversation`);
    return { border: outer.borderWidth, preBorder: s.borderWidth, preRadius: s.borderRadius, bannerRadius: banner.borderRadius, family: s.fontFamily };
  });
  check(cards.length === 3, `${label}: the actual code primitives were not rendered`);
  check(normalize(getComputedStyle(prose).fontFamily) === normalize(bodyStyle.getPropertyValue('--dsh-claude-font-prose')), `${label}: body font differs from native conversation`);
  check(normalize(getComputedStyle(ui).fontFamily) === normalize(bodyStyle.getPropertyValue('--dsw-font-family')), `${label}: UI font differs from native conversation`);
  check(getComputedStyle(prose).fontSize === bodyStyle.getPropertyValue('--dsh-content-font-size').trim(), `${label}: body font size changed`);
  const supplement = host.querySelector<HTMLElement>('[data-reader-input="steering"]')!;
  const seat = supplement.closest('[data-reader-process-entry]')!;
  const rightGap = seat.getBoundingClientRect().right - supplement.getBoundingClientRect().right;
  check(Math.abs(rightGap) <= 1, `${label}: supplementary message is not right aligned (${rightGap}px)`);
  check(!host.querySelector('[data-reader-reasoning]'), `${label}: settled thinking remains a separate top-level row`);
  check(host.querySelectorAll('[data-reader-group]').length === 2, `${label}: thought/process groups missing`);
  check(host.scrollWidth <= host.clientWidth + 1 && main.getBoundingClientRect().width <= host.clientWidth + 1, `${label}: horizontal overflow`);
  return { label, rightGap, cards, bodyFamily: getComputedStyle(prose).fontFamily, bodySize: getComputedStyle(prose).fontSize, groups: host.querySelectorAll('[data-reader-group]').length };
}
(window as any).runClearviewPerformance = async () => {
  const cases = [];
  for (const narrow of [false, true]) for (const dark of [false, true]) {
    width = narrow ? 392 : 900; document.body.toggleAttribute('data-ds-dark-theme', dark); host.style.background = dark ? '#141413' : '#fff';
    seedCompleted(); await document.fonts.ready; await wait(150);
    cases.push(inspect(`${width}/${dark ? 'dark' : 'light'}`));
    group().querySelector<HTMLButtonElement>('[data-reader-line] > button')!.click(); await wait(20);
    check(group().querySelectorAll('[data-reader-reasoning]').length === 1 && group().querySelectorAll('[data-reader-tool-call]').length === 2, 'Thought and tool rows must open inside one group');
    const row = group().querySelector<HTMLElement>('[data-reader-reasoning]')!;
    row.querySelector<HTMLButtonElement>('[data-reader-line] > button')!.click(); await wait(20);
    check(row.querySelector<HTMLElement>('[data-reader-reasoning-scroll]')?.clientHeight === 128, 'Historical thought lost its 128px viewport');
    group().querySelector<HTMLButtonElement>('[data-reader-line] > button')!.click(); await wait(20);
    check(!group().querySelector('[data-reader-reasoning-scroll]'), 'Explicit group folding must close its thinking viewport');
  }
  // Keeping the same key/parents is essential: selection and scroll survive tool arrival.
  width = 900; motion = true;
  const turn = turnLocation({ status: 'open', steps: [1], start: Date.now() });
  const user = chatNode('user', { content: [{ type: 'text', text: '实时思考' }] }, turn);
  const node = { ...assistantNode(turn, 1, [reasoning(thought)], 'running'), key: 'live' };
  chat = chatOf([user, node], [turn]); session.running = true; iteration++; expanded = {}; draw(); await wait(250);
  const port = host.querySelector<HTMLElement>('[data-reader-reasoning-scroll]')!;
  check(port?.clientHeight === 128 && port.scrollTop > 0, 'Live thought must cap its height and follow the tail');
  const settled = { ...node, data: { ...node.data as any, status: 'settled' } };
  const call = chatNode('tool-call', { root: settledTool('arrived', 'bash', { command: 'npm run build' }) }, turn, 1);
  chat = chatOf([user, settled, call], [turn]); draw(); await wait(80);
  const retained = port.isConnected && host.querySelector('[data-reader-reasoning-scroll]') === port;
  check(retained && port.clientHeight === 128, 'Thought/group growth remounted or hid the live viewport');
  await wait(1100); check(port.isConnected && port.clientHeight === 128, 'Grouping removed the reading grace period');
  host.querySelector<HTMLButtonElement>('[data-reader-group] > [data-reader-line] > button')!.click(); await wait(350);
  check(!host.querySelector('[data-reader-reasoning-scroll]'), 'Explicit process close must win over the retained thought');
  flushSync(() => root.render(null));
  return { failures, styleRefinement: { cases, liveViewportRetained: retained } };
};
(window as any).prepareClearviewScreenshot = async (theme: string) => {
  document.body.toggleAttribute('data-ds-dark-theme', theme === 'dark'); host.style.background = theme === 'dark' ? '#141413' : '#fff';
  width = 900; motion = false; seedCompleted(); await wait(150); host.scrollTop = 0;
  return { groups: host.querySelectorAll('[data-reader-group]').length, overflow: host.scrollWidth - host.clientWidth };
};
(window as any).clearviewPerformanceFailures = () => [...failures];
