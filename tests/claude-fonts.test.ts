import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { FONT_ROUTE, fontRouteHandler, locateClaudeFonts } from '../src/server/claude-fonts.ts';

function fakeInstall(versions: string[], css: (v: string) => string) {
  const root = mkdtempSync(join(tmpdir(), 'cc-fonts-'));
  for (const version of versions) {
    const dir = join(root, 'AnthropicClaude', `app-${version}`, 'resources', 'ion-dist', 'assets', 'v1');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'main.css'), css(version));
    for (const file of ['sans', 'serif', 'mono']) writeFileSync(join(dir, `${file}-${version}.woff2`), `${file}@${version}`);
  }
  return root;
}
const CSS = (v: string) => [
  `@font-face{font-family:anthropic-sans;src:url(/assets/v1/sans-${v}.woff2)format("woff2");font-weight:300 800;font-style:normal}`,
  `@font-face{font-family:anthropic-sans;src:url(/assets/v1/italic-${v}.woff2)format("woff2");font-weight:300 800;font-style:italic}`,
  `@font-face{font-family:anthropic-serif;src:url(/assets/v1/serif-${v}.woff2)format("woff2");font-weight:300 800;font-style:normal}`,
  `@font-face{font-family:anthropic-mono;src:url(/assets/v1/mono-${v}.woff2)format("woff2");font-weight:300 800;font-style:normal}`,
].join('');

