// Read-only side-by-side recorder: one headless Chrome per run, one tab (REC_TAB=对话|阅读) on one session.
// Run it twice at the same time (REC_TAB=对话 and REC_TAB=阅读) into two output dirs to compare a running turn.
// Clicks only: workspace row (expand), 「展开其余」, the session row, the tab. Never types or sends.
// Aborts when more than one session/create request is seen (the host's own startup session counts as one).
// Records what the host serves: after install this is the installed bundle; no interception here.
// Usage: REC_TAB=阅读 node scripts/record-compare.mjs <out dir> <session id suffix> <workspace name> [minutes=8] [interval seconds=12]
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = 'http://127.0.0.1:3193';
const [out, title, workspace, minutes = '8', interval = '12'] = process.argv.slice(2);
if (!['对话', '阅读'].includes(process.env.REC_TAB ?? '') || !out || !title || !workspace) throw new Error('Set REC_TAB=对话|阅读 and pass <out dir> <session id suffix> <workspace name>.');
mkdirSync(out, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), 'clearview-rec-'));
const chrome = spawn(join(process.env.ProgramFiles || 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'),
  ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--window-size=1440,900', 'about:blank'],
  { stdio: 'ignore', windowsHide: true });
const delay = ms => new Promise(done => setTimeout(done, ms));
const log = [];
const cleanup = () => {
  writeFileSync(join(out, 'log.json'), JSON.stringify(log, null, 1));
  if (chrome.pid) spawnSync('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  for (let i = 0; i < 20; i++) { try { rmSync(profile, { recursive: true, force: true }); return; } catch { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500); } }
};
process.on('uncaughtException', e => { console.error('FATAL', e); log.push({ fatal: String(e?.stack ?? e) }); cleanup(); process.exit(2); });
process.on('unhandledRejection', e => { console.error('FATAL', e); log.push({ fatal: String(e?.stack ?? e) }); cleanup(); process.exit(2); });

let port;
for (let i = 0; i < 100 && !port; i++) { try { port = Number(readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]); } catch {} if (!port) await delay(100); }
let creates = 0;
async function page(ws) {
  await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = fail; });
  let id = 0; const pending = new Map();
  const send = (method, params = {}) => new Promise((ok, fail) => { const n = ++id; pending.set(n, { ok, fail }); ws.send(JSON.stringify({ id: n, method, params })); });
  const exceptions = [];
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.method === 'Network.requestWillBeSent' && m.params.request.method === 'POST' && /session\/create/.test(m.params.request.postData ?? '')) creates++;
    if (m.method === 'Runtime.exceptionThrown') exceptions.push((m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 300));
    const w = pending.get(m.id); if (w) { pending.delete(m.id); m.error ? w.fail(new Error(m.error.message)) : w.ok(m.result); }
  };
  const evaluate = async expression => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text); return r.result.value; };
  const until = async (expr, ms = 20000) => { for (let w = 0; w < ms; w += 200) { if (await evaluate(expr)) return true; await delay(200); } return false; };
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  return { send, evaluate, until, exceptions };
}
const pages = [];
const first = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page');
for (const [tab, target] of [[process.env.REC_TAB, first]]) {
  const p = await page(new WebSocket(target.webSocketDebuggerUrl));
  p.tab = tab; pages.push(p);
}
try {
  for (const p of pages) {
    await p.send('Page.navigate', { url: base });
    await p.until("!!document.querySelector('[data-composer-seat]')", 30000);
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
    if (!await p.until(`${rows}.length > 0`, 5000)) throw new Error('session row not found on ' + p.tab + ' ' + JSON.stringify(await p.evaluate(`[...document.querySelectorAll('[role=treeitem]')].map(n => (n.dataset.rowKey||'').slice(0,20) + ':' + n.getAttribute('aria-expanded') + ':' + n.textContent.trim().slice(0,12)).slice(0,40)`)));
    await p.evaluate(`${rows}[0].click()`);
    await delay(2500);
    await p.evaluate(`(() => { const t = [...document.querySelectorAll('[role="tab"]')].find(n => n.textContent.trim() === ${JSON.stringify(p.tab)}); t?.click(); })()`);
    await delay(1500);
    if (creates > 1) throw new Error('session create seen: ' + creates);
  }
  const end = Date.now() + Number(minutes) * 60000;
  for (let n = 0; Date.now() < end; n++) {
    const t0 = Date.now();
    const entry = { n, t: new Date().toISOString().slice(11, 19) };
    for (const p of pages) {
      const tag = p.tab === '对话' ? 'chat' : 'reader';
      const { data } = await p.send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(out, `${String(n).padStart(3, '0')}-${tag}.png`), Buffer.from(data, 'base64'));
      entry[tag] = await p.evaluate(`(() => { const s = document.querySelector('[data-conversation-scroll]'); return s ? { top: Math.round(s.scrollTop), h: s.scrollHeight, c: s.clientHeight } : null; })()`).catch(e => String(e));
    }
    log.push(entry);
    if (creates > 1) throw new Error('session create seen: ' + creates);
    await delay(Math.max(0, Number(interval) * 1000 - (Date.now() - t0)));
  }
  log.push({ exceptions: pages.map(p => ({ tab: p.tab, list: p.exceptions })), creates });
} finally { cleanup(); }
