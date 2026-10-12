import React, { useRef, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { Reader } from 'fixture-source/Reader.tsx';
import { createReaderStructureSelector } from 'fixture-source/reader-selection.ts';
import { assistantNode, chatNode, chatOf, text, toolCall, turnLocation } from '../support/chat-fixture.ts';

// Publish synthetic snapshots only. No rewind command is sent to the host.
const failures: string[] = [];
const check = (value: unknown, message: string) => { if (!value) failures.push(message); };
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
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
host.dataset.conversationScroll = '';
host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;overflow:auto;padding:24px;box-sizing:border-box;background:white;--dsh-composer-height:0px';
document.body.append(host);
const root = createRoot(host);
const chat = store(chatOf([], []));
const session = store({ running: false, queue: [], pendingSubmissions: [], openState: 'loaded', hasMore: false, loadingOlder: false, openError: null });
const pending = store(new Map());
const preferences = store({ motion: false, expanded: {} });
const sessions = store({ byId: { 'rewind-fixture': { cwd: 'C:/synthetic' } }, jobsBySession: {} });
const props: any = { sessionId: 'rewind-fixture', useChat: chat.use, useSession: session.use, useSessionPendingInteraction: pending.use,
  useStore: preferences.use, useSessions: sessions.use, useProjection: () => undefined,
  jobsSource: { subscribe: () => () => {}, getSnapshot: () => ({ rows: {} }) }, watchJobs: () => () => {},
  actions: { setMotion: (motion: boolean) => preferences.set({ ...preferences.get(), motion }),
    setExpanded: (key: string, open: boolean) => preferences.set({ ...preferences.get(), expanded: { ...preferences.get().expanded, [key]: open } }) },
  renderSlotChain: (_name: string, _owner: any, options: any) => options.fallback,
  loadImage: async () => '', loadOlder: async () => {}, openView: () => {}, viewRequest: null, completeViewRequest: () => {},
  contextT: (key: string) => key, t: (key: string) => key };
const keptTurn = turnLocation({ turn: 1, steps: [0], closingStep: 0 });
const withdrawnTurn: any = turnLocation({ turn: 2, steps: [0], closingStep: 0, reason: 'error', start: 1000, end: 25000 });
withdrawnTurn.start.seq = 266;
withdrawnTurn.steps[0].start.seq = 269;
withdrawnTurn.steps[0].end = { seq: 274, time: 25000 };
withdrawnTurn.steps[0].data.set('assistant-step', { blocks: [toolCall('withdrawn-draft', 'read_file', { path: 'fixture.txt' })] });
const kept = { ...assistantNode(keptTurn, 0, [text('回退之前的正文应当保留。')]), key: 'fixture-kept', anchorSeq: 20 };
const chrome = chatNode('turn-process', { turn: 2 }, withdrawnTurn, undefined, { key: 'fixture-chrome', anchorSeq: 266 });
const target = chatNode('user', { seq: 268, content: [{ type: 'text', text: '这条用户消息将被撤回。' }] }, withdrawnTurn, undefined, { key: 'fixture-target', anchorSeq: 268 });
const assistant = { ...assistantNode(withdrawnTurn, 0, [text('WITHDRAWN_BODY：旧正文不应残留。')]), key: 'fixture-assistant', anchorSeq: 270 };
const retry = chatNode('model-retry', { current: { retry: 5, retryState: 'started', failure: { code: 'SERVER', status: 500 } } }, withdrawnTurn, 0, { key: 'fixture-retry', anchorSeq: 272 });
const error = chatNode('turn-error', { code: 'SERVER', message: 'WITHDRAWN_ERROR' }, withdrawnTurn, 0, { key: 'fixture-error', anchorSeq: 274 });
const preview = chatNode('command', { seq: 276, name: 'rewind-plugin', args: 'preview @268 chat', outcome: { kind: 'success', text: 'INTERNAL_PREVIEW' } }, withdrawnTurn, undefined, { key: 'fixture-preview', anchorSeq: 276 });
const command = chatNode('command', { seq: 277, name: 'rewind-plugin', args: '@268 chat', outcome: null }, withdrawnTurn, undefined, { key: 'fixture-execute', anchorSeq: 277 });
const initialRows = [kept, chrome, target, assistant, retry, error, preview, command];
const nextTurn = turnLocation({ turn: 3, steps: [0], closingStep: 0 });
const nextUser = chatNode('user', { seq: 280, content: [{ type: 'text', text: '回退之后的新消息。' }] }, nextTurn, undefined, { key: 'fixture-new-user', anchorSeq: 280 });
const nextAssistant = { ...assistantNode(nextTurn, 0, [text('新回复正常显示。')]), key: 'fixture-new-assistant', anchorSeq: 281 };
function snapshot(rows: any[]) {
  const snap = chatOf(rows, [keptTurn, withdrawnTurn, nextTurn]);
  return { ...snap, locations: { getTurn: (turn: number) => rows.filter(row => row.location.turn?.turn === turn).map(row => row.key) } };
}
function oracle(label: string) {
  const snap = chat.get();
  const hidden = (window as any).__clearviewRewindOracle(snap) as Set<number>;
  const actual = createReaderStructureSelector()(snap);
  check(JSON.stringify([...actual.hidden].sort((a, b) => a - b)) === JSON.stringify([...hidden].sort((a, b) => a - b)), `${label}: hidden anchors differ from installed rewind`);
  return { hidden: [...actual.hidden].sort((a, b) => a - b), groups: actual.groups.map(group => group.key) };
}
function checkWithdrawn(label: string) {
  check(!host.querySelector('[data-reader-turn="2"]'), `${label}: withdrawn turn shell/footer remains`);
  check(!host.textContent?.includes('WITHDRAWN_BODY') && !host.textContent?.includes('WITHDRAWN_ERROR'), `${label}: withdrawn body/error remains`);
  check(!host.querySelector('[data-reader-tool-call="withdrawn-draft"]'), `${label}: withdrawn tool draft remains`);
  check(host.textContent?.includes('回退之前的正文应当保留。'), `${label}: earlier body was hidden`);
}
(window as any).runClearviewPerformance = async () => {
  chat.set(snapshot(initialRows));
  flushSync(() => root.render(<Reader {...props} />));
  await wait(150);
  const pendingOracle = oracle('pending');
  check(host.querySelector('[data-reader-turn="2"]') && host.textContent?.includes('WITHDRAWN_BODY'), 'Pending rewind unexpectedly removes old content');
  check(host.querySelector('[data-reader-tool-call="withdrawn-draft"]'), 'Pending tool draft fixture did not render');
  check(!host.textContent?.includes('INTERNAL_PREVIEW'), 'Internal preview text leaks into the reader');
  host.querySelector<HTMLButtonElement>('[data-reader-turn="2"] [data-reader-turn-disclosure]')?.click();
  await wait(150);
  const done = { ...command, data: { ...command.data as any, outcome: { kind: 'success', sourceEventSeq: 279, text: 'INTERNAL_SUCCESS' } } };
  const doneRows = initialRows.map(row => row.key === command.key ? done : row);
  flushSync(() => chat.set(snapshot(doneRows)));
  await wait(300);
  const doneOracle = oracle('completed');
  checkWithdrawn('completed');
  check(!host.textContent?.includes('INTERNAL_SUCCESS'), 'Executed rewind text leaks into the reader');
  flushSync(() => chat.set(snapshot([...doneRows, nextUser, nextAssistant])));
  await wait(150);
  checkWithdrawn('new-traffic');
  check(host.textContent?.includes('回退之后的新消息。') && host.textContent?.includes('新回复正常显示。'), 'New traffic after the marker was hidden');
  const nextOracle = oracle('new-traffic');
  flushSync(() => root.render(null));
  flushSync(() => root.render(<Reader {...props} />));
  await wait(150);
  checkWithdrawn('remounted');
  return { failures, rewindVisibility: { pendingOracle, doneOracle, nextOracle, sameOrderCompletion: true, remounted: true } };
};
(window as any).prepareClearviewScreenshot = async (theme: string) => {
  document.body.toggleAttribute('data-ds-dark-theme', theme === 'dark');
  host.style.background = theme === 'dark' ? '#141413' : '#fff';
  host.scrollTop = 0;
  await wait(150);
  checkWithdrawn(`${theme}/${innerWidth}`);
  check(host.scrollWidth <= host.clientWidth + 1, `${theme}/${innerWidth}: horizontal overflow`);
  return { theme, viewport: innerWidth, turns: host.querySelectorAll('[data-reader-turn]').length };
};
(window as any).clearviewPerformanceFailures = () => [...failures];
