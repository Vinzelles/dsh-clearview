// Read-only host verification. Request-stage interception denies every non-allowlisted RPC,
// including startup session/create. Clipboard writes are browser-local receipts only.
// Missing sessions, blocked prerequisites and known native chat noise are reported uncovered.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

import { readonlyDecision, readonlyRequestSummary, classifyBrowserError, interactionCoverage, recordBlockedRequest, summarizeReaderGate } from './browser-readonly.mjs';

// BEGIN TYPOGRAPHY GATE: pure numeric checks; CSS family and FontFace loading are separate evidence.
function typographyGate(fonts) {
  const px = value => typeof value === 'string' && value.trim().endsWith('px') && value.trim().slice(0, -2).trim() !== '' ? Number(value.trim().slice(0, -2)) : NaN;
  const delta = fonts?.delta;
  const expectedBody = px(fonts?.hostBodySize);
  const expectedCommand = 13 + delta;
  const size = px(fonts?.prose?.size);
  const line = px(fonts?.prose?.line);
  const close = (actual, expected) => Number.isFinite(actual) && Number.isFinite(expected) && Math.abs(actual - expected) <= 0.12;
  const validDelta = Number.isFinite(delta) && expectedBody > 0 && expectedCommand > 0;
  const proseSize = validDelta && fonts?.prose?.tag === 'P' && close(size, expectedBody);
  const proseLine = proseSize && close(line, size * 1.6);
  const proseWeight = fonts?.prose?.weight === '400' || fonts?.prose?.weight === 'normal';
  const commandSize = !fonts?.command || validDelta && close(px(fonts.command.size), expectedCommand);
  return { pass: proseSize && proseLine && proseWeight && commandSize, delta, expectedBody, expectedCommand,
    proseSize, proseLine, proseWeight, commandSize, commandCovered: !!fonts?.command };
}
// END TYPOGRAPHY GATE

// BEGIN VISIBLE WIDTH GATE: equal scroll/client widths do not prove that text is on screen.
function visibleWidthGate(state) {
  const width = state?.viewport?.width;
  const bounds = state?.horizontalBounds;
  if (!Number.isFinite(width) || width <= 0 || !bounds) return false;
  const clip = bounds.scroller;
  const left = Math.max(0, clip?.left ?? 0);
  const right = Math.min(width, clip?.right ?? width);
  if (!Number.isFinite(left) || !Number.isFinite(right) || right <= left) return false;
  // The host pane itself may be clipped; the column must use only its visible intersection.
  return ['column', 'prose'].every(key => {
    const box = bounds[key];
    return box && [box.left, box.right, box.width].every(Number.isFinite)
      && box.width > 0 && box.left >= left - 1 && box.right <= right + 1;
  });
}
// END VISIBLE WIDTH GATE

// The reader must report the version this worktree is released as.
const expectedVersion = JSON.parse(readFileSync(resolve('package.json'), 'utf8')).version;
const base = process.env.DSH_TEST_URL || 'http://127.0.0.1:3193';
const bundle = readFileSync(resolve(process.env.READER_BUNDLE || 'lib/client.js'));
const titles = (process.env.READER_SESSIONS || '').split('|').map(value => value.trim()).filter(Boolean);
const out = resolve(process.env.READER_LIVE_OUTPUT || '.perf-results/live');
// READER_NO_INTERCEPT=1 checks the bundle the host itself serves (after install).
const intercept = process.env.READER_NO_INTERCEPT !== '1';
const expand = (process.env.READER_EXPAND || '').split(',').map(value => value.trim()).filter(Boolean);
const conditions = process.env.READER_CONDITIONS !== '0';
if (!titles.length) throw new Error('Set READER_SESSIONS to "|"-separated session title prefixes.');
mkdirSync(out, { recursive: true });

