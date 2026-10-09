import React, { memo, useMemo, useRef, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { Reader } from 'fixture-source/Reader.tsx';
import * as bridge from 'fixture-source/compat/session-snapshot.ts';
import { injectCompatStyles } from 'fixture-source/compat/styles.ts';
import { cachedSnapshot } from 'fixture-source/compat/reader-root.ts';
import { turnMeta, turnMetaText } from 'fixture-source/turn-meta.ts';
declare const __BASELINE__: boolean;
const failures: string[] = [];
const check = (condition: unknown, message: string) => { if (!condition)
    failures.push(message); };
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
const frame = () => new Promise<number>(r => requestAnimationFrame(r));
const quantile = (a: number[], q: number) => [...a].sort((x, y) => x - y)[Math.floor((a.length - 1) * q)] ?? 0;
function store(initial: any, optional = false) { let value = initial; const listeners = new Set<() => void>(); const subscribe = (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn); }; return { get: () => value, subscriberCount: () => listeners.size, set(next: any) { value = next; listeners.forEach(fn => fn()); }, use(selector: any, equal: any = Object.is) { const cache = useRef<{
        value: any;
        has: boolean;
    }>({ value: undefined, has: false }); const get = () => { const next = optional && value === undefined ? undefined : selector(value); if (!cache.current.has || !equal(cache.current.value, next)) {
        cache.current = { value: next, has: true };
    } return cache.current.value; }; return useSyncExternalStore(subscribe, get, get); } }; }
