import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const chrome = [process.env.CHROME_PATH,
  process.platform === 'win32' ? join(process.env.ProgramFiles || 'C:/Program Files', 'Google/Chrome/Application/chrome.exe') : undefined,
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find(path => path && existsSync(path));
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Compare real painted pixels either side of the loop, not just animation names or CSS strings.
// No host is contacted; Chrome receives only a synthetic, in-memory React fixture.
test('running shimmer moves without a visible jump at the loop boundary', { skip: chrome ? false : 'Chrome not available', timeout: 60_000 }, async () => {
  const repo = fileURLToPath(new URL('..', import.meta.url));
  const bundle = await build({ entryPoints: [join(repo, 'tests/browser/shimmer-continuity.tsx')], bundle: true,
    write: false, outfile: join(repo, 'shimmer-fixture.js'), platform: 'browser', format: 'iife', jsx: 'automatic', target: 'es2022',
    define: { 'process.env.NODE_ENV': '"production"' } });
  const js = bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text;
  const css = bundle.outputFiles.find(file => file.path.endsWith('.css'))!.text;
  const profile = mkdtempSync(join(tmpdir(), 'clearview-shimmer-'));
  const child = spawn(chrome!, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--window-size=1200,800', 'about:blank'], { stdio: 'ignore', windowsHide: true });
  let launchError: Error | undefined;
  child.on('error', error => { launchError = error; });
  const closed = new Promise<void>(resolve => child.once('close', () => resolve()));
  let socket: WebSocket | undefined;
  const pending = new Map<number, { resolve: (value: any) => void; reject: (reason: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  try {
    let port = 0;
    for (let attempt = 0; attempt < 100 && !port; attempt++) {
      if (launchError) throw launchError;
      if (child.exitCode !== null) throw Error(`isolated Chrome exited: ${child.exitCode}`);
      try { port = Number(readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]); } catch { /* Chrome is starting */ }
      if (!port) await delay(100);
    }
    assert.ok(port, 'isolated Chrome did not start');
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() as { type: string; webSocketDebuggerUrl: string }[];
    const target = targets.find(item => item.type === 'page');
    assert.ok(target, 'isolated Chrome page missing');
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('CDP connection timed out')), 15_000);
      socket!.onopen = () => { clearTimeout(timer); resolve(); };
      socket!.onerror = () => { clearTimeout(timer); reject(Error('CDP connection failed')); };
    });
    let id = 0;
    const send = (method: string, params: Record<string, unknown> = {}): Promise<any> => new Promise((resolve, reject) => {
      const current = ++id;
      const timer = setTimeout(() => { pending.delete(current); reject(Error(`CDP timeout: ${method}`)); }, 15_000);
      pending.set(current, { resolve, reject, timer });
      socket!.send(JSON.stringify({ id: current, method, params }));
    });
    const exceptions: string[] = [];
    socket.onmessage = event => {
      const message = JSON.parse(String(event.data));
      if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id); clearTimeout(entry.timer);
      message.error ? entry.reject(Error(message.error.message)) : entry.resolve(message.result);
    };
    const evaluate = async (expression: string) => {
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
      return result.result.value;
    };
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false });
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    await evaluate(`(()=>{const style=document.createElement('style');style.textContent=${JSON.stringify(css)};document.head.append(style)})()`);
    await evaluate(js);
    const screenshots: string[] = [];
    let rects: { name: string; duration: number; clip: string; width: number; height: number }[] = [];
    for (const time of [0.1, 1999.9, 500, 1000]) {
      rects = await evaluate(`window.shimmerSample(${time})`);
      screenshots.push((await send('Page.captureScreenshot', { format: 'png' })).data);
    }
    assert.equal(rects.length, 8, 'all status and tool label cases must be exercised');
    for (const rect of rects) {
      assert.equal(rect.duration, 2000, `${rect.name}: expected a two-second sweep`);
      assert.equal(rect.clip, 'text', `${rect.name}: sweep must be clipped to text`);
      assert.ok(rect.width > 0 && rect.height > 0, `${rect.name}: label must be visible`);
    }
    const differences = await evaluate(`window.shimmerCompare(${JSON.stringify(screenshots)}, ${JSON.stringify(rects)})`) as { name: string; boundary: number; moving: number }[];
    console.log('Shimmer painted-frame differences:', JSON.stringify(differences));
    for (const { name, boundary, moving } of differences) {
      assert.ok(moving > 0.2, `${name}: shimmer did not visibly move (${moving})`);
      assert.ok(boundary <= Math.max(0.08, moving * 0.04), `${name}: loop visibly jumps (${boundary} vs ${moving})`);
    }
    const remounted = await evaluate('window.shimmerRemount()') as { name: string; running: boolean }[];
    for (const item of remounted) assert.equal(item.running, true, `${item.name}: remounted sweep must run`);
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    const reduced = await evaluate('window.shimmerReducedMotion()') as { name: string; animations: unknown[]; animationName: string; color: string; background: string }[];
    for (const item of reduced) {
      assert.equal(item.animations.length, 0, `${item.name}: reduced motion must stop the sweep`);
      assert.equal(item.animationName, 'none', `${item.name}: reduced motion must disable the CSS animation`);
      assert.equal(item.background, 'none', `${item.name}: reduced motion must restore plain text`);
      assert.notEqual(item.color, 'rgba(0, 0, 0, 0)', `${item.name}: reduced motion must retain visible text`);
    }
    assert.deepEqual(exceptions, []);
  } finally {
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(Error('CDP closed')); }
    socket?.close();
    if (child.pid && child.exitCode === null) {
      if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      else child.kill('SIGKILL');
    }
    let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([closed, new Promise(resolve => { cleanupTimer = setTimeout(resolve, 5000); })]); }
    finally { clearTimeout(cleanupTimer); }
    rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  }
});
