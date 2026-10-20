import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { TurnSection } from 'fixture-source/TurnSection.tsx';
import { ToolRow } from 'fixture-source/ToolRow.tsx';
import { ReaderActionsContext } from 'fixture-source/reader-context.ts';
import { createCompatSessionHook } from 'fixture-source/compat/session-snapshot.ts';
import readerCss from 'fixture-source/Reader.module.css';
import { assistantNode, chatNode, chatOf, settledTool, text, toolCall, toolEntry, turnLocation } from '../support/chat-fixture.ts';

// Synthetic historical records, rendered with the running host's React and primitives.
// No question submission API, real Agent, or writable session store is involved.
const failures: string[] = [];
const check = (ok: unknown, message: string) => { if (!ok) failures.push(message); };
const settle = () => new Promise(resolve => setTimeout(resolve, 350));
const host = document.createElement('div');
host.style.cssText = 'position:fixed;inset:0;overflow:auto;z-index:2147483647;background:white;padding:24px 0;box-sizing:border-box';
document.body.append(host);
const root = createRoot(host);
const questions = [
  { id: 'fix_scope', header: '修复范围', question: '根因已确认。是否同时修复原版对话的输入框消失和过程折叠问题？',
    options: [{ label: '完整修复（推荐）', description: '同时修复输入框与过程折叠。' }, { label: '仅修复输入框', description: '先恢复输入，保留折叠现状。' }] },
  { id: 'keep', header: '需要保留', question: '还有哪些功能需要保留？', multi_select: true },
];
const answers = [{ id: 'keep', selected: ['完整正文', '流式动效'], custom: '思考继续限高自动滚动。\n不要改动原会话记录。' }, { id: 'fix_scope', selected: ['完整修复（推荐）'] }];
const finished = toolEntry('fixture-question', 1, settledTool('fixture-question', 'ask_user_question', { questions }, {
  content: [{ type: 'text', text: JSON.stringify({ answers }) }],
}));
const renderProps = { renderSlotChain: (_name: string, _props: unknown, value: { fallback: unknown }) => value.fallback, loadImage: async () => '' };
const turn = turnLocation({ steps: [1, 2], closingStep: 2, start: 1000, end: 7000 });
const nodes = [chatNode('user', { content: [{ type: 'text', text: '请核对并修复对话视图。' }] }, turn),
  assistantNode(turn, 1, [text('我会先确认修复范围。'), toolCall('fixture-question', 'ask_user_question', { questions })]),
  chatNode('tool-call', { root: finished.block }, turn, 1), assistantNode(turn, 2, [text('修复已完成。问答记录按当时的选择保留，可直接回看。')])];
const chat = chatOf(nodes, [turn]);
const hook = createCompatSessionHook({ sessionId: 'fixture', useSession: (select: any) => select({ sessionId: 'fixture', openState: 'ready', running: false, pendingSubmissions: [] }),
  useChat: (select: any) => select(chat), useSessionPendingInteraction: (select: any) => select(new Map()) } as any);
const inspected: string[] = [];
let motion = true;
let expanded: Record<string, boolean> = {};
let current = finished;
let mode = 'turn';
function draw() {
  flushSync(() => root.render(<ReaderActionsContext.Provider value={{ motion, inspectCall: (id: string) => inspected.push(id) }}>
    <main className={readerCss.root} data-dsh-clearview="fixture" data-motion={motion ? 'on' : 'off'} style={{ maxWidth: 748, margin: '0 auto' }}>
      {mode === 'turn' ? <TurnSection {...renderProps as any} sessionId="fixture" useSession={hook} contextT={(key: string) => key}
        useStore={(select: any) => select({ expanded })} actions={{ setMotion: () => {}, setExpanded: (key: string, open: boolean) => { expanded = { ...expanded, [key]: open }; draw(); } }}
        group={{ key: 'turn:1', turn: 1, keys: nodes.map(n => n.key) }} pinnedKeys={[]} rewindHidden={new Set<number>()} rewindSpans={[]} />
        : <ToolRow {...renderProps as any} entry={current} turnClosed={false} onRead={() => {}} />}
    </main>
  </ReaderActionsContext.Provider>));
}
const card = () => host.querySelector<HTMLElement>('[data-reader-question-record]')!;
const visible = (element: Element) => element.getBoundingClientRect().height > 0 && getComputedStyle(element).visibility !== 'hidden'
  && !element.closest('[data-folded="true"]');
