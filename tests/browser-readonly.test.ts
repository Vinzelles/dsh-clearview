import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { READ_ONLY_RPC_METHODS, READ_ONLY_GET_PATHS, readonlyDecision, readonlyRequestSummary, knownNativeReact130, classifyBrowserError, interactionCoverage, recordBlockedRequest, aggregateBlockedRequests, summarizeReaderGate } from '../scripts/browser-readonly.mjs';

const base = 'http://127.0.0.1:3294'; // URL fixture: never connects to the host.
test('exact native boot failures stay uncovered without hiding reader or runtime failures', () => {
  const messages = [
    '[cordis-client-runner] syncing inspect providers failed: Error: gateway/internal: client api: dynamicCordisRunner/syncInspectManifest failed: Failed to fetch',
    '[ui-cordis] reading the Cordis inventory failed: Error: gateway/internal: client api: dynamicCordisRunner/inventory failed: Failed to fetch',
    '[dsh-claude-style] "permissions" failed and was switched off: Error: permission: unexpected permissionPresets catalog shape',
  ];
  for (const text of messages) {
    assert.equal(classifyBrowserError({ kind: 'console', phase: 'startup', text }, []), 'hostStartup');
    assert.equal(classifyBrowserError({ kind: 'console', phase: 'reader', text }, []), 'failure');
    assert.equal(classifyBrowserError({ kind: 'runtime', phase: 'startup', text }, []), 'failure');
  }
  assert.equal(classifyBrowserError({ kind: 'console', phase: 'startup', text: '[dsh-clearview] Failed to fetch' }, []), 'failure');
  assert.equal(classifyBrowserError({ kind: 'console', phase: 'startup', text: '[ui-cordis] Failed to fetch' }, []), 'failure');
});
const rpc = (endpoint: string, method = endpoint) => ({ url: base + '/api/' + endpoint, method: 'POST',
  postData: JSON.stringify({ type: 'client-request', rpcId: 'fixture', method, payload: { args: {} } }) });

test('explicit reads require the matching endpoint and client-request envelope', () => {
  assert.ok(Object.isFrozen(READ_ONLY_RPC_METHODS));
  for (const endpoint of READ_ONLY_RPC_METHODS) assert.equal(readonlyDecision(rpc(endpoint), base).allowed, true, endpoint);
  assert.equal(readonlyDecision(rpc('session/list', 'settings/update'), base).allowed, false);
  for (const postData of [undefined, '{broken', '[]', 'null', JSON.stringify({ method: 'session/list' })]) {
    assert.equal(readonlyDecision({ ...rpc('session/list'), postData }, base).allowed, false);
  }
});

test('creation paths are denied, including /session/create and legacy spelling', () => {
  for (const path of ['/session/create', '/api/session/create', '/session.create', '/api/session.create']) {
    for (const method of ['GET', 'HEAD', 'POST', 'PUT']) {
      const decision = readonlyDecision({ url: base + path, method }, base);
      assert.equal(decision.allowed, false);
      assert.equal(decision.reason, 'session/create forbidden');
    }
  }
});

test('create envelopes are denied even on a generic RPC URL or a read endpoint', () => {
  for (const path of ['rpc', 'session/list', 'session.list']) for (const method of ['session/create', 'session.create']) {
    const decision = readonlyDecision(rpc(path, method), base);
    assert.equal(decision.allowed, false);
    assert.equal(decision.reason, 'session/create forbidden');
  }
});

test('unknown writes and known mutations are denied', () => {
  for (const endpoint of ['session/prompt', 'session/cancel', 'session/fork', 'session/selectModel', 'settings/update', 'workspace/delete', 'host/openPath', 'respond', 'unknown/list', 'plugin/execute']) {
    assert.equal(readonlyDecision(rpc(endpoint), base).allowed, false, endpoint);
  }
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) assert.equal(readonlyDecision({ url: base + '/assets/main.js', method }, base).allowed, false);
});