const html = await (await fetch(base)).text();
const boot = JSON.parse(html.match(/globalThis\["__DSH_BOOT__"\] = (.*?);?<\/script>/s)[1].replace(/;$/, ''));
const entry = boot.entries.find(item => item.id === 'dsh-clearview');
if (!entry) throw new Error('dsh-clearview is missing from the boot manifest');
// The host serves plugin clients as combo requests `plugins/??a/client.js,b/client.js,…&rev=…`;
// each plugin is one `window.__ModuleLoader__.load({ id: "…", … });` module. The reader
// request is answered by this script: a combo that is exactly this one file is replaced
// whole, a combined one has only the dsh-clearview module spliced out and swapped for the
// local bundle (every other plugin's module is returned untouched).
const comboList = url => decodeURIComponent(url).split('??')[1]?.split('&')[0]?.split(',') ?? [];
const MODULE_OPEN = 'window.__ModuleLoader__.load({\n\tid: "';
const bundleText = bundle.toString('utf8').replace(/\n\/\/# sourceMappingURL=.*\s*$/, '\n');
function spliceReaderModule(text) {
  const start = text.indexOf(MODULE_OPEN + 'dsh-clearview"');
  if (start < 0) return null;
  const next = text.indexOf(MODULE_OPEN, start + MODULE_OPEN.length);
  if (next >= 0) return text.slice(0, start) + bundleText.trimEnd() + '\n;\n' + text.slice(next);
  const map = text.indexOf('\n//# sourceMappingURL=', start);
  return text.slice(0, start) + bundleText.trimEnd() + '\n' + (map >= 0 ? text.slice(map) : '');
}

const sessionCount = async () => {
  const response = await fetch(new URL('/api/session/list', base), { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method: 'session/list', payload: { args: { _request: {} } } }) });
  if (!response.ok) throw new Error('session/list HTTP ' + response.status);
  const items = (await response.json()).result?.value?.items;
  if (!Array.isArray(items)) throw new Error('session/list did not return a session inventory');
  return items.length;
};
const profile = mkdtempSync(join(tmpdir(), 'clearview-live-'));
const chrome = spawn(process.env.CHROME_PATH || join(process.env.ProgramFiles || 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'),
  ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--window-size=1440,900', 'about:blank'],
  { stdio: 'ignore', windowsHide: true });
const delay = ms => new Promise(done => setTimeout(done, ms));
const killChrome = () => {
  if (!chrome.pid || chrome.exitCode !== null) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  else chrome.kill('SIGKILL');
};
// Chrome's helper processes can hold the profile for a moment after the main process is gone,
// so removal retries for up to ~15s (synchronous: it also runs on the fatal exit path).
const removeProfile = () => {
  let failure;
  for (let attempt = 0; attempt < 30; attempt++) {
    try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); return; } catch (error) { failure = error; }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  }
  console.error('could not remove temporary profile', profile, failure?.message);
};
// Fatal paths that bypass the main flow: never leave Chrome attached to the real DSH page.
const bail = error => { console.error(error); killChrome(); removeProfile(); process.exit(2); };
process.on('unhandledRejection', bail);
process.on('uncaughtException', bail);
const sessionCountBefore = await sessionCount().catch(() => null);
const report = { base, entry: entry.url, previewBundleHash: intercept ? createHash('sha256').update(bundle).digest('hex') : null, sessions: [], exceptions: [], consoleErrors: [], replacements: 0, spliced: 0, sessionCreates: 0, comboPassedThrough: [], handlerErrors: [], sessionCountBefore, blockedRequests: [], skippedChecks: [], blockedPrerequisite: [], hostBackgroundErrors: [], uncovered: [], fatal: null };
let exceptionPhase = 'startup';
let ws;
try {
  let port;
  for (let i = 0; i < 100 && !port; i++) {
    try { port = Number(readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]); } catch {}
    if (!port) await delay(100);
  }
  if (!port) throw new Error('Chrome did not start');
  const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  ws = new WebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl);
  await new Promise((done, fail) => { ws.onopen = done; ws.onerror = fail; });
  let id = 0;
  const pending = new Map();
  const createRequests = new Set();
  const send = (method, params = {}) => new Promise((done, fail) => { const n = ++id; const timer = setTimeout(() => { pending.delete(n); fail(new Error('CDP timeout: ' + method)); }, 15000); pending.set(n, { done, fail, timer }); ws.send(JSON.stringify({ id: n, method, params })); });
  ws.onmessage = async event => {
    let paused;
    try {
      const message = JSON.parse(event.data);
      if (message.method === 'Network.requestWillBeSent' && /session[/.]create/.test(message.params.request.url + (message.params.request.postData ?? ''))) createRequests.add(message.params.requestId);
      if (message.method === 'Network.responseReceived' && createRequests.has(message.params.requestId)) report.sessionCreates++;
      const waiter = pending.get(message.id);
      if (waiter) { clearTimeout(waiter.timer); pending.delete(message.id); message.error ? waiter.fail(new Error(message.error.message)) : waiter.done(message.result); }
      if (message.method === 'Runtime.exceptionThrown') report.exceptions.push({ kind: 'runtime', text: message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text, phase: exceptionPhase });
      if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') report.consoleErrors.push({ kind: 'console', text: message.params.args.map(arg => arg.value ?? arg.description ?? '').join(' ').slice(0, 2000), phase: exceptionPhase });
      if (message.method === 'Fetch.requestPaused') {
        const { requestId, request, responseStatusCode, responseErrorReason } = message.params;
        paused = requestId;
        if (responseStatusCode === undefined && responseErrorReason === undefined) {
          const decision = readonlyDecision(request, base);
          if (!decision.allowed) {
            const summary = readonlyRequestSummary(request, decision);
            recordBlockedRequest(report.blockedRequests, summary);
            await send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' });
          } else await send('Fetch.continueRequest', { requestId });
          return;
        }
        const list = comboList(request.url);
        let replaced = null;
        if (list.includes('dsh-clearview/client.js') && responseStatusCode === 200) {
          if (list.length === 1) replaced = bundleText;
          else {
            const { body, base64Encoded } = await send('Fetch.getResponseBody', { requestId });
            replaced = spliceReaderModule(base64Encoded ? Buffer.from(body, 'base64').toString('utf8') : body);
          }
        }
        if (replaced === null) {
          report.comboPassedThrough.push(request.url);
          await send('Fetch.continueRequest', { requestId });
          return;
        }
        await send('Fetch.fulfillRequest', { requestId, responseCode: 200, body: Buffer.from(replaced, 'utf8').toString('base64'),
          responseHeaders: [{ name: 'Content-Type', value: 'text/javascript; charset=utf-8' }, { name: 'Cache-Control', value: 'no-store' }] });
        if (list.length === 1) report.replacements++; else report.spliced++;
      }
    } catch (error) {
      // A failed interception reply must not become an unhandled rejection that skips cleanup.
      report.handlerErrors.push(String(error?.stack ?? error).slice(0, 500));
      if (paused) await send('Fetch.failRequest', { requestId: paused, errorReason: 'BlockedByClient' }).catch(() => {});
    }
  };
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  const shot = async name => {
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(out, `${name}.png`), Buffer.from(data, 'base64'));
  };
  const until = async (expression, ms = 15000) => {
    for (let waited = 0; waited < ms; waited += 200) { if (await evaluate(expression)) return true; await delay(200); }
    return false;
  };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Network.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    const receipt = { ready: false, writes: [] }; globalThis.__clearviewClipboardStub = receipt;
    const record = (kind, length) => receipt.writes.push({ kind, length });
    Object.defineProperty(navigator, 'clipboard', { configurable: false, value: Object.freeze({
      writeText: async text => { receipt.lastText = String(text); record('writeText', String(text).length); },
      write: async items => { record('write', items.length); },
      readText: async () => '', read: async () => [],
    }) });
    const original = document.execCommand.bind(document);
    document.execCommand = (command, ...args) => {
      if (/^(copy|cut)$/i.test(command)) { record('execCommand:' + command, document.getSelection()?.toString().length ?? 0); return true; }
      return original(command, ...args);
    };
    document.addEventListener('copy', event => { event.preventDefault(); record('copy-event', event.clipboardData?.getData('text/plain')?.length ?? 0); });
    document.addEventListener('cut', event => event.preventDefault());
    receipt.ready = true;
  })()` });
  await send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }, ...(intercept ? [{ urlPattern: '*dsh-clearview/client.js*', requestStage: 'Response' }] : [])] });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: base });
  if (!await until("!!document.querySelector('[data-composer-seat], [data-row-key^=\"workspace:\"]')", 30000)) { report.uncovered.push({ kind: 'host-startup', reason: 'Host did not finish loading with writes blocked' }); throw new Error('DSH did not finish loading safely'); }
  if (!await evaluate('globalThis.__clearviewClipboardStub?.ready === true')) throw new Error('Browser-local clipboard stub unavailable');

  // Selectors of the 0.2.x layout that must not exist any more (counted only to assert 0).
  const retiredSelector = '[data-reader-panel],[data-reader-process],[data-reader-cluster],[data-reader-earlier],[data-reader-narration],[data-reader-activity-pill],[data-reader-reasoning-card],[data-reader-reasoning-row]';
  const collect = `(() => {
    const root = document.querySelector('[data-dsh-clearview]');
    if (!root) return null;
    const all = selector => [...root.querySelectorAll(selector)];
    return {
      version: root.getAttribute('data-dsh-clearview'),
      turns: all('section[data-reader-turn]').length,
      lines: all('[data-reader-line]').length,
      groups: all('[data-reader-group]').map(node => node.getAttribute('data-group-state')),
      flows: all('[data-reader-flow]').length,
      statusLines: all('[data-reader-status-line]').map(node => node.getAttribute('data-phase')),
      liveThoughts: all('[data-reader-live-thought]').length,
      settledThoughts: all('[data-reader-reasoning]').length,
      bubbles: all('[data-reader-user-bubble]').map(node => node.getAttribute('data-clamped')),
      plans: all('[data-reader-plan]').length,
      toolCalls: all('[data-reader-tool-call]').length,
      narration: all('[data-reader-flow] [data-reader-key]').length,
      jump: all('[data-reader-jump]').length,
      retired: root.querySelectorAll(${JSON.stringify(retiredSelector)}).length,
      blockErrors: all('[data-reader-block-error]').map(node => node.getAttribute('data-reader-block-error')),
      triggers: all('[data-reader-trigger]').map(node => node.getAttribute('data-reader-trigger')),
      records: [...new Set(all('[data-reader-record-kind]').map(node => node.getAttribute('data-reader-record-kind')))],
      footers: all('[data-reader-turn-footer]').length,
      deliverables: all('[data-reader-deliverables] button[title]').length,
      answers: all('[data-reader-answer]').length,
      rewindSeats: all('[data-dshcp-rewind-seat="1"]').length,
      dark: document.body.hasAttribute('data-ds-dark-theme'),
    };
  })()`;
  // Geometry / style evidence. Reads computed styles only: row heights, tool summaries, fonts,
  // reader background and horizontal overflow.
  const measure = `(() => {
    const root = document.querySelector('[data-dsh-clearview]');
    if (!root) return null;
    const all = (selector, scope = root) => [...scope.querySelectorAll(selector)];
    const cs = node => getComputedStyle(node);
    const lines = all('[data-reader-line]');
    const heights = {};
    for (const line of lines) { const height = Math.round(line.getBoundingClientRect().height * 10) / 10; heights[height] = (heights[height] ?? 0) + 1; }
    const summaries = all('[data-reader-tool-call] [data-reader-line] span[title]');
    const clipped = summaries.filter(node => node.scrollWidth > node.clientWidth + 1);
    const sample = node => node ? { tag: node.tagName, size: cs(node).fontSize, line: cs(node).lineHeight, weight: cs(node).fontWeight, color: cs(node).color, family: cs(node).fontFamily.slice(0, 120) } : null;
    // Measure rendered prose paragraphs, not the outer article/Block root.
    const prose = root.querySelector('[data-reader-answer] p') ?? root.querySelector('[data-reader-flow] article[data-reader-key] p');
    const code = root.querySelector('[data-reader-answer] code, [data-reader-flow] code');
    const command = root.querySelector('[data-reader-tool-call][data-tool-category="terminal"] [data-reader-line] code');
    // Resolve the custom property's calc() independently of the paragraph we are testing.
    const deltaProbe = document.createElement('span');
    deltaProbe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none';
    deltaProbe.style.setProperty('font-size', 'calc(100px + var(--dsh-content-font-delta, 0px))', 'important');
    root.appendChild(deltaProbe);
    let delta, hostBodySize, primaryColor, secondaryColor, processColor;
    try {
      delta = Number.parseFloat(cs(deltaProbe).fontSize) - 100;
      deltaProbe.style.setProperty('font-size', 'var(--dsh-content-font-size, calc(14px + var(--dsh-content-font-delta, 0px)))', 'important');
      hostBodySize = cs(deltaProbe).fontSize;
      deltaProbe.style.color = 'var(--cc-text-100)';
      primaryColor = cs(deltaProbe).color;
      deltaProbe.style.color = 'var(--cc-text-300)';
      secondaryColor = cs(deltaProbe).color;
      deltaProbe.style.color = 'var(--cv-process-text)';
      processColor = cs(deltaProbe).color;
    }
    finally { deltaProbe.remove(); }
    let backdrop = root; while (backdrop && /^rgba\\(0, 0, 0, 0\\)$|^transparent$/.test(cs(backdrop).backgroundColor)) backdrop = backdrop.parentElement;
    const scroller = document.querySelector('[data-conversation-scroll]');
    const box = node => {
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return { left: rect.left, right: rect.right, width: rect.width };
    };
    return {
      viewport: { width: innerWidth, height: innerHeight },
      horizontalBounds: { root: box(root), column: box(root.firstElementChild), prose: box(prose), scroller: box(scroller) },
      lineCount: lines.length, lineHeights: heights,
      toolSummaries: summaries.length, clippedSummaries: clipped.length,
      fonts: { delta, hostBodySize, prose: sample(prose), command: sample(command), line: sample(root.querySelector('[data-reader-line]')), code: sample(code), toolLine: sample(root.querySelector('[data-reader-tool-call] [data-reader-line]')),
        user: sample(root.querySelector('[data-reader-user-bubble]')), response: { fontSetCheck: document.fonts.check('14px anthropic-sans'), loaded: [...document.fonts].some(face => face.family.replace(/["']/g, '') === 'anthropic-sans' && face.status === 'loaded'), cssStack: prose ? cs(prose).fontFamily : null } },
      rootBackground: cs(root).backgroundColor, backdropBackground: backdrop ? cs(backdrop).backgroundColor : null,
      hierarchy: (() => {
        const thoughts = all('[data-reader-reasoning]');
        const label = root.querySelector('[data-reader-reasoning] > [data-reader-line] [data-reader-line-label]');
        const groups = all('[data-reader-group][data-group-state="settled"] > [data-reader-line] > button');
        const thoughtAndToolMixed = thoughts.filter(node => node.querySelector('[data-reader-tool-call], [data-reader-group]') || node.closest('[data-reader-tool-call], [data-reader-group]')).length;
        const groupAffordance = groups.map(button => ({
          expanded: button.getAttribute('aria-expanded'), hint: button.querySelector('[data-reader-line-hint]')?.textContent,
          chevron: !!button.querySelector('svg[data-open]'),
          background: cs(button).backgroundColor, border: cs(button).borderTopWidth, minHeight: cs(button).minHeight,
        }));
        const bodyPrimary = !!prose && cs(prose).color === primaryColor;
        const bodyDistinct = !!prose && !!label && primaryColor !== processColor && cs(label).color === processColor && cs(prose).color !== cs(label).color;
        const groupsClear = groupAffordance.length > 0 && groupAffordance.every(row => Number.parseFloat(row.border) === 0 && Number.parseFloat(row.minHeight) >= 32 && !row.hint && row.chevron && ['true', 'false'].includes(row.expanded));
        const thoughtButtons = all('[data-reader-reasoning] > [data-reader-line] > button');
        const rowStyle = button => {
          const style = cs(button);
          return Object.fromEntries(['minHeight', 'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight', 'fontSize', 'fontFamily', 'fontWeight', 'fontStyle', 'borderTopWidth', 'borderRadius'].map(key => [key, style[key]]));
        };
        const thoughtStyle = thoughtButtons[0] ? rowStyle(thoughtButtons[0]) : null;
        const processRowsConsistent = !!thoughtStyle && groups.length > 0 && groups.every(button => JSON.stringify(rowStyle(button)) === JSON.stringify(thoughtStyle));
        return { body: sample(prose), process: sample(label), primaryColor, secondaryColor, bodyPrimary, bodyDistinct, thoughts: thoughts.length, thoughtAndToolMixed, groupAffordance, groupsClear, thoughtStyle, processRowsConsistent,
          pass: bodyPrimary && bodyDistinct && thoughts.length > 0 && thoughtAndToolMixed === 0 && groupsClear && processRowsConsistent };
      })(),
      overflowX: { page: document.documentElement.scrollWidth > document.documentElement.clientWidth, scroller: scroller ? scroller.scrollWidth > scroller.clientWidth + 1 : null, root: root.scrollWidth > root.clientWidth + 1 },
      // Elements that stick out past the reader root's right edge (a horizontal-overflow culprit hunt).
      overflowing: (() => { const edge = root.getBoundingClientRect().right + 1; return all('*').filter(node => node.getBoundingClientRect().right > edge && node.getBoundingClientRect().width > 0).slice(0, 6)
        .map(node => ({ tag: node.tagName, cls: String(node.className).slice(0, 50), attrs: [...node.attributes].filter(a => a.name.startsWith('data-reader')).map(a => a.name).join(' '), right: Math.round(node.getBoundingClientRect().right), edge: Math.round(edge) })); })(),
      coverage: (() => {
        const tally = (selector, attribute) => { const counts = {}; for (const node of all(selector)) { const key = node.getAttribute(attribute) ?? ''; counts[key] = (counts[key] ?? 0) + 1; } return counts; };
        return { toolCategories: tally('[data-reader-tool-call]', 'data-tool-category'), toolPhases: tally('[data-reader-tool-call]', 'data-tool-phase'), groupStates: tally('[data-reader-group]', 'data-group-state'),
          childCalls: all('[aria-label="子调用"] [data-reader-tool-call]').length, notices: all('[data-reader-notice]').length };
      })(),
      floating: { jump: !!root.querySelector('[data-reader-jump]') },
    };
  })()`;
  // Only a session row in the sidebar tree is ever clicked (never a workspace row).
  const sessionRows = title => title.startsWith('#')
    ? `[...document.querySelectorAll('[role="treeitem"][data-row-key^="session:"]')].filter(node => node.dataset.rowKey.endsWith(${JSON.stringify(title.slice(1))}))`
    : `[...document.querySelectorAll('[role="treeitem"][data-row-key^="session:"]')].filter(node => node.textContent.trim().startsWith(${JSON.stringify(title)}))`;
  // No startup exception: any observed sent create means the request guard failed.
  const guardCreates = () => { if (report.sessionCreates > 0) throw new Error('a session was created during the run (' + report.sessionCreates + ' session/create requests)'); };
  // Toggle the listed workspace rows open, then their 「展开其余」 buttons, until none is left.
  const expandWorkspaces = async () => {
    for (const workspace of expand) {
      if (!await until(`[...document.querySelectorAll('[role="treeitem"][data-row-key^="workspace:"]')].some(node => node.textContent.trim() === ${JSON.stringify(workspace)})`, 5000)) continue;
      await evaluate(`(() => { const row = [...document.querySelectorAll('[role="treeitem"][data-row-key^="workspace:"]')].find(node => node.textContent.trim() === ${JSON.stringify(workspace)}); if (row && row.getAttribute('aria-expanded') === 'false') row.click(); })()`);
      await delay(1200);
      for (let round = 0; round < 25; round++) {
        const more = await evaluate(`(() => { const row = [...document.querySelectorAll('[role="treeitem"][data-row-key^="workspace:"]')].find(node => node.textContent.trim() === ${JSON.stringify(workspace)}); const button = [...(row?.closest('[class*=groupSection]')?.querySelectorAll('button') ?? [])].find(node => /展开其余/.test(node.textContent)); if (!button) return false; button.click(); return true; })()`);
        if (!more) break;
        await delay(1200);
      }
      guardCreates();
    }
  };
  const clickSession = async title => {
    // The sidebar fills in after the page is ready; wait for the row instead of guessing a delay.
    if (!await until(`${sessionRows(title)}.length > 0`, 20000)) return false;
    const matches = await evaluate(`${sessionRows(title)}.length`);
    if (matches !== 1) return false;
    return evaluate(`(() => { const row = ${sessionRows(title)}[0]; row.click(); return row.dataset.rowKey; })()`);
  };
  const clickTab = label => evaluate(`(() => { const tab = [...document.querySelectorAll('[role="tab"]')].find(node => node.textContent.trim() === ${JSON.stringify(label)}); tab?.click(); return !!tab; })()`);
  const selectedTab = () => evaluate(`[...document.querySelectorAll('[role="tab"]')].find(node => node.getAttribute('aria-selected') === 'true')?.textContent.trim() ?? null`);
  // Hover only: move the pointer over an element. Never a click.
  const hover = async (selector, fraction = 0.5) => {
    const box = await evaluate(`(() => { const node = document.querySelector(${JSON.stringify(selector)}); if (!node) return null; node.scrollIntoView({ block: 'center' }); const r = node.getBoundingClientRect(); return { x: r.x + r.width * ${fraction}, y: r.y + r.height / 2 }; })()`);
    if (!box) return false;
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
    await delay(300);
    return true;
  };

  // These probes operate on local disclosure state only; no host preference or message writes.
  const inspectTurn = turn => {
    const button = turn.querySelector('button[data-reader-turn-disclosure]');
    const flow = turn.querySelector('div[data-reader-flow]');
    const visible = node => node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && node.getBoundingClientRect().height > 0;
    const entries = [...turn.querySelectorAll('div[data-reader-process-entry]')];
    const process = entries.filter(node => node.getAttribute('data-reader-process-entry') === 'true');
    const retained = entries.filter(node => node.getAttribute('data-reader-process-entry') === 'false');
    const answers = [...turn.querySelectorAll('[data-reader-answer]')];
    const persistentContent = [...turn.querySelectorAll('[data-reader-user-bubble], [data-reader-command-input], [data-reader-notice], [data-reader-command-output]')];
    const expanded = button?.getAttribute('aria-expanded');
    const folded = expanded === 'false';
    const summaryCss = button && getComputedStyle(button);
    const summaryStyle = summaryCss && { borders: ['Top','Right','Bottom','Left'].map(side => summaryCss['border'+side+'Width']), background: summaryCss.backgroundColor, radius: summaryCss.borderTopLeftRadius };
    const bottomLineOnly = !!summaryStyle && summaryStyle.borders.join(',') === '0px,0px,1px,0px' && summaryStyle.background === 'rgba(0, 0, 0, 0)' && summaryStyle.radius === '0px';
    const hint = folded ? '展开过程' : '收起过程';
    const label = button?.textContent ?? '';
    const accessibleLabel = button?.getAttribute('aria-label') ?? '';
    const controls = !!button && !!flow?.id && button.getAttribute('aria-controls') === flow.id && document.getElementById(flow.id) === flow;
    return {
      result: turn.getAttribute('data-reader-turn-result'), expanded, controls, label, summaryStyle, bottomLineOnly,
      processCount: process.length, answerCount: answers.length,
      processState: process.length > 0 && process.every(node => node.getAttribute('data-folded') === String(folded) && visible(node) === !folded),
      processStateMismatch: process.filter(node => node.getAttribute('data-folded') !== String(folded) || visible(node) !== !folded).slice(0, 6).map(node => ({
        key: node.getAttribute('data-reader-key'), folded: node.getAttribute('data-folded'), visible: visible(node),
        height: node.getBoundingClientRect().height, display: getComputedStyle(node).display, visibility: getComputedStyle(node).visibility,
      })),
      retainedVisible: retained.every(node => node.getAttribute('data-folded') === 'false' && visible(node)),
      persistentVisible: persistentContent.every(visible),
      answersVisible: answers.length > 0 && answers.every(visible),
      pass: bottomLineOnly && controls && ['true', 'false'].includes(expanded) && accessibleLabel.includes(hint) && !/展开过程|收起过程/.test(label)
        && entries.every(node => ['true', 'false'].includes(node.getAttribute('data-reader-process-entry')))
        && process.length > 0 && process.every(node => node.getAttribute('data-folded') === String(folded) && visible(node) === !folded)
        && retained.every(node => node.getAttribute('data-folded') === 'false' && visible(node)) && answers.every(visible) && persistentContent.every(visible),
    };
  };
  const expandTurns = async () => {
    await evaluate("document.querySelectorAll('[data-dsh-clearview] button[data-reader-turn-disclosure][aria-expanded=\"false\"]').forEach(button => button.click())");
    await delay(400);
  };
  const clickTurnCenter = async () => {
    // This helper navigates to historical content. Establish real upward intent
    // before programmatic positioning; layout scroll intentionally retains follow.
    const portPoint = await evaluate(`(() => {
      const root = document.querySelector('[data-dsh-clearview]');
      const box = root.closest('[data-conversation-scroll]').getBoundingClientRect();
      return { x: (Math.max(0, box.left) + Math.min(innerWidth, box.right)) / 2,
        y: (Math.max(0, box.top) + Math.min(innerHeight, box.bottom)) / 2 };
    })()`);
    await send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...portPoint, deltaX: 0, deltaY: -64, buttons: 0 });
    await delay(100);
    await evaluate("globalThis.__clearviewTurnProbe.button.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })");
    await delay(350);
    const point = await evaluate(`(() => {
      const button = globalThis.__clearviewTurnProbe.button;
      const box = button.getBoundingClientRect();
      const x = box.left + box.width / 2, y = box.top + box.height / 2;
      const hit = document.elementFromPoint(x, y);
      return { x, y, width: box.width, height: box.height, hit: !!hit && button.contains(hit) && box.width > 0 && box.height > 0,
        following: document.querySelector('[data-dsh-clearview]')?.getAttribute('data-reader-following') };
    })()`);
    if (point.hit) {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y });
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', buttons: 1, clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', buttons: 0, clickCount: 1 });
      await delay(450);
    }
    return point;
  };
  await until("!!document.querySelector('[role=treeitem][data-row-key^=\"session:\"]')", 20000);
  await expandWorkspaces();
  report.sidebarRows = await evaluate("(() => { const out = {}; let group = ''; for (const node of document.querySelectorAll('[role=treeitem]')) { const key = node.dataset.rowKey || ''; if (key.startsWith('workspace:')) group = node.textContent.trim(); else out[group] = (out[group] ?? 0) + 1; } return out; })()");
  for (const [index, title] of titles.entries()) {
    const name = `s${index + 1}`;
    // The sidebar drops its 「展开其余」 state after a session switch, so expand again before each pick.
    if (index > 0) await expandWorkspaces();
    const item = { title, opened: await clickSession(title) };
    guardCreates();
    report.sessions.push(item);
    if (!item.opened) { report.uncovered.push({ kind: 'session', title, reason: 'Requested existing session row unavailable; no replacement session created' }); continue; }
    await delay(1500);
    item.sessionSelected = await evaluate(`(() => { const row = [...document.querySelectorAll('[role=treeitem][data-row-key]')].find(node => node.dataset.rowKey === ${JSON.stringify(item.opened)}); return row?.getAttribute('aria-selected') === 'true'; })()`);
    if (!item.sessionSelected) { report.uncovered.push({ kind: 'session-selection', title, reason: 'Requested session could not be confirmed selected' }); continue; }
    exceptionPhase = 'reader';
    if (!await clickTab('阅读')) { report.uncovered.push({ kind: 'reader-tab', title, reason: 'Reader tab unavailable' }); continue; }
    item.readerTabSelected = await selectedTab() === '阅读';
    item.readerMounted = await until("!!document.querySelector('[data-dsh-clearview] section[data-reader-turn]')");
    await delay(800);
    if (!item.readerMounted) { report.uncovered.push({ kind: 'reader-mount', title, reason: 'Reader did not mount under the read-only guard' }); continue; }
    item.initial = await evaluate(collect);
    await send('DOM.enable');
    await send('CSS.enable');
    const fontTarget = await evaluate(`(() => {
      const root = document.querySelector('[data-dsh-clearview]');
      const node = [...root.querySelectorAll('[data-reader-answer] p, [data-reader-flow] article[data-reader-key] p')].find(node => /[\\u4e00-\\u9fff]/.test(node.textContent) && getComputedStyle(node).fontFamily.includes('anthropic-sans'));
      if (!node) return null;
      node.setAttribute('data-reader-font-probe', '');
      return { fontFamily: getComputedStyle(node).fontFamily, fontSize: getComputedStyle(node).fontSize, fontWeight: getComputedStyle(node).fontWeight };
    })()`);
    if (fontTarget) {
      const { root } = await send('DOM.getDocument');
      const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: '[data-reader-font-probe]' });
      item.platformFonts = { ...fontTarget, ...(await send('CSS.getPlatformFontsForNode', { nodeId })) };
      await evaluate("document.querySelector('[data-reader-font-probe]')?.removeAttribute('data-reader-font-probe')");
    }
    item.turnDefaults = await evaluate(`([...document.querySelectorAll('[data-dsh-clearview] section[data-reader-turn]')].map(${inspectTurn})).filter(turn => turn.processCount > 0)`);
    const hasTurnProbe = await evaluate(`(() => {
      const turn = [...document.querySelectorAll('[data-dsh-clearview] section[data-reader-turn][data-reader-turn-result="completed"]')]
        .find(node => node.querySelector('button[data-reader-turn-disclosure]') && node.querySelector('[data-reader-answer]') && node.querySelector('div[data-reader-process-entry="true"]'));
      if (!turn) return false;
      const button = turn.querySelector('button[data-reader-turn-disclosure]');
      const nodes = [...turn.querySelectorAll('div[data-reader-process-entry], div[data-reader-process-entry] *, [data-reader-answer], [data-reader-answer] *')];
      globalThis.__clearviewTurnProbe = { turn, button, nodes };
      return true;
    })()`);
    if (hasTurnProbe) {
      const snapshot = `(() => { const probe = globalThis.__clearviewTurnProbe; return { ...(${inspectTurn})(probe.turn), domRetained: probe.nodes.every(node => node.isConnected && probe.turn.contains(node)) }; })()`;
      item.turnToggle = { before: await evaluate(snapshot) };
      item.turnToggle.openClick = await clickTurnCenter();
      item.turnToggle.opened = await evaluate(snapshot);
      item.turnToggle.closeClick = await clickTurnCenter();
      item.turnToggle.closedImmediate = await evaluate(snapshot);
      item.turnToggle.settled = await until(`(() => { const state = (${inspectTurn})(globalThis.__clearviewTurnProbe.turn); return state.expanded === 'false' && state.processState; })()`, 5000);
      item.turnToggle.closed = await evaluate(snapshot);
      await evaluate('delete globalThis.__clearviewTurnProbe');
    }
    await shot(`${name}-bottom`);
    await expandTurns();
    await evaluate("(() => { const scroller = document.querySelector('[data-conversation-scroll]'); if (scroller) scroller.scrollTop = 0; })()");
    await delay(500);
    await shot(`${name}-top`);
    const closedGroup = await evaluate(`(() => {
      const button = document.querySelector('[data-dsh-clearview] [data-reader-group][data-group-state="settled"] > [data-reader-line] > button[aria-expanded="false"]');
      if (!button) return false;
      button.scrollIntoView({ block: 'center' });
      return true;
    })()`);
    if (closedGroup) {
      await delay(400);
      item.closedGroupVisible = await evaluate(`(() => {
        const button = document.querySelector('[data-dsh-clearview] [data-reader-group][data-group-state="settled"] > [data-reader-line] > button[aria-expanded="false"]');
        if (!button) return null;
        const box = button.getBoundingClientRect();
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return { width: box.width, height: box.height, visible: button.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }),
          inViewport: box.top >= 0 && box.bottom <= innerHeight && box.left >= 0 && box.right <= innerWidth, hit: !!hit && button.contains(hit) };
      })()`);
      await shot(`${name}-closed-group`);
    }
    // Open the first closed group (clicking an already open one would collapse it), then the first
    // closed tool row. Only local disclosure state is toggled.
    item.groupOpened = await evaluate(`(() => {
      const group = [...document.querySelectorAll('[data-dsh-clearview] [data-reader-group]')].find(node => node.querySelector(':scope > [data-reader-line] > button[aria-expanded="false"]'));
      if (!group) return null;
      group.setAttribute('data-live-check', 'group');
      const button = group.querySelector(':scope > [data-reader-line] > button[aria-expanded="false"]');
      if (!button) return null;
      button.click();
      return { state: group.getAttribute('data-group-state'), label: button.textContent.slice(0, 60) };
    })()`);
    await delay(700);
    item.groupAfter = item.groupOpened ? await evaluate("document.querySelector('[data-live-check=group]')?.getAttribute('data-expanded') ?? null") : null;
    item.toolOpened = await evaluate(`(() => {
      const button = document.querySelector('[data-dsh-clearview] [data-reader-tool-call] button[aria-expanded="false"]');
      if (!button) return false;
      button.scrollIntoView({ block: 'center' });
      button.closest('[data-reader-tool-call]').setAttribute('data-live-check', 'tool');
      button.click();
      return true;
    })()`);
    await delay(700);
    item.toolDetails = await evaluate("(() => { const row = document.querySelector('[data-live-check=tool]'); const detail = row?.querySelector('[data-reader-tool-details]'); const box = detail?.getBoundingClientRect(); return !!box && box.height > 0 && detail.checkVisibility({ checkVisibilityCSS: true }) && row.getAttribute('data-expanded') === 'true'; })()");
    await shot(`${name}-group-tool-open`);
    item.measured = await evaluate(measure);
    item.planTick = await evaluate(`(() => {
      const completed = document.querySelector('[data-dsh-clearview] [data-reader-plan] [data-status="completed"]');
      if (!completed) return null;
      const box = completed.querySelector(':scope > span[aria-hidden="true"]');
      const svg = box?.querySelector('svg');
      if (!box || !svg) return { pass: false, reason: 'Completed checkbox has no decorative SVG' };
      const outer = box.getBoundingClientRect(), tick = svg.getBoundingClientRect();
      const style = getComputedStyle(box);
      const offset = { x: tick.left + tick.width / 2 - outer.left - outer.width / 2, y: tick.top + tick.height / 2 - outer.top - outer.height / 2 };
      return { box: { width: outer.width, height: outer.height }, tick: { width: tick.width, height: tick.height }, offset, boxSizing: style.boxSizing, lineHeight: style.lineHeight,
        pass: svg.checkVisibility({ checkVisibilityCSS: true }) && Math.abs(outer.width - 14) <= 0.12 && Math.abs(outer.height - 14) <= 0.12
          && Math.abs(tick.width - 10) <= 0.12 && Math.abs(tick.height - 10) <= 0.12 && Math.abs(offset.x) <= 0.12 && Math.abs(offset.y) <= 0.12
          && style.boxSizing === 'border-box' && box.getAttribute('aria-hidden') === 'true' };
    })()`);
    // Prose / thought / bubble / plan close-ups: one crop each, from the first match.
    for (const [label, selector] of [['answer', '[data-reader-answer]'], ['narration', '[data-reader-flow] [data-reader-key]'], ['thought', '[data-reader-reasoning]'], ['bubble', '[data-reader-user-bubble]'], ['plan', '[data-reader-plan]']]) {
      if (!await evaluate(`(() => { const node = document.querySelector(${JSON.stringify('[data-dsh-clearview] ' + selector)}); if (!node) return false; node.scrollIntoView({ block: 'center' }); return true; })()`)) continue;
      await delay(600);
      const box = await evaluate(`(() => { const r = document.querySelector(${JSON.stringify('[data-dsh-clearview] ' + selector)}).getBoundingClientRect(); return { x: Math.max(0, r.left - 24), y: Math.max(0, r.top - 12), width: r.width + 48, height: Math.min(r.height + 24, 220) }; })()`);
      const { data } = await send('Page.captureScreenshot', { format: 'png', clip: { ...box, scale: 2 } });
      writeFileSync(join(out, `${name}-${label}-crop.png`), Buffer.from(data, 'base64'));
    }
    // Open every remaining group and tool row in a bounded batch so the narrow-width probe sees the widest layout.
    await evaluate("[...document.querySelectorAll('[data-dsh-clearview] [data-reader-group] button[aria-expanded=\"false\"], [data-dsh-clearview] [data-reader-tool-call] button[aria-expanded=\"false\"]')].slice(0, 24).forEach(button => button.click())");
    await delay(900);
    // Narrow-width overflow with everything opened.
    const setWidth = width => send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await setWidth(480);
    await delay(800);
    item.narrow = await evaluate(measure);
    await shot(`${name}-narrow-opened`);
    await evaluate("(() => { const scroller = document.querySelector('[data-conversation-scroll]'); if (scroller) scroller.scrollTop = scroller.scrollHeight; })()");
    await delay(500);
    await shot(`${name}-narrow-bottom`);
    item.narrowBottom = await evaluate(measure);
    await setWidth(1440);
    await delay(800);
    // Hover look of the row kinds (hover only, no click).
    item.hover = {};
    for (const [key, selector] of [['line', '[data-dsh-clearview] [data-reader-line] button'], ['toolLine', '[data-dsh-clearview] [data-reader-tool-call] [data-reader-line] button'], ['fileChanges', '[data-dsh-clearview] [data-reader-file-changes] [data-reader-file-review-toggle]']]) {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 });
      await delay(200);
      if (!await hover(selector, 0.15)) { item.hover[key] = null; continue; }
      item.hover[key] = await evaluate(`(() => { const node = document.querySelector(${JSON.stringify(selector)}); const style = getComputedStyle(node); const box = node.getBoundingClientRect(); return { hovered: node.matches(':hover'), background: style.backgroundColor, left: Math.round(box.left), right: Math.round(box.right), height: Math.round(box.height * 10) / 10 }; })()`);
      await shot(`${name}-hover-${key}`);
    }
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 });
    // Group toggle: aria-expanded must flip on click and flip back (local state only).
    item.groupToggle = await evaluate(`(async () => {
      const group = document.querySelector('[data-dsh-clearview] [data-reader-group]');
      const button = group?.querySelector(':scope > [data-reader-line] > button[aria-expanded]');
      if (!button) return null;
      const snap = () => {
        const member = group.querySelector('[data-reader-tool-call], [data-reader-record-kind]');
        return { expanded: button.getAttribute('aria-expanded'), dataExpanded: group.getAttribute('data-expanded'),
          memberVisible: !!member && member.getBoundingClientRect().height > 0 && member.checkVisibility({ checkVisibilityCSS: true }) };
      };
      const before = snap();
      button.click(); await new Promise(done => setTimeout(done, 500));
      const during = snap();
      button.click(); await new Promise(done => setTimeout(done, 500));
      return { before, during, after: snap() };
    })()`);
    // Clamped user bubbles: the expand control is a plain local toggle.
    item.bubbleClamp = await evaluate(`(async () => {
      const bubble = document.querySelector('[data-dsh-clearview] [data-reader-user-bubble][data-clamped="true"]');
      if (!bubble) return null;
      bubble.scrollIntoView({ block: 'center' });
      const surface = bubble.closest('[data-reader-user-surface]');
      const button = surface?.querySelector('[data-reader-bubble-toggle]');
      if (!button) return { clamped: true, button: false };
      const snap = () => { const box = surface.getBoundingClientRect(), control = button.getBoundingClientRect(), text = bubble.querySelector('[data-reader-user-text]'); return { label: button.getAttribute('aria-label'), iconOnly: !!button.querySelector('svg') && !button.textContent.trim(), controls: button.getAttribute('aria-controls') === text.id, clamped: bubble.getAttribute('data-clamped'), height: Math.round(box.height * 10) / 10,
        inside: control.left >= box.left && control.right <= box.right && control.bottom <= box.bottom,
        inline: control.top < text.getBoundingClientRect().bottom,
        mask: getComputedStyle(bubble.querySelector('[data-open]')).maskImage,
        background: getComputedStyle(surface).backgroundColor, border: getComputedStyle(surface).borderTopWidth }; };
      const before = snap();
      button.click(); await new Promise(done => setTimeout(done, 500));
      const opened = snap();
      button.click(); await new Promise(done => setTimeout(done, 400));
      const after = snap();
      if (![before, opened, after].every(state => state.inside && state.inline && state.iconOnly && state.controls && parseFloat(state.border) >= 1) || before.mask === 'none' || opened.mask !== 'none' || after.mask === 'none') throw Error('User bubble containment or clamp indicator failed: ' + JSON.stringify({ before, opened, after }));
      const seat = bubble.closest('[data-reader-anchor]');
      const copy = seat?.querySelector('[data-dshcp-rewind-root] button[aria-label="复制"]');
      if (!copy) throw Error('User copy control missing');
      const actionButtons = [...seat.querySelectorAll('[data-dshcp-rewind-root] button')];
      const box = bubble.getBoundingClientRect();
      const actionsOutside = actionButtons.length >= 2 && actionButtons.every(control => { const r = control.getBoundingClientRect(); return r.top >= box.bottom && r.left >= box.left - 1 && r.right <= box.right + 1; });
      if (!actionsOutside) throw Error('User message actions must sit below the bubble');
      const expectedText = (bubble.querySelector(':scope > p')?.textContent ?? '') + bubble.querySelector('[data-open]').textContent;
      globalThis.__clearviewClipboardStub.lastText = null;
      copy.click(); await new Promise(done => setTimeout(done, 100));
      const copyClean = globalThis.__clearviewClipboardStub.lastText === expectedText;
      if (!copyClean) throw Error('User copy mismatch: ' + JSON.stringify({ actualLength: globalThis.__clearviewClipboardStub.lastText?.length, expectedLength: expectedText.length, writes: globalThis.__clearviewClipboardStub.writes.slice(-2), controlCaption: globalThis.__clearviewClipboardStub.lastText?.endsWith(button.textContent) }));
      return { clamped: true, button: true, before, opened, after, copyClean, actionsOutside };
    })()`);
    guardCreates();
    // 阅读 → 对话 → 阅读 round trips (tab switches only): the reader remounts and restores its position;
    // any exception thrown meanwhile lands in report.exceptions and fails the run.
    const exceptionsBefore = report.exceptions.length;
    item.roundTrips = [];
    for (let trip = 0; trip < 2; trip++) {
      exceptionPhase = 'native-chat';
      const chatClicked = await clickTab('对话');
      await delay(1200);
      const chatSelected = await selectedTab();
      const readerWhileOnChat = await evaluate("!!document.querySelector('[data-dsh-clearview]')");
      exceptionPhase = 'reader';
      const readerClicked = await clickTab('阅读');
      await delay(1500);
      item.roundTrips.push({ chatClicked, chatSelected, readerClicked, readerSelected: await selectedTab(), readerWhileOnChat, readerVersion: await evaluate("document.querySelector('[data-dsh-clearview]')?.getAttribute('data-dsh-clearview')"), readerBack: await evaluate("!!document.querySelector('[data-dsh-clearview] section[data-reader-turn]')") });
    }
    item.roundTripExceptions = report.exceptions.length - exceptionsBefore;
    // Tab round trips remount completed turns folded. Reopen before thought/group measurements.
    await expandTurns();
    // Conditions, while the reader still has the whole pane: host font size 13/14/16, dark / light,
    // reduced motion. Opening a file below adds a right sidebar that would crowd these screenshots.
    const focusGroup = async () => {
      await evaluate("document.querySelector('[data-dsh-clearview] [data-reader-group]')?.scrollIntoView({ block: 'start' })");
      await delay(350);
    };
    if (conditions) {
    item.fontSizes = {};
    const savedDelta = await evaluate("({ value: document.querySelector('[data-dsh-clearview]').style.getPropertyValue('--dsh-content-font-delta'), priority: document.querySelector('[data-dsh-clearview]').style.getPropertyPriority('--dsh-content-font-delta') })");
    for (const size of ['13px', '14px', '16px']) {
      await evaluate(`document.querySelector('[data-dsh-clearview]').style.setProperty('--dsh-content-font-delta', '${Number.parseFloat(size) - 14}px')`);
      await delay(400);
      await focusGroup();
      item.fontSizes[size] = (await evaluate(measure))?.fonts;
      await shot(`${name}-font-${size}`);
    }
    await evaluate(`(() => { const saved = ${JSON.stringify(savedDelta)}; const root = document.querySelector('[data-dsh-clearview]'); if (saved.value) root.style.setProperty('--dsh-content-font-delta', saved.value, saved.priority); else root.style.removeProperty('--dsh-content-font-delta'); })()`);
    await focusGroup();
    // Theme check. The host theme does not follow prefers-color-scheme, so the attribute is flipped on
    // document.body of this throwaway headless page only (no host setting is written) and restored after.
    item.theme = {};
    const savedTheme = await evaluate("({ dark: document.body.getAttribute('data-ds-dark-theme'), colorScheme: document.documentElement.style.getPropertyValue('color-scheme'), priority: document.documentElement.style.getPropertyPriority('color-scheme') })");
    for (const mode of ['dark', 'light']) {
      await evaluate(mode === 'dark' ? "(() => { document.body.setAttribute('data-ds-dark-theme', ''); document.documentElement.style.colorScheme = 'dark'; })()" : "(() => { document.body.removeAttribute('data-ds-dark-theme'); document.documentElement.style.colorScheme = 'light'; })()");
      await delay(600);
      await focusGroup();
      const measured = await evaluate(measure);
      const expected = 'rgba(0, 0, 0, 0)';
      item.theme[mode] = { attribute: await evaluate("document.body.hasAttribute('data-ds-dark-theme')"), rootBackground: measured?.rootBackground, backdropBackground: measured?.backdropBackground, hierarchy: measured?.hierarchy, expected,
        matches: measured?.rootBackground === expected };
      await shot(`${name}-theme-${mode}`);
      item.theme[mode].bubble = await evaluate(`(() => {
        const surface = document.querySelector('[data-dsh-clearview] [data-reader-user-surface]');
        if (!surface) return null;
        surface.scrollIntoView({ block: 'center' });
        const style = getComputedStyle(surface), border = parseFloat(style.borderTopWidth);
        const color = style.backgroundColor;
        const match = color.match(/rgba?\\(([^)]+)\\)/);
        const channels = match ? match[1].split(',').map(Number) : [];
        const dark = document.body.hasAttribute('data-ds-dark-theme');
        const pass = border >= 1 && channels.length >= 3 && (dark ? channels[0] >= 35 && channels[0] <= 65 : channels[0] >= 220);
        return { border, background: color, pass };
      })()`);
      if (item.theme[mode].bubble && !item.theme[mode].bubble.pass) throw Error('User bubble theme boundary failed: ' + mode);
      await delay(250);
      await shot(`${name}-bubble-${mode}`);
      item.theme[mode].notices = await evaluate(`(() => {
        const nodes = [...document.querySelectorAll('[data-dsh-clearview] [data-reader-notice-tone]')];
        nodes[0]?.scrollIntoView({ block: 'center' });
        return nodes.map(node => { const style = getComputedStyle(node); return { tone: node.getAttribute('data-reader-notice-tone'),
          background: style.backgroundColor, border: style.borderLeftWidth,
          pass: !node.querySelector('[data-reader-line]') && !node.closest('[data-reader-group]') && parseFloat(style.borderLeftWidth) >= 3 && style.backgroundColor !== 'rgba(0, 0, 0, 0)' }; });
      })()`);
      if (item.theme[mode].notices.some(notice => !notice.pass)) throw Error('Exception notice presentation failed: ' + mode);
      if (item.theme[mode].notices.length) { await delay(250); await shot(`${name}-notices-${mode}`); }
    }
    await evaluate(`(() => { const saved = ${JSON.stringify(savedTheme)}; if (saved.dark === null) document.body.removeAttribute('data-ds-dark-theme'); else document.body.setAttribute('data-ds-dark-theme', saved.dark); if (saved.colorScheme) document.documentElement.style.setProperty('color-scheme', saved.colorScheme, saved.priority); else document.documentElement.style.removeProperty('color-scheme'); })()`);
    await delay(400);
    const transitions = "(() => { const read = selector => { const node = document.querySelector(selector); return node ? getComputedStyle(node).transitionDuration : null; }; return { line: read('[data-reader-line] button'), toolLine: read('[data-reader-tool-call] [data-reader-line] button') }; })()";
    item.defaultTransitions = await evaluate(transitions);
    item.motionDefault = await evaluate("document.querySelector('[data-dsh-clearview]')?.getAttribute('data-motion')");
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await delay(400);
    item.reducedMotion = await evaluate("document.querySelector('[data-dsh-clearview]')?.getAttribute('data-motion')");
    item.reducedMotionTransitions = await evaluate(transitions);
    await focusGroup();
    await shot(`${name}-reduced-motion`);
    await send('Emulation.setEmulatedMedia', { features: [] });
    }
    // Coverage of the node kinds a session has: triggers, records. Only local disclosure state is toggled.
    const scrollShot = async (selector, label) => {
      const found = await evaluate(`(() => { const node = document.querySelector(${JSON.stringify(selector)}); if (!node) return false; node.scrollIntoView({ block: 'center' }); return true; })()`);
      if (found) { await delay(500); await shot(`${name}-${label}`); }
      return found;
    };
    const cov = item.coverage = { triggers: {}, records: {} };
    cov.counts = await evaluate("(() => { const root = document.querySelector('[data-dsh-clearview]'); const tally = (selector, attribute) => { const out = {}; root.querySelectorAll(selector).forEach(node => { const key = node.getAttribute(attribute) ?? ''; out[key] = (out[key] ?? 0) + 1; }); return out; }; return { turnResults: tally('section[data-reader-turn]', 'data-reader-turn-result'), groupStates: tally('[data-reader-group]', 'data-group-state'), triggers: tally('[data-reader-trigger]', 'data-reader-trigger'), records: tally('[data-reader-record-kind]', 'data-reader-record-kind'), stoppedTags: [...root.querySelectorAll('*')].filter(node => node.children.length === 0 && node.textContent.trim() === '已停止').length }; })()");
    for (const type of Object.keys(cov.counts.triggers)) {
      cov.triggers[type] = await evaluate(`(() => { const node = document.querySelector('[data-dsh-clearview] [data-reader-trigger="${type}"]'); const button = node.querySelector('button'); button.click(); return { title: button.textContent.slice(0, 60), height: button.getBoundingClientRect().height }; })()`);
      await delay(400);
      cov.triggers[type].shot = await scrollShot(`[data-reader-trigger="${type}"]`, `trigger-${type}`);
      cov.triggers[type].body = await evaluate(`document.querySelector('[data-reader-trigger="${type}"]')?.textContent.slice(0, 160)`);
    }
    for (const kind of Object.keys(cov.counts.records)) {
      cov.records[kind] = await evaluate(`(() => { const record = document.querySelector('[data-dsh-clearview] [data-reader-record-kind="${kind}"]'); const row = record.querySelector('button') ?? record; row.click(); return { title: row.textContent.slice(0, 80), height: row.getBoundingClientRect().height, tone: record.getAttribute('data-record-tone') }; })()`);
      await delay(500);
      cov.records[kind].shot = await scrollShot(`[data-reader-record-kind="${kind}"]`, `record-${kind}`);
      cov.records[kind].body = await evaluate(`document.querySelector('[data-reader-record-kind="${kind}"]')?.textContent.slice(0, 200)`);
      if (kind === 'model-retry') {
        cov.records[kind].disclosure = await evaluate(`(() => {
          const node = document.querySelector('[data-dsh-clearview] [data-reader-record-kind="model-retry"]');
          const button = node.querySelector('button'), detail = document.getElementById(button.getAttribute('aria-controls'));
          const opened = button.getAttribute('aria-expanded') === 'true' && !!detail && detail.getBoundingClientRect().height > 0;
          button.click();
          return { opened, independent: node.getAttribute('data-reader-notice-tone') === 'warning' && !node.querySelector('[data-reader-line]') && !node.closest('[data-reader-group]') };
        })()`);
        await delay(350);
        cov.records[kind].disclosure.closed = await evaluate(`document.querySelector('[data-dsh-clearview] [data-reader-record-kind="model-retry"] button')?.getAttribute('aria-expanded') === 'false'`);
        if (!Object.values(cov.records[kind].disclosure).every(Boolean)) throw Error('Retry notice disclosure failed');
      }
      cov.records[kind].showInChat = await evaluate(`!!document.querySelector('[data-reader-record-kind="${kind}"] [data-reader-show-in-chat]')`);
      if (cov.records[kind].showInChat) {
        await evaluate(`document.querySelector('[data-reader-record-kind="${kind}"] [data-reader-show-in-chat]').click()`);
        await delay(900);
        cov.records[kind].showInChatTab = await selectedTab();
        await shot(`${name}-record-${kind}-in-chat`);
        await clickTab('阅读');
        await delay(900);
        await expandTurns();
      }
    }
    if (await evaluate("!!document.querySelector('[data-reader-inspect]')")) {
      await evaluate("document.querySelector('[data-reader-inspect]').click()");
      await delay(800);
      item.inspectTab = await selectedTab();
      await clickTab('阅读');
      await delay(800);
      await expandTurns();
    }
    guardCreates();
    // Gap between the last transcript block and the composer.
    await evaluate("(() => { const scroller = document.querySelector('[data-conversation-scroll]'); if (scroller) scroller.scrollTop = scroller.scrollHeight; })()");
    await delay(400);
    item.bottomGap = await evaluate(`(() => {
      const root = document.querySelector('[data-dsh-clearview]'); const composer = document.querySelector('[data-composer-seat]');
      if (!root || !composer) return null;
      const blocks = [...root.querySelectorAll('[data-reader-file-changes], [data-reader-turn-footer], [data-reader-answer], [data-reader-group], [data-reader-status-line], [data-reader-attention]')].filter(node => node.getBoundingClientRect().height > 0);
      const lastContent = Math.max(...blocks.map(node => node.getBoundingClientRect().bottom));
      return { composerTop: Math.round(composer.getBoundingClientRect().top), lastContentBottom: Math.round(lastContent), gap: Math.round(composer.getBoundingClientRect().top - lastContent) };
    })()`);
    await shot(`${name}-bottom-gap`);
    // Hover look of the collapsed file-changes header (hover only): background plus side bleed.
    if (await hover('[data-dsh-clearview] [data-reader-file-changes] [data-reader-file-review-toggle]', 0.1)) {
      item.changesHover = await evaluate("(() => { const node = document.querySelector('[data-dsh-clearview] [data-reader-file-changes] [data-reader-file-review-toggle]'); const style = getComputedStyle(node); const root = document.querySelector('[data-dsh-clearview]').getBoundingClientRect(); const box = node.getBoundingClientRect(); return { hovered: node.matches(':hover'), background: style.backgroundColor, boxShadow: style.boxShadow, left: Math.round(box.left), right: Math.round(box.right), rootRight: Math.round(root.right) }; })()");
      await shot(`${name}-changes-hover`);
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 });
    }
    if (await evaluate("!!document.querySelector('[data-reader-file-changes]')")) {
      item.fileCard = await evaluate(`(async () => {
        const card = document.querySelector('[data-reader-file-changes]');
        const rows = () => card.querySelectorAll('[data-reader-changed-file]').length;
        const buttons = () => [...card.querySelectorAll('button')];
        const wait = () => new Promise(resolve => setTimeout(resolve, 350));
        const initialRows = rows();
        const more = buttons().find(node => /^再显示/.test(node.textContent));
        const morePadding = more ? [getComputedStyle(more).paddingLeft, getComputedStyle(more).paddingRight] : null;
        more?.click(); await wait();
        const expandedRows = rows();
        buttons().find(node => node.textContent === '收起文件列表')?.click(); await wait();
        const collapsedRows = rows();
        const review = card.querySelector('[data-reader-file-review-toggle]');
        review.click(); await wait();
        const reviewOpen = card.dataset.open === 'true' && card.querySelector('[data-reader-file-review]').textContent.includes('本会话已加载');
        const reviewHasContent = card.querySelector('[data-reader-file-review]').textContent.length > 60;
        const overflow = card.scrollWidth > card.clientWidth + 1;
        review.click(); await wait();
        return { initialRows, expandedRows, collapsedRows, reviewOpen, reviewHasContent, overflow, morePadding,
          pass: initialRows <= 3 && (!morePadding || morePadding.every(value => parseFloat(value) >= 8)) && (!more || expandedRows > initialRows) && collapsedRows === initialRows && reviewOpen && reviewHasContent && !overflow && card.dataset.open === 'false' };
      })()`);
      if (!item.fileCard.pass) throw Error('Session file card interaction failed');
      const cardTheme = await evaluate("document.body.getAttribute('data-ds-dark-theme')");
      await evaluate("document.body.setAttribute('data-ds-dark-theme', ''); document.querySelector('[data-reader-file-changes]').scrollIntoView({block:'center'})");
      await delay(300); await shot(`${name}-file-card-dark`);
      await evaluate(`(() => { const saved = ${JSON.stringify(cardTheme)}; if (saved === null) document.body.removeAttribute('data-ds-dark-theme'); else document.body.setAttribute('data-ds-dark-theme', saved); })()`);
    }
    // Footer actions on the last closed turn. Fork is only checked for being
    // available: clicking it would create a session.
    const footer = "[...document.querySelectorAll('[data-dsh-clearview] [data-reader-turn-footer]')].at(-1)";
    // An interrupted last turn can have no answer; test the latest copyable turn.
    const copyFooter = "[...document.querySelectorAll('[data-dsh-clearview] [data-reader-turn-footer]')].reverse().find(node => node.querySelector('[aria-label=\"复制回答\"]'))";
    item.forkAvailable = await evaluate(`(() => { const button = ${footer}?.querySelector('[aria-label="从这里分支"]'); return button ? !button.disabled : null; })()`);
    item.copyReceipt = await evaluate(`(async () => {
      const footer = ${copyFooter};
      const button = footer?.querySelector('[aria-label="复制回答"]');
      if (!button) return null;
      const countBefore = globalThis.__clearviewClipboardStub.writes.length;
      button.click();
      await new Promise(done => setTimeout(done, 400));
      return { receipt: footer.querySelector('[data-reader-answer-actions] [role="status"]')?.textContent ?? '', writes: globalThis.__clearviewClipboardStub.writes.slice(countBefore), isolated: globalThis.__clearviewClipboardStub.ready };
    })()`);
    // Deliverable cards carry a title (the path); the 「展开其余」 button has none.
    // File mentions are inline-code buttons inside the answer. Both only open a read-only preview.
    for (const [key, selector] of [['deliverableOpened', '[data-reader-deliverables] button[title]'], ['mentionOpened', '[data-reader-answer] code > button']]) {
      item[key] = await evaluate(`(() => { const target = document.querySelector('[data-dsh-clearview] ${selector}'); target?.scrollIntoView({ block: 'center' }); target?.click(); return !!target; })()`);
      if (item[key]) { await delay(900); await shot(`${name}-${key}`); }
    }
    item.final = await evaluate(collect);
    // Step 2 expectations, evaluated from the evidence above.
    const noOverflow = state => state ? !Object.values(state.overflowX).some(value => value === true) : null;
    const family = (item.measured?.fonts?.prose?.family ?? '').replace(/["']/g, '');
    item.typography = [item.measured, item.narrow, item.narrowBottom].map(state => typographyGate(state?.fonts));
    item.typographyMatrix = Object.fromEntries(Object.entries(item.fontSizes ?? {}).map(([size, fonts]) => [size, typographyGate(fonts)]));
    const covered = (name, value) => interactionCoverage(name, value, { optional: name === 'bubbleToggle', title, skippedChecks: report.skippedChecks, uncovered: report.uncovered });
    const toggle = item.groupToggle;
    const bubble = item.bubbleClamp;
    const turnToggle = item.turnToggle;
    const turnDefaults = result => {
      const turns = item.turnDefaults.filter(turn => turn.result === result);
      if (!turns.length) {
        report.uncovered.push({ kind: 'turn-fold-default', title, result, reason: 'No applicable process-bearing turn in the selected session' });
        return 'uncovered';
      }
      return turns.every(turn => turn.pass && turn.expanded === (result === 'completed' ? 'false' : 'true'));
    };
    if (!item.planTick) report.uncovered.push({ kind: 'plan-tick-center', title, reason: 'No real completed plan check; synthetic fixture coverage belongs to the main task' });
    if (!turnToggle) report.uncovered.push({ kind: 'turn-toggle', title, reason: 'No completed turn with both process entries and final answer' });
    item.checks = {
      completedFoldDefault: turnDefaults('completed'), interruptedOpenDefault: turnDefaults('interrupted'),
      turnToggle: turnToggle ? turnToggle.openClick.hit && turnToggle.closeClick.hit
        && turnToggle.before.expanded === 'false' && turnToggle.opened.expanded === 'true' && turnToggle.closed.expanded === 'false'
        && [turnToggle.before, turnToggle.opened, turnToggle.closed].every(state => state.pass && state.answersVisible && state.domRetained) : 'uncovered',
      planTickCenter: item.planTick ? item.planTick.pass : 'uncovered',
      visibleWidth1440: visibleWidthGate(item.measured),
      visibleWidth480: visibleWidthGate(item.narrow) && visibleWidthGate(item.narrowBottom),
      overflow1440: covered('geometry1440', noOverflow(item.measured)), overflow480: covered('geometry480', item.narrow && item.narrowBottom ? noOverflow(item.narrow) && noOverflow(item.narrowBottom) : null),
      proseCssStack: !item.measured?.fonts?.prose ? 'n/a' : family.startsWith('anthropic-sans') ? 'declared' : 'fallback-stack',
      // CSS stack and FontFace loaded status are evidence, never proof of the font used for a glyph.
      fontLoaded: item.measured?.fonts?.response?.loaded ?? null,
      typography: item.typography.every(state => state.pass) && Object.values(item.typographyMatrix).every(state => state.pass),
      hierarchy: [item.measured, item.narrow, item.narrowBottom].every(state => state?.hierarchy?.pass) && Object.values(item.theme ?? {}).every(theme => theme.hierarchy?.pass)
        && !!item.closedGroupVisible?.visible && item.closedGroupVisible.inViewport && item.closedGroupVisible.hit && item.closedGroupVisible.width > 0 && item.closedGroupVisible.height >= 32,
      groupToggle: covered('groupToggle', toggle ? toggle.before.expanded !== toggle.during.expanded && toggle.before.expanded === toggle.after.expanded && [toggle.before, toggle.during, toggle.after].every(state => ['true', 'false'].includes(state.expanded) && state.expanded === state.dataExpanded && state.memberVisible === (state.expanded === 'true')) : null),
      groupOpened: covered('groupOpened', item.groupOpened ? item.groupAfter === 'true' : null),
      toolDetails: covered('toolDetails', item.toolOpened ? item.toolDetails === true : null),
      bubbleToggle: covered('bubbleToggle', bubble ? bubble.button === true && bubble.before?.clamped === 'true' && bubble.opened?.clamped === 'false' && bubble.after?.clamped === 'true' && bubble.opened.height > bubble.before.height + 1 && Math.abs(bubble.after.height - bubble.before.height) <= 1 && bubble.before.label === '展开全文' && bubble.opened.label === '收起全文' && bubble.after.label === '展开全文' && bubble.actionsOutside && bubble.copyClean : null),
      roundTrips: item.roundTrips.length === 2 && item.roundTrips.every(trip => trip.chatClicked && trip.chatSelected === '对话' && !trip.readerWhileOnChat && trip.readerClicked && trip.readerSelected === '阅读' && trip.readerBack && trip.readerVersion === expectedVersion),
      copy: covered('copy', item.copyReceipt ? item.copyReceipt.isolated && item.copyReceipt.receipt.includes('已复制') && item.copyReceipt.writes.length > 0 : null),
      themeBackground: [item.measured, item.narrow, item.narrowBottom].every(state => state?.rootBackground === 'rgba(0, 0, 0, 0)')
        && (!item.theme || item.theme.dark.matches && item.theme.light.matches),
    };
    item.checks.pass = item.checks.overflow1440 && item.checks.overflow480 && item.checks.visibleWidth1440 && item.checks.visibleWidth480 && item.checks.themeBackground !== false
      && item.checks.completedFoldDefault !== false && item.checks.interruptedOpenDefault !== false && item.checks.turnToggle !== false && item.checks.planTickCenter !== false
      && item.checks.typography && item.checks.hierarchy && item.checks.groupToggle && item.checks.groupOpened && item.checks.toolDetails && item.checks.bubbleToggle && item.checks.roundTrips && item.checks.copy;
    guardCreates();
  }
  report.sessionCountAfter = await sessionCount();
} catch (error) {
  if (report.uncovered.some(item => item.kind === 'host-startup')) report.incomplete = String(error?.stack ?? error);
  else report.fatal = String(error?.stack ?? error);
} finally {
  try { ws?.close(); } catch {}
  const exited = new Promise(done => chrome.once('exit', done));
  killChrome();
  await Promise.race([exited, delay(5000)]);
  removeProfile();
}
report.profileRemoved = !existsSync(profile);
if (report.sessionCountAfter === undefined) report.sessionCountAfter = await sessionCount().catch(() => null);
const allErrors = report.exceptions.concat(report.consoleErrors);
const nativeNoise = allErrors.filter(error => classifyBrowserError(error, report.blockedRequests) === 'nativeReact130');
report.hostBackgroundErrors = allErrors.filter(error => classifyBrowserError(error, report.blockedRequests) === 'blockedPrerequisite');
for (const error of nativeNoise) report.uncovered.push({ kind: 'nativeReact130', reason: error.text, phase: error.phase });
const readerErrors = allErrors.filter(error => classifyBrowserError(error, report.blockedRequests) === 'failure');
report.hostStartupErrors = allErrors.filter(error => classifyBrowserError(error, report.blockedRequests) === 'hostStartup');
for (const error of report.hostStartupErrors) report.uncovered.push({ kind: 'hostStartup', phase: error.phase, reason: error.text.split('\n')[0] });
if (report.sessionCountBefore === null || report.sessionCountAfter === null) report.uncovered.push({ kind: 'session-inventory', reason: 'Session counts unavailable' });
report.blockedPrerequisite = report.blockedRequests.filter(request => request.blockedPrerequisite);
report.blockedRequestCount = report.blockedRequests.reduce((sum, request) => sum + request.counter, 0);
for (const request of report.blockedPrerequisite) report.uncovered.push({ kind: 'blockedPrerequisite', ...request });
report.readerErrors = readerErrors;
Object.assign(report, summarizeReaderGate(report, expectedVersion, { intercept }));
report.wholeHostScope = { complete: report.uncovered.length === 0, uncovered: report.uncovered };
report.pass = report.readerPass && report.readerScope.complete && report.wholeHostScope.complete
  && report.sessionCountBefore !== null && report.sessionCountAfter !== null && report.sessionCountBefore === report.sessionCountAfter;
const failedChecks = report.sessions.some(item =>
  item.checks && Object.entries(item.checks).some(([key, value]) =>
    (!['pass', 'fontLoaded'].includes(key) && value === false) || (key === 'proseCssStack' && value === 'mismatch'))
  || [item.initial, item.final].some(state => state && (state.version !== expectedVersion || state.blockErrors.length > 0 || state.retired > 0)));
const inventoryChanged = report.sessionCountBefore !== null && report.sessionCountAfter !== null && report.sessionCountBefore !== report.sessionCountAfter;
report.status = report.pass ? 'pass' : report.fatal || readerErrors.length || report.handlerErrors.length || report.sessionCreates > 0 || inventoryChanged || failedChecks ? 'fail' : 'uncovered';
writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ pass: report.pass, readerPass: report.readerPass, readerScope: report.readerScope, wholeHostScope: report.wholeHostScope, blockedRequestCount: report.blockedRequestCount, skippedChecks: report.skippedChecks, blockedPrerequisite: report.blockedPrerequisite, hostBackgroundErrors: report.hostBackgroundErrors, status: report.status, uncovered: report.uncovered, blockedRequests: report.blockedRequests, fatal: report.fatal, replacements: report.replacements, spliced: report.spliced, comboPassedThrough: report.comboPassedThrough.length, sessions: report.sessions.map(item => ({ title: item.title, opened: item.opened, initial: item.initial, checks: item.checks })), readerErrors }, null, 2));
process.exit(report.pass ? 0 : report.status === 'uncovered' ? 2 : 1);
