import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { FONT_ROUTE, fontRouteHandler, locateClaudeFonts } from '../src/server/claude-fonts.ts';
import { CLAUDE_FONT_FACES, ensureClaudeFonts } from '../src/client/cc-fonts.ts';

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

function call(handler: ReturnType<typeof fontRouteHandler>, url: string) {
  const res = Object.assign(new EventEmitter(), {
    statusCode: 0, headers: {} as Record<string, string>, body: Buffer.alloc(0),
    setHeader(name: string, value: string) { this.headers[name.toLowerCase()] = value; },
    writeHead(code: number, headers?: Record<string, string>) { this.statusCode = code; for (const [k, v] of Object.entries(headers ?? {})) this.headers[k.toLowerCase()] = v; return this; },
    end(chunk?: Buffer | string) { if (chunk) this.body = Buffer.from(chunk); this.emit('done'); },
  });
  const done = new Promise(resolve => res.once('done', resolve));
  return handler({ url, method: 'GET' } as never, res as never).then(() => done).then(() => res);
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

test('client font faces point at the route and inject once', () => {
  assert.match(CLAUDE_FONT_FACES, /font-family:\s*anthropic-serif;[^}]*url\("\/dsh-clearview\/fonts\/serif\.woff2"\)/);
  assert.match(CLAUDE_FONT_FACES, /font-display:\s*swap/);
  const nodes: { id: string; textContent: string }[] = [];
  const doc = { getElementById: (id: string) => nodes.find(node => node.id === id) ?? null, createElement: () => ({ id: '', textContent: '' }), head: { appendChild: (node: never) => nodes.push(node) } };
  ensureClaudeFonts(doc as never); ensureClaudeFonts(doc as never);
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0]!.id, 'dsh-clearview-fonts');
});
