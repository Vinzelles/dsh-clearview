import { build } from 'esbuild';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { Script } from 'node:vm';
const repo = resolve(fileURLToPath(new URL('..', import.meta.url)));
const out = resolve(process.env.CLEARVIEW_PERF_OUTPUT || join(repo, '.perf-results'));
const buildOnly = process.argv.includes('--build-only');
if (!buildOnly) mkdirSync(out, { recursive: true });
const source = resolve(process.env.CLEARVIEW_PERF_SOURCE || repo);
const testUrl = process.env.DSH_TEST_URL;
if (!buildOnly && !testUrl)
    throw new Error('Set DSH_TEST_URL to the running test host (read-only, fresh browser profile).');
const baseline = process.argv.includes('--baseline');
const tracing = process.argv.includes('--trace');
const fixtureName = process.argv.includes('--thought-settlement') ? 'thought-settlement' : process.argv.includes('--question-record') ? 'question-record' : 'reader-performance';
const sourceVersion = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8')).version;
const transcript = existsSync(join(source, 'src/client/StatusLine.tsx')) && existsSync(join(source, 'src/client/ToolGroupRow.tsx'));
const harnessHash = createHash('sha256').update(readFileSync(join(repo, `tests/browser/${fixtureName}.tsx`))).update(readFileSync(fileURLToPath(import.meta.url))).digest('hex');
// --baseline labels the report only. Do not deliberately give main coarse subscriptions.
// --build-only bundles in memory: no Chrome, host traffic, or generated files.


