// Read-only side-by-side recorder: one headless Chrome per run, one tab (REC_TAB=对话|阅读) on one session.
// Run it twice at the same time (REC_TAB=对话 and REC_TAB=阅读) into two output dirs to compare a running turn.
// Clicks only: workspace row (expand), 「展开其余」, the session row, the tab. Never types or sends.
// Request-stage interception blocks session/create and every non-allowlisted write before sending.
// Records the installed bundle; no bundle replacement. Safety interception is always enabled.
// Usage: REC_TAB=阅读 node scripts/record-compare.mjs <out dir> <session id suffix> <workspace name> [minutes=8] [interval seconds=12]
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readonlyDecision, readonlyRequestSummary, classifyBrowserError, recordBlockedRequest } from './browser-readonly.mjs';

const base = process.env.DSH_TEST_URL || 'http://127.0.0.1:3193';
const expectedVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const [out, title, workspace, minutes = '8', interval = '12'] = process.argv.slice(2);
if (!Number.isFinite(Number(minutes)) || Number(minutes) <= 0 || !Number.isFinite(Number(interval)) || Number(interval) <= 0) throw new Error('Recording minutes and interval must be positive finite numbers');
if (!['对话', '阅读'].includes(process.env.REC_TAB ?? '') || !out || !title || !workspace) throw new Error('Set REC_TAB=对话|阅读 and pass <out dir> <session id suffix> <workspace name>.');
mkdirSync(out, { recursive: true });
let creates = 0;
const blockedRequests = [];
let phase = 'startup';
let recordStatus = 'uncovered';
let recorder;
let profileRemoved = false;
const profile = mkdtempSync(join(tmpdir(), 'clearview-rec-'));
const chrome = spawn(join(process.env.ProgramFiles || 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'),
  ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--window-size=1440,900', 'about:blank'],
  { stdio: 'ignore', windowsHide: true });
const delay = ms => new Promise(done => setTimeout(done, ms));
const log = [];
const cleanup = () => {
  recorder?.close();
  if (chrome.pid && chrome.exitCode === null) spawnSync('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  for (let i = 0; i < 20; i++) {
    try { rmSync(profile, { recursive: true, force: true }); break; }
    catch { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500); }
  }
  profileRemoved = !existsSync(profile);
  if (!profileRemoved) recordStatus = 'fail';
  writeFileSync(join(out, 'log.json'), JSON.stringify({ status: recordStatus, base, expectedVersion, blockedRequests, blockedRequestCount: blockedRequests.reduce((sum, request) => sum + request.counter, 0), blockedPrerequisite: blockedRequests.filter(request => request.blockedPrerequisite), creates, profileRemoved, frames: log }, null, 1));
};
process.on('uncaughtException', e => { console.error('FATAL', e); recordStatus = 'fail'; log.push({ fatal: String(e?.stack ?? e) }); cleanup(); process.exit(2); });
process.on('unhandledRejection', e => { console.error('FATAL', e); recordStatus = 'fail'; log.push({ fatal: String(e?.stack ?? e) }); cleanup(); process.exit(2); });