test('same-origin static GET/HEAD and known read-only downlinks are allowed', () => {
  for (const path of ['/', '/assets/main.js', '/plugins/??a/client.js,b/client.js', '/dsh-clearview/fonts/serif.woff2', '/favicon.ico', '/api/events.mux', '/api/events.host', '/api/file']) {
    for (const method of ['GET', 'HEAD']) assert.equal(readonlyDecision({ url: base + path, method }, base).allowed, true, path);
  }
  for (const path of ['/api/unknown', '/api/session/list', '/host/openPath', '/assets/../api/session/create']) assert.equal(readonlyDecision({ url: base + path, method: 'GET' }, base).allowed, false, path);
});

test('cross-origin requests, including non-GET read-looking RPCs, are denied', () => {
  for (const origin of ['http://127.0.0.1:3193', 'https://127.0.0.1:3294', 'https://example.com']) {
    assert.equal(readonlyDecision({ ...rpc('session/list'), url: origin + '/api/session/list' }, base).allowed, false);
    assert.equal(readonlyDecision({ url: origin + '/assets/main.js', method: 'GET' }, base).allowed, false);
  }
  assert.equal(readonlyDecision({ url: 'not-a-url', method: 'POST' }, base).allowed, false);
});

test('decision and summary never disclose postData, URL query or headers', () => {
  const request = { ...rpc('rpc', 'session/create'), url: base + '/api/rpc?key=query-secret', headers: { authorization: 'header-secret' } };
  request.postData = JSON.stringify({ type: 'client-request', rpcId: 'fixture', method: 'session/create', payload: { secret: 'body-secret' } });
  const decision = readonlyDecision(request, base), summary = readonlyRequestSummary(request, decision);
  assert.deepEqual(summary, { method: 'POST', path: '/api/rpc', reason: 'session/create forbidden' });
  assert.doesNotMatch(JSON.stringify({ decision, summary }), /body-secret|query-secret|header-secret|postData|authorization/);
});

test('only the known native chat-slot React 130 is uncovered noise', () => {
  const known = "slot entry crashed in 'conversation.chat.node': Error: Minified React error #130; invariant=130&args[]=undefined&args[]=";
  assert.equal(knownNativeReact130(known, 'native-chat'), true);
  assert.equal(knownNativeReact130(known, 'reader'), false);
  assert.equal(knownNativeReact130('Error: Minified React error #130;', 'native-chat'), false);
  assert.equal(knownNativeReact130(known.replace('undefined', 'object'), 'native-chat'), false);
});

test('actual Fetch callbacks deny creation before continuing, and allow named reads', async () => {
  for (const script of ['verify-live-reader.mjs', 'record-compare.mjs']) {
    const source = readFileSync(new URL('../scripts/' + script, import.meta.url), 'utf8');
    assert.match(source, /requestStage: 'Request'/);
    assert.ok(source.indexOf("send('Fetch.enable'") < source.indexOf("send('Page.navigate'"));
    const start = source.indexOf('ws.onmessage = async'), end = source.indexOf('  const evaluate', start);
    const calls: { method: string; params: Record<string, unknown> }[] = [];
    const context = { URL, Set, Map, clearTimeout, base, readonlyDecision, readonlyRequestSummary, recordBlockedRequest,
      ws: {} as { onmessage: (event: { data: string }) => Promise<void> }, pending: new Map(), createRequests: new Set(),
      report: { blockedRequests: [], blockedPrerequisite: [], uncovered: [], handlerErrors: [], sessionCreates: 0 }, exceptionPhase: 'startup', phase: 'startup',
      blockedRequests: [], handlerErrors: [], exceptions: [], creates: 0,
      send: async (method: string, params: Record<string, unknown>) => { calls.push({ method, params }); return {}; } };
    runInNewContext(source.slice(start, end), context);
    const pause = (request: ReturnType<typeof rpc>) => context.ws.onmessage({ data: JSON.stringify({ method: 'Fetch.requestPaused', params: { requestId: 'fixture', request } }) });
    await pause(rpc('rpc', 'session/create'));
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.method, 'Fetch.failRequest');
    assert.equal(calls[0]!.params.errorReason, 'BlockedByClient');
    calls.length = 0;
    await pause({ url: base + '/api/desktop/dsh-tauri-scheduler/runs/recover', method: 'POST', postData: '{}' });
    assert.equal(calls[0]!.method, 'Fetch.failRequest');
    const denied: unknown[] = script === 'verify-live-reader.mjs' ? context.report.blockedRequests : context.blockedRequests;
    assert.equal((denied.at(-1) as { blockedPrerequisite?: string }).blockedPrerequisite, 'scheduler-recovery');
    calls.length = 0;
    await pause(rpc('session/list'));
    assert.equal(calls[0]!.method, 'Fetch.continueRequest');
    await context.ws.onmessage({ data: JSON.stringify({ method: 'Network.requestWillBeSent', params: { requestId: 'create', request: rpc('session/create') } }) });
    assert.equal(context.report.sessionCreates, 0);
    assert.equal(context.creates, 0);
  }
});

