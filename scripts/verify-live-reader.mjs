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
// The theme check only flips document.body's data-ds-dark-theme attribute inside the headless page; no host preference is written.
// Pass also requires the retired 0.2.x selectors (panel / cluster / earlier / activity pill ...) to count 0.
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
    const sample = node => node ? { size: cs(node).fontSize, line: cs(node).lineHeight, family: cs(node).fontFamily.slice(0, 120) } : null;
    const prose = root.querySelector('[data-reader-answer]') ?? root.querySelector('[data-reader-flow] [data-reader-key]');
    const code = root.querySelector('[data-reader-answer] code, [data-reader-flow] code');
    let backdrop = root; while (backdrop && /^rgba\\(0, 0, 0, 0\\)$|^transparent$/.test(cs(backdrop).backgroundColor)) backdrop = backdrop.parentElement;
    const scroller = document.querySelector('[data-conversation-scroll]');
    return {
      viewport: { width: innerWidth, height: innerHeight },
      lineCount: lines.length, lineHeights: heights,
      toolSummaries: summaries.length, clippedSummaries: clipped.length,
      fonts: { prose: sample(prose), line: sample(root.querySelector('[data-reader-line]')), code: sample(code), toolLine: sample(root.querySelector('[data-reader-tool-call] [data-reader-line]')),
        user: sample(root.querySelector('[data-reader-user-bubble]')), anthropicSerifLoaded: document.fonts.check('16px anthropic-serif') },
      rootBackground: cs(root).backgroundColor, backdropBackground: backdrop ? cs(backdrop).backgroundColor : null,
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
      button.click();
      return true;
    })()`);
    await delay(700);
    item.toolDetails = await evaluate("!!document.querySelector('[data-reader-tool-details]')");
    await shot(`${name}-group-tool-open`);
    item.measured = await evaluate(measure);
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
    for (const [key, selector] of [['line', '[data-dsh-clearview] [data-reader-line] button'], ['toolLine', '[data-dsh-clearview] [data-reader-tool-call] [data-reader-line] button'], ['fileChanges', '[data-dsh-clearview] [data-reader-file-changes] > button']]) {
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
      const before = button.getAttribute('aria-expanded');
      button.click(); await new Promise(done => setTimeout(done, 500));
      const during = button.getAttribute('aria-expanded');
      button.click(); await new Promise(done => setTimeout(done, 500));
      return { before, during, after: button.getAttribute('aria-expanded') };
    })()`);
    // Clamped user bubbles: the expand control is a plain local toggle.
    item.bubbleClamp = await evaluate(`(async () => {
      const bubble = document.querySelector('[data-dsh-clearview] [data-reader-user-bubble][data-clamped="true"]');
      if (!bubble) return null;
      bubble.scrollIntoView({ block: 'center' });
      // The toggle is a sibling of the bubble inside the same row, with no aria-expanded: its text carries the state.
      const button = bubble.parentElement?.querySelector('button');
      if (!button) return { clamped: true, button: false };
      const snap = () => ({ text: button.textContent.trim(), clamped: bubble.getAttribute('data-clamped'), height: Math.round(bubble.getBoundingClientRect().height * 10) / 10 });
      const before = snap();
      button.click(); await new Promise(done => setTimeout(done, 500));
      const opened = snap();
      button.click(); await new Promise(done => setTimeout(done, 400));
      return { clamped: true, button: true, before, opened, after: snap() };
    })()`);
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
    // Conditions, while the reader still has the whole pane: host font size 13/14/16, dark / light,
    // reduced motion. Opening a file below adds a right sidebar that would crowd these screenshots.
    const focusGroup = async () => {
      await evaluate("document.querySelector('[data-dsh-clearview] [data-reader-group]')?.scrollIntoView({ block: 'start' })");
      await delay(350);
    };
    if (conditions) {
    item.fontSizes = {};
    for (const size of ['13px', '14px', '16px']) {
      await evaluate(`document.body.style.setProperty('--dsh-content-font-size', '${size}')`);
      await delay(400);
      await focusGroup();
      item.fontSizes[size] = (await evaluate(measure))?.fonts;
      await shot(`${name}-font-${size}`);
    }
    await evaluate("document.body.style.setProperty('--dsh-content-font-size', '14px')");
    await focusGroup();
    // Theme check. The host theme does not follow prefers-color-scheme, so the attribute is flipped on
    // document.body of this throwaway headless page only (no host setting is written) and restored after.
    item.theme = {};
    for (const mode of ['dark', 'light']) {
      await evaluate(mode === 'dark' ? "(() => { document.body.setAttribute('data-ds-dark-theme', ''); document.documentElement.style.colorScheme = 'dark'; })()" : "(() => { document.body.removeAttribute('data-ds-dark-theme'); document.documentElement.style.colorScheme = 'light'; })()");
      await delay(600);
      await focusGroup();
      const measured = await evaluate(measure);
      const expected = await evaluate(`(() => { const probe = document.createElement('span'); probe.style.backgroundColor = ${JSON.stringify(mode === 'dark' ? 'hsl(60 2.7% 14.5%)' : 'hsl(48 33.3% 97.1%)')}; document.body.appendChild(probe); const color = getComputedStyle(probe).backgroundColor; probe.remove(); return color; })()`);
      item.theme[mode] = { attribute: await evaluate("document.body.hasAttribute('data-ds-dark-theme')"), rootBackground: measured?.rootBackground, backdropBackground: measured?.backdropBackground, expected,
        matches: [measured?.rootBackground, measured?.backdropBackground].includes(expected) };
      await shot(`${name}-theme-${mode}`);
    }
    await evaluate("(() => { document.body.setAttribute('data-ds-dark-theme', ''); document.documentElement.style.colorScheme = 'dark'; })()");
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
    if (await evaluate("!!document.querySelector('[data-reader-inspect]')")) {
      await evaluate("document.querySelector('[data-reader-inspect]').click()");
      await delay(800);
      item.inspectTab = await selectedTab();
      await clickTab('阅读');
      await delay(800);
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
    // Step 2 expectations, evaluated from the evidence above.
    const overflowing = state => state ? Object.values(state.overflowX).some(value => value === true) : false;
    const family = (item.measured?.fonts?.prose?.family ?? '').replace(/["']/g, '');
    const serifLoaded = item.measured?.fonts?.anthropicSerifLoaded;
    item.checks = {
      overflow1440: !overflowing(item.measured), overflow480: !overflowing(item.narrow) && !overflowing(item.narrowBottom),
      proseFont: !item.measured?.fonts?.prose ? 'n/a' : family.startsWith('anthropic-serif') ? 'anthropic-serif' : serifLoaded === false ? 'fallback' : 'mismatch',
      themeBackground: item.theme ? item.theme.dark.matches && item.theme.light.matches : 'skipped',
    };
    item.checks.pass = item.checks.overflow1440 && item.checks.overflow480 && item.checks.proseFont !== 'mismatch' && item.checks.themeBackground !== false;
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
  && report.sessions.every(item => item.opened && item.readerMounted && item.initial?.version === expectedVersion && item.initial.blockErrors.length === 0 && item.final?.blockErrors.length === 0 && item.initial.retired === 0 && item.final?.retired === 0 && item.checks?.pass === true)
  && readerErrors.length === 0 && report.handlerErrors.length === 0 && report.profileRemoved
  && report.sessionCreates <= 1 && report.sessionCountBefore === report.sessionCountAfter;
report.readerErrors = readerErrors;
writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ pass: report.pass, replacements: report.replacements, spliced: report.spliced, comboPassedThrough: report.comboPassedThrough.length, sessions: report.sessions.map(item => ({ title: item.title, opened: item.opened, initial: item.initial, checks: item.checks })), readerErrors }, null, 2));
process.exit(report.pass ? 0 : 1);
