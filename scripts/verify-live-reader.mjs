// Real-host check: a fresh headless Chrome profile opens the live DSH page and
// receives the locally built reader bundle through CDP response interception.
// Nothing is installed and no message is sent; only existing sessions are opened.
// Safety: this script only reads and navigates. It never types, never presses a key,
// never clicks fork / rewind / approve / stop / settings / workspace entries.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const base = process.env.DSH_TEST_URL || 'http://127.0.0.1:3193';
const bundle = readFileSync(resolve(process.env.READER_BUNDLE || 'lib/client.js'));
const titles = (process.env.READER_SESSIONS || '').split('|').map(value => value.trim()).filter(Boolean);
const out = resolve(process.env.READER_LIVE_OUTPUT || '.perf-results/live');
// READER_NO_INTERCEPT=1 checks the bundle the host itself serves (after install).
const intercept = process.env.READER_NO_INTERCEPT !== '1';
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

const profile = mkdtempSync(join(tmpdir(), 'clearview-live-'));
const chrome = spawn(process.env.CHROME_PATH || join(process.env.ProgramFiles || 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'),
  ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--window-size=1440,900', 'about:blank'],
  { stdio: 'ignore', windowsHide: true });
const delay = ms => new Promise(done => setTimeout(done, ms));
const report = { base, entry: entry.url, sessions: [], exceptions: [], consoleErrors: [], replacements: 0, spliced: 0, comboPassedThrough: [] };
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
    const message = JSON.parse(event.data);
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
      return { row: rowText.slice(0, 80), cardPreview: card?.getAttribute('data-preview') ?? null, cardLive: card?.getAttribute('data-live') ?? null,
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
          reasoningRows: all('[data-reader-reasoning]').length, folds: all('[data-reader-fold]').length, steps: all('[data-reader-step]').length,
          childCalls: all('[aria-label="子调用"] [data-reader-tool-call]').length, earlierButtons: all('[data-reader-earlier]').length, notices: all('[data-reader-notice]').length };
      })(),
      floating: { activity: !!root.querySelector('[data-reader-activity-pill]'), jump: !!root.querySelector('[data-reader-jump]') },
    };
  })()`;
  // Only a session row in the sidebar tree is ever clicked (never a workspace row).
  const sessionRows = title => `[...document.querySelectorAll('[role="treeitem"][data-row-key^="session:"]')]
    .filter(node => node.textContent.trim().startsWith(${JSON.stringify(title)}))`;
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

  for (const [index, title] of titles.entries()) {
    const name = `s${index + 1}`;
    const item = { title, opened: await clickSession(title) };
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
  }
} finally {
  try { ws?.close(); } catch {}
  chrome.kill();
  setTimeout(() => { try { rmSync(profile, { recursive: true, force: true }); } catch {} }, 1500).unref();
}
const readerErrors = report.exceptions.concat(report.consoleErrors).filter(text => /clearview|data-reader|dsh-clearview/i.test(text));
report.pass = (!intercept || report.replacements + report.spliced > 0)
  && report.sessions.every(item => item.opened && item.readerMounted && item.initial?.version === '0.2.0' && item.initial.blockErrors.length === 0 && item.final?.blockErrors.length === 0)
  && readerErrors.length === 0;
report.readerErrors = readerErrors;
writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ pass: report.pass, replacements: report.replacements, spliced: report.spliced, comboPassedThrough: report.comboPassedThrough.length, sessions: report.sessions.map(item => ({ title: item.title, opened: item.opened, initial: item.initial })), readerErrors }, null, 2));
process.exit(report.pass ? 0 : 1);