test('clipboard stub records browser-local receipts without calling the native implementation', async () => {
  const source = readFileSync(new URL('../scripts/verify-live-reader.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /Browser.grantPermissions/);
  const quote = String.fromCharCode(96);
  const stub = source.split('Page.addScriptToEvaluateOnNewDocument')[1]!.split('source: ' + quote)[1]!.split(quote + ' });')[0]!;
  let nativeCalls = 0;
  const browser = { navigator: { clipboard: { writeText: async (_text: string) => { nativeCalls++; } } },
    document: { execCommand: (_command: string) => { nativeCalls++; }, getSelection: () => ({ toString: () => 'selection' }), addEventListener: () => {} },
    __clearviewClipboardStub: undefined as undefined | { ready: boolean; writes: { kind: string; length: number }[] } };
  runInNewContext(stub, browser);
  await browser.navigator.clipboard.writeText('fixture');
  browser.document.execCommand('copy');
  assert.equal(nativeCalls, 0);
  assert.equal(browser.__clearviewClipboardStub?.ready, true);
  assert.equal(browser.__clearviewClipboardStub?.writes.length, 2);
});


test('e95fc396 audited GET routes are allowed, adjacent unknown routes and write verbs are denied', () => {
  for (const path of READ_ONLY_GET_PATHS) {
    assert.equal(readonlyDecision({ url: base + path, method: 'GET' }, base).allowed, true, path);
    assert.equal(readonlyDecision({ url: base + path, method: 'POST', postData: '{}' }, base).allowed, false, path);
  }
  for (const path of ['/memory-evolve/api/coi/adapters', '/memory-evolve/api/unknown', '/scheduler/api/tasks/run', '/api/desktop/dsh-tauri-worktree/checkouts', '/api/present.open', '/dsh-claude-style/session-delete', '/modsearch/config?doctor=1']) {
    assert.equal(readonlyDecision({ url: base + path, method: 'GET' }, base).allowed, false, path);
  }
  assert.equal(readonlyDecision({ url: base + '/dsh-custom-patcher/assets/reader.js', method: 'GET' }, base).allowed, true);
  assert.equal(readonlyDecision({ url: base + '/dsh-custom-patcher/assets/unknown-action', method: 'GET' }, base).allowed, false);
});

test('plugin read RPCs are scoped to their audited channel and matching envelope', () => {
  for (const [path, method] of [['/smooth-stream/settings.read', 'settings.read'], ['/sidebar/api/settings.get', 'settings.get'], ['/sidebar/api/fs.read', 'fs.read']]) {
    const request = { ...rpc('ignored', method), url: base + path };
    assert.equal(readonlyDecision(request, base).allowed, true);
    assert.equal(readonlyDecision({ ...request, postData: rpc('ignored', 'settings.write').postData }, base).allowed, false);
    assert.equal(readonlyDecision({ ...request, url: base + '/unknown/' + method }, base).allowed, false);
  }
  assert.equal(readonlyDecision({ url: base + '/api/dsh-context/detail', method: 'POST', postData: JSON.stringify({ sessionId: 'synthetic' }) }, base).allowed, true);
  assert.equal(readonlyDecision({ url: base + '/api/dsh-context/detail', method: 'POST', postData: JSON.stringify({ method: 'session/create', sessionId: 'synthetic' }) }, base).allowed, false);
});

test('verified host background writes remain blocked and carry safe prerequisite evidence', () => {
  for (const [method, path, prerequisite] of [['POST', '/api/desktop/dsh-tauri-scheduler/runs/recover', 'scheduler-recovery'], ['POST', '/prompt-enhancer/diag', 'prompt-enhancer-diagnostic-write'], ['GET', '/dsh-claude-style/usage', 'usage-event-scan-and-cache-write']]) {
    const request = { url: base + path + '?token=secret-query', method, postData: '{"secret":"secret-body"}' };
    const decision = readonlyDecision(request, base);
    assert.equal(decision.allowed, false);
    assert.equal(decision.blockedPrerequisite, prerequisite);
    const summary = readonlyRequestSummary(request, decision);
    assert.equal(summary.blockedPrerequisite, prerequisite);
    assert.doesNotMatch(JSON.stringify(summary), /secret-query|secret-body|postData/);
  }
});

test('optional absent bubble checks skip explicitly and produce boolean true; required targets do not', () => {
  const skippedChecks: unknown[] = [], uncovered: unknown[] = [];
  const options = { optional: true, title: 'synthetic', skippedChecks, uncovered };
  assert.equal(interactionCoverage('bubbleToggle', null, options), true);
  assert.equal(skippedChecks.length, 1);
  assert.equal(uncovered.length, 0);
  assert.equal(interactionCoverage('bubbleToggle', false, options), false, 'a present but broken bubble must fail');
  assert.equal(interactionCoverage('toolDetails', null, { ...options, optional: false }), false);
  assert.equal(uncovered.length, 1);
  assert.equal(typeof (true && interactionCoverage('bubbleToggle', null, options)), 'boolean');
});

test('only exact correlated host console failures move to blockedPrerequisite; runtime errors never do', () => {
  const blocked = [{ method: 'POST', path: '/api/desktop/dsh-tauri-scheduler/runs/recover', blockedPrerequisite: 'scheduler-recovery' }];
  const error = { kind: 'console', phase: 'startup', text: '[dsh-tauri-scheduler] /api/desktop/dsh-tauri-scheduler/runs/recover TypeError: Failed to fetch' };
  assert.equal(classifyBrowserError(error, blocked), 'blockedPrerequisite');
  assert.equal(classifyBrowserError(error, []), 'failure');
  assert.equal(classifyBrowserError({ ...error, kind: 'runtime' }, blocked), 'failure');
  assert.equal(classifyBrowserError({ ...error, text: '[dsh-scheduler] 初始加载失败 TypeError: Failed to fetch' }, blocked), 'failure', 'legacy scheduler read failure is not the native recover side effect');
  assert.equal(classifyBrowserError({ ...error, text: '[reader] TypeError: Failed to fetch' }, blocked), 'failure');
  const usage = [{ method: 'GET', path: '/dsh-claude-style/usage', blockedPrerequisite: 'usage-event-scan-and-cache-write' }];
  assert.equal(classifyBrowserError({ ...error, text: '[dsh-claude-style] "usage" failed and was switched off: TypeError: Failed to fetch' }, usage), 'blockedPrerequisite');
  assert.equal(classifyBrowserError({ ...error, text: '[dsh-claude-style] "permissions" failed and was switched off: TypeError: Failed to fetch' }, usage), 'failure');
});


test('poll evidence is deduplicated by method/path/tag with counters and no body retention', () => {
  const request = { method: 'GET', path: '/dsh-claude-style/usage', reason: 'background', blockedPrerequisite: 'usage-cache', postData: 'never-retain-this' };
  const records: Record<string, unknown>[] = [];
  for (let index = 0; index < 259; index++) recordBlockedRequest(records, request);
  assert.equal(records.length, 1);
  assert.equal(records[0]!.counter, 259);
  assert.equal(records[0]!.tag, 'usage-cache');
  recordBlockedRequest(records, { ...request, method: 'HEAD' });
  recordBlockedRequest(records, { ...request, blockedPrerequisite: 'different-tag' });
  recordBlockedRequest(records, { ...request, path: '/different-path' });
  assert.equal(records.length, 4);
  assert.doesNotMatch(JSON.stringify(records), /never-retain-this|postData/);
  const compact = aggregateBlockedRequests(records);
  assert.equal(compact[0]!.counter, 259, 'reaggregation must preserve existing counters');
});

function syntheticReaderReport() {
  const state = () => ({ version: '0.3.0', blockErrors: [], retired: 0 });
  const item = (title: string) => ({ title, opened: true, sessionSelected: true, readerTabSelected: true, readerMounted: true, initial: state(), final: state(), checks: { pass: true } });
  return { sessions: [item('one'), item('two'), { title: 'missing', opened: false }], readerErrors: [], handlerErrors: [], fatal: null,
    profileRemoved: true, sessionCreates: 0, sessionCountBefore: 766, sessionCountAfter: 766, replacements: 1, spliced: 0, uncovered: [{ kind: 'blockedPrerequisite' }], hostBackgroundErrors: [{ text: 'denied background side effect' }] };
}

test('covered Reader gates pass independently while missing cases and whole-host gaps remain explicit', () => {
  const report = syntheticReaderReport();
  const gate = summarizeReaderGate(report, '0.3.0', { intercept: true });
  assert.equal(gate.readerPass, true);
  assert.equal(gate.readerScope.covered, 2);
  assert.equal(gate.readerScope.passed, 2);
  assert.equal(gate.readerScope.requested, 3);
  assert.equal(gate.readerScope.complete, false);
  assert.deepEqual(gate.readerScope.missing, ['missing']);
  assert.equal(gate.readerPass && gate.readerScope.complete && report.uncovered.length === 0, false, 'partial Reader coverage must never become full pass');
});

test('Reader failures, empty coverage and safety/cleanup failures still block the Reader gate', () => {
  const baseReport = syntheticReaderReport();
  assert.equal(summarizeReaderGate({ ...baseReport, sessions: [] }, '0.3.0').readerPass, false);
  for (const change of [{ readerErrors: ['reader failure'] }, { handlerErrors: ['interception failure'] }, { profileRemoved: false }, { sessionCreates: 1 }, { fatal: 'fatal' }, { replacements: 0 }]) {
    assert.equal(summarizeReaderGate({ ...baseReport, ...change }, '0.3.0', { intercept: true }).readerPass, false);
  }
  const broken = structuredClone(baseReport);
  const first = broken.sessions[0]!;
  if (!('checks' in first)) throw new Error('fixture must have a covered first case');
  first.checks.pass = false;
  assert.equal(summarizeReaderGate(broken, '0.3.0').readerPass, false);
});

test('fonts.prose measures the paragraph and independently resolves/removes its host typography probe', () => {
  const source = readFileSync(new URL('../scripts/verify-live-reader.mjs', import.meta.url), 'utf8');
  const quote = String.fromCharCode(96);
  const start = source.indexOf('const measure = ' + quote) + 'const measure = '.length;
  const end = source.indexOf(quote + ';', start + 1) + 1;
  const expression = runInNewContext(source.slice(start, end));
  for (const delta of [-1, 0, 2, 0.5]) {
    const paragraph = { tagName: 'P', getBoundingClientRect: () => ({ left: 0, right: 100, width: 100 }) }, command = { tagName: 'CODE' };
    let attached = false, created = 0, removed = 0, probeSize = '';
    const deltaProbe = { tagName: 'SPAN', style: { cssText: '', setProperty: (name: string, value: string, priority: string) => {
      assert.equal(name, 'font-size');
      assert.ok(['calc(100px + var(--dsh-content-font-delta, 0px))', 'var(--dsh-content-font-size, calc(14px + var(--dsh-content-font-delta, 0px)))'].includes(value));
      probeSize = value;
      assert.equal(priority, 'important');
    } }, remove: () => { assert.equal(attached, true); attached = false; removed++; } };
    const root = { tagName: 'ARTICLE', scrollWidth: 100, clientWidth: 100,
      querySelectorAll: () => [], querySelector: (selector: string) => selector.endsWith(' p') ? paragraph : selector.includes('[data-tool-category="terminal"]') ? command : null,
      getBoundingClientRect: () => ({ right: 100 }), appendChild: (node: unknown) => { assert.equal(node, deltaProbe); attached = true; } };
    const fonts = Object.assign([], { check: () => false });
    const document = { body: {}, createElement: (tag: string) => { assert.equal(tag, 'span'); created++; return deltaProbe; },
      querySelector: (selector: string) => selector === '[data-dsh-clearview]' ? root : null,
      documentElement: { scrollWidth: 100, clientWidth: 100 }, fonts };
    const getComputedStyle = (node: unknown) => {
      if (node === deltaProbe) assert.equal(attached, true, 'probe must be mounted before its computed size is read');
      return { backgroundColor: 'rgb(255, 255, 255)', getPropertyValue: (name: string) => name === '--dsh-claude-font-prose' ? 'anthropic-serif, Georgia' : '',
        fontSize: (node === deltaProbe ? (probeSize.startsWith('calc(100px') ? 100 + delta : 14 + delta) : node === paragraph ? 14 + delta : node === command ? 13 + delta : 14 + delta) + 'px',
        lineHeight: node === paragraph ? (1.6 * (14 + delta)) + 'px' : '21px',
        fontWeight: node === paragraph ? '400' : '500', fontFamily: node === paragraph ? 'anthropic-serif, Georgia' : 'system-ui' };
    };
    const measured = runInNewContext(expression, { document, getComputedStyle, innerWidth: 1440, innerHeight: 900 });
    assert.equal(measured.fonts.delta, delta);
    assert.equal(measured.fonts.prose.tag, 'P');
    assert.equal(measured.fonts.hostBodySize, (14 + delta) + 'px');
    assert.equal(measured.fonts.prose.size, (14 + delta) + 'px');
    assert.equal(measured.fonts.prose.line, (1.6 * (14 + delta)) + 'px');
    assert.equal(measured.fonts.prose.weight, '400');
    assert.equal(measured.fonts.prose.family, 'anthropic-serif, Georgia');
    assert.equal(measured.fonts.response.expectedStack, 'anthropic-serif, Georgia');
    assert.equal(measured.fonts.command.size, (13 + delta) + 'px');
    assert.equal(created, 1);
    assert.equal(removed, 1);
    assert.equal(attached, false, 'measurement must leave no probe in the mock DOM');
    assert.equal(numericTypographyGate()(measured.fonts).pass, true);
  }
});

test('Reader gate requires known unchanged inventory, independently of whole-host coverage', () => {
  const report = syntheticReaderReport();
  assert.equal(summarizeReaderGate(report, '0.3.0').readerPass, true);
  for (const changes of [{ sessionCountBefore: null }, { sessionCountAfter: null }, { sessionCountBefore: undefined }, { sessionCountAfter: undefined }, { sessionCountAfter: 767 }, { sessionCountAfter: 765 }]) {
    assert.equal(summarizeReaderGate({ ...report, ...changes }, '0.3.0').readerPass, false);
  }
});

test('three covered Reader cases remain explicit while whole-host blocked prerequisites prevent full pass', () => {
  const report = syntheticReaderReport();
  const third = structuredClone(report.sessions[0]!);
  third.title = 'three';
  report.sessions[2] = third;
  const gate = summarizeReaderGate(report, '0.3.0');
  assert.equal(gate.readerPass, true);
  assert.equal(gate.readerScope.complete, true);
  assert.equal(gate.readerScope.requested, 3);
  assert.equal(gate.readerScope.covered, 3);
  assert.equal(gate.readerScope.passed, 3);
  assert.equal(gate.readerPass && gate.readerScope.complete && report.uncovered.length === 0, false);
});

function numericTypographyGate() {
  const source = readFileSync(new URL('../scripts/verify-live-reader.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('// BEGIN TYPOGRAPHY GATE');
  const end = source.indexOf('// END TYPOGRAPHY GATE');
  return runInNewContext(source.slice(start, end) + '\ntypographyGate') as (fonts: Record<string, unknown>) => { pass: boolean; proseSize: boolean; proseLine: boolean; commandSize: boolean };
}

test('visible-width gate rejects offscreen prose even when all scrollWidth checks pass', () => {
  const source = readFileSync(new URL('../scripts/verify-live-reader.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('// BEGIN VISIBLE WIDTH GATE');
  const end = source.indexOf('// END VISIBLE WIDTH GATE');
  const gate = runInNewContext(source.slice(start, end) + '\nvisibleWidthGate') as (state: unknown) => boolean;
  const rect = (left: number, right: number) => ({ left, right, width: right - left });
  const state = { viewport: { width: 480 }, overflowX: { page: false, scroller: false, root: false },
    horizontalBounds: { root: rect(20, 460), column: rect(20, 460), prose: rect(20, 460), scroller: rect(20, 460) } };
  assert.equal(gate(state), true);
  assert.equal(gate({ ...state, horizontalBounds: { ...state.horizontalBounds, prose: rect(-140, 320) } }), false);
  assert.equal(gate({ ...state, horizontalBounds: { ...state.horizontalBounds, column: rect(20, 700) } }), false);
  assert.equal(gate({ ...state, horizontalBounds: { ...state.horizontalBounds, scroller: rect(146, 344) } }), false);
  assert.equal(gate({ ...state, horizontalBounds: { root: rect(-78, 334), scroller: rect(-78, 344), column: rect(0, 334), prose: rect(16, 318) } }), true, 'a clipped host is acceptable only when the reading column and prose remain visible');
  assert.equal(gate({ viewport: { width: 480 } }), false, 'missing geometry cannot count as visible');
});

test('typography gate compares paragraph to independent host size, ratio 1.6 and command size 13 plus delta', () => {
  const gate = numericTypographyGate();
  for (const delta of [-1, 0, 2, 0.5]) {
    const fonts = { delta, hostBodySize: (14 + delta) + 'px', prose: { tag: 'P', size: (14 + delta) + 'px', line: (1.6 * (14 + delta)) + 'px', weight: '400', family: 'Georgia' },
      command: { size: (13 + delta) + 'px' }, serif: { loaded: false, fontSetCheck: false } };
    assert.equal(gate(fonts).pass, true, '404/fallback is allowed when actual numeric typography is correct');
    assert.equal(gate({ ...fonts, prose: { ...fonts.prose, size: (16 + delta) + 'px' } }).pass, false);
    assert.equal(gate({ ...fonts, prose: { ...fonts.prose, line: (1.5 * (14 + delta)) + 'px' } }).pass, false);
    assert.equal(gate({ ...fonts, prose: { ...fonts.prose, weight: '500' } }).pass, false);
    assert.equal(gate({ ...fonts, command: { size: (12 + delta) + 'px' } }).pass, false);
    assert.equal(gate({ ...fonts, command: null }).pass, true, 'command is optional only when absent');
    assert.equal(gate({ ...fonts, hostBodySize: '18px', prose: { ...fonts.prose, size: '18px', line: '28.8px' } }).pass, true, 'explicit host size takes precedence over delta fallback');
    for (const hostBodySize of [undefined, 'normal', '0px', 'NaNpx']) {
      assert.equal(gate({ ...fonts, hostBodySize }).pass, false, 'missing or invalid independent host measurement must fail');
    }
  }
  assert.equal(gate({ delta: NaN, hostBodySize: '16px', prose: { tag: 'P', size: '16px', line: '25.6px', weight: '400' } }).pass, false);
  assert.equal(gate({ delta: 0, hostBodySize: '16px', prose: { tag: 'ARTICLE', size: '16px', line: '25.6px', weight: '400' } }).pass, false);
  assert.equal(gate({ delta: 0, hostBodySize: '16px', prose: { tag: 'P', size: '16px', line: 'normal', weight: '400' } }).pass, false);
});