const bundle = await build({ entryPoints: [join(repo, `tests/browser/${fixtureName}.tsx`)], bundle: true, write: !buildOnly, outfile: join(out, 'fixture.js'), platform: 'browser', format: 'iife', jsx: 'automatic', target: 'es2022', external: ['react', 'react/*', 'react-dom', 'react-dom/*', '@deepseek-ai/*', '/dsh-clearview/fonts/*.woff2'], define: { 'process.env.NODE_ENV': '"production"', '__TRANSCRIPT__': String(transcript) }, plugins: [{ name: 'fixture-source', setup(b) { b.onResolve({ filter: /^fixture-source\// }, a => ({ path: join(source, 'src/client', a.path.slice('fixture-source/'.length)) })); } }], banner: { js: 'var require = (name) => { if (!(name in window.__clearviewTestModules)) throw new Error("Missing test host module: "+name); return window.__clearviewTestModules[name]; };' } });
if (buildOnly) {
    for (const file of bundle.outputFiles) if (file.path.endsWith('.js')) new Script(file.text, { filename: file.path });
    console.log(JSON.stringify({ syntaxChecked: true, buildOnly: true, source, sourceVersion, grammar: transcript ? 'transcript-0.3' : 'panel-0.2', outputs: bundle.outputFiles.map(file => ({ path: file.path, bytes: file.contents.length })) }, null, 2));
    process.exit(0);
}
// Shared policy must exist before any host access; build-only remains entirely offline.
const { readonlyDecision, readonlyRequestSummary, knownNativeReact130 } = await import('./browser-readonly.mjs');
const readonlyPolicyHash = createHash('sha256').update(readFileSync(join(repo, 'scripts/browser-readonly.mjs'))).digest('hex');
async function sessionInventory() {
    const url = new URL('/api/session/list', testUrl).href;
    const body = JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method: 'session/list', payload: { args: { _request: {} } } });
    if (!readonlyDecision({ url, method: 'POST', postData: body }, testUrl).allowed) throw Error('Shared policy rejected session inventory RPC');
    const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    const items = (await response.json()).result?.value?.items;
    if (!response.ok || !Array.isArray(items) || items.some(item => typeof item.sessionId !== 'string')) throw Error('Cannot verify read-only session inventory');
    return { count: items.length, idsHash: createHash('sha256').update(JSON.stringify(items.map(item => item.sessionId).sort())).digest('hex') };
}
const initialSessions = await sessionInventory();
const profile = mkdtempSync(join(tmpdir(), 'clearview-browser-'));
// Both sources use foreground scheduling. A paint-window trace showed >90% idle
// while waiting for rAF in the Windows headless renderer; do not measure OS
// background scheduling as transcript work. Chromium defines this switch in
// content/public/common/content_switches.cc. Keep GPU and all motion enabled.
const chrome = spawn(process.env.CHROME_PATH || join(process.env.ProgramFiles || 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'), ['--headless=new', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--disable-background-timer-throttling', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--window-size=1280,950', 'about:blank'], { stdio: 'ignore', windowsHide: true });
const delay = ms => new Promise(done => setTimeout(done, ms));
// Chrome must never outlive the run, and its profile must always be removed: on success, on
// failure, on timeout and on an uncaught error. taskkill /T also stops Chrome's helper processes.
const killChrome = () => {
    if (!chrome.pid || chrome.exitCode !== null)
        return;
    if (process.platform === 'win32')
        spawnSync('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    else
        chrome.kill('SIGKILL');
};
const removeProfile = () => {
    let failure;
    for (let attempt = 0; attempt < 30; attempt++) {
        try {
            rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
            return;
        }
        catch (error) {
            failure = error;
        }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
    }
    console.error('could not remove temporary profile', profile, failure?.message);
};
const bail = error => { console.error(error); killChrome(); removeProfile(); process.exit(2); };
process.on('unhandledRejection', bail);
process.on('uncaughtException', bail);
const timer = setTimeout(() => bail(new Error('performance run timed out')), 180000);
let ws;
try {
    let port;
    for (let i = 0; i < 100; i++) {
        try {
            port = Number(readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]);
            if (port)
                break;
        }
        catch { }
        await new Promise(r => setTimeout(r, 100));
    }
    if (!port)
        throw Error('Chrome did not start');
    const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
    const pending = new Map(), errors = [], trace = [], blockedMutations = [];
    let traceDone;
    let id = 0;
    ws.onmessage = e => { const m = JSON.parse(e.data);
        if (m.method === 'Fetch.requestPaused') {
            const { requestId, request } = m.params;
            const decision = readonlyDecision(request, testUrl);
            if (!decision.allowed) blockedMutations.push({ ...readonlyRequestSummary(request, decision), observedAtUtcMs: Date.now() });
            void send(decision.allowed ? 'Fetch.continueRequest' : 'Fetch.failRequest', decision.allowed ? { requestId } : { requestId, errorReason: 'BlockedByClient' }).catch(bail);
        }
 const p = pending.get(m.id); if (p) {
        pending.delete(m.id);
        clearTimeout(p.timer);
        m.error ? p.reject(Error(m.error.message)) : p.resolve(m.result);
    } if (m.method === 'Runtime.exceptionThrown')
        errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); if (m.method === 'Tracing.dataCollected')
        trace.push(...m.params.value); if (m.method === 'Tracing.tracingComplete')
        traceDone?.(); };
    const send = (method, params = {}) => new Promise((resolve, reject) => { const n = ++id, timer = setTimeout(() => { pending.delete(n); reject(Error('CDP timeout ' + method)); }, 90000); pending.set(n, { resolve, reject, timer }); ws.send(JSON.stringify({ id: n, method, params })); });
    const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails)
        throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Page.bringToFront');
    await send('Emulation.setFocusEmulationEnabled', { enabled: true });
    await send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    await send('Page.navigate', { url: testUrl });
    for (let i = 0; i < 100; i++) {
        if (await evaluate('!!window.__dshSidebarModuleSystem__'))
            break;
        await new Promise(r => setTimeout(r, 100));
    }
    const modules = ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/dsh-client-ui-primitives'];
    await evaluate(`(async()=>{const system=window.__dshSidebarModuleSystem__;if(!system?.import)throw Error('Host module system unavailable');window.__clearviewTestModules={};for(const name of ${JSON.stringify(modules)})window.__clearviewTestModules[name]=await system.import(name)})()`);
    // The native host must have completed a frame before timing a new reader view.
    // Module-table readiness alone can precede its first compositor commit; the
    // trace showed steady BeginFrames with the main-frame pipeline still deferred.
    // This happens before the tested stylesheet and Reader code are installed.
    const hostReadyStart = performance.now();
    await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const hostReadyFrameMs = performance.now() - hostReadyStart;
    // Fresh browser profile and synthetic session only. No Agent messages or
    // writes to the running host. Production primitives/React come from its real
    // module table; the tested Reader itself comes from the selected source tree.
    await evaluate(`(()=>{const style=document.createElement('style');style.textContent=${JSON.stringify(readFileSync(join(out, 'fixture.css'), 'utf8'))};document.head.append(style)})()`);
    const version = await send('Browser.getVersion');
    const initialErrors = errors.length;
    if (tracing) {
        await send('Profiler.enable');
        await send('Profiler.start');
        await send('Tracing.start', { categories: 'devtools.timeline,blink.user_timing,v8.execute,cc,viz,gpu,disabled-by-default-devtools.timeline.frame', transferMode: 'ReportEvents' });
    }
    await evaluate(readFileSync(join(out, 'fixture.js'), 'utf8'));
    const result = await evaluate('window.runClearviewPerformance()');
    let traceSummary;
    if (tracing) {
        const { profile: cpu } = await send('Profiler.stop');
        const ended = new Promise(r => traceDone = r);
        await send('Tracing.end');
        await ended;
        const start = trace.find(e => e.name === 'clearview-stream-start')?.ts ?? 0, end = trace.find(e => e.name === 'clearview-stream-end')?.ts ?? Infinity;
        const stream = trace.filter(e => e.ts >= start && e.ts <= end && e.dur);
        const groups = new Map();
        for (const e of stream) {
            const row = groups.get(e.name) || { name: e.name, totalMs: 0, maxMs: 0, count: 0 };
            row.totalMs += e.dur / 1000;
            row.maxMs = Math.max(row.maxMs, e.dur / 1000);
            row.count++;
            groups.set(e.name, row);
        }
        const nodes = new Map(cpu.nodes.map(n => [n.id, n])), hits = new Map();
        let at = cpu.startTime;
        cpu.samples.forEach((id, i) => { at += cpu.timeDeltas[i]; if (at >= start && at <= end)
            hits.set(id, (hits.get(id) || 0) + 1); });
        traceSummary = { events: [...groups.values()].sort((a, b) => b.totalMs - a.totalMs).slice(0, 18), cpu: [...hits].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([id, samples]) => ({ samples, ...nodes.get(id).callFrame })), slowest: stream.sort((a, b) => b.dur - a.dur).slice(0, 10).map(e => ({ name: e.name, duration: e.dur / 1000, args: e.args })) };
        writeFileSync(join(out, baseline ? 'baseline-trace.json' : 'optimized-trace.json'), JSON.stringify({ trace, cpu }));
    }
    let screenshots;
    if (process.argv.includes('--screenshots')) {
        screenshots = [];
        for (const [name, theme, width] of [['running-dark', 'dark', 1280], ['running-light', 'light', 1280], ['running-480', 'dark', 480]]) {
            await send('Emulation.setDeviceMetricsOverride', { width, height: 1100, deviceScaleFactor: 1, mobile: false });
            const facts = await evaluate(`window.prepareClearviewScreenshot(${JSON.stringify(theme)})`);
            const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
            const file = join(out, `${name}.png`);
            writeFileSync(file, Buffer.from(data, 'base64'));
            screenshots.push({ file, ...facts });
        }
        // Screenshot-only checks use the same failure list, after all timed counters are frozen.
        const screenshotFailures = await evaluate('window.clearviewPerformanceFailures()');
        result.failures = screenshotFailures;
    }
    if (fixtureName === 'thought-settlement') {
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 });
        const point = await evaluate('window.prepareThoughtHover()');
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
        await delay(2800);
        const held = await evaluate('window.inspectThoughtHover()');
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 });
        await delay(3000);
        const folded = await evaluate('window.inspectThoughtHover()');
        const control = await evaluate('window.thoughtControlPoint()');
        const click = async () => {
            await send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, x: control.x, y: control.y });
            await send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, x: control.x, y: control.y });
            await delay(350);
            return evaluate('window.inspectThoughtHover()');
        };
        const opened = await click(), closed = await click();
        const pass = held.expanded === 'true' && held.originalConnected && held.viewport === 128 && held.fullText
            && folded.expanded === 'false' && control.hit && opened.expanded === 'true' && opened.fullText && closed.expanded === 'false';
        result.pointerInteraction = { held, folded, opened, closed, hit: control.hit, pass };
        if (!pass) result.failures.push('Native pointer hover/leave/disclosure interaction failed');
    }
    const finalSessions = await sessionInventory();
    if (initialSessions.idsHash !== finalSessions.idsHash) result.failures.push('Host session inventory changed during read-only probe');
    const sourceBundleHash = createHash('sha256').update(readFileSync(join(out, 'fixture.js'))).update(readFileSync(join(out, 'fixture.css'))).digest('hex');
    const report = { fixtureName, readonlyPolicyHash, hostReadyFrameMs, screenshots, sourceBundleHash, initialSessions, finalSessions, schemaVersion: 2, capturedAt: new Date().toISOString(), source, sourceVersion, harnessHash, testUrl, viewport: { width: 1280, height: 950 }, baseline, browser: version.product, blockedMutations, initialHostErrors: errors.slice(0, initialErrors), errors: [...errors.slice(0, initialErrors).filter(text => !knownNativeReact130(text, 'native-chat')), ...errors.slice(initialErrors)], ...result, ...traceSummary ? { traceSummary } : {} };
    writeFileSync(join(out, baseline ? 'baseline.json' : 'optimized.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ report: join(out, baseline ? 'baseline.json' : 'optimized.json'), initialSessions, finalSessions, errors: report.errors, performance: report.performance, failures: report.failures }, null, 2));
    if (report.errors.length || report.failures.length)
        process.exitCode = 1;
}
finally {
    clearTimeout(timer);
    try {
        ws?.close();
    }
    catch { }
    const exited = new Promise(done => chrome.once('exit', done));
    killChrome();
    await Promise.race([exited, delay(5000)]);
    removeProfile();
    console.log('Stopped test Chrome PID', chrome.pid, existsSync(profile) ? '(profile NOT removed)' : '(profile removed)');
}