const host = document.createElement('div');
host.dataset.conversationScroll = '';
host.style.cssText = 'position:fixed;inset:0;background:#fff;color:#222;z-index:2147483647;overflow:auto;--dsh-composer-height:0px';
document.body.append(host);
const root = createRoot(host);
const source = store({ stable: { text: 'history' }, active: '' }, true), session = store({ id: 'fixture', running: false, queue: [] }), pending = store(new Map(), true);
const compat = bridge.createCompatSessionHook({ useSession: session.use, useChat: source.use, useSessionPendingInteraction: pending.use, sessionId: 'fixture' } as any);
const selectChat = (selector: any, equal?: any) => __BASELINE__ ? compat((s: any) => selector(s.chat), equal) : bridge.useChatSelector(compat, selector, equal);
const selectPending = (selector: any, equal?: any) => __BASELINE__ ? compat((s: any) => selector(s.pending), equal) : bridge.usePendingSelector(compat, selector, equal);
async function subscriptions() {
    let renders = 0;
    const Child = memo(() => { const value = selectChat((c: any) => c.stable); renders++; return <span>{value?.text}</span>; });
    flushSync(() => root.render(<>{Array.from({ length: 40 }, (_, i) => <Child key={i}/>)}</>));
    renders = 0;
    for (let i = 0; i < 20; i++)
        flushSync(() => source.set({ ...source.get(), active: String(i) }));
    const extra = renders;
    if (!__BASELINE__)
        check(extra === 0, 'unrelated chat updates rendered history');
    flushSync(() => root.render(null));
    let pendingRenders = 0;
    const Pending = () => { const value = selectPending((p: any) => p); pendingRenders++; return <span>{value.length}</span>; };
    flushSync(() => root.render(<Pending />));
    const own = { kind: 'question' };
    flushSync(() => pending.set(new Map([['fixture', own]])));
    pendingRenders = 0;
    flushSync(() => pending.set(new Map([['fixture', own], ['other', { kind: 'approval' }]])));
    if (!__BASELINE__)
        check(pendingRenders === 0, 'other session pending update rendered this session');
    flushSync(() => root.render(null));
    if (!__BASELINE__) {
        let selected: any = 'unset';
        const Empty = () => { selected = selectChat(() => undefined); return null; };
        flushSync(() => root.render(<Empty />));
        check(selected === undefined, 'selector undefined must remain undefined');
        flushSync(() => source.set(undefined));
        check(selected === undefined, 'missing chat fallback');
        flushSync(() => source.set({ stable: { text: 'restored' } }));
        check(selected === undefined, 'chat restore with undefined selection');
        flushSync(() => root.render(null));
    }
    if (!__BASELINE__) {
        const legacy = store({ chat: { stable: { text: 'legacy' } }, pending: [], running: false, queue: [] });
        const legacyHook = bridge.createCompatSessionHook({ useSession: legacy.use, sessionId: 'legacy' } as any);
        let calls = 0;
        let observed: any;
        const Legacy = () => { observed = [bridge.useChatSelector(legacyHook, (c: any) => c.stable.text), bridge.usePendingSelector(legacyHook, (p: any) => p.length), bridge.useSessionSelector(legacyHook, (s: any) => s.running)]; calls++; return null; };
        flushSync(() => root.render(<Legacy />));
        calls = 0;
        flushSync(() => legacy.set({ ...legacy.get(), unrelated: 1 }));
        check(calls === 0, 'legacy unrelated publication rendered consumer');
        flushSync(() => legacy.set({ ...legacy.get(), running: true, pending: [{}] }));
        check(observed[0] === 'legacy' && observed[1] === 1 && observed[2] === true, 'legacy slices stale');
        flushSync(() => root.render(null));
        const PendingMissing = () => { observed = bridge.usePendingSelector(compat, (p: any) => p.length); return null; };
        flushSync(() => root.render(<PendingMissing />));
        flushSync(() => pending.set(undefined));
        check(observed === 0, 'missing pending source fallback');
        flushSync(() => pending.set(new Map([['fixture', {}]])));
        check(observed === 1, 'pending source did not recover');
        flushSync(() => root.render(null));
    }
    return { historicalExtraRenders: extra, pendingExtraRenders: pendingRenders };
}
function makeData() { const turns = new Map(), nodes = new Map(), order: string[] = []; let seq = 0; const add = (n: any) => { n.anchorSeq = ++seq; n.visibility = 'visible'; nodes.set(n.key, n); order.push(n.key); }; for (let t = 1; t <= 21; t++) {
    const turn: any = { turn: t, status: t === 21 ? 'open' : 'closed', steps: [], data: new Map(), start: { time: Date.now() - 5000 }, end: t === 21 ? undefined : { time: Date.now() - 1000, data: { reason: { kind: 'completed' } } } };
    add({ key: `u${t}`, kind: 'user', location: { kind: 'turn', turn }, data: { content: [{ type: 'text', text: '请检查实现并验证结果。' }] } });
    const data = { turn: t, step: 0, status: t === 21 ? 'running' : 'settled', time: Date.now(), blocks: [{ kind: t === 21 ? 'reasoning' : 'text', text: t === 21 ? '' : '已检查实现，当前结果与预期一致。'.repeat(12) }] };
    const step = { step: 0, data: new Map([['assistant-step', data]]) };
    if (t === 21) {
        for (let k = 0; k < 20; k++) {
            const prior = { turn: t, step: k, status: 'settled', time: Date.now() - 4000 + k, blocks: [{ kind: 'reasoning', text: '检查调用路径与执行结果。'.repeat(8) }, { kind: 'text', text: '该步骤已完成，继续检查下一项。' }] };
            const priorStep = { step: k, data: new Map([['assistant-step', prior]]) };
            turn.steps.push(priorStep);
            add({ key: `prior${k}`, kind: 'assistant-step', location: { kind: 'step', turn, step: priorStep }, data: prior });
            const call = { name: 'read_file', argsRaw: JSON.stringify({ path: `src/file${k}.ts` }) };
            add({ key: `tool${k}`, kind: 'tool-call', location: { kind: 'step', turn, step: priorStep }, data: { root: { kind: 'tool-call', callId: `call${k}`, call, content: [{ type: 'text', text: '文件内容已读取。' }], subCalls: [], isError: false, callTime: Date.now() - 200, time: Date.now() } } });
        }
        data.step = 20;
        step.step = 20;
    }
    turn.steps.push(step);
    add({ key: `a${t}`, kind: 'assistant-step', location: { kind: 'step', turn, step }, data });
    if (t !== 21)
        turn.data.set('turn-tail', { closing: { step: 20, time: Date.now(), finalNode: { seq: 900 + t }, blocks: data.blocks } });
    turns.set(t, turn);
} return { order, nodes, timeline: { turns, turnOrder: [...turns.keys()] } }; }
async function reader() {
    const chat = store(makeData(), true);
    const sess = store({ running: true, queue: [], pendingSubmissions: [], openState: 'loaded', hasMore: false, loadingOlder: false, openError: null });
    const pend = store(new Map(), true);
    const prefs = store({ motion: true, expanded: {} });
    const sessions = store({ byId: { fixture: { cwd: 'C:/synthetic' } }, jobsBySession: {} });
    const actions = { setExpanded: (key: string, value: boolean) => prefs.set({ ...prefs.get(), expanded: { ...prefs.get().expanded, [key]: value } }), setMotion: (motion: boolean) => prefs.set({ ...prefs.get(), motion }) };
    let historyBlockRenders = 0;
    const renderSlotChain = (_name: any, owner: any, options: any) => { if (owner.block.text?.startsWith('已检查实现'))
        historyBlockRenders++; return options.fallback; };
    const props: any = { sessionId: 'fixture', useSession: sess.use, useChat: chat.use, useSessionPendingInteraction: pend.use, useStore: prefs.use, useSessions: sessions.use, actions, renderSlotChain, loadOlder: async () => { }, loadImage: async () => { throw Error('No image in fixture'); }, t: (key: any) => key, contextT: (key: any) => key,
        useProjection: () => undefined, jobsSource: { subscribe: () => () => { }, getSnapshot: () => ({ rows: {} }) }, watchJobs: () => () => { },
        openView: () => { }, viewRequest: null, completeViewRequest: () => { } };
    injectCompatStyles();
    flushSync(() => root.render(<Reader {...props}/>));
    await wait(600);
    historyBlockRenders = 0;
    const toolRowsBeforeStream = host.querySelectorAll('[data-reader-tool-call], [data-reader-group]').length;
    let toolRowsAtHeavyCheck = -1;
    const frames: number[] = [], commits: number[] = [], scrolls: number[] = [];
    let last = 0, lastInput = 0, animations = 0, blur = false;
    let heavyPreserved = false, shimmerPreserved = false, heavyChecked = false;
    performance.mark('clearview-stream-start');
    const start = performance.now();
    const append = (text: string, reason: boolean) => { const old = chat.get(), oldNode = old.nodes.get('a21'), oldTurn = old.timeline.turns.get(21); const data = { ...oldNode.data, blocks: [{ kind: reason ? 'reasoning' : 'text', text }] }; const step = { step: 20, data: new Map([['assistant-step', data]]) }; const turn = { ...oldTurn, steps: [...oldTurn.steps.slice(0, -1), step] }; const node = { ...oldNode, data, location: { kind: 'step', turn, step } }; chat.set({ ...old, nodes: new Map(old.nodes).set('a21', node), timeline: { ...old.timeline, turns: new Map(old.timeline.turns).set(21, turn) } }); };
    let text = '', previousReason = true;
    while (performance.now() - start < 5000) {
        const now = await frame();
        if (last)
            frames.push(now - last);
        last = now;
        if (now - lastInput >= 40) {
            lastInput = now;
            const reason = now - start < 2300;
            if (reason !== previousReason) {
                text = '';
                previousReason = reason;
            }
            text += '检查当前状态，并验证实际结果。';
            const t = performance.now();
            flushSync(() => append(text, reason));
            commits.push(performance.now() - t);
        }
        scrolls.push(host.scrollTop);
        const live = document.getAnimations();
        animations = Math.max(animations, live.length);
        blur ||= live.some(a => (a.effect as KeyframeEffect)?.getKeyframes().some(f => String(f.filter).includes('blur(1px)')));
        if (!heavyChecked && now - start > 1000) {
            const reader = host.querySelector<HTMLElement>('[data-dsh-clearview]')!, word = reader.querySelector('[data-reader-word][data-word-state="resolving"]'), shimmers = [...reader.querySelectorAll<HTMLElement>('[data-shimmer] > [inert]')];
            if (word) {
                heavyChecked = true;
                reader.dataset.dshcpHeavy = 'on';
                toolRowsAtHeavyCheck = host.querySelectorAll('[data-reader-tool-call], [data-reader-group]').length;
                heavyPreserved = getComputedStyle(word).filter.includes('blur(');
                // A visible shimmer decoration that really animates (a running Web Animation or a CSS animation), not just a rendered node.
                shimmerPreserved = shimmers.some(node => getComputedStyle(node).display !== 'none' && (node.getAnimations({ subtree: true }).length > 0 || getComputedStyle(node).animationName !== 'none'));
                reader.dataset.dshcpHeavy = 'off';
                if (!__BASELINE__) {
                    check(heavyPreserved, 'heavy mode removed blur');
                    check(shimmerPreserved, 'heavy mode removed shimmer');
                }
            }
        }
    }
    const finalFrame = await frame();
    frames.push(finalFrame - last);
    performance.mark('clearview-stream-end');
    check(host.querySelectorAll('[data-reader-turn]').length === 21, 'full Reader turn count');
    check(!host.querySelector('[data-reader-block-error]'), 'Reader error boundary');
    // Every step is a transcript line of its own; consecutive operations would fold into [data-reader-group] lines,
    // so open any folded group before counting the member tool rows (a single call stays one row and is always mounted).
    for (const group of host.querySelectorAll<HTMLElement>('[data-reader-group] button[aria-expanded="false"]'))
        group.click();
    await wait(400);
    check(host.querySelectorAll('[data-reader-tool-call]').length === 20, 'tool rows missing');
    check(animations > 0 && blur, 'original blur animation was not active');
    if (!__BASELINE__)
        check(historyBlockRenders === 0, 'full Reader rerendered historical text blocks');
    const tool = host.querySelector<HTMLElement>('[data-reader-tool-call] [data-disclosure-row]');
    tool?.click();
    await wait(300);
    check(!!host.querySelector('[data-reader-tool-call][data-expanded="true"]'), 'native tool detail did not open');
    tool?.click();
    await wait(300);
    const before = host.scrollTop;
    host.dispatchEvent(new WheelEvent('wheel', { deltaY: -160, bubbles: true }));
    host.scrollTop = Math.max(0, before - 160);
    await wait(80);
    const paused = host.scrollTop;
    flushSync(() => append(text += '补充说明。'.repeat(8), false));
    await wait(250);
    check(host.scrollTop <= paused + 2, 'manual upward scroll did not pause follow');
    const jump = host.querySelector<HTMLButtonElement>('[data-reader-jump]');
    check(!!jump, 'back-to-latest control missing');
    jump?.click();
    await wait(80);
    check(host.scrollHeight - host.clientHeight - host.scrollTop < 3, 'back-to-latest did not reach bottom');
    const old = chat.get(), oldNode = old.nodes.get('a21'), oldTurn = old.timeline.turns.get(21);
    const data = { ...oldNode.data, status: 'settled' };
    const step = { step: 20, data: new Map([['assistant-step', data]]) };
    const turn = { ...oldTurn, status: 'closed', steps: [...oldTurn.steps.slice(0, -1), step], end: { time: Date.now(), data: { reason: { kind: 'completed' } } }, data: new Map([['turn-tail', { closing: { step: 20, time: Date.now(), finalNode: { seq: 921 }, blocks: data.blocks } }]]) };
    flushSync(() => { chat.set({ ...old, nodes: new Map(old.nodes).set('a21', { ...oldNode, data, location: { kind: 'step', turn, step } }), timeline: { ...old.timeline, turns: new Map(old.timeline.turns).set(21, turn) } }); sess.set({ ...sess.get(), running: false }); });
    await wait(750);
    const lastText = host.querySelector('[data-reader-turn="21"] [data-reader-text]')?.textContent;
    check(lastText === text, 'final streamed text differs from source');
    if (!__BASELINE__) {
        const saved = chat.get();
        flushSync(() => chat.set(undefined));
        check(host.querySelectorAll('[data-reader-turn]').length === 0, 'absent chat kept old turns');
        flushSync(() => chat.set(saved));
        check(host.querySelectorAll('[data-reader-turn]').length === 21, 'restored chat lost turns');
        const snap = cachedSnapshot(host.querySelector('[data-dsh-clearview]')! as HTMLElement);
        check(snap?.chat.timeline.turns.get(21)?.status === 'closed', 'DOM compat snapshot stale');
        check(!!snap && turnMetaText(turnMeta(snap.chat.timeline.turns.get(21))) !== '', 'turn footer missing after fine-grained subscriptions');
    }
    const result = { frameP95: quantile(frames, .95), frameMax: Math.max(...frames), framesOver25: frames.filter(n => n > 25).length, samples: frames.length, commitP95: quantile(commits, .95), historyBlockRenders, chatSubscribers: chat.subscriberCount(), sessionSubscribers: sess.subscriberCount(), pendingSubscribers: pend.subscriberCount(), peakAnimations: animations, blurActive: blur, heavyPreserved, shimmerPreserved, scrollRange: Math.max(...scrolls) - Math.min(...scrolls), maxActiveChars: text.length, turns: 21, tools: 20, toolRowsDuringStream: { beforeStream: toolRowsBeforeStream, atHeavyCheck: toolRowsAtHeavyCheck } };
    flushSync(() => root.render(null));
    return result;
}
(window as any).runClearviewPerformance = async () => { const subscription = await subscriptions(); const performanceResult = await reader(); return { subscription, performance: performanceResult, failures }; };
