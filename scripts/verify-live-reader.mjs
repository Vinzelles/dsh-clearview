// Real-host check: a fresh headless Chrome profile opens the live DSH page and
// receives the locally built reader bundle through CDP response interception.
// Nothing is installed and no message is sent; only existing sessions are opened.
// Safety: this script only reads and navigates. It never types, never presses a key,
// never clicks fork / rewind / approve / stop / settings, and never creates a session.
// Workspace rows (and their 「展开其余」 buttons) are only toggled open when READER_EXPAND lists
// them, to reach sessions hidden in collapsed sidebar groups; the script counts session/create
// requests and aborts if there is more than the host's own blank startup session.
// READER_SESSIONS entries are title prefixes, or "#<id suffix>" to pick one session row by id.
// READER_CONDITIONS=0 skips the font-size / theme / reduced-motion matrix (narrow still runs).
// Side effects to expect: (1) loading the DSH page makes the host open its own blank startup
// session; (2) the 复制回答 check clicks the real copy button, and headless Chrome may write the
// answer text to your real system clipboard (the profile is isolated, the OS clipboard is not);
// (3) the temporary Chrome profile (%TEMP%/clearview-live-*) is removed when the run ends: the
// script stops Chrome (taskkill /T /F on Windows), waits for it to exit, then deletes the
// profile with retries, on success, on failure and on an uncaught error.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

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
  return (await response.json()).result?.value?.items?.length ?? null;
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
const sessionCountBefore = await sessionCount();
const report = { base, entry: entry.url, sessions: [], exceptions: [], consoleErrors: [], replacements: 0, spliced: 0, sessionCreates: 0, comboPassedThrough: [], handlerErrors: [], sessionCountBefore };
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
  const send = (method, params = {}) => new Promise((done, fail) => { const n = ++id; pending.set(n, { done, fail }); ws.send(JSON.stringify({ id: n, method, params })); });
  ws.onmessage = async event => {
    try {
      const message = JSON.parse(event.data);
      if (message.method === 'Network.requestWillBeSent' && message.params.request.method === 'POST' && /session\/create/.test(message.params.request.postData ?? '')) report.sessionCreates++;
      const waiter = pending.get(message.id);
      if (waiter) { pending.delete(message.id); message.error ? waiter.fail(new Error(message.error.message)) : waiter.done(message.result); }
      if (message.method === 'Runtime.exceptionThrown') report.exceptions.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
      if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') report.consoleErrors.push(message.params.args.map(arg => arg.value ?? arg.description ?? '').join(' ').slice(0, 500));
      if (message.method === 'Fetch.requestPaused') {
        const { requestId, request, responseStatusCode } = message.params;
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
  await send('Browser.grantPermissions', { origin: new URL(base).origin, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] }).catch(() => {});
  if (intercept) await send('Fetch.enable', { patterns: [{ urlPattern: '*dsh-clearview/client.js*', requestStage: 'Response' }] });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: base });
  if (!await until("!!document.querySelector('[data-composer-seat]')", 30000)) throw new Error('DSH did not finish loading');

  const collect = `(() => {
    const root = document.querySelector('[data-dsh-clearview]');
    if (!root) return null;
    const all = selector => [...root.querySelectorAll(selector)];
    return {
      version: root.getAttribute('data-dsh-clearview'),
      turns: all('section[data-reader-turn]').length,
      panels: all('[data-reader-panel]').map(panel => panel.getAttribute('data-status')),
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
  // Geometry / style evidence. Reads computed styles only. Wide rows, shimmer clipping,
  // inset backgrounds, the reasoning preview and per-size font metrics.
  const measure = `(() => {
    const root = document.querySelector('[data-dsh-clearview]');
    if (!root) return null;
    const all = (selector, scope = root) => [...scope.querySelectorAll(selector)];
    const cs = node => getComputedStyle(node);
    const rows = all('[data-disclosure-row]');
    const heights = {};
    for (const row of rows) { const height = Math.round(row.getBoundingClientRect().height * 10) / 10; heights[height] = (heights[height] ?? 0) + 1; }
    const summaries = all('[data-reader-tool-call] [data-disclosure-row] span[title]');
    const clipped = summaries.filter(node => node.scrollWidth > node.clientWidth + 1);
    const wrapper = node => { let p = node.parentElement; const chain = []; while (p && !p.hasAttribute('data-disclosure-row') && chain.length < 4) { chain.push({ cls: String(p.className).slice(0, 40), overflow: cs(p).overflow, scrollWidth: p.scrollWidth, clientWidth: p.clientWidth }); p = p.parentElement; } return chain; };
    const details = all('[data-reader-tool-details]');
    const cards = all('[data-reader-reasoning-card]');
    const reasoning = all('[data-reader-reasoning]').map(node => {
      const rowText = node.querySelector('[data-reader-reasoning-row]')?.textContent ?? '';
      const text = node.querySelector('[data-reader-reasoning-text]');
      const viewport = node.querySelector('[data-reader-reasoning-scroll]');
      const card = node.querySelector('[data-reader-reasoning-card]');
      return { row: rowText.slice(0, 80), cardLive: card?.getAttribute('data-live') ?? null,
        textStart: text?.textContent.trim().slice(0, 40) ?? null, scrollTop: viewport?.scrollTop ?? null, scrollHeight: viewport?.scrollHeight ?? null, clientHeight: viewport?.clientHeight ?? null };
    });
    const sample = selector => { const node = root.querySelector(selector); return node ? { size: cs(node).fontSize, line: cs(node).lineHeight } : null; };
    const scroller = document.querySelector('[data-conversation-scroll]');
    return {
      viewport: { width: innerWidth, height: innerHeight },
      rowCount: rows.length, rowHeights: heights,
      toolSummaries: summaries.length, clippedSummaries: clipped.length,
      clippedSample: clipped.slice(0, 3).map(node => ({ textOverflow: cs(node).textOverflow, text: node.textContent.slice(0, 40), scrollWidth: node.scrollWidth, clientWidth: node.clientWidth, wrappers: wrapper(node) })),
      insetToken: cs(root).getPropertyValue('--dsw-alias-markdown-code-block').trim() || null,
      insetBackground: details.slice(0, 2).map(node => cs(node).backgroundColor),
      reasoningCardBackground: cards.slice(0, 2).map(node => cs(node).backgroundColor),
      reasoning: reasoning.slice(0, 6),
      fonts: { answer: sample('[data-reader-answer] p'), toolRow: sample('[data-reader-tool-call] [data-disclosure-row]'), panelHeader: sample('[data-reader-panel] button'), meta: sample('[data-reader-answer-actions] > span:not([role])'), user: sample('[data-reader-anchor]:not(article)') },
      overflowX: { scrollerStyle: scroller ? cs(scroller).overflowX : null, page: document.documentElement.scrollWidth > document.documentElement.clientWidth, scroller: scroller ? scroller.scrollWidth > scroller.clientWidth + 1 : null, root: root.scrollWidth > root.clientWidth + 1 },
      // Elements that stick out past the reader root's right edge (a horizontal-overflow culprit hunt).
      overflowing: (() => { const edge = root.getBoundingClientRect().right + 1; return all('*').filter(node => node.getBoundingClientRect().right > edge && node.getBoundingClientRect().width > 0).slice(0, 6)
        .map(node => ({ tag: node.tagName, cls: String(node.className).slice(0, 50), attrs: [...node.attributes].filter(a => a.name.startsWith('data-reader')).map(a => a.name).join(' '), right: Math.round(node.getBoundingClientRect().right), edge: Math.round(edge) })); })(),
      coverage: (() => {
        const tally = (selector, attribute) => { const counts = {}; for (const node of all(selector)) { const key = node.getAttribute(attribute) ?? ''; counts[key] = (counts[key] ?? 0) + 1; } return counts; };
        return { toolCategories: tally('[data-reader-tool-call]', 'data-tool-category'), toolPhases: tally('[data-reader-tool-call]', 'data-tool-phase'),
          reasoningRows: all('[data-reader-reasoning]').length, clusters: all('[data-reader-cluster]').length, clusterMembers: all('[data-reader-cluster] [data-reader-tool-call]').length,
          childCalls: all('[aria-label="子调用"] [data-reader-tool-call]').length, earlierButtons: all('[data-reader-earlier]').length, notices: all('[data-reader-notice]').length };
      })(),
      floating: { activity: !!root.querySelector('[data-reader-activity-pill]'), jump: !!root.querySelector('[data-reader-jump]') },
    };
  })()`;
  // Only a session row in the sidebar tree is ever clicked (never a workspace row).
  const sessionRows = title => title.startsWith('#')
    ? `[...document.querySelectorAll('[role="treeitem"][data-row-key^="session:"]')].filter(node => node.dataset.rowKey.endsWith(${JSON.stringify(title.slice(1))}))`
    : `[...document.querySelectorAll('[role="treeitem"][data-row-key^="session:"]')].filter(node => node.textContent.trim().startsWith(${JSON.stringify(title)}))`;
  // session/create beyond the host's own startup session means something created a session: stop at once.
  const guardCreates = () => { if (report.sessionCreates > 1) throw new Error('a session was created during the run (' + report.sessionCreates + ' session/create requests)'); };
  // Toggle the listed workspace rows open, then their 「展开其余」 buttons, until none is left.
  const expandWorkspaces = async () => {
    for (const workspace of expand) {
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
    return evaluate(`(() => { ${sessionRows(title)}[0].click(); return true; })()`);
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
    if (!item.opened) continue;
    await delay(1500);
    await clickTab('阅读');
    item.readerMounted = await until("!!document.querySelector('[data-dsh-clearview] section[data-reader-turn]')");
    await delay(800);
    item.initial = await evaluate(collect);
    await shot(`${name}-bottom`);
    await evaluate("(() => { const scroller = document.querySelector('[data-conversation-scroll]'); if (scroller) scroller.scrollTop = 0; })()");
    await delay(500);
    await shot(`${name}-top`);
    // Open the first panel that holds a tool row (clicking an already open
    // header would collapse it), then expand a tool row inside that panel.
    item.panelOpened = await evaluate(`(() => {
      const panels = [...document.querySelectorAll('[data-dsh-clearview] [data-reader-panel]')];
      const panel = panels.find(node => node.querySelector('[data-reader-disclosure][data-expanded="false"]')) ?? panels[0];
      if (!panel) return false;
      panel.setAttribute('data-live-check', 'panel');
      const header = panel.querySelector('[data-reader-disclosure][data-expanded="false"] > button');
      header?.click();
      return true;
    })()`);
    await delay(500);
    // 0.2.1 visual contract, measured with every panel open and every cluster still in its default state.
    await evaluate("[...document.querySelectorAll('[data-dsh-clearview] [data-reader-disclosure][data-expanded=\"false\"] > button')].slice(0, 12).forEach(button => button.click())");
    await delay(900);
    await evaluate("document.querySelector('[data-dsh-clearview] [data-reader-panel]')?.scrollIntoView({ block: 'start' })");
    await delay(500);
    await shot(`${name}-panel-default`);
    item.polish = await evaluate(`(() => {
      const root = document.querySelector('[data-dsh-clearview]');
      if (!root) return null;
      const all = selector => [...root.querySelectorAll(selector)];
      const visible = node => { const box = node.getBoundingClientRect(); return box.width > 0 && box.height > 0; };
      const clusters = all('[data-reader-cluster]').map(node => ({ state: node.getAttribute('data-cluster-state'), expanded: node.getAttribute('data-expanded'),
        title: node.querySelector('[data-disclosure-row]')?.textContent.slice(0, 50), members: node.querySelectorAll('[data-reader-tool-call], [data-reader-record-kind]').length }));
      const text = root.innerText;
      const panels = all('[data-reader-panel]');
      const panelStyle = panels.slice(0, 3).map(panel => { const style = getComputedStyle(panel); const header = panel.querySelector(':scope > [data-reader-disclosure] > button');
        return { status: panel.getAttribute('data-status'), background: style.backgroundColor, boxShadow: style.boxShadow, radius: style.borderRadius, headerHeight: header ? Math.round(header.getBoundingClientRect().height * 10) / 10 : null,
          headerColor: header ? getComputedStyle(header.querySelector('span:nth-of-type(2)') ?? header).color : null, headerText: header?.textContent.slice(0, 60) }; });
      const failedHeader = all('[data-reader-panel][data-status="error"] > [data-reader-disclosure] > button, [data-reader-panel][data-status="interrupted"] > [data-reader-disclosure] > button')[0];
      const metas = panels.slice(0, 2).map(panel => { const tag = panel.querySelector(':scope > [data-reader-disclosure] > button > span:last-of-type'); return tag ? { size: getComputedStyle(tag).fontSize, line: getComputedStyle(tag).lineHeight } : null; });
      return {
        clusterCount: clusters.length, clusterMembers: clusters.reduce((sum, item) => sum + item.members, 0), clusterStates: clusters.reduce((out, item) => { out[item.state] = (out[item.state] ?? 0) + 1; return out; }, {}),
        clusterExpandedDefault: clusters.filter(item => item.expanded === 'true').length, clusterSample: clusters.slice(0, 4),
        stepLabelsVisible: (text.match(/步骤\\s*\\d/g) ?? []).length, stepGroupAttributes: all('[data-reader-step]').length,
        toolCallEnglishVisible: (text.match(/Tool call/g) ?? []).length, toolCallSamples: [...text.matchAll(/.{0,30}Tool call.{0,30}/g)].slice(0, 3).map(match => match[0]), stepSamples: [...text.matchAll(/.{0,30}步骤\\s*\\d.{0,30}/g)].slice(0, 3).map(match => match[0]), toolCallEnglishInDom: (root.textContent.match(/Tool call/g) ?? []).length,
        previewAttributes: all('[data-preview]').length,
        reasoningInsetsVisible: all('[data-reader-reasoning-card]').filter(node => visible(node) && node.getAttribute('data-live') !== 'true').length, reasoningRows: all('[data-reader-reasoning]').length,
        toolTitles: [...new Set(all('[data-reader-tool-call] [data-disclosure-row]').map(row => row.textContent.slice(0, 14)))].slice(0, 12),
        panels: panelStyle, failedHeaderColor: failedHeader ? getComputedStyle(failedHeader.querySelector('span:nth-of-type(2)') ?? failedHeader).color : null, metas,
      };
    })()`);
    // A settled thought followed by exactly one settled tool call / record renders as one thought row with a short
    // suffix (class *suffix*); its tool row only exists once the thought row is opened.
    const mergedScope = '[data-dsh-clearview] [data-reader-reasoning]:has([class*="suffix"])';
    const openMerged = scope => evaluate(`(() => { const rows = [...document.querySelectorAll(${JSON.stringify(scope + ' [data-reader-reasoning-row][aria-expanded="false"]')})].slice(0, 80); rows.forEach(row => row.click()); return rows.length; })()`);
    item.rowCensus = await evaluate(`(() => {
      const root = document.querySelector('[data-dsh-clearview]'); const scroller = document.querySelector('[data-conversation-scroll]');
      const sr = scroller.getBoundingClientRect(); const composerTop = document.querySelector('[data-composer-seat]')?.getBoundingClientRect().top ?? innerHeight;
      const top = sr.top; const bottom = Math.min(sr.bottom, composerTop);
      const inWindow = node => { const box = node.getBoundingClientRect(); return box.height > 0 && box.bottom > top && box.top < bottom; };
      const rows = [...root.querySelectorAll('[data-reader-reasoning-row], [data-reader-cluster] [data-disclosure-row], [data-reader-tool-call] [data-disclosure-row], [data-reader-record-kind] [data-disclosure-row], [data-reader-panel] > [data-reader-disclosure] > button')];
      const thoughts = [...root.querySelectorAll('[data-reader-reasoning]')];
      const merged = thoughts.filter(node => node.querySelector('[class*="suffix"]'));
      const standalone = [...root.querySelectorAll('[data-reader-tool-call]')].filter(node => !node.closest('[data-reader-cluster]') && !node.closest('[data-reader-reasoning]') && !node.parentElement.closest('[aria-label="子调用"]'));
      const order = [...root.querySelectorAll('[data-reader-reasoning], [data-reader-tool-call], [data-reader-cluster]')].filter(node => !node.closest('[data-reader-cluster]') || node.hasAttribute('data-reader-cluster')).filter(node => node.hasAttribute('data-reader-cluster') || node.hasAttribute('data-reader-reasoning') || (!node.closest('[data-reader-reasoning]') && !node.parentElement.closest('[aria-label="子调用"]')));
      let thoughtThenStandaloneTool = 0;
      order.forEach((node, index) => { if (node.hasAttribute('data-reader-reasoning') && !node.querySelector('[class*="suffix"]') && order[index + 1]?.hasAttribute('data-reader-tool-call')) thoughtThenStandaloneTool++; });
      return { thoughtRows: thoughts.length, mergedThoughtRows: merged.length, mergedSuffixes: [...new Set(merged.map(node => node.querySelector('[class*="suffix"]').textContent))].slice(0, 8),
        standaloneToolRows: standalone.length, clusters: root.querySelectorAll('[data-reader-cluster]').length, thoughtThenStandaloneTool,
        visibleRowsInWindow: rows.filter(inWindow).length, fullyVisibleRows: rows.filter(node => { const box = node.getBoundingClientRect(); return box.top >= top && box.bottom <= bottom; }).length, windowHeight: Math.round(bottom - top) };
    })()`);
    item.narration = await evaluate(`(() => {
      const root = document.querySelector('[data-dsh-clearview]');
      const probe = document.createElement('span'); probe.style.color = 'var(--dsw-alias-label-secondary)'; root.appendChild(probe); const secondary = getComputedStyle(probe).color; probe.style.color = 'var(--dsw-alias-label-primary)'; const primary = getComputedStyle(probe).color; probe.remove();
      const paragraph = scope => [...root.querySelectorAll(scope + ' [data-reader-text] > p')].find(node => node.textContent.trim().length > 20);
      const describe = node => node ? { color: getComputedStyle(node).color, weight: getComputedStyle(node).fontWeight, size: getComputedStyle(node).fontSize, text: node.textContent.slice(0, 30) } : null;
      const inline = (scope, tag) => { const node = root.querySelector(scope + ' [data-reader-text] ' + tag); return node ? { color: getComputedStyle(node).color, weight: getComputedStyle(node).fontWeight, parentColor: getComputedStyle(node.parentElement).color } : null; };
      return { secondary, primary, narration: describe(paragraph('[data-reader-narration]')), answer: describe(paragraph('[data-reader-answer]')),
        narrationInline: { code: inline('[data-reader-narration]', 'code'), strong: inline('[data-reader-narration]', 'strong'), link: inline('[data-reader-narration]', 'a') },
        answerInline: { code: inline('[data-reader-answer]', 'code'), strong: inline('[data-reader-answer]', 'strong'), link: inline('[data-reader-answer]', 'a') } };
    })()`);
    item.merged = null;
    if (await evaluate(`!!document.querySelector(${JSON.stringify(mergedScope)})`)) {
      await evaluate(`document.querySelector(${JSON.stringify(mergedScope)}).setAttribute('data-live-anim', 'merged')`);
      await evaluate("document.querySelector('[data-live-anim=merged]').scrollIntoView({ block: 'center' })");
      await delay(400);
      const closed = await evaluate("(() => { const node = document.querySelector('[data-live-anim=merged]'); return { toolRowBefore: !!node.querySelector('[data-reader-tool-call]'), rowText: node.querySelector('[data-reader-reasoning-row]').textContent.slice(0, 80), height: Math.round(node.querySelector('[data-reader-reasoning-row]').getBoundingClientRect().height * 10) / 10 }; })()");
      await shot(`${name}-merged-closed`);
      await evaluate("document.querySelector('[data-live-anim=merged] [data-reader-reasoning-row]').click()");
      await delay(900);
      const opened = await evaluate("(() => { const node = document.querySelector('[data-live-anim=merged]'); const text = node.querySelector('[data-reader-reasoning-text]'); const tool = node.querySelector('[data-reader-tool-call], [data-reader-record-kind]'); return { thoughtText: !!text, toolRowAfter: !!tool, toolKind: tool?.hasAttribute('data-reader-tool-call') ? 'tool' : tool ? 'record' : null, textBeforeTool: !!(text && tool && (text.compareDocumentPosition(tool) & Node.DOCUMENT_POSITION_FOLLOWING)) }; })()");
      await evaluate("document.querySelector('[data-live-anim=merged]').scrollIntoView({ block: 'center' })");
      await delay(300);
      await shot(`${name}-merged-open`);
      const toolOpen = await evaluate("(() => { const row = document.querySelector('[data-live-anim=merged] [data-reader-tool-call] [data-disclosure-row], [data-live-anim=merged] [data-reader-record-kind] [data-disclosure-row]'); if (!row) return null; row.click(); return true; })()");
      await delay(800);
      const toolDetails = toolOpen ? await evaluate("(() => { const node = document.querySelector('[data-live-anim=merged]'); const row = node.querySelector('[data-reader-tool-call] [data-disclosure-row], [data-reader-record-kind] [data-disclosure-row]'); return { rowExpanded: row.getAttribute('aria-expanded'), details: !!node.querySelector('[data-reader-tool-details]'), raw: !!node.querySelector('[data-reader-record-kind] pre, [data-reader-record-kind] [role=tree]') }; })()") : null;
      await shot(`${name}-merged-tool-open`);
      item.merged = { closed, opened, toolOpen, toolDetails };
      // Leave it closed for the later probes.
      if (toolOpen) await evaluate("document.querySelector('[data-live-anim=merged] [data-reader-tool-call] [data-disclosure-row], [data-live-anim=merged] [data-reader-record-kind] [data-disclosure-row]')?.click()");
      await delay(500);
      await evaluate("document.querySelector('[data-live-anim=merged] [data-reader-reasoning-row]').click()");
      await delay(700);
      await evaluate("document.querySelector('[data-live-anim=merged]')?.removeAttribute('data-live-anim')");
    }
    // Collapse-body animation: sampled every frame inside the page. data-clip must be present while the height
    // animates (computed overflow hidden), gone afterwards (overflow visible), with no height jump at the end.
    const animationProbe = (containerSelector, triggerSelector, direction) => evaluate(`new Promise(resolve => {
      const container = document.querySelector(${JSON.stringify(containerSelector)});
      if (!container) { resolve(null); return; }
      const bodyOf = () => container.querySelector(':scope > [data-ud-motion="reader-collapse-size"]');
      const trigger = container.querySelector(${JSON.stringify(triggerSelector)});
      const frames = []; const start = performance.now();
      trigger.click();
      const tick = () => {
        const body = bodyOf(); const now = Math.round(performance.now() - start);
        if (body) { const box = body.getBoundingClientRect(); const style = getComputedStyle(body); frames.push({ t: now, clip: body.hasAttribute('data-clip'), h: Math.round(box.height * 10) / 10, scrollHeight: body.scrollHeight, overflow: style.overflowX + '/' + style.overflowY, opacity: Math.round(Number(style.opacity) * 100) / 100, display: style.display }); }
        else frames.push({ t: now, gone: true });
        if (now < 800) requestAnimationFrame(tick); else finish();
      };
      const finish = () => {
        const withBody = frames.filter(frame => !frame.gone);
        const clipFrames = withBody.filter(frame => frame.clip);
        const lastClipIndex = frames.map(frame => !!frame.clip).lastIndexOf(true);
        const next = lastClipIndex >= 0 ? frames[lastClipIndex + 1] : null;
        const jump = next && !next.gone ? Math.abs(next.h - frames[lastClipIndex].h) : null;
        const settled = withBody.filter(frame => !frame.clip).slice(-1)[0] ?? null;
        resolve({ direction: ${JSON.stringify(direction)}, frameCount: frames.length, clipFrames: clipFrames.length, clipDurationMs: clipFrames.length ? clipFrames.at(-1).t - clipFrames[0].t : 0,
          clipOverflowAllHidden: clipFrames.every(frame => frame.overflow === 'hidden/hidden'), settledOverflow: settled ? settled.overflow : null, settledClipLeft: withBody.slice(-1)[0] ? withBody.slice(-1)[0].clip : null,
          jump, lastClipHeight: lastClipIndex >= 0 ? frames[lastClipIndex].h : null, nextHeight: next && !next.gone ? next.h : null,
          settledHeightVsContent: settled ? Math.abs(settled.h - settled.scrollHeight) : null, bodyGoneAtEnd: frames.at(-1).gone === true, heights: frames.filter((frame, index) => index % 3 === 0).map(frame => frame.gone ? 'gone' : frame.h + (frame.clip ? 'c' : '')) });
      };
      requestAnimationFrame(tick);
    })`);
    item.animations = {};
    const panelSelector = '[data-dsh-clearview] [data-reader-panel]';
    item.animations.panel = [await animationProbe(panelSelector, ':scope > [data-reader-disclosure] > button', 'collapse'), null];
    await delay(300);
    item.animations.panel[1] = await animationProbe(panelSelector, ':scope > [data-reader-disclosure] > button', 'expand');
    await delay(300);
    await evaluate("(() => { const cluster = document.querySelector('[data-dsh-clearview] [data-reader-cluster][data-expanded=\"false\"]'); if (cluster) cluster.setAttribute('data-live-anim', 'cluster'); })()");
    item.animations.cluster = await evaluate("!!document.querySelector('[data-live-anim=cluster]')") ? [await animationProbe('[data-live-anim=cluster]', '[data-disclosure-row]', 'expand'), null] : null;
    if (item.animations.cluster) { await delay(300); item.animations.cluster[1] = await animationProbe('[data-live-anim=cluster]', '[data-disclosure-row]', 'collapse'); await delay(300); }
    await evaluate("(() => { const row = document.querySelector('[data-dsh-clearview] [data-reader-reasoning-row][aria-expanded=\"false\"]'); row?.closest('[data-reader-reasoning]')?.setAttribute('data-live-anim', 'reasoning'); })()");
    item.animations.reasoning = await evaluate("!!document.querySelector('[data-live-anim=reasoning]')") ? [await animationProbe('[data-live-anim=reasoning]', '[data-reader-reasoning-row]', 'expand'), null] : null;
    if (item.animations.reasoning) { await delay(300); item.animations.reasoning[1] = await animationProbe('[data-live-anim=reasoning]', '[data-reader-reasoning-row]', 'collapse'); await delay(300); }
    if (await evaluate(`!!document.querySelector(${JSON.stringify(mergedScope)} + ' [data-reader-reasoning-row][aria-expanded="false"]')`)) {
      await evaluate(`document.querySelector(${JSON.stringify(mergedScope + ' [data-reader-reasoning-row][aria-expanded="false"]')}).closest('[data-reader-reasoning]').setAttribute('data-live-anim', 'merged')`);
      item.animations.merged = [await animationProbe('[data-live-anim=merged]', '[data-reader-reasoning-row]', 'expand'), null];
      await delay(300);
      item.animations.merged[1] = await animationProbe('[data-live-anim=merged]', '[data-reader-reasoning-row]', 'collapse');
      await delay(300);
      await evaluate("document.querySelector('[data-live-anim=merged]')?.removeAttribute('data-live-anim')");
    }
    // 前 N 步 inserts rows into the (already open) panel body: it must not turn the body's clip on or leave it on.
    if (await evaluate("!!document.querySelector('[data-dsh-clearview] [data-reader-earlier]')")) {
      await evaluate("document.querySelector('[data-dsh-clearview] [data-reader-earlier]').closest('[data-reader-panel]').setAttribute('data-live-anim', 'earlier')");
      item.animations.earlier = await animationProbe('[data-live-anim=earlier]', '[data-reader-earlier]', 'earlier');
      await delay(300);
    }
    // Narrow-width overflow in each disclosure state, then hover bleed at full width (side shadows, not clipped).
    const overflowProbe = async label => { const measured = await evaluate(measure); return { label, ...measured?.overflowX, overflowing: measured?.overflowing ?? null }; };
    const setWidth = width => send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    const clickFirst = selector => evaluate(`(() => { const node = document.querySelector(${JSON.stringify(selector)}); if (!node) return false; node.click(); return true; })()`);
    item.narrowStates = [];
    await setWidth(480);
    await delay(800);
    item.narrowStates.push(await overflowProbe('panels open, clusters collapsed'));
    await shot(`${name}-narrow-collapsed`);
    await evaluate("document.querySelectorAll('[data-dsh-clearview] [data-reader-cluster][data-expanded=\"false\"] [data-disclosure-row]').forEach(row => row.click())");
    await delay(800);
    item.narrowStates.push(await overflowProbe('clusters opened'));
    if (await openMerged('[data-dsh-clearview]')) { await delay(900); item.narrowStates.push(await overflowProbe('merged thought rows opened')); }
    if (await clickFirst('[data-dsh-clearview] [data-reader-earlier]')) { await delay(800); item.narrowStates.push(await overflowProbe('前 N 步 opened')); }
    if (await clickFirst('[data-dsh-clearview] [data-reader-reasoning-row][aria-expanded="false"]')) { await delay(800); item.narrowStates.push(await overflowProbe('reasoning row opened')); }
    if (await clickFirst('[data-dsh-clearview] [data-reader-tool-call] [data-disclosure-row]')) { await delay(800); item.narrowStates.push(await overflowProbe('tool row opened')); }
    await evaluate("document.querySelector('[data-dsh-clearview] [data-reader-tool-call]')?.scrollIntoView({ block: 'center' })");
    await delay(400);
    await shot(`${name}-narrow-opened`);
    await setWidth(1440);
    await delay(800);
    const bleedProbe = `(selector => {
      const el = document.querySelector(selector); if (!el) return null;
      const style = getComputedStyle(el); const box = el.getBoundingClientRect();
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let textBox = null;
      for (let node = walker.nextNode(); node; node = walker.nextNode()) { if (node.textContent.trim()) { const range = document.createRange(); range.selectNodeContents(node); textBox = range.getBoundingClientRect(); break; } }
      const clippedBy = [];
      for (let parent = el.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        const parentStyle = getComputedStyle(parent);
        if (/(hidden|clip|auto|scroll)/.test(parentStyle.overflowX)) { const parentBox = parent.getBoundingClientRect(); if (parentBox.left > box.left - 6 + 0.5 || parentBox.right < box.right + 6 - 0.5) clippedBy.push({ tag: parent.tagName, cls: String(parent.className).slice(0, 40), overflowX: parentStyle.overflowX, left: Math.round(parentBox.left), right: Math.round(parentBox.right) }); }
      }
      return { hovered: el.matches(':hover'), background: style.backgroundColor, boxShadow: style.boxShadow, left: Math.round(box.left * 10) / 10, right: Math.round(box.right * 10) / 10, width: Math.round(box.width), height: Math.round(box.height * 10) / 10, textLeft: textBox ? Math.round(textBox.left * 10) / 10 : null, clippedBy };
    })`;
    item.hoverBleed = {};
    for (const [key, selector] of [['panelHeader', '[data-dsh-clearview] [data-reader-panel] > [data-reader-disclosure] > button'], ['cluster', '[data-dsh-clearview] [data-reader-cluster] [data-disclosure-row]'],
      ['toolRow', '[data-dsh-clearview] [data-reader-tool-call] [data-disclosure-row]'], ['reasoningRow', '[data-dsh-clearview] [data-reader-reasoning-row]'], ['mergedRow', '[data-dsh-clearview] [data-reader-reasoning]:has([class*="suffix"]) [data-reader-reasoning-row]'], ['fileChanges', '[data-dsh-clearview] [data-reader-file-changes] > button']]) {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 });
      await delay(200);
      const before = await evaluate(`${bleedProbe}(${JSON.stringify(selector)})`);
      if (!before) { item.hoverBleed[key] = null; continue; }
      await hover(selector, 0.15);
      const after = await evaluate(`${bleedProbe}(${JSON.stringify(selector)})`);
      item.hoverBleed[key] = { before, after, textShift: before.textLeft !== null && after.textLeft !== null ? Math.round((after.textLeft - before.textLeft) * 10) / 10 : null };
      const { data } = await send('Page.captureScreenshot', { format: 'png', clip: { x: Math.max(0, after.left - 24), y: Math.max(0, (await evaluate(`document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().top`)) - 8), width: after.width + 48, height: after.height + 16, scale: 2 } });
      writeFileSync(join(out, `${name}-hover-${key}.png`), Buffer.from(data, 'base64'));
      await shot(`${name}-hover-${key}-full`);
    }
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 });
    await evaluate("document.querySelectorAll('[data-dsh-clearview] [data-reader-cluster][data-expanded=\"false\"] [data-disclosure-row]').forEach(row => row.click())");
    await delay(900);
    await openMerged('[data-dsh-clearview]');
    await delay(700);
    item.clustersOpened = await evaluate(`(() => [...document.querySelectorAll('[data-dsh-clearview] [data-reader-cluster]')].map(node => { const title = node.querySelector('[data-disclosure-row]')?.textContent ?? ''; const topCalls = [...node.querySelectorAll('[data-reader-tool-call]')].filter(call => !call.parentElement.closest('[aria-label=\"子调用\"]')); const calls = topCalls.length; const nested = node.querySelectorAll('[data-reader-tool-call]').length - calls; const records = node.querySelectorAll('[data-reader-record-kind]').length; const claimed = Number(title.match(/(\\d+) 次工具调用/)?.[1] ?? NaN); return { title: title.slice(0, 40), claimedCalls: claimed, calls, nested, records, ok: Number.isNaN(claimed) ? null : claimed === calls }; }))()`);
    await evaluate("document.querySelector('[data-dsh-clearview] [data-reader-cluster]')?.scrollIntoView({ block: 'center' })");
    await delay(400);
    await shot(`${name}-clusters-open`);
    await evaluate("(() => { const scroller = document.querySelector('[data-conversation-scroll]'); if (scroller) scroller.scrollTop = scroller.scrollHeight; })()");
    await delay(700);
    item.bottomGap = await evaluate(`(() => {
      const root = document.querySelector('[data-dsh-clearview]'); const composer = document.querySelector('[data-composer-seat]');
      if (!root || !composer) return null;
      const blocks = [...root.querySelectorAll('[data-reader-file-changes], [data-reader-turn-footer], [data-reader-answer], [data-reader-panel], [data-reader-attention]')].filter(node => node.getBoundingClientRect().height > 0);
      const lastContent = Math.max(...blocks.map(node => node.getBoundingClientRect().bottom));
      return { composerTop: Math.round(composer.getBoundingClientRect().top), lastContentBottom: Math.round(lastContent), gap: Math.round(composer.getBoundingClientRect().top - lastContent), rootBottom: Math.round(root.getBoundingClientRect().bottom) };
    })()`);
    await shot(`${name}-bottom-gap`);
    await evaluate("document.querySelector('[data-dsh-clearview] [data-reader-panel]')?.scrollIntoView({ block: 'start' })");
    await delay(400);
    // Consecutive tool calls are merged into collapsed cluster rows and single calls into their thought row; open both so the member tool rows can be measured.
    await openMerged('[data-live-check=panel]');
    await delay(500);
    await evaluate("document.querySelectorAll('[data-live-check=panel] [data-reader-cluster][data-expanded=\"false\"] [data-disclosure-row]').forEach(row => row.click())");
    await delay(500);
    await evaluate("document.querySelector('[data-live-check=panel]')?.scrollIntoView({ block: 'start' })");
    await shot(`${name}-panel-open`);
    item.measuredPanel = await evaluate(measure);
    // Row hover state before and after a pointer move (hover only, no click).
    const rowState = `(() => {
      const row = document.querySelector('[data-live-check=panel] [data-reader-tool-call] [data-disclosure-row]');
      if (!row) return null;
      const style = node => ({ cls: String(node.getAttribute('class') ?? '').split(' ').map(name => name.replace(/^_|_[a-z0-9]+_\d+$/g, '')).join(' ').slice(0, 40), opacity: getComputedStyle(node).opacity, display: getComputedStyle(node).display });
      return { hovered: row.matches(':hover'), height: row.getBoundingClientRect().height, background: getComputedStyle(row).backgroundColor,
        leading: [...row.querySelectorAll('svg')].slice(0, 3).map(node => ({ ...style(node), parent: style(node.parentElement) })) };
    })()`;
    item.rowHover = null;
    if (await evaluate("!!document.querySelector('[data-live-check=panel] [data-reader-tool-call] [data-disclosure-row]')")) {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 });
      const before = await evaluate(rowState);
      await hover('[data-live-check=panel] [data-reader-tool-call] [data-disclosure-row]');
      item.rowHover = { before, after: await evaluate(rowState) };
      await shot(`${name}-row-hover`);
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 });
    }
    // A failed tool row: red title / end, and the error summary inset below it.
    item.failedRow = await evaluate(`(() => {
      const tool = document.querySelector('[data-live-check=panel] [data-reader-tool-call][data-tool-phase="failed"]');
      if (!tool) return null;
      tool.scrollIntoView({ block: 'center' });
      const row = tool.querySelector('[data-disclosure-row]');
      const summary = tool.children[1];
      const style = node => node ? getComputedStyle(node) : null;
      return { text: row.textContent.slice(0, 120), height: row.getBoundingClientRect().height, titleColor: style(row.querySelector('span:not([class*="icon"]):not([class*="leading"])'))?.color ?? null,
        errorBackground: style(summary)?.backgroundColor ?? null, errorFont: style(summary?.firstElementChild ?? summary)?.font.slice(0, 80) ?? null, errorText: summary?.textContent.slice(0, 100) ?? null };
    })()`);
    if (item.failedRow) { await delay(400); await shot(`${name}-failed-row`); }
    await evaluate("document.querySelector('[data-live-check=panel] [data-reader-earlier]')?.click()");
    await delay(500);
    await evaluate("document.querySelectorAll('[data-live-check=panel] [data-reader-cluster][data-expanded=\"false\"] [data-disclosure-row]').forEach(row => row.click())");
    await delay(500);
    item.toolOpened = await evaluate(`(() => {
      const panel = document.querySelector('[data-live-check=panel]');
      panel?.querySelector('[data-reader-earlier]')?.click();
      const row = panel?.querySelector('[data-reader-tool-call] [data-disclosure-row]');
      row?.click();
      return !!row;
    })()`);
    await delay(500);
    item.toolDetails = await evaluate("!!document.querySelector('[data-reader-tool-details]')");
    await shot(`${name}-tool-open`);
    item.measuredTool = await evaluate(measure);
    if (await evaluate("!!document.querySelector('[data-reader-inspect]')")) {
      await evaluate("document.querySelector('[data-reader-inspect]').click()");
      await delay(800);
      item.inspectTab = await selectedTab();
      await clickTab('阅读');
      await delay(800);
    }
    if (await evaluate("!!document.querySelector('[data-dsh-clearview] [data-reader-show-in-chat]')")) {
      await evaluate("document.querySelector('[data-dsh-clearview] [data-reader-show-in-chat]').click()");
      await delay(800);
      item.showInChatTab = await selectedTab();
      await clickTab('阅读');
      await delay(800);
    }
    // Coverage of the node kinds a session has: triggers, panel statuses, records, 「前 N 步」.
    // Only local disclosure state is toggled (panel headers, trigger / record rows, 「前 N 步」).
    const scrollShot = async (selector, label) => {
      const found = await evaluate(`(() => { const node = document.querySelector(${JSON.stringify(selector)}); if (!node) return false; node.scrollIntoView({ block: 'center' }); return true; })()`);
      if (found) { await delay(500); await shot(`${name}-${label}`); }
      return found;
    };
    await evaluate("[...document.querySelectorAll('[data-dsh-clearview] [data-reader-disclosure][data-expanded=\"false\"] > button')].slice(0, 12).forEach(button => button.click())");
    await delay(900);
    const cov = item.coverage = { triggers: {}, panels: {}, records: {}, earlier: [] };
    cov.counts = await evaluate("(() => { const root = document.querySelector('[data-dsh-clearview]'); const tally = (selector, attribute) => { const out = {}; root.querySelectorAll(selector).forEach(node => { const key = node.getAttribute(attribute) ?? ''; out[key] = (out[key] ?? 0) + 1; }); return out; }; return { turnResults: tally('section[data-reader-turn]', 'data-reader-turn-result'), panelStatuses: tally('[data-reader-panel]', 'data-status'), triggers: tally('[data-reader-trigger]', 'data-reader-trigger'), records: tally('[data-reader-record-kind]', 'data-reader-record-kind'), stoppedTags: [...root.querySelectorAll('*')].filter(node => node.children.length === 0 && node.textContent.trim() === '已停止').length }; })()");
    for (const type of Object.keys(cov.counts.triggers)) {
      cov.triggers[type] = await evaluate(`(() => { const node = document.querySelector('[data-dsh-clearview] [data-reader-trigger="${type}"]'); const button = node.querySelector('button'); button.click(); return { title: button.textContent.slice(0, 60), height: button.getBoundingClientRect().height }; })()`);
      await delay(400);
      cov.triggers[type].shot = await scrollShot(`[data-reader-trigger="${type}"]`, `trigger-${type}`);
      cov.triggers[type].body = await evaluate(`document.querySelector('[data-reader-trigger="${type}"]')?.textContent.slice(0, 160)`);
    }
    for (const status of Object.keys(cov.counts.panelStatuses).filter(value => value !== 'done')) {
      cov.panels[status] = await evaluate(`(() => { const panel = document.querySelector('[data-dsh-clearview] [data-reader-panel][data-status="${status}"]'); const header = panel.querySelector(':scope > [data-reader-disclosure]'); return { header: header.textContent.slice(0, 80), open: header.getAttribute('data-expanded'), clusters: panel.querySelectorAll('[data-reader-cluster]').length }; })()`);
      cov.panels[status].shot = await scrollShot(`[data-reader-panel][data-status="${status}"]`, `panel-${status}`);
    }
    for (const kind of Object.keys(cov.counts.records)) {
      cov.records[kind] = await evaluate(`(() => { const record = document.querySelector('[data-dsh-clearview] [data-reader-record-kind="${kind}"]'); const row = record.querySelector('[data-disclosure-row]'); row.click(); return { title: row.textContent.slice(0, 80), height: row.getBoundingClientRect().height, tone: record.getAttribute('data-record-tone') }; })()`);
      await delay(500);
      cov.records[kind].shot = await scrollShot(`[data-reader-record-kind="${kind}"]`, `record-${kind}`);
      cov.records[kind].body = await evaluate(`document.querySelector('[data-reader-record-kind="${kind}"]')?.textContent.slice(0, 200)`);
      cov.records[kind].showInChat = await evaluate(`!!document.querySelector('[data-reader-record-kind="${kind}"] [data-reader-show-in-chat]')`);
      if (cov.records[kind].showInChat) {
        await evaluate(`document.querySelector('[data-reader-record-kind="${kind}"] [data-reader-show-in-chat]').click()`);
        await delay(900);
        cov.records[kind].showInChatTab = await selectedTab();
        await shot(`${name}-record-${kind}-in-chat`);
        await clickTab('阅读');
        await delay(900);
      }
    }
    // 「前 N 步」: the panel keeps only the latest steps while a turn did not finish well.
    for (let nth = 0; nth < 3; nth++) {
      const before = await evaluate(`(() => { const button = document.querySelector('[data-dsh-clearview] [data-reader-earlier]'); if (!button) return null; const panel = button.closest('[data-reader-panel]'); const total = panel.querySelector(':scope > [data-reader-disclosure]').textContent.match(/(\\d+) 步/)?.[1] ?? null; button.setAttribute('data-live-earlier', '1'); panel.setAttribute('data-live-earlier-panel', '1'); return { text: button.textContent.trim().slice(0, 80), height: button.getBoundingClientRect().height, status: panel.getAttribute('data-status'), headerSteps: total, clustersBefore: panel.querySelectorAll('[data-reader-cluster]').length, toolsBefore: panel.querySelectorAll('[data-reader-tool-call]').length, reasoningBefore: panel.querySelectorAll('[data-reader-reasoning]').length }; })()`);
      if (!before) break;
      await scrollShot('[data-live-earlier]', `earlier-closed-${nth}`);
      await evaluate("document.querySelector('[data-live-earlier]').click()");
      await delay(700);
      const after = await evaluate("(() => { const panel = document.querySelector('[data-live-earlier-panel]'); return { buttonGone: !panel.querySelector('[data-reader-earlier]'), clustersAfter: panel.querySelectorAll('[data-reader-cluster]').length, toolsAfter: panel.querySelectorAll('[data-reader-tool-call]').length, clusterMembersAfter: panel.querySelectorAll('[data-reader-cluster] [data-reader-tool-call]').length, reasoningAfter: panel.querySelectorAll('[data-reader-reasoning]').length, headerTools: panel.querySelector(':scope > [data-reader-disclosure]').textContent.match(/(\\d+) 次工具/)?.[1] ?? null }; })()");
      await scrollShot('[data-live-earlier-panel]', `earlier-open-${nth}`);
      cov.earlier.push({ ...before, ...after });
      await evaluate("document.querySelectorAll('[data-live-earlier],[data-live-earlier-panel]').forEach(node => { node.removeAttribute('data-live-earlier'); node.removeAttribute('data-live-earlier-panel'); })");
    }
    guardCreates();
    // 阅读 → 对话 → 阅读 round trips (tab switches only): the reader remounts and restores its position;
    // any exception thrown meanwhile lands in report.exceptions and fails the run.
    const exceptionsBefore = report.exceptions.length;
    item.roundTrips = [];
    for (let trip = 0; trip < 2; trip++) {
      await clickTab('对话');
      await delay(1200);
      const readerWhileOnChat = await evaluate("!!document.querySelector('[data-dsh-clearview]')");
      await clickTab('阅读');
      await delay(1500);
      item.roundTrips.push({ readerWhileOnChat, readerBack: await evaluate("!!document.querySelector('[data-dsh-clearview] section[data-reader-turn]')") });
    }
    item.roundTripExceptions = report.exceptions.length - exceptionsBefore;
    // Conditions first, while the reader still has the whole pane: narrow width, host font
    // size 13/14/16, dark / light, reduced motion. Opening a file below adds a right
    // sidebar that would crowd these screenshots, so that happens last.
    item.focusLog = [];
    const focusPanel = async () => {
      const probe = "(() => { const panel = document.querySelector('[data-dsh-clearview] [data-reader-panel]'); panel?.scrollIntoView({ block: 'start' }); return panel ? Math.round(panel.getBoundingClientRect().top) : null; })()";
      await evaluate(probe);
      await delay(350);
      item.focusLog.push(await evaluate(probe));
    };
    await send('Emulation.setDeviceMetricsOverride', { width: 480, height: 900, deviceScaleFactor: 1, mobile: false });
    await delay(600);
    await focusPanel();
    await delay(300);
    await shot(`${name}-narrow`);
    item.measuredNarrow = await evaluate(measure);
    await evaluate("(() => { const scroller = document.querySelector('[data-conversation-scroll]'); if (scroller) scroller.scrollTop = scroller.scrollHeight; })()");
    await delay(500);
    await shot(`${name}-narrow-bottom`);
    item.narrowBottom = await evaluate(measure);
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    if (conditions) {
    item.fontSizes = {};
    for (const size of ['13px', '14px', '16px']) {
      await evaluate(`document.body.style.setProperty('--dsh-content-font-size', '${size}')`);
      await delay(400);
      await focusPanel();
      await delay(300);
      item.fontSizes[size] = (await evaluate(measure))?.fonts;
      await shot(`${name}-font-${size}`);
    }
    await evaluate("document.body.style.setProperty('--dsh-content-font-size', '14px')");
    await focusPanel();
    for (const scheme of ['light', 'dark']) {
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
      await delay(600);
      await focusPanel();
      await delay(300);
      item[`scheme-${scheme}`] = await evaluate("document.body.hasAttribute('data-ds-dark-theme')");
      await shot(`${name}-scheme-${scheme}`);
    }
    await send('Emulation.setEmulatedMedia', { features: [] });
    // The host theme does not follow prefers-color-scheme, so the real light theme needs the user's
    // own setting. As a stand-in, flip the theme attribute on this throwaway page only (no setting is
    // written) so the --dsw-alias-* light tokens can be eyeballed; it is not the host's light theme.
    item.lightSimulation = await evaluate("(() => { document.body.removeAttribute('data-ds-dark-theme'); document.documentElement.style.colorScheme = 'light'; return !document.body.hasAttribute('data-ds-dark-theme'); })()");
    await delay(600);
    await focusPanel();
    await delay(300);
    await shot(`${name}-light-simulated`);
    await evaluate("(() => { document.body.setAttribute('data-ds-dark-theme', ''); document.documentElement.style.colorScheme = 'dark'; })()");
    await delay(400);
    const transitions = "(() => { const read = selector => { const node = document.querySelector(selector); return node ? getComputedStyle(node).transitionDuration : null; }; return { panelHeader: read('[data-reader-panel] > [data-reader-disclosure] > button'), toolRow: read('[data-reader-tool-call] [data-disclosure-row]'), reasoningRow: read('[data-reader-reasoning-row]') }; })()";
    item.defaultTransitions = await evaluate(transitions);
    item.motionDefault = await evaluate("document.querySelector('[data-dsh-clearview]')?.getAttribute('data-motion')");
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await delay(400);
    item.reducedMotion = await evaluate("document.querySelector('[data-dsh-clearview]')?.getAttribute('data-motion')");
    item.reducedMotionTransitions = await evaluate(transitions);
    await focusPanel();
    await delay(400);
    await shot(`${name}-reduced-motion`);
    await send('Emulation.setEmulatedMedia', { features: [] });
    }
    // Hover look of the collapsed file-changes header (hover only): background plus side bleed.
    await evaluate("(() => { const scroller = document.querySelector('[data-conversation-scroll]'); if (scroller) scroller.scrollTop = scroller.scrollHeight; })()");
    await delay(400);
    if (await hover('[data-dsh-clearview] [data-reader-file-changes] > button', 0.1)) {
      item.changesHover = await evaluate("(() => { const node = document.querySelector('[data-dsh-clearview] [data-reader-file-changes] > button'); const style = getComputedStyle(node); const root = document.querySelector('[data-dsh-clearview]').getBoundingClientRect(); const box = node.getBoundingClientRect(); return { hovered: node.matches(':hover'), background: style.backgroundColor, boxShadow: style.boxShadow, left: Math.round(box.left), right: Math.round(box.right), rootRight: Math.round(root.right) }; })()");
      await shot(`${name}-changes-hover`);
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 });
    }
    // Footer actions on the last closed turn. Fork is only checked for being
    // available: clicking it would create a session.
    const footer = "[...document.querySelectorAll('[data-dsh-clearview] [data-reader-turn-footer]')].at(-1)";
    item.forkAvailable = await evaluate(`(() => { const button = ${footer}?.querySelector('[aria-label="从这里分支"]'); return button ? !button.disabled : null; })()`);
    item.copyReceipt = await evaluate(`(async () => {
      const footer = ${footer};
      const button = footer?.querySelector('[aria-label="复制回答"]');
      if (!button) return null;
      button.click();
      await new Promise(done => setTimeout(done, 400));
      return footer.querySelector('[data-reader-answer-actions] [role="status"]')?.textContent ?? '';
    })()`);
    // Deliverable cards carry a title (the path); the 「展开其余」 button has none.
    // File mentions are inline-code buttons inside the answer. Both only open a read-only preview.
    for (const [key, selector] of [['deliverableOpened', '[data-reader-deliverables] button[title]'], ['mentionOpened', '[data-reader-answer] code > button']]) {
      item[key] = await evaluate(`(() => { const target = document.querySelector('[data-dsh-clearview] ${selector}'); target?.scrollIntoView({ block: 'center' }); target?.click(); return !!target; })()`);
      if (item[key]) { await delay(900); await shot(`${name}-${key}`); }
    }
    item.final = await evaluate(collect);
    guardCreates();
  }
  report.sessionCountAfter = await sessionCount();
} finally {
  try { ws?.close(); } catch {}
  const exited = new Promise(done => chrome.once('exit', done));
  killChrome();
  await Promise.race([exited, delay(5000)]);
  removeProfile();
}
report.profileRemoved = !existsSync(profile);
if (report.sessionCountAfter === undefined) report.sessionCountAfter = await sessionCount().catch(() => null);
const readerErrors = report.exceptions.concat(report.consoleErrors).filter(text => /clearview|data-reader|dsh-clearview/i.test(text));
report.pass = (!intercept || report.replacements + report.spliced > 0)
  && report.sessions.every(item => item.opened && item.readerMounted && item.initial?.version === expectedVersion && item.initial.blockErrors.length === 0 && item.final?.blockErrors.length === 0)
  && readerErrors.length === 0 && report.handlerErrors.length === 0 && report.profileRemoved
  && report.sessionCreates <= 1 && report.sessionCountBefore === report.sessionCountAfter;
report.readerErrors = readerErrors;
writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ pass: report.pass, replacements: report.replacements, spliced: report.spliced, comboPassedThrough: report.comboPassedThrough.length, sessions: report.sessions.map(item => ({ title: item.title, opened: item.opened, initial: item.initial })), readerErrors }, null, 2));
process.exit(report.pass ? 0 : 1);