test('picks the highest app version and the normal-style face of each family', async () => {
  const root = fakeInstall(['2.19675.1', '2.26454.2', '2.3.0'], CSS);
  try {
    const found = await locateClaudeFonts(root);
    assert.match(found.sans!, /app-2\.26454\.2[\\/].*sans-2\.26454\.2\.woff2$/);
    assert.match(found.serif!, /serif-2\.26454\.2\.woff2$/);
    assert.match(found.mono!, /mono-2\.26454\.2\.woff2$/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('no install, unreadable css or missing files yield an empty result instead of throwing', async () => {
  assert.deepEqual(await locateClaudeFonts(undefined), {});
  assert.deepEqual(await locateClaudeFonts(join(tmpdir(), 'cc-fonts-missing-xyz')), {});
  const root = fakeInstall(['1.0.0'], () => '@font-face{font-family:anthropic-sans;src:url(/assets/v1/gone.woff2)}');
  try { assert.deepEqual(await locateClaudeFonts(root), {}); } finally { rmSync(root, { recursive: true, force: true }); }
});

function call(handler: ReturnType<typeof fontRouteHandler>, url: string, method = 'GET') {
  const events = new EventEmitter();
  const res = Object.assign(events, {
    statusCode: 0, headers: {} as Record<string, string>, body: Buffer.alloc(0),
    setHeader(name: string, value: string) { this.headers[name.toLowerCase()] = value; },
    writeHead(code: number, headers?: Record<string, string>) { this.statusCode = code; for (const [k, v] of Object.entries(headers ?? {})) this.headers[k.toLowerCase()] = v; return this; },
    end(chunk?: Buffer | string) { if (chunk) this.body = Buffer.from(chunk); events.emit('done'); },
  });
  const done = new Promise(resolve => res.once('done', resolve));
  return handler({ url, method } as never, res as never).then(() => done).then(() => res);
}

test('the route serves only the three whitelisted names', async () => {
  const root = fakeInstall(['2.26454.2'], CSS);
  try {
    const handler = fontRouteHandler(() => locateClaudeFonts(root));
    const ok = await call(handler, `${FONT_ROUTE}/serif.woff2`);
    assert.equal(ok.statusCode, 200);
    assert.equal(ok.headers['content-type'], 'font/woff2');
    assert.equal(ok.body.toString(), 'serif@2.26454.2');
    for (const bad of [`${FONT_ROUTE}/../main.css`, `${FONT_ROUTE}/sans.css`, `${FONT_ROUTE}/x.woff2`, `${FONT_ROUTE}/`]) {
      assert.equal((await call(handler, bad)).statusCode, 404, bad);
    }
    assert.equal((await call(fontRouteHandler(async () => ({})), `${FONT_ROUTE}/sans.woff2`)).statusCode, 404);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('module stylesheet declares exactly three whitelisted font faces with swap fallback', () => {
  const css = readFileSync(new URL('../src/client/Reader.module.css', import.meta.url), 'utf8');
  const faces = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map(match => match[1]!);
  assert.equal(faces.length, 3);
  for (const role of ['sans', 'serif', 'mono']) {
    const face = faces.find(rule => rule.includes(`font-family: anthropic-${role};`));
    assert.ok(face, role);
    assert.ok(face.includes(`url("/dsh-clearview/fonts/${role}.woff2")`));
    assert.match(face, /font-display:\s*swap/);
  }
});


test('first empty discovery retries when the installation becomes available', async () => {
  const root = fakeInstall(['1.0.0'], CSS);
  let time = 0, scans = 0;
  try {
    const handler = fontRouteHandler(async () => ++scans === 1 ? {} : locateClaudeFonts(root), { now: () => time, ttlMs: 100, missingTtlMs: 10 });
    assert.equal((await call(handler, `${FONT_ROUTE}/sans.woff2`)).statusCode, 404);
    time = 9;
    assert.equal((await call(handler, `${FONT_ROUTE}/sans.woff2`)).statusCode, 404);
    assert.equal(scans, 1);
    time = 10;
    assert.equal((await call(handler, `${FONT_ROUTE}/sans.woff2`)).body.toString(), 'sans@1.0.0');
    assert.equal(scans, 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a missing role is rediscovered without waiting for the successful cache lifetime', async () => {
  const root = fakeInstall(['1.0.0'], CSS);
  let time = 0, scans = 0;
  try {
    const all = await locateClaudeFonts(root);
    const handler = fontRouteHandler(async () => ++scans === 1 ? { sans: all.sans } : all, { now: () => time, ttlMs: 100, missingTtlMs: 10 });
    assert.equal((await call(handler, `${FONT_ROUTE}/sans.woff2`)).statusCode, 200);
    assert.equal((await call(handler, `${FONT_ROUTE}/serif.woff2`)).statusCode, 404);
    time = 10;
    assert.equal((await call(handler, `${FONT_ROUTE}/serif.woff2`)).statusCode, 200);
    assert.equal(scans, 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('successful discovery expires and sees a newer install', async () => {
  const root = fakeInstall(['1.0.0', '2.0.0'], CSS);
  let time = 0, scans = 0;
  try {
    const latest = await locateClaudeFonts(root);
    const old = Object.fromEntries(Object.entries(latest).map(([role, path]) => [role, path!.replaceAll('2.0.0', '1.0.0')]));
    const handler = fontRouteHandler(async () => ++scans === 1 ? old : latest, { now: () => time, ttlMs: 100 });
    assert.equal((await call(handler, `${FONT_ROUTE}/sans.woff2`)).body.toString(), 'sans@1.0.0');
    time = 99;
    assert.equal((await call(handler, `${FONT_ROUTE}/sans.woff2`)).body.toString(), 'sans@1.0.0');
    time = 100;
    assert.equal((await call(handler, `${FONT_ROUTE}/sans.woff2`)).body.toString(), 'sans@2.0.0');
    assert.equal(scans, 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('file read errors invalidate discovery immediately and do not cache the 404', async () => {
  const root = fakeInstall(['1.0.0'], CSS);
  let scans = 0;
  try {
    const all = await locateClaudeFonts(root);
    const handler = fontRouteHandler(async () => ++scans === 1 ? { ...all, sans: join(root, 'gone.woff2') } : all);
    const missing = await call(handler, `${FONT_ROUTE}/sans.woff2`);
    assert.equal(missing.statusCode, 404);
    assert.equal(missing.headers['cache-control'], 'no-store');
    assert.equal((await call(handler, `${FONT_ROUTE}/sans.woff2`)).statusCode, 200);
    assert.equal(scans, 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('non-GET methods and non-whitelisted paths never invoke discovery', async () => {
  let scans = 0;
  const handler = fontRouteHandler(async () => { scans++; return {}; });
  for (const method of ['POST', 'PUT', 'DELETE', 'HEAD', 'OPTIONS']) {
    assert.equal((await call(handler, `${FONT_ROUTE}/sans.woff2`, method)).statusCode, 404);
  }
  assert.equal((await call(handler, `${FONT_ROUTE}/other.woff2`)).statusCode, 404);
  assert.equal(scans, 0);
});