const click = async (selector: string) => { const button = host.querySelector<HTMLElement>(selector); check(!!button, `Missing ${selector}`); button?.click(); await settle(); };

(window as any).runClearviewPerformance = async () => {
  draw(); await settle();
  check(host.querySelector('[data-reader-turn-disclosure]')?.getAttribute('aria-expanded') === 'false', 'Completed process should start folded');
  check(visible(card()), 'Question receipt was hidden with the folded process');
  check(card().textContent?.includes('完整修复（推荐）') && card().textContent?.includes('不要改动原会话记录。'), 'Question and all answers must be immediately readable');
  check(!host.querySelector('form, input, [role="radio"], [role="checkbox"]'), 'History contains answer submission controls');
  await click('[data-reader-question-original]');
  check(card().querySelector('[data-reader-tool-details]')?.textContent?.includes('"questions"'), 'Original input missing');
  check(card().querySelector('[role="tab"][aria-selected="true"]')?.textContent === '原始数据', 'Original receipt should start on raw data');
  await click('[data-reader-question-record] details > summary');
  check(card().querySelector('details')?.open && card().textContent?.includes('同时修复输入框与过程折叠。'), 'Original options did not open');
  await click('[data-reader-question-record] details > summary');
  await click('[data-reader-question-original]');
  check(card().getAttribute('data-expanded') === 'false', 'Original record failed to fold');
  await click('[data-reader-question-record] [data-reader-inspect]');
  check(inspected[0] === 'fixture-question', 'Inspect did not use the actual call ID');
  // Same ToolRow survives a pending→answered update while the reader has raw data open.
  mode = 'tool'; current = toolEntry('fixture-question', 1, undefined, toolCall('fixture-question', 'ask_user_question', { questions })); draw(); await settle();
  check(card().textContent?.includes('等待用户回答'), 'Pending receipt claims an answer');
  await click('[data-reader-question-original]');
  const originalButton = card().querySelector<HTMLElement>('[data-reader-question-original]')!;
  originalButton.focus(); current = finished; draw(); await settle();
  check(originalButton === card().querySelector('[data-reader-question-original]') && document.activeElement === originalButton, 'Answer arrival remounted the focused history control');
  check(card().getAttribute('data-expanded') === 'true' && card().textContent?.includes('完整修复（推荐）'), 'Answer arrival lost open history or failed to update');
  mode = 'turn'; motion = false; expanded = {}; draw(); await settle();
  check(visible(card()), 'Motion-off folded the receipt');
  return { failures, questionRecord: { inspectCalls: inspected, selected: answers, processFolded: true, pendingToAnsweredFocusPreserved: true, motionOff: true } };
};
(window as any).prepareClearviewScreenshot = async (theme: string) => {
  motion = true; mode = 'turn'; expanded = {};
  document.body.toggleAttribute('data-ds-dark-theme', theme === 'dark');
  host.style.background = theme === 'dark' ? '#141413' : '#fff';
  host.scrollTop = 0; draw(); await settle();
  const q = card().querySelector<HTMLElement>('dd')!;
  const answer = card().querySelector<HTMLElement>('[data-question-answer]')!;
  const facts = { theme, viewport: innerWidth, cardWidth: card().getBoundingClientRect().width, cardHeight: card().getBoundingClientRect().height, questionColor: getComputedStyle(q).color,
    answerColor: getComputedStyle(answer).color, fontSize: getComputedStyle(answer).fontSize, overflow: host.scrollWidth - host.clientWidth,
    visible: visible(card()), columns: getComputedStyle(card().querySelector('dl')!).gridTemplateColumns };
  check(facts.visible, `${theme}: question receipt hidden`);
  check(facts.questionColor !== facts.answerColor, `${theme}: question and answer have no color hierarchy`);
  check(facts.overflow <= 1, `${theme}: horizontal overflow`);
  return facts;
};
(window as any).clearviewPerformanceFailures = () => [...failures];