let port;
for (let i = 0; i < 100 && !port; i++) { try { port = Number(readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]); } catch {} if (!port) await delay(100); }
async function page(ws) {
  await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = fail; });
  let id = 0; const pending = new Map(); const createRequests = new Set();
  const send = (method, params = {}) => new Promise((ok, fail) => { const n = ++id; const timer = setTimeout(() => { pending.delete(n); fail(new Error('CDP timeout: ' + method)); }, 15000); pending.set(n, { ok, fail, timer }); ws.send(JSON.stringify({ id: n, method, params })); });
  const exceptions = [];
  const handlerErrors = [];
  ws.onmessage = async e => {
    let paused;
    try {
      const m = JSON.parse(e.data);
    if (m.method === 'Network.requestWillBeSent' && /session[/.]create/.test(m.params.request.url + (m.params.request.postData ?? ''))) createRequests.add(m.params.requestId);
    if (m.method === 'Network.responseReceived' && createRequests.has(m.params.requestId)) creates++;
    if (m.method === 'Runtime.exceptionThrown') exceptions.push({ kind: 'runtime', text: m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text, phase });
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') exceptions.push({ kind: 'console', text: m.params.args.map(arg => arg.value ?? arg.description ?? '').join(' '), phase });
    if (m.method === 'Fetch.requestPaused') {
      paused = m.params.requestId;
      const decision = readonlyDecision(m.params.request, base);
      if (!decision.allowed) { recordBlockedRequest(blockedRequests, readonlyRequestSummary(m.params.request, decision)); await send('Fetch.failRequest', { requestId: paused, errorReason: 'BlockedByClient' }); }
      else await send('Fetch.continueRequest', { requestId: paused });
    }
    const w = pending.get(m.id); if (w) { clearTimeout(w.timer); pending.delete(m.id); m.error ? w.fail(new Error(m.error.message)) : w.ok(m.result); }
    } catch (error) { handlerErrors.push(String(error)); if (paused) await send('Fetch.failRequest', { requestId: paused, errorReason: 'BlockedByClient' }).catch(() => {}); }
  };
  const evaluate = async expression => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text); return r.result.value; };
  const until = async (expr, ms = 20000) => { for (let w = 0; w < ms; w += 200) { if (await evaluate(expr)) return true; await delay(200); } return false; };
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  await send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  return { send, evaluate, until, exceptions, handlerErrors, close: () => ws.close() };
}
const target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page');
const p = await page(new WebSocket(target.webSocketDebuggerUrl));
recorder = p;
p.tab = process.env.REC_TAB;
const failCoverage = reason => { log.push({ uncovered: reason }); throw new Error('UNCOVERED: ' + reason); };
try {
  await p.send('Page.navigate', { url: base });
  if (!await p.until("!!document.querySelector('[data-composer-seat]')", 30000)) failCoverage('Host not ready with writes blocked');
  await p.until("!!document.querySelector('[role=treeitem][data-row-key^=\"session:\"]')");
  const rows = `[...document.querySelectorAll('[role="treeitem"][data-row-key^="session:"]')].filter(n => n.dataset.rowKey.endsWith(${JSON.stringify(title)}))`;
  await p.until(`${rows}.length > 0`, 8000);
  if (!await p.evaluate(`${rows}.length > 0`)) {
    await p.evaluate(`(() => { const row = [...document.querySelectorAll('[role="treeitem"][data-row-key^="workspace:"]')].find(n => n.textContent.trim() === ${JSON.stringify(workspace)}); if (row && row.getAttribute('aria-expanded') === 'false') row.click(); })()`);
    await delay(1500);
  }
  for (let r = 0; r < 10 && !await p.evaluate(`${rows}.length > 0`); r++) {
    await p.evaluate(`(() => { const row = [...document.querySelectorAll('[role="treeitem"][data-row-key^="workspace:"]')].find(n => n.textContent.trim() === ${JSON.stringify(workspace)}); const b = [...(row?.closest('[class*=groupSection]')?.querySelectorAll('button') ?? [])].find(n => /展开其余/.test(n.textContent)); b?.click(); })()`);
    await delay(1200);
  }
  if (!await p.until(`${rows}.length > 0`, 5000)) failCoverage('session row not found on ' + p.tab + ' ' + JSON.stringify(await p.evaluate(`[...document.querySelectorAll('[role=treeitem]')].map(n => (n.dataset.rowKey||'').slice(0,20) + ':' + n.getAttribute('aria-expanded') + ':' + n.textContent.trim().slice(0,12)).slice(0,40)`)));
  if (await p.evaluate(`${rows}.length`) !== 1) failCoverage('Session suffix must identify exactly one existing row');
  const sessionKey = await p.evaluate(`${rows}[0].dataset.rowKey`);
  await p.evaluate(`${rows}[0].click()`);
  await delay(2500);
  // Verify the installed reader version even when recording the native chat tab.
  phase = 'reader';
  if (!await p.evaluate("(() => { const tab = [...document.querySelectorAll('[role=tab]')].find(n => n.textContent.trim() === '阅读'); tab?.click(); return !!tab; })()")) failCoverage('Reader tab unavailable for version verification');
  if (!await p.until(`document.querySelector('[data-dsh-clearview]')?.getAttribute('data-dsh-clearview') === ${JSON.stringify(expectedVersion)} && !!document.querySelector('[data-dsh-clearview] section[data-reader-turn]')`)) failCoverage('Installed reader version or mount unavailable');
  phase = p.tab === '对话' ? 'native-chat' : 'reader';
  if (!await p.evaluate(`(() => { const t = [...document.querySelectorAll('[role="tab"]')].find(n => n.textContent.trim() === ${JSON.stringify(p.tab)}); t?.click(); return !!t; })()`)) failCoverage('Requested tab unavailable: ' + p.tab);
  await delay(1500);
  if (creates > 0) throw new Error('session create seen: ' + creates);
  const verifyTarget = async () => {
    const state = await p.evaluate(`(() => {
      const row = [...document.querySelectorAll('[role="treeitem"][data-row-key^="session:"]')].find(n => n.dataset.rowKey === ${JSON.stringify(sessionKey)});
      const tab = [...document.querySelectorAll('[role="tab"]')].find(n => n.getAttribute('aria-selected') === 'true')?.textContent.trim();
      return { sessionKey: row?.dataset.rowKey, sessionSelected: row?.getAttribute('aria-selected') === 'true', tab,
        readerVersion: document.querySelector('[data-dsh-clearview]')?.getAttribute('data-dsh-clearview'),
        readerMounted: !!document.querySelector('[data-dsh-clearview] section[data-reader-turn]') };
    })()`);
    if (state.sessionKey !== sessionKey || !state.sessionSelected || state.tab !== p.tab) failCoverage('Selected session or tab could not be verified');
    if (p.tab === '阅读' && (!state.readerMounted || state.readerVersion !== expectedVersion)) failCoverage('Reader mount/version mismatch');
    return state;
  };
  log.push({ verified: await verifyTarget(), expectedVersion });
  const end = Date.now() + Number(minutes) * 60000;
  for (let n = 0; Date.now() < end; n++) {
    const t0 = Date.now();
    const entry = { n, t: new Date().toISOString().slice(11, 19) };
    const tag = p.tab === '对话' ? 'chat' : 'reader';
    entry.verified = await verifyTarget();
    const { data } = await p.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(out, `${String(n).padStart(3, '0')}-${tag}.png`), Buffer.from(data, 'base64'));
    entry[tag] = await p.evaluate(`(() => { const s = document.querySelector('[data-conversation-scroll]'); return s ? { top: Math.round(s.scrollTop), h: s.scrollHeight, c: s.clientHeight } : null; })()`).catch(e => String(e));
    log.push(entry);
    if (creates > 0) throw new Error('session create seen: ' + creates);
    await delay(Math.max(0, Number(interval) * 1000 - (Date.now() - t0)));
  }
  const nativeNoise = p.exceptions.filter(error => classifyBrowserError(error, blockedRequests) !== 'failure');
  const failures = p.exceptions.filter(error => classifyBrowserError(error, blockedRequests) === 'failure');
  log.push({ exceptions: failures, hostBackgroundErrors: nativeNoise.filter(error => classifyBrowserError(error, blockedRequests) === 'blockedPrerequisite'), uncovered: nativeNoise, handlerErrors: p.handlerErrors, creates });
  recordStatus = failures.length || p.handlerErrors.length || creates > 0 ? 'fail' : nativeNoise.length || blockedRequests.some(request => request.blockedPrerequisite) || !log.some(entry => entry.n !== undefined) ? 'uncovered' : 'pass';
} catch (error) {
  log.push({ error: String(error?.stack ?? error) });
  if (!String(error.message).startsWith('UNCOVERED:')) recordStatus = 'fail';
} finally {
  // Errors still fail when missing sessions or a blocked prerequisite ended the run early.
  const failures = p.exceptions.filter(error => classifyBrowserError(error, blockedRequests) === 'failure');
  const nativeNoise = p.exceptions.filter(error => classifyBrowserError(error, blockedRequests) !== 'failure');
  log.push({ runtimeFailures: failures, uncovered: nativeNoise, handlerErrors: p.handlerErrors });
  if (failures.length || p.handlerErrors.length || creates > 0) recordStatus = 'fail';
  else if (nativeNoise.length || blockedRequests.some(request => request.blockedPrerequisite)) recordStatus = 'uncovered';
  cleanup();
}

console.log(JSON.stringify({ status: recordStatus, blockedRequests, creates, profileRemoved }));
process.exit(recordStatus === 'pass' ? 0 : recordStatus === 'uncovered' ? 2 : 1);
