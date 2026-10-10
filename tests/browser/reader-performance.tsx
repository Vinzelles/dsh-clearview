import React, { memo, useRef, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { Reader } from 'fixture-source/Reader.tsx';
import { FileChangesCard } from 'fixture-source/FileChanges.tsx';
import readerCss from 'fixture-source/Reader.module.css';
import * as bridge from 'fixture-source/compat/session-snapshot.ts';
import { injectCompatStyles } from 'fixture-source/compat/styles.ts';
import { cachedSnapshot } from 'fixture-source/compat/reader-root.ts';
import { turnMeta, turnMetaText } from 'fixture-source/turn-meta.ts';
declare const __TRANSCRIPT__: boolean;
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
const selectChat = (selector: any, equal?: any) => bridge.useChatSelector(compat, selector, equal);
const selectPending = (selector: any, equal?: any) => bridge.usePendingSelector(compat, selector, equal);
async function subscriptions() {
    let renders = 0;
    const Child = memo(() => { const value = selectChat((c: any) => c.stable); renders++; return <span>{value?.text}</span>; });
    flushSync(() => root.render(<>{Array.from({ length: 40 }, (_, i) => <Child key={i}/>)}</>));
    renders = 0;
    for (let i = 0; i < 20; i++)
        flushSync(() => source.set({ ...source.get(), active: String(i) }));
    const extra = renders;
    check(extra === 0, 'unrelated chat updates rendered history');
    flushSync(() => root.render(null));
    let pendingRenders = 0;
    const Pending = () => { const value = selectPending((p: any) => p); pendingRenders++; return <span>{value.length}</span>; };
    flushSync(() => root.render(<Pending />));
    const own = { kind: 'question' };
    flushSync(() => pending.set(new Map([['fixture', own]])));
    pendingRenders = 0;
    flushSync(() => pending.set(new Map([['fixture', own], ['other', { kind: 'approval' }]])));
    check(pendingRenders === 0, 'other session pending update rendered this session');
    flushSync(() => root.render(null));
    {
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
    {
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
            // A narration interrupts each pair; adjacent calls exercise real grouping.
            if (k % 2 === 0) {
                turn.steps.push(priorStep);
                add({ key: `prior${k}`, kind: 'assistant-step', location: { kind: 'step', turn, step: priorStep }, data: prior });
            }
            const call = { name: 'read_file', argsRaw: JSON.stringify({ path: `src/file${k}.ts` }) };
            add({ key: `tool${k}`, kind: 'tool-call', location: { kind: 'step', turn, step: priorStep }, data: { root: { kind: 'tool-call', callId: `call${k}`, call, content: [{ type: 'text', text: '文件内容已读取。' }], subCalls: [], isError: false, callTime: Date.now() - 200, time: Date.now() } } });
        }
        data.step = 20;
        step.step = 20;
    }
    turn.steps.push(step);
    add({ key: `a${t}`, kind: 'assistant-step', location: { kind: 'step', turn, step }, data });
    if (t !== 21)
        turn.data.set('turn-tail', { closing: { step: 0, time: Date.now(), finalNode: { seq: 900 + t }, blocks: data.blocks } });
    turns.set(t, turn);
} return { order, nodes, timeline: { turns, turnOrder: [...turns.keys()] } }; }
// Keep this workload and its gates identical for 0.2.1 and 0.3.0; only DOM grammar differs.
const WORKLOAD = { id: 'reader-030-staged-v3', updates: 125, intervalMs: 40, reasoningUpdates: 50, toolUpdates: 25 };
function visible(node: Element): boolean {
    const style = getComputedStyle(node), box = node.getBoundingClientRect();
    const clip = node.closest('[data-reader-reasoning-scroll]')?.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0
        && box.width > 0 && box.height > 0 && box.bottom > Math.max(0, clip?.top ?? 0)
        && box.top < Math.min(innerHeight, clip?.bottom ?? innerHeight) && box.right > 0 && box.left < innerWidth;
}
function activeBlur(node: Element | undefined): boolean {
    const value = node && getComputedStyle(node).filter.match(/blur\(([\d.]+)px\)/)?.[1];
    return !!value && Number(value) > 0.001;
}
function shimmerActive(scope: Element): boolean {
    // 0.3 CSS animates the label itself; 0.2 host TextShimmer animates its inert decoration.
    return [...scope.querySelectorAll<HTMLElement>('[data-shimmer], [data-shimmer] > [inert]')].some(node =>
        visible(node) && node.getAnimations({ subtree: true }).some(a => a.playState === 'running'
            && (a.effect as KeyframeEffect)?.getKeyframes().some(f =>
                f.backgroundPosition !== undefined || f.backgroundPositionX !== undefined || f.transform !== undefined)));
}
function disclosure(row: Element | null): HTMLElement | null {
    return row?.querySelector<HTMLElement>(__TRANSCRIPT__ ? '[data-reader-line] > button[aria-expanded]' : '[data-disclosure-row]') ?? null;
}
// Independent real-DOM lifecycle fixtures. No host session/prefs or performance counters participate.
async function focusedLifecycles(chat: any, sess: any, prefs: any, props: any) {
    const saved = { chat: chat.get(), session: sess.get(), prefs: prefs.get() };
    const evidence: Record<string, any> = {};
    const focusEvents: any[] = [];
    const focusEvent = (event: Event) => { const target = event.target as HTMLElement; focusEvents.push({ type: event.type, tag: target.tagName, inFixture: host.contains(target), seat: target.closest?.('[data-reader-live-seat]')?.getAttribute('data-reader-key') }); };
    document.addEventListener('focusin', focusEvent); document.addEventListener('focusout', focusEvent);
    const imageUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNwaDjwHwAFBAKAPJ4DgAAAAABJRU5ErkJggg==';
    const fixtureProps = { ...props, loadImage: async () => imageUrl };
    const selection = document.getSelection()!;
    const clear = async () => {
        (document.activeElement as HTMLElement | null)?.blur?.();
        selection.removeAllRanges(); document.dispatchEvent(new Event('selectionchange')); await wait(60);
    };
    const scope = () => host.querySelector<HTMLElement>('[data-reader-turn="1"]')!;
    const publish = async (value: any) => { flushSync(() => chat.set(value)); await wait(100); };
    const seed = (blocks: any[]) => {
        const data = { turn: 1, step: 0, status: 'running', time: Date.now() - 5000, blocks };
        const step = { step: 0, data: new Map([['assistant-step', data]]) };
        const turn = { turn: 1, status: 'open', steps: [step], data: new Map(), start: { time: Date.now() - 5000 } };
        const user = { key: 'life-user', anchorSeq: 1, visibility: 'visible', kind: 'user', location: { kind: 'turn', turn }, data: { content: [{ type: 'text', text: '独立生命周期验收' }] } };
        const assistant = { key: 'life-a', anchorSeq: 2, visibility: 'visible', kind: 'assistant-step', location: { kind: 'step', turn, step }, data };
        return { order: [user.key, assistant.key], nodes: new Map([[user.key, user], [assistant.key, assistant]]), timeline: { turns: new Map([[1, turn]]), turnOrder: [1] } };
    };
    const assistant = (value: any, key: string, blocks: any[], status: string, stepNo = 0) => {
        const oldTurn = value.timeline.turns.get(1), oldNode = value.nodes.get(key);
        const data = { turn: 1, step: stepNo, time: oldNode?.data.time ?? Date.now() - 5000, status, blocks };
        const step = { step: stepNo, data: new Map([['assistant-step', data]]) };
        const steps = oldTurn.steps.some((item: any) => item.step === stepNo)
            ? oldTurn.steps.map((item: any) => item.step === stepNo ? step : item) : [...oldTurn.steps, step];
        const turn = { ...oldTurn, steps };
        const node = { ...(oldNode ?? { key, anchorSeq: value.order.length + 1, visibility: 'visible', kind: 'assistant-step' }), data, location: { kind: 'step', turn, step } };
        return { ...value, order: oldNode ? value.order : [...value.order, key], nodes: new Map(value.nodes).set(key, node), timeline: { ...value.timeline, turns: new Map([[1, turn]]) } };
    };
    const tool = (value: any, block: any) => {
        const key = `life-tool-${block.callId}`, prior = value.nodes.get(key), turn = value.timeline.turns.get(1), step = turn.steps.at(-1);
        const node = { ...(prior ?? { key, anchorSeq: value.order.length + 1, visibility: 'visible', kind: 'tool-call' }), data: { root: block }, location: { kind: 'step', turn, step } };
        return { ...value, order: prior ? value.order : [...value.order, key], nodes: new Map(value.nodes).set(key, node) };
    };
    const call = (id: string, name = 'read_file', raw = JSON.stringify({ path: `C:/synthetic/${id}.ts` }), returned = false, content: any[] = []) => ({
        callId: id, call: { name, argsRaw: raw }, subCalls: [], callTime: Date.now() - 1000,
        ...(returned ? { kind: 'tool-call', content, isError: false, time: Date.now() } : {})
    });
    const mount = async (value: any, motion = false) => {
        await clear(); flushSync(() => root.render(null));
        flushSync(() => { chat.set(value); prefs.set({ ...saved.prefs, motion }); sess.set({ ...saved.session, running: true }); root.render(<Reader {...fixtureProps}/>); });
        await wait(100);
    };
    const select = async (element: Element | null, label: string) => {
        const walker = element ? document.createTreeWalker(element, NodeFilter.SHOW_TEXT) : null;
        let node: Node | null = null;
        while (walker?.nextNode()) if ((walker.currentNode.textContent?.length ?? 0) >= 8) { node = walker.currentNode; break; }
        check(!!node, `${label}: no real selectable text node`);
        if (!node) return null;
        const range = document.createRange(); range.setStart(node, 0); range.setEnd(node, 8);
        selection.removeAllRanges(); selection.addRange(range); document.dispatchEvent(new Event('selectionchange')); await wait(80);
        const text = selection.toString(); check(text.length === 8, `${label}: selection not established`);
        return { node, text };
    };
    const retained = (savedSelection: { node: Node; text: string } | null) => !!savedSelection && savedSelection.node.isConnected
        && selection.anchorNode === savedSelection.node && selection.focusNode === savedSelection.node && selection.toString() === savedSelection.text;
    const inputTab = async (row: Element | null, title = '输入') => {
        disclosure(row)?.click(); await wait(80);
        const tab = [...(row?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [])].find(button => button.textContent === title);
        tab?.click(); await wait(60);
        return { tab, detail: row?.querySelector<HTMLElement>('[data-reader-tool-details]') ?? null, panel: row?.querySelector<HTMLElement>('[role="tabpanel"]') ?? null };
    };
    try {
        // High-rate reasoning must remain readable while blur and tail-follow are active.
        let burstValue = seed([{ kind: 'reasoning', text: '' }]);
        await mount(burstValue, true);
        let burstText = '', sampledWords = 0, minimumOpacity = 1, animatedWords = 0, futureStarts = 0;
        for (let frame = 0; frame < 60; frame++) {
            burstText += `Fast thought ${frame}: new words remain readable. 快速输出不应形成透明文字队列。\n\n`;
            burstValue = assistant(burstValue, 'life-a', [{ kind: 'reasoning', text: burstText }], 'running');
            flushSync(() => chat.set(burstValue));
            await wait(16);
            const words = [...scope().querySelectorAll<HTMLElement>('[data-reader-reasoning-text] [data-reader-word]')];
            for (const word of words) {
                sampledWords++;
                minimumOpacity = Math.min(minimumOpacity, Number(getComputedStyle(word).opacity));
                for (const animation of word.getAnimations()) {
                    animatedWords++;
                    if (Number(animation.startTime) > Number(document.timeline.currentTime) + 1) futureStarts++;
                }
            }
        }
        await wait(900);
        const burstPort = scope().querySelector<HTMLElement>('[data-reader-reasoning-scroll]');
        check(sampledWords > 0 && animatedWords > 0, 'rapid reasoning probe did not sample live animations');
        check(minimumOpacity >= .79 && futureStarts === 0, 'rapid reasoning became unreadable or queued future animation starts');
        check(burstPort?.textContent === burstText, 'rapid reasoning lost source text');
        check(!!burstPort && Math.abs(burstPort.scrollHeight - burstPort.clientHeight - burstPort.scrollTop) <= 2, 'rapid reasoning did not finish following the tail');
        evidence.rapidReasoning = { sampledWords, animatedWords, minimumOpacity, futureStarts, fullText: burstPort?.textContent === burstText };
        // Reproduce a companion reveal engine painting ranges through the generic host marker.
        // Element opacity alone cannot detect CSS Highlight text-alpha overrides.
        const paintNode = burstPort?.querySelector<HTMLElement>('[data-reader-text] > div');
        const paintRealm = globalThis as any;
        const registry = paintRealm.CSS?.highlights;
        check(!!paintNode && !!registry && !!paintRealm.Highlight, 'highlight paint probe unavailable');
        if (paintNode && registry && paintRealm.Highlight) {
            const name = 'clearview-readability-regression';
            const sheet = document.createElement('style');
            sheet.textContent = `[data-streaming] ::highlight(${name}) { color: rgb(1 2 3 / .2); }`;
            const control = document.createElement('div'); control.dataset.streaming = 'true';
            const span = document.createElement('span'); span.textContent = 'control'; control.append(span);
            const range = document.createRange(); range.selectNodeContents(paintNode);
            const controlRange = document.createRange(); controlRange.selectNodeContents(span);
            try {
                document.head.append(sheet); document.body.append(control);
                registry.set(name, new paintRealm.Highlight(range, controlRange));
                await wait(50);
                const normal = getComputedStyle(paintNode).color;
                const painted = getComputedStyle(paintNode, `::highlight(${name})`).color;
                const controlPaint = getComputedStyle(span, `::highlight(${name})`).color;
                evidence.highlightIsolation = { normal, painted, controlPaint,
                    readerOwnsMarker: !!scope().querySelector('[data-reader-streaming="true"]'),
                    hostMarkerCount: scope().querySelectorAll('[data-streaming]').length };
                check(controlPaint === 'rgba(1, 2, 3, 0.2)', 'highlight regression did not activate its control');
                check(painted === normal && evidence.highlightIsolation.hostMarkerCount === 0 && evidence.highlightIsolation.readerOwnsMarker,
                    'host highlight dimmed reader text despite normal element opacity');
            } finally { registry.delete(name); sheet.remove(); control.remove(); }
        }

        // Exercise the real TurnSection seat, not a standalone scrolling div.
        // Wheel reading owns neither focus nor selection and used to disappear at tool arrival.
        evidence.reasoningFollow = [];
        for (const motion of [false, true]) {
            let reason = '限高思考逐行输出，保留完整原文并跟随最新内容。\n'.repeat(45);
            let value = seed([{ kind: 'reasoning', text: reason }]); await mount(value, motion);
            const seat = scope().querySelector<HTMLElement>('[data-reader-live-seat]')!;
            const port = seat?.querySelector<HTMLElement>('[data-reader-reasoning-scroll]')!;
            check(!!port && port.scrollHeight > port.clientHeight, 'reasoning follow: overflowing live viewport missing');
            if (!port) continue;
            const tail = () => port.scrollHeight - port.clientHeight;
            const cap = port.clientHeight;
            check(Math.abs(port.clientHeight - 128) <= 1, 'reasoning follow: live viewport must retain the original 128px cap');
            reason += '新增长文本。\n'.repeat(6);
            value = assistant(value, 'life-a', [{ kind: 'reasoning', text: reason }], 'running'); await publish(value);
            await wait(1100);
            check(Math.abs(port.scrollTop - tail()) <= 2, 'reasoning follow: growth did not reach the tail');
            port.dispatchEvent(new WheelEvent('wheel', { deltaY: -80, bubbles: true }));
            port.scrollTop = Math.max(0, port.scrollTop - 90); await wait(80);
            const pausedTop = port.scrollTop;
            reason += '暂停期间继续收到的文字。\n'.repeat(5);
            value = assistant(value, 'life-a', [{ kind: 'reasoning', text: reason }], 'running'); await publish(value);
            check(Math.abs(port.scrollTop - pausedTop) <= 1, 'reasoning follow: growth moved a wheel-paused viewport');
            value = assistant(value, 'life-a', [{ kind: 'reasoning', text: reason }], 'settled');
            value = tool(value, call('wheel-read')); await publish(value);
            check(seat.isConnected && Math.abs(port.scrollTop - pausedTop) <= 1, 'reasoning -> tool lost wheel reading position');
            value = assistant(value, 'life-b', [{ kind: 'reasoning', text: '下一步思考。'.repeat(70) }], 'running', 1); await publish(value);
            check(seat.isConnected && Math.abs(port.scrollTop - pausedTop) <= 1, 'tool -> next step lost wheel reading position');
            check(seat.querySelector('[data-reader-reasoning-text]')?.textContent === reason, 'paused seat dropped reasoning text on settle');
            const resume = [...seat.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '结束回看');
            check(!!resume, 'wheel-paused thought has no resume action');
            resume?.focus(); await wait(40);
            resume?.click(); await wait(120);
            check(!seat.isConnected, 'explicit resume did not release the old wheel-reading seat');
            const thought = scope().querySelector<HTMLElement>('[data-reader-flow] [data-reader-reasoning]');
            disclosure(thought)?.click(); await wait(400);
            const history = thought?.querySelector<HTMLElement>('[data-reader-reasoning-scroll]');
            check(!!history && history.clientHeight <= 128 && history.scrollHeight > history.clientHeight, 'settled thought lost its capped scroll viewport');
            check(history?.textContent === reason, 'settled thought does not expose the complete reasoning');
            history?.focus(); await wait(80);
            check(![...thought!.querySelectorAll('button')].some(button => button.textContent === '继续跟随'), 'historical thought offers an ineffective resume action');
            evidence.reasoningFollow.push({ motion, cap, pausedTop, historyHeight: history?.clientHeight, fullText: history?.textContent === reason });
        }

        // Focus holds A first. Only after B exists do we select A, then transfer focus to B.
        const reason = '思考 A 正在阅读，出现 B 后仍要保留 A 的真实选区。'.repeat(100);
        let value = seed([{ kind: 'reasoning', text: reason }]); await mount(value);
        const seatA = scope().querySelector<HTMLElement>('[data-reader-live-seat][data-reader-key="life-a:0"]');
        const viewportA = seatA?.querySelector<HTMLElement>('[data-reader-reasoning-scroll]');
        viewportA?.focus({ preventScroll: true }); await wait(80);
        check(!!viewportA && document.activeElement === viewportA, 'focused A: real viewport focus was not established');
        value = assistant(value, 'life-a', [{ kind: 'reasoning', text: reason }], 'settled');
        value = assistant(value, 'life-b', [{ kind: 'reasoning', text: '思考 B 已出现，选中 A 时不能把 A 当作 B。'.repeat(60) }], 'running', 1);
        await publish(value);
        evidence.focusAfterB = { documentFocused: document.hasFocus(), activeInA: !!seatA?.contains(document.activeElement), events: focusEvents.slice() };
        const heldByFocus = !!seatA && seatA.isConnected && scope().querySelector('[data-reader-live-seat][data-reader-key="life-a:0"]') === seatA;
        check(heldByFocus, 'focused A -> B: original live seat was replaced');
        const selectedA = await select(seatA?.querySelector('[data-reader-reasoning-text]') ?? null, 'focused A -> B -> select A');
        scope().querySelector<HTMLElement>('[data-reader-live-seat][data-reader-key="life-b:0"] [data-reader-reasoning-scroll]')?.focus({ preventScroll: true });
        await wait(100);
        value = assistant(value, 'life-b', [{ kind: 'reasoning', text: '思考 B 继续生成，A 的选区必须原样保留。'.repeat(61) }], 'running', 1);
        await publish(value);
        evidence.focusAThenSelectAfterB = { heldByFocus, sameSeat: !!seatA && seatA.isConnected && scope().querySelector('[data-reader-live-seat][data-reader-key="life-a:0"]') === seatA,
            selectionRetained: retained(selectedA), selectedChars: selection.toString().length };
        check(evidence.focusAThenSelectAfterB.sameSeat && retained(selectedA), 'focus A -> B -> select A -> focus B: A DOM/selection was lost');
        await clear();
        const releasedThought = [...scope().querySelectorAll<HTMLElement>('[data-reader-reasoning]')].at(-1);
        disclosure(releasedThought ?? null)?.click(); await wait(80);
        evidence.focusAThenSelectAfterB.releasedToThought = !!seatA && !seatA.isConnected && releasedThought?.querySelector('[data-reader-reasoning-text]')?.textContent === reason;
        check(evidence.focusAThenSelectAfterB.releasedToThought, 'released focused/selected A did not become a full thought row');

        // A provisional body becomes narration when an operation arrives: same article and text nodes.
        const body = '这段正文暂时作为回答展示，工具出现后仍是同一段可选择文字。'.repeat(8);
        value = seed([{ kind: 'text', text: body }]); await mount(value);
        const article = scope().querySelector<HTMLElement>('article[data-reader-key="life-a"][data-reader-answer]');
        const selectedBody = await select(article?.querySelector('[data-reader-text]') ?? null, 'provisional body');
        check(!!article, 'provisional answer article missing before transition');
        value = tool(value, call('after-body')); await publish(value);
        evidence.bodyAnswerToNarration = { sameArticle: !!article && article.isConnected && scope().querySelector('article[data-reader-key="life-a"]') === article,
            selectionRetained: retained(selectedBody), fullTextRetained: article?.querySelector('[data-reader-text]')?.textContent === body,
            becameNarration: !!article && !article.hasAttribute('data-reader-answer') && !!scope().querySelector('[data-reader-tool-call="after-body"]') };
        check(Object.values(evidence.bodyAnswerToNarration).every(Boolean), 'answer -> narration: article/text/selection was replaced or routing failed');

        // Opening the singleton's input detail gives the group real reading intent.
        value = tool(seed([]), call('singleton')); await mount(value);
        const firstRow = scope().querySelector<HTMLElement>('[data-reader-tool-call="singleton"]');
        const firstParent = firstRow?.parentElement;
        const firstDetail = await inputTab(firstRow);
        check(!!firstRow && !!firstDetail.detail && !!firstDetail.tab && !!firstDetail.panel, 'singleton: real input detail did not open');
        value = tool(value, call('second')); await publish(value);
        const sameFirst = () => !!firstRow && firstRow.isConnected && scope().querySelector('[data-reader-tool-call="singleton"]') === firstRow
            && firstRow.parentElement === firstParent && firstRow.querySelector('[data-reader-tool-details]') === firstDetail.detail
            && firstRow.querySelector('[role="tab"][aria-selected="true"]') === firstDetail.tab && !!firstDetail.panel?.isConnected && visible(firstDetail.panel);
        const promoted = sameFirst() && scope().querySelectorAll('[data-reader-group] [data-reader-tool-call]').length === 2;
        check(promoted, 'singleton -> group: ToolRow parent/detail/tab state was replaced');
        const initialCall = (value.nodes.get('life-tool-singleton') as any).data.root;
        const attachment = { attachmentId: 'synthetic-lifecycle-image', name: 'synthetic.png', width: 32, height: 24 };
        value = tool(value, { ...initialCall, kind: 'tool-call', content: [{ type: 'image', attachment }], isError: false, time: Date.now() }); await publish(value);
        await wait(200);
        const image = scope().querySelector<HTMLImageElement>('[data-reader-tool-media] [data-reader-image] img');
        const imageReady = !!image && image.complete && image.naturalWidth > 0;
        check(imageReady, 'group first result: synthetic image was not decoded');
        const stableWithImage = sameFirst(); check(stableWithImage, 'first tool returned image: original ToolRow parent/detail was replaced');
        value = tool(value, call('second', 'read_file', undefined, true, [{ type: 'text', text: '第二工具返回。' }])); await publish(value);
        const group = scope().querySelector<HTMLElement>('[data-reader-group]');
        const retainedWhenSettled = sameFirst() && !!group && group.getBoundingClientRect().height > 0;
        check(retainedWhenSettled, 'settled group folded away an opened member detail');
        disclosure(group)?.click(); await wait(80);
        const imageOutsideFold = !!image && image.isConnected && scope().querySelector('[data-reader-tool-media] [data-reader-image] img') === image && visible(image);
        check(imageOutsideFold, 'folding the group hid/remounted its returned image');
        evidence.singletonToGroupWithImage = { promoted, stableWithImage, retainedWhenSettled, imageReady, imageOutsideFold };

        // Same call id moves from an incomplete raw fallback to a checklist; native details survive.
        evidence.todoFallbackToCard = {};
        for (const intent of ['detail', 'focus', 'selection', 'untouched']) {
            value = tool(seed([]), call('todo', 'todo_write', '{"todos":[')); await mount(value);
            const row = scope().querySelector<HTMLElement>('[data-reader-tool-call="todo"]');
            const parent = row?.parentElement;
            const history = scope().querySelector<HTMLDetailsElement>('[data-reader-plan-calls]');
            const plan = scope().querySelector<HTMLElement>('[data-reader-plan]');
            let detail: HTMLElement | null = null, tab: HTMLButtonElement | undefined, selectedRaw: { node: Node; text: string } | null = null;
            if (intent === 'detail' || intent === 'selection') {
                const view = await inputTab(row, intent === 'selection' ? '原始数据' : '输入'); detail = view.detail; tab = view.tab;
                check(!!detail && !!view.panel && visible(view.panel), `${intent} todo fallback: real detail is not visible`);
                if (intent === 'selection') selectedRaw = await select(view.panel, 'todo raw selection');
            } else if (intent === 'focus') {
                const button = disclosure(row); button?.focus({ preventScroll: true }); await wait(60);
                check(!!button && document.activeElement === button, 'todo fallback focus was not established');
            }
            check(!!history?.open && !!row && !!plan, `${intent} todo fallback: original call/history missing`);
            const raw = JSON.stringify({ todos: [{ content: '验证原始计划调用', status: 'pending' }, { content: '完成项的勾需要在框内居中', status: 'completed' }] });
            value = tool(value, call('todo', 'todo_write', raw, true, [{ type: 'text', text: '计划已保存。' }])); await publish(value);
            const checklist = scope().querySelector<HTMLElement>('[data-reader-plan] [data-status="pending"]');
            const facts = { samePlan: !!plan && plan.isConnected && scope().querySelector('[data-reader-plan]') === plan,
                sameRowParent: !!row && row.isConnected && scope().querySelector('[data-reader-tool-call="todo"]') === row && row.parentElement === parent,
                sameHistory: !!history && scope().querySelector('[data-reader-plan-calls]') === history,
                realChecklist: !!checklist && checklist.textContent?.includes('验证原始计划调用') && visible(checklist),
                historyOpen: history?.open ?? false,
                detailRetained: !detail || (detail.isConnected && row?.querySelector('[data-reader-tool-details]') === detail && visible(detail) && row?.querySelector('[role="tab"][aria-selected="true"]') === tab),
                selectionRetained: intent !== 'selection' || retained(selectedRaw) };
            evidence.todoFallbackToCard[intent] = facts;
            check(facts.samePlan && facts.sameRowParent && facts.sameHistory && facts.realChecklist && facts.detailRetained && facts.selectionRetained,
                `${intent} todo fallback -> card: original raw call/detail DOM, checklist, or selection was lost`);
            check(facts.historyOpen === (intent !== 'untouched'), `${intent} todo promotion did not respect real reading intent`);
        }
        const tick = scope().querySelector<SVGSVGElement>('[data-reader-plan] [data-status="completed"] > span > svg');
        const tickBox = tick?.parentElement;
        const tickRect = tick?.getBoundingClientRect(), boxRect = tickBox?.getBoundingClientRect();
        evidence.planTick = { present: !!tick && !!tickBox && visible(tickBox),
            dx: tickRect && boxRect ? Math.abs(tickRect.left + tickRect.width / 2 - boxRect.left - boxRect.width / 2) : null,
            dy: tickRect && boxRect ? Math.abs(tickRect.top + tickRect.height / 2 - boxRect.top - boxRect.height / 2) : null };
        check(evidence.planTick.present && evidence.planTick.dx <= .5 && evidence.planTick.dy <= .5, 'completed plan SVG tick is not centered in its actual box');

        // Whole-turn folding keeps the final answer visible and preserves the same process DOM.
        let processValue = seed([{ kind: 'text', text: '保留这段过程正文，折叠只改变可见性。'.repeat(5) }]);
        processValue = tool(processValue, call('fold', 'read_file', JSON.stringify({ path: 'C:/synthetic/fold.ts' }), true, [{ type: 'text', text: '原始工具输出仍可查看。' }]));
        await mount(processValue);
        const processArticle = scope().querySelector<HTMLElement>('article[data-reader-key="life-a"]');
        const processText = processArticle?.textContent;
        const finish = (source: any) => {
            const next = assistant(source, 'life-final', [{ kind: 'text', text: '这是始终可见的最终回答。' }], 'settled', 1);
            const oldTurn = next.timeline.turns.get(1);
            const end = { time: Date.now(), data: { reason: { kind: 'completed' } } };
            const turn = { ...oldTurn, status: 'closed', end, data: new Map([['turn-tail', { closing: { step: 1, time: end.time, finalNode: { seq: 900 } } }]]) };
            return { ...next, timeline: { ...next.timeline, turns: new Map([[1, turn]]) } };
        };
        await publish(finish(processValue)); await wait(350);
        let processButton = scope().querySelector<HTMLButtonElement>('[data-reader-turn-disclosure]');
        const finalAnswer = scope().querySelector<HTMLElement>('[data-reader-answer][data-reader-key="life-final"]');
        const collapsed = processButton?.getAttribute('aria-expanded') === 'false' && !!processArticle && !visible(processArticle) && !!finalAnswer && visible(finalAnswer);
        check(collapsed, 'completed turn did not fold process independently of its final answer');
        processButton?.click(); await wait(350);
        const processExpanded = processButton?.getAttribute('aria-expanded') === 'true' && !!processArticle && visible(processArticle) && processArticle.isConnected
            && scope().querySelector('article[data-reader-key="life-a"]') === processArticle && processArticle.textContent === processText;
        check(processExpanded, 'process expansion replaced or failed to reveal original prose');
        processButton?.click(); await wait(350);
        const refolded = !!processArticle && processArticle.isConnected && !visible(processArticle) && !!finalAnswer && visible(finalAnswer);
        check(refolded, 'process re-fold removed its DOM or hid the final answer');
        await publish(processValue); // Resume without clearing the saved closed choice.
        const selectedProcess = await select(scope().querySelector('article[data-reader-key="life-a"]'), 'process completion selection');
        await publish(finish(processValue)); await wait(350);
        processButton = scope().querySelector<HTMLButtonElement>('[data-reader-turn-disclosure]');
        const heldBySelection = processButton?.getAttribute('aria-expanded') === 'true' && retained(selectedProcess);
        check(heldBySelection, 'completion collapsed or replaced selected process prose');
        await clear(); await wait(350);
        const foldedAfterRead = processButton?.getAttribute('aria-expanded') === 'false';
        check(foldedAfterRead, 'completed process did not fold after reading ended');
        await publish(processValue);
        const processControl = scope().querySelector<HTMLButtonElement>('[data-reader-tool-call] button');
        processControl?.focus(); await wait(80);
        await publish(finish(processValue)); await wait(100);
        processButton = scope().querySelector<HTMLButtonElement>('[data-reader-turn-disclosure]');
        const heldByProcessFocus = processButton?.getAttribute('aria-expanded') === 'true';
        processButton?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }));
        processButton?.focus(); await wait(80);
        processButton?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })); await wait(350);
        const focusTransferClose = heldByProcessFocus && processButton?.getAttribute('aria-expanded') === 'false';
        check(focusTransferClose, 'moving focus to the process summary reversed a close click');
        evidence.turnProcess = { collapsed, expanded: processExpanded, refolded, heldBySelection, foldedAfterRead, focusTransferClose };
        const userText = Array.from({ length: 20 }, (_, index) => `第 ${index + 1} 行：完整用户内容必须保留，初始截断仍可展开和收起。`).join('\n');
        value = seed([]);
        const user = value.nodes.get('life-user');
        value.nodes.set(user.key, { ...user, data: { content: [{ type: 'text', text: userText }] } });
        await mount(value); await wait(200);
        const bubble = scope().querySelector<HTMLElement>('[data-reader-user-bubble]');
        const box = bubble?.querySelector<HTMLElement>('[data-open]');
        const clampHeight = box?.clientHeight ?? 0;
        const lineHeight = box ? parseFloat(getComputedStyle(box).lineHeight) : 0;
        const expand = [...scope().querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '展开全文');
        const initiallyClipped = !!box && clampHeight > 0 && box.scrollHeight > clampHeight + 1 && clampHeight <= lineHeight * 6 + 1;
        check(initiallyClipped && !!expand && box?.textContent === userText, 'RO initial clamp missing or user source text lost');
        const surface = bubble?.closest<HTMLElement>('[data-reader-user-surface]');
        const inside = !!surface && !!expand && surface.contains(expand) && !bubble!.contains(expand) && expand.getBoundingClientRect().bottom <= surface.getBoundingClientRect().bottom;
        const fade = !!box && getComputedStyle(box).maskImage !== 'none';
        const border = !!surface && parseFloat(getComputedStyle(surface).borderTopWidth) >= 1;
        check(inside && fade && border, 'bubble needs a visible boundary, clipping cue and internal toggle');
        expand?.click(); await wait(100);
        const expanded = !!box && box.clientHeight > clampHeight + 1 && box.scrollHeight <= box.clientHeight + 1 && box.textContent === userText;
        check(expanded, 'long user bubble did not show complete source on expansion');
        [...scope().querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '收起')?.click(); await wait(150);
        const clippedAgain = !!box && box.clientHeight <= lineHeight * 6 + 1 && box.scrollHeight > box.clientHeight + 1 && box.textContent === userText;
        check(clippedAgain, 'long user bubble did not restore clamp after collapsing');
        evidence.userBubble = { initiallyClipped, expanded, clippedAgain, clampHeight, lineHeight, inside, fade, border };
        check(!host.querySelector('[data-reader-block-error]'), 'focused lifecycle fixture hit a Reader error boundary');
        const fileOpens: string[] = [];
        const fileSummary = { added: [], deleted: [], total: 6, modified: Array.from({ length: 6 }, (_, index) => ({ key: `file-${index}`, display: `src/components/file-${index}.ts`, kind: 'modified' as const, turns: [1], edits: [{ oldText: 'before\n', newText: 'after\nextra\n' }] })) };
        flushSync(() => root.render(<div className={readerCss.root} data-dsh-clearview="fixture"><FileChangesCard summary={fileSummary} hasMore={true} motion={false} openFile={path => { fileOpens.push(path); }} /></div>));
        await wait(100);
        const card = host.querySelector<HTMLElement>('[data-reader-file-changes]')!;
        const rows = () => card.querySelectorAll('[data-reader-changed-file]').length;
        const control = (label: string) => [...card.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === label);
        check(rows() === 3 && !!control('再显示 3 个文件'), 'file card must initially show three of six files');
        control('再显示 3 个文件')?.click(); await wait(80);
        const expandedFiles = rows() === 6;
        control('收起文件列表')?.click(); await wait(80);
        card.querySelector<HTMLButtonElement>('[data-reader-changed-file] button')?.click();
        control('审阅')?.click(); await wait(100);
        const reviewOpened = card.getAttribute('data-open') === 'true' && !!card.querySelector('[data-reader-file-review]')?.textContent?.includes('before');
        control('关闭审阅')?.click(); await wait(100);
        evidence.fileCard = { expandedFiles, collapsedFiles: rows() === 3, reviewOpened, reviewClosed: card.getAttribute('data-open') === 'false', fileOpened: fileOpens[0] === 'src/components/file-0.ts' };
        check(Object.values(evidence.fileCard).every(Boolean), 'file card expansion, review or file opening failed');
    } finally {
        document.removeEventListener('focusin', focusEvent); document.removeEventListener('focusout', focusEvent);
        await clear(); flushSync(() => root.render(null));
        flushSync(() => { chat.set(saved.chat); sess.set(saved.session); prefs.set(saved.prefs); root.render(<Reader {...props}/>); });
        await wait(100);
    }
    return evidence;
}
async function reader() {
    const initial = makeData();
    const scheduledTools = new Map([18, 19].map(k => [k, initial.nodes.get(`tool${k}`)]));
    // The final pair arrives in the current model step, rather than reviving calls from an older step.
    initial.order = initial.order.filter(key => key !== 'tool18' && key !== 'tool19');
    initial.nodes.delete('tool18'); initial.nodes.delete('tool19');
    const chat = store(initial, true);
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
    performance.mark('clearview-mount-start');
    const mountStart = performance.now();
    flushSync(() => root.render(<Reader {...props}/>));
    const mountCommitMs = performance.now() - mountStart;
    performance.mark('clearview-mount-end');
    await frame();
    const mountFrameMs = performance.now() - mountStart;
    // The second rAF is after at least one paint opportunity. This includes
    // natural layout and initial RO/scroll restoration, so deferring layout
    // past flushSync cannot masquerade as faster first-screen rendering.
    await frame();
    const mountPaintMs = performance.now() - mountStart;
    performance.mark('clearview-mount-painted');
    await document.fonts.ready;
    await wait(600);
    const readerRoot = host.querySelector<HTMLElement>('[data-dsh-clearview]')!;
    check(readerRoot.dataset.motion === 'on', 'fixture motion must be enabled');
    check(!matchMedia('(prefers-reduced-motion: reduce)').matches, 'fixture requires no reduced motion');
    const fontStatusAtStreamStart = document.fonts.status;
    const mountHistoryBlockRenders = historyBlockRenders;
    historyBlockRenders = 0;
    const activeTurn = () => host.querySelector<HTMLElement>('[data-reader-turn="21"]')!;
    const toolRowsBeforeStream = activeTurn().querySelectorAll('[data-reader-tool-call]').length;
    const frames: number[] = [], commits: number[] = [], scrolls: number[] = [];
    const slowFrames: any[] = [];
    const stageEvidence: Record<string, any> = {};
    let last = 0, lastInput = 0, animations = 0, blur = false;
    let heavyPreserved = false, shimmerPreserved = false;
    let reasoningText = '', text = '', phase = 'reasoning';
    let activeKey = 'a21';
    const append = (nextText: string, nextPhase: string) => {
        const old = chat.get(), oldTurn = old.timeline.turns.get(21);
        const textPhase = nextPhase === 'text', key = textPhase ? 'final21' : 'a21', stepNo = textPhase ? 21 : 20;
        const oldNode = old.nodes.get(key) ?? old.nodes.get('a21');
        const blocks: any[] = textPhase ? [{ kind: 'text', text: nextText }] : [{ kind: 'reasoning', text: reasoningText }];
        if (nextPhase === 'tools') for (const k of [18, 19]) blocks.push({ kind: 'tool-call', callId: `call${k}`, name: 'read_file', argsRaw: JSON.stringify({ path: `src/file${k}.ts` }) });
        const data = { ...oldNode.data, step: stepNo, status: nextPhase === 'tools' ? 'settled' : 'running', blocks };
        const step = { step: stepNo, data: new Map([['assistant-step', data]]) };
        const steps = oldTurn.steps.some((item: any) => item.step === stepNo)
            ? oldTurn.steps.map((item: any) => item.step === stepNo ? step : item) : [...oldTurn.steps, step];
        const turn = { ...oldTurn, steps };
        const order = old.nodes.has(key) ? [...old.order] : [...old.order, key];
        const nextSeq = Math.max(...[...old.nodes.values()].map((node: any) => node.anchorSeq)) + 1;
        const node = { ...oldNode, key, anchorSeq: old.nodes.has(key) ? oldNode.anchorSeq : nextSeq, data, location: { kind: 'step', turn, step } };
        const nodes = new Map(old.nodes).set(key, node);
        if (phase !== nextPhase && nextPhase !== 'reasoning') for (const k of [18, 19]) {
            const scheduled: any = scheduledTools.get(k), previous = old.nodes.get(`tool${k}`) ?? scheduled, settled = scheduled.data.root;
            const toolRoot = nextPhase === 'tools' ? { callId: settled.callId, call: settled.call, subCalls: [], callTime: Date.now() } : settled;
            if (!old.nodes.has(previous.key)) order.push(previous.key);
            const toolStep = nextPhase === 'tools' ? step : oldTurn.steps.find((item: any) => item.step === 20);
            nodes.set(previous.key, { ...previous, anchorSeq: nextPhase === 'tools' ? nextSeq + k - 18 : previous.anchorSeq, data: { root: toolRoot }, location: { kind: 'step', turn, step: toolStep } });
        }
        chat.set({ ...old, order, nodes, timeline: { ...old.timeline, turns: new Map(old.timeline.turns).set(21, turn) } });
        activeKey = key; phase = nextPhase;
    };
    performance.mark('clearview-stream-start');
    const start = performance.now();
    const streamStartedAtUtcMs = Date.now();
    let updates = 0;
    while (updates < WORKLOAD.updates) {
        const now = await frame();
        if (last) { frames.push(now - last); if (now - last > 50) slowFrames.push({ durationMs: now - last, phase, updates, elapsedMs: now - start }); }
        last = now;
        if (now - lastInput >= WORKLOAD.intervalMs) {
            lastInput = now;
            const nextPhase = updates < WORKLOAD.reasoningUpdates ? 'reasoning'
                : updates < WORKLOAD.reasoningUpdates + WORKLOAD.toolUpdates ? 'tools' : 'text';
            if (nextPhase === 'reasoning') reasoningText += '检查当前状态，并验证实际结果。';
            if (nextPhase === 'text') text += '检查当前状态，并验证实际结果。';
            const t = performance.now();
            flushSync(() => append(text, nextPhase));
            commits.push(performance.now() - t);
            updates++;
        }
        scrolls.push(host.scrollTop);
        const live = readerRoot.getAnimations({ subtree: true });
        animations = Math.max(animations, live.length);
        blur ||= live.some(a => a.playState === 'running' && (a.effect as KeyframeEffect)?.getKeyframes().some(f => String(f.filter).includes('blur(1px)')));
        if (!stageEvidence[phase] && (phase === 'reasoning' ? updates >= 25 : phase === 'tools' ? updates >= 60 : updates >= 85)) {
            const scope = activeTurn();
            const word = [...scope.querySelectorAll<HTMLElement>('[data-reader-word][data-word-state="resolving"]')].find(node => visible(node) && activeBlur(node));
            // Capture blur at its real, visible frontier; retry until one exists, never silently skip.
            if (phase !== 'tools' && !word) continue;
            const savedHeavy = readerRoot.getAttribute('data-dshcp-heavy');
            readerRoot.dataset.dshcpHeavy = 'off';
            const normalBlur = activeBlur(word);
            const normalShimmer = shimmerActive(scope);
            readerRoot.dataset.dshcpHeavy = 'on';
            const heavyBlur = activeBlur(word);
            const heavyShimmer = shimmerActive(scope);
            if (savedHeavy === null) readerRoot.removeAttribute('data-dshcp-heavy');
            else readerRoot.setAttribute('data-dshcp-heavy', savedHeavy);
            const evidence = { normalBlur, heavyBlur, normalShimmer, heavyShimmer,
                toolRows: scope.querySelectorAll('[data-reader-tool-call]').length,
                runningTools: scope.querySelectorAll('[data-reader-tool-call][data-tool-phase="running"]').length,
                runningGroups: scope.querySelectorAll('[data-reader-group][data-group-state="running"][data-expanded="true"]').length,
                runningClusters: scope.querySelectorAll('[data-reader-cluster][data-cluster-state="running"]').length,
                sourceRunningCalls: [...chat.get().nodes.values()].filter((node: any) => node.kind === 'tool-call' && !('kind' in node.data.root)).length,
                statusLines: scope.querySelectorAll('[data-reader-status-line]').length,
                liveThought: !!scope.querySelector('[data-reader-live-thought]'),
                body: !!scope.querySelector(`[data-reader-answer][data-reader-key="${activeKey}"] [data-reader-text-kind="body"]`) };
            stageEvidence[phase] = evidence;
            if (phase === 'reasoning') { heavyPreserved = normalBlur && heavyBlur; shimmerPreserved = normalShimmer && heavyShimmer; }
            check(normalShimmer && heavyShimmer, `${phase}: visible shimmer must animate in normal and heavy modes`);
            if (phase !== 'tools') check(normalBlur && heavyBlur, `${phase}: heavy mode removed visible positive blur`);
            if (phase === 'tools') check(evidence.sourceRunningCalls === 2 && (__TRANSCRIPT__ ? evidence.runningTools === 2 : evidence.runningClusters === 1), 'running tool pair/group was not exercised in the source grammar');
            if (phase === 'text') check(evidence.body, 'streamed body is not in the answer zone');
            if (__TRANSCRIPT__) {
                check(evidence.statusLines === 1, `${phase}: expected exactly one status line`);
                if (phase === 'reasoning') check(evidence.liveThought, 'live thought phase missing');
                if (phase === 'tools') check(evidence.runningGroups === 1, 'running group must auto-expand');
            }
        }
    }
    frames.push((await frame()) - last);
    performance.mark('clearview-stream-end');
    const streamDurationMs = performance.now() - start;
    const streamEndedAtUtcMs = Date.now();
    const streamingHistoryBlockRenders = historyBlockRenders;
    check(streamingHistoryBlockRenders === 0, 'full Reader rerendered historical text blocks during stream');
    check(Object.keys(stageEvidence).length === 3, 'reasoning/tools/text animation stages were not all measured');
    check(animations > 0 && blur, 'original blur animation was not active');
    check(heavyPreserved, 'visible heavy-mode blur probe missing or failed');
    check(shimmerPreserved, 'visible heavy-mode shimmer probe missing or failed');
    check(host.querySelectorAll('[data-reader-turn]').length === 21, 'full Reader turn count');
    check(!host.querySelector('[data-reader-block-error]'), 'Reader error boundary');
    if (__TRANSCRIPT__) {
        check(activeTurn().querySelectorAll('[data-reader-group]').length === 10, 'adjacent tool pairs were not grouped');
        check(!activeTurn().querySelector('[data-reader-group][data-expanded="true"]'), 'settled groups should auto-fold');
    }
    // Open only the synthetic active turn's containers, outside the timed window.
    if (!__TRANSCRIPT__) {
        activeTurn().querySelector<HTMLElement>('[data-reader-earlier]')?.click();
        await wait(400);
    }
    for (const group of activeTurn().querySelectorAll<HTMLElement>('[data-reader-group], [data-reader-cluster]')) {
        if (group.dataset.expanded !== 'true') disclosure(group)?.click();
    }
    await wait(400);
    check(activeTurn().querySelectorAll('[data-reader-tool-call]').length === 20, 'tool rows missing');
    const toolRow = activeTurn().querySelector<HTMLElement>('[data-reader-tool-call="call19"]');
    disclosure(toolRow)?.click();
    await wait(300);
    check(toolRow?.dataset.expanded === 'true' && !!toolRow.querySelector('[data-reader-tool-details]'), 'native tool detail did not open');
    disclosure(toolRow)?.click();
    await wait(300);
    check(toolRow?.dataset.expanded === 'false', 'native tool detail did not close');
    const before = host.scrollTop;
    host.dispatchEvent(new WheelEvent('wheel', { deltaY: -160, bubbles: true }));
    host.scrollTop = Math.max(0, before - 160);
    await wait(80);
    const paused = host.scrollTop;
    flushSync(() => append(text += '补充说明。'.repeat(8), 'text'));
    await wait(250);
    check(host.scrollTop <= paused + 2, 'manual upward scroll did not pause follow');
    const jump = host.querySelector<HTMLButtonElement>(__TRANSCRIPT__ ? '[data-reader-jump]' : '[data-reader-activity-pill], [data-reader-jump]');
    check(!!jump, 'back-to-latest control missing');
    jump?.click();
    await wait(80);
    check(host.scrollHeight - host.clientHeight - host.scrollTop < 3, 'back-to-latest did not reach bottom');
    const interactionHistoryBlockRenders = historyBlockRenders - streamingHistoryBlockRenders;
    historyBlockRenders = 0;
    const old = chat.get(), oldNode = old.nodes.get(activeKey), oldTurn = old.timeline.turns.get(21);
    const data = { ...oldNode.data, status: 'settled' };
    const step = { step: 21, data: new Map([['assistant-step', data]]) };
    const turn = { ...oldTurn, status: 'closed', steps: [...oldTurn.steps.slice(0, -1), step], end: { time: Date.now(), data: { reason: { kind: 'completed' } } }, data: new Map([['turn-tail', { closing: { step: 21, time: Date.now(), finalNode: { seq: 921 }, blocks: data.blocks } }]]) };
    flushSync(() => { chat.set({ ...old, nodes: new Map(old.nodes).set(activeKey, { ...oldNode, data, location: { kind: 'step', turn, step } }), timeline: { ...old.timeline, turns: new Map(old.timeline.turns).set(21, turn) } }); sess.set({ ...sess.get(), running: false }); });
    await wait(750);
    const lastTexts = activeTurn().querySelectorAll(`[data-reader-answer][data-reader-key="${activeKey}"] [data-reader-text-kind="body"]`);
    const finalText = [...lastTexts].map(node => node.textContent).join('');
    check(lastTexts.length === 1 && finalText === text, 'final streamed text differs from source');
    const settledHistoryBlockRenders = historyBlockRenders;
    check(settledHistoryBlockRenders === 0, 'settlement rerendered historical text blocks');
    historyBlockRenders = 0;
    const saved = chat.get();
    flushSync(() => chat.set(undefined));
    check(host.querySelectorAll('[data-reader-turn]').length === 0, 'absent chat kept old turns');
    flushSync(() => chat.set(saved));
    check(host.querySelectorAll('[data-reader-turn]').length === 21, 'restored chat lost turns');
    const snap = cachedSnapshot(host.querySelector('[data-dsh-clearview]')! as HTMLElement);
    check(snap?.chat.timeline.turns.get(21)?.status === 'closed', 'DOM compat snapshot stale');
    check(!!snap && turnMetaText(turnMeta(snap.chat.timeline.turns.get(21))) !== '', 'turn footer missing after fine-grained subscriptions');
    check(!host.querySelector('[data-reader-block-error]'), 'Reader error boundary after interactions');
    const restorationHistoryBlockRenders = historyBlockRenders;
    // Functional lifecycle probes are outside stream timing and do not touch host stores.
    const lifecycle: Record<string, any> = { supported: __TRANSCRIPT__ };
    if (__TRANSCRIPT__) {
        const closedChat = chat.get(), closedSession = sess.get(), savedPrefs = prefs.get();
        const reason = '保留正在阅读的思考选区，直到用户主动释放。'.repeat(16);
        const baseNode = closedChat.nodes.get('a21'), baseTurn = closedChat.timeline.turns.get(21);
        const liveData = { ...baseNode.data, status: 'running', blocks: [{ kind: 'reasoning', text: reason }] };
        const liveStep = { step: 20, data: new Map([['assistant-step', liveData]]) };
        const liveTurn = { ...baseTurn, status: 'open', end: undefined, data: new Map(), steps: [...baseTurn.steps.filter((step: any) => step.step < 20), liveStep] };
        const liveChat = { ...closedChat, order: closedChat.order.filter((key: string) => !['tool18', 'tool19', 'final21'].includes(key)), nodes: new Map([...closedChat.nodes].filter(([key]: any) => !['tool18', 'tool19', 'final21'].includes(key))).set('a21', { ...baseNode, data: liveData, location: { kind: 'step', turn: liveTurn, step: liveStep } }),
            timeline: { ...closedChat.timeline, turns: new Map(closedChat.timeline.turns).set(21, liveTurn) } };
        flushSync(() => { prefs.set({ ...savedPrefs, motion: false }); chat.set(liveChat); sess.set({ ...closedSession, running: true }); });
        await wait(100);
        const seat = activeTurn().querySelector<HTMLElement>('[data-reader-live-seat]');
        const content = seat?.querySelector('[data-reader-reasoning-text]');
        const walker = content ? document.createTreeWalker(content, NodeFilter.SHOW_TEXT) : null;
        let selectedNode: Node | null = null;
        while (walker?.nextNode()) { if ((walker.currentNode.textContent?.length ?? 0) >= 8) { selectedNode = walker.currentNode; break; } }
        check(!!seat && !!selectedNode, 'selection fixture lacks a live thought text node');
        if (seat && selectedNode) {
            const selection = document.getSelection()!;
            const range = document.createRange();
            range.setStart(selectedNode, 0); range.setEnd(selectedNode, 8);
            selection.removeAllRanges(); selection.addRange(range);
            document.dispatchEvent(new Event('selectionchange'));
            await wait(80);
            const selectedText = selection.toString();
            check(selectedText.length === 8, 'live selection was not established');
            const settledData = { ...liveData, status: 'settled' };
            const settledStep = { ...liveStep, data: new Map([['assistant-step', settledData]]) };
            const settledTurn = { ...liveTurn, steps: [...liveTurn.steps.slice(0, -1), settledStep] };
            const settledChat = { ...liveChat, nodes: new Map(liveChat.nodes).set('a21', { ...baseNode, data: settledData, location: { kind: 'step', turn: settledTurn, step: settledStep } }),
                timeline: { ...liveChat.timeline, turns: new Map(liveChat.timeline.turns).set(21, settledTurn) } };
            flushSync(() => chat.set(settledChat));
            await wait(100);
            lifecycle.retainedOnSettle = seat.isConnected && selectedNode.isConnected && selection.anchorNode === selectedNode && selection.toString() === selectedText;
            check(lifecycle.retainedOnSettle, 'settling reasoning removed or replaced selected live DOM');
            const nextData = { ...liveData, step: 21, blocks: [{ kind: 'reasoning', text: '新步骤开始，旧选区仍须保留。' }] };
            const nextStep = { step: 21, data: new Map([['assistant-step', nextData]]) };
            const nextTurn = { ...settledTurn, steps: [...settledTurn.steps, nextStep] };
            const nextNode = { ...baseNode, key: 'selection-next', anchorSeq: Math.max(...[...settledChat.nodes.values()].map((node: any) => node.anchorSeq)) + 1,
                data: nextData, location: { kind: 'step', turn: nextTurn, step: nextStep } };
            flushSync(() => chat.set({ ...settledChat, order: [...settledChat.order, nextNode.key], nodes: new Map(settledChat.nodes).set(nextNode.key, nextNode),
                timeline: { ...settledChat.timeline, turns: new Map(settledChat.timeline.turns).set(21, nextTurn) } }));
            await wait(100);
            lifecycle.retainedWithNewStep = seat.isConnected && selectedNode.isConnected && selection.anchorNode === selectedNode && selection.toString() === selectedText
                && activeTurn().querySelectorAll('[data-reader-live-seat]').length === 2;
            check(lifecycle.retainedWithNewStep, 'new reasoning step removed the selected previous live seat');
            selection.removeAllRanges();
            document.dispatchEvent(new Event('selectionchange'));
            await wait(100);
            const thoughts = activeTurn().querySelectorAll<HTMLElement>('[data-reader-flow] [data-reader-reasoning]');
            const thought = thoughts[thoughts.length - 1];
            lifecycle.releasedToThought = !seat.isConnected && activeTurn().querySelectorAll('[data-reader-live-seat]').length === 1 && !!thought;
            check(lifecycle.releasedToThought, 'clearing selection did not restore a normal thought row');
            disclosure(thought)?.click();
            await wait(100);
            check(thought?.querySelector('[data-reader-reasoning-text] [data-reader-text]')?.textContent === reason, 'released thought row lost reasoning text');
        }
        flushSync(() => { chat.set(closedChat); sess.set(closedSession); prefs.set(savedPrefs); });
        await wait(150);
    }
    if (__TRANSCRIPT__) lifecycle.focused = await focusedLifecycles(chat, sess, prefs, props);
    // Normalize local disclosure state before comparing positions across remounts.
    flushSync(() => root.render(null));
    await frame();
    flushSync(() => root.render(<Reader {...props}/>));
    await wait(200);
    // A detached reading position must survive a Reader remount, then jump resumes the tail.
    host.dispatchEvent(new WheelEvent('wheel', { deltaY: -200, bubbles: true }));
    host.scrollTop = Math.max(0, host.scrollHeight - host.clientHeight - 200);
    await wait(100);
    const rememberedTop = host.scrollTop;
    const detachedBeforeRemount = host.scrollHeight - host.clientHeight - rememberedTop > 100;
    flushSync(() => root.render(null));
    await frame();
    if (__TRANSCRIPT__) {
        // Leave the reader again before RO has consumed the saved anchor. This
        // must not erase that position or replace it with a zero-height seat.
        flushSync(() => root.render(<Reader {...props}/>));
        flushSync(() => root.render(null));
    }
    flushSync(() => root.render(<Reader {...props}/>));
    await wait(200);
    lifecycle.positionRestored = detachedBeforeRemount && Math.abs(host.scrollTop - rememberedTop) <= 2;
    check(lifecycle.positionRestored, 'Reader remount lost detached reading position');
    if (__TRANSCRIPT__) {
        flushSync(() => root.render(null));
        flushSync(() => root.render(<Reader {...props}/>));
        host.dispatchEvent(new WheelEvent('wheel', { deltaY: -200, bubbles: true }));
        host.scrollTop = Math.max(0, host.scrollHeight - host.clientHeight - 350);
        const gestureTop = host.scrollTop;
        await wait(200);
        lifecycle.initialGesturePreserved = Math.abs(host.scrollTop - gestureTop) <= 2;
        check(lifecycle.initialGesturePreserved, 'initial RO restoration overrode an upward reader gesture');
    }
    const restoredJump = host.querySelector<HTMLButtonElement>('[data-reader-jump]');
    check(!!restoredJump, 'remounted detached Reader lacks jump control');
    restoredJump?.click();
    await wait(100);
    lifecycle.jumpRestored = host.scrollHeight - host.clientHeight - host.scrollTop < 3;
    check(lifecycle.jumpRestored, 'jump after remount did not restore latest position');
    const result = { fontStatusAtStreamStart, mountCommitMs, mountFrameMs, mountPaintMs, frameP95: quantile(frames, .95), frameMax: Math.max(...frames), framesOver25: frames.filter(n => n > 25).length, samples: frames.length, commitP95: quantile(commits, .95),
        historyBlockRenders: streamingHistoryBlockRenders,
        historyRendersByPhase: { mount: mountHistoryBlockRenders, stream: streamingHistoryBlockRenders, interaction: interactionHistoryBlockRenders, settlement: settledHistoryBlockRenders, restoration: restorationHistoryBlockRenders },
        chatSubscribers: chat.subscriberCount(), sessionSubscribers: sess.subscriberCount(), pendingSubscribers: pend.subscriberCount(), peakAnimations: animations, blurActive: blur, heavyPreserved, shimmerPreserved,
        streamDurationMs, streamStartedAtUtcMs, streamEndedAtUtcMs, slowFrames, updates, reasoningChars: reasoningText.length, scrollRange: Math.max(...scrolls) - Math.min(...scrolls), maxActiveChars: text.length, turns: 21, tools: 20,
        lifecycle, toolRowsDuringStream: { beforeStream: toolRowsBeforeStream, atHeavyCheck: stageEvidence.reasoning?.toolRows ?? -1 }, stageEvidence, finalTextMatches: finalText === text };
    (window as any).prepareClearviewScreenshot = async (theme: string) => {
        // An independent small, running transcript after every performance/lifecycle counter is frozen.
        const visual = makeData();
        const keys = ['u21', 'prior0', 'tool0', 'tool1', 'prior2', 'tool2', 'tool3', 'a21'];
        const nodes = new Map(keys.map(key => [key, visual.nodes.get(key)]));
        const turn: any = visual.timeline.turns.get(21);
        turn.steps = turn.steps.filter((step: any) => [0, 2, 20].includes(step.step));
        nodes.get('u21').data = { content: [{ type: 'text', text: Array.from({ length: 12 }, (_, i) => `第 ${i + 1} 项：请检查实现、调用路径与实际结果，保持说明全文和工具记录。`).join('\n') }] };
        for (const k of [2, 3]) {
            const node = nodes.get(`tool${k}`), block = node.data.root;
            node.data = { root: { callId: block.callId, call: k === 3 ? { name: 'bash', argsRaw: JSON.stringify({ command: 'npm run build -- --mode synthetic' }) } : block.call, subCalls: [], callTime: block.callTime } };
        }
        const current = nodes.get('a21');
        current.data = { ...current.data, blocks: [{ kind: 'reasoning', text: '检查调用路径与执行结果，保留模型输出并确认工具阶段。'.repeat(20) }] };
        turn.steps.at(-1).data.set('assistant-step', current.data);
        if (theme === 'dark') document.body.setAttribute('data-ds-dark-theme', '');
        else document.body.removeAttribute('data-ds-dark-theme');
        flushSync(() => { chat.set({ order: keys, nodes, timeline: { turns: new Map([[21, turn]]), turnOrder: [21] } }); sess.set({ ...sess.get(), running: true }); });
        flushSync(() => root.render(<Reader {...props}/>));
        await wait(600);
        host.scrollTop = 0;
        await frame();
        const scope = host.querySelector<HTMLElement>('[data-dsh-clearview]')!;
        host.style.background = getComputedStyle(scope).getPropertyValue('--cc-bg-100');
        const styleOf = (selector: string) => {
            const node = scope.querySelector<HTMLElement>(selector);
            if (!node) return null;
            const style = getComputedStyle(node), rect = node.getBoundingClientRect();
            const rules: any[] = [];
            const scan = (items: CSSRuleList, source: string) => { for (const rule of items) {
                if (rule instanceof CSSMediaRule && !matchMedia(rule.conditionText).matches) continue;
                if (rule instanceof CSSStyleRule) {
                    try { if (node.matches(rule.selectorText) && ['font', 'font-family', 'font-size', 'font-weight', 'line-height', 'color', 'background'].some(name => rule.style.getPropertyValue(name))) rules.push({ selector: rule.selectorText, style: rule.style.cssText, source }); } catch {}
                } else if ('cssRules' in rule) scan((rule as CSSGroupingRule).cssRules, source);
            } };
            for (const sheet of document.styleSheets) { try { scan(sheet.cssRules, sheet.href ?? 'inline'); } catch {} }
            return { matchedRules: rules.slice(-16), font: style.fontFamily, size: style.fontSize, lineHeight: style.lineHeight, weight: style.fontWeight, color: style.color, background: style.backgroundColor,
                width: rect.width, height: rect.height };
        };
        const ancestors = (selector: string) => { let node = scope.querySelector<HTMLElement>(selector); const items = []; while (node && scope.contains(node)) { const style = getComputedStyle(node); items.push({ tag: node.tagName, className: node.className, lineHeight: style.lineHeight, size: style.fontSize }); node = node.parentElement; } return items; };
        const facts = { proseAncestors: ancestors('[data-reader-text-kind="body"] p'), theme, width: innerWidth, background: getComputedStyle(scope).backgroundColor,
            prose: styleOf('[data-reader-text-kind="body"] p'), thought: styleOf('[data-reader-live-thought] [data-reader-text]'),
            line: styleOf('[data-reader-line] > button'), commandCode: styleOf('[data-reader-tool-call][data-tool-category="terminal"] code'), bubble: styleOf('[data-reader-user-bubble]'),
            clamped: !!scope.querySelector('[data-reader-user-bubble][data-clamped="true"]'),
            groups: scope.querySelectorAll('[data-reader-group]').length,
            thoughts: scope.querySelectorAll('[data-reader-reasoning]').length,
            runningGroups: scope.querySelectorAll('[data-reader-group][data-group-state="running"][data-expanded="true"]').length,
                runningClusters: scope.querySelectorAll('[data-reader-cluster][data-cluster-state="running"]').length,
                sourceRunningCalls: [...chat.get().nodes.values()].filter((node: any) => node.kind === 'tool-call' && !('kind' in node.data.root)).length,
            statusLines: scope.querySelectorAll('[data-reader-status-line]').length,
            overflow: host.scrollWidth > host.clientWidth + 1,
            overflowingElements: [...scope.querySelectorAll<HTMLElement>('*')].filter(visible).filter(node => {
                const rect = node.getBoundingClientRect(); return !getComputedStyle(node).transform || getComputedStyle(node).transform === 'none' ? rect.left < -1 || rect.right > innerWidth + 1 : false;
            }).map(node => ({ tag: node.tagName, className: node.className })).slice(0, 12) };
        if (__TRANSCRIPT__) {
            check(facts.groups === 2 && facts.runningGroups === 1 && facts.thoughts === 2 && facts.statusLines === 1, `${theme}/${innerWidth}: screenshot grammar missing`);
            check(facts.clamped, `${theme}/${innerWidth}: long user bubble was not clamped`);
            const hostBody = getComputedStyle(scope).getPropertyValue('--dsh-content-font-size').trim() || '14px';
            const probe = document.createElement('span'); probe.style.fontSize = hostBody; scope.appendChild(probe);
            const expectedBody = getComputedStyle(probe).fontSize; probe.remove();
            check(facts.prose?.size === expectedBody && Math.abs(parseFloat(facts.prose?.lineHeight ?? '') - parseFloat(expectedBody) * 1.6) < .12, `${theme}/${innerWidth}: prose differs from host size/reader line-height`);
            check(facts.background === 'rgba(0, 0, 0, 0)', `${theme}/${innerWidth}: reader background is not transparent`);
            check(facts.prose?.weight === '400' && /anthropic-sans|sans-serif/.test(facts.prose?.font ?? ''), `${theme}/${innerWidth}: actual prose weight/family differs from spec`);
            check(facts.commandCode?.size === '13px', `${theme}/${innerWidth}: actual command code is not 13px`);
            check(/anthropic-mono|Cascadia Mono|monospace/.test(facts.commandCode?.font ?? ''), `${theme}/${innerWidth}: actual command code is not mono`);
            check(facts.line?.size === '13px' && facts.bubble?.size === '15px', `${theme}/${innerWidth}: process/bubble size differs from spec`);
            check(!facts.overflow && facts.overflowingElements.length === 0, `${theme}/${innerWidth}: visible horizontal overflow`);
        }
        return facts;
    };
    flushSync(() => root.render(null));
    return result;
}
(window as any).runClearviewPerformance = async () => {
    failures.length = 0;
    const subscription = await subscriptions();
    const performanceResult = await reader();
    return { workload: WORKLOAD, grammar: __TRANSCRIPT__ ? 'transcript-0.3' : 'panel-0.2', subscription, performance: performanceResult, failures };
};
(window as any).clearviewPerformanceFailures = () => [...failures];
