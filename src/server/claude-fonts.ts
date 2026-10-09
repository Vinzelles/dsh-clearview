/// <reference types="node" />
import { readdir, readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import type {} from '@deepseek-ai/cordis';

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host web server (optional: absent in Electron and tests; use through ctx.inject). */
    webServer: { register(route: { kind: 'exact' | 'prefix'; path: string; handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void> }): () => void };
  }
}

export type FontRole = 'sans' | 'serif' | 'mono';
export const FONT_ROUTE = '/dsh-clearview/fonts';
const FAMILIES: Record<FontRole, string> = { sans: 'anthropic-sans', serif: 'anthropic-serif', mono: 'anthropic-mono' };
const NAME = /^\/dsh-clearview\/fonts\/(sans|serif|mono)\.woff2$/;

function compareVersions(left: string, right: string): number {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Font files of the newest installed Claude Desktop, read from its bundled stylesheet; `{}` when anything is missing. */
export async function locateClaudeFonts(localAppData: string | undefined): Promise<Partial<Record<FontRole, string>>> {
  if (!localAppData) return {};
  try {
    const base = join(localAppData, 'AnthropicClaude');
    const versions = (await readdir(base)).filter(name => /^app-\d+(\.\d+)*$/.test(name)).map(name => name.slice(4)).sort(compareVersions);
    const newest = versions.at(-1);
    if (!newest) return {};
    const assets = join(base, `app-${newest}`, 'resources', 'ion-dist', 'assets', 'v1');
    const files = new Set(await readdir(assets));
    const found: Partial<Record<FontRole, string>> = {};
    for (const sheet of [...files].filter(name => name.endsWith('.css'))) {
      const css = await readFile(join(assets, sheet), 'utf8');
      for (const face of css.match(/@font-face\{[^}]*\}/g) ?? []) {
        const family = /font-family:\s*([\w-]+)/.exec(face)?.[1];
        const role = (Object.keys(FAMILIES) as FontRole[]).find(key => FAMILIES[key] === family);
        if (!role || found[role] || /font-style:\s*italic/.test(face)) continue;
        const file = /url\(\/assets\/v1\/([\w.-]+\.woff2)\)/.exec(face)?.[1];
        if (file && files.has(file)) found[role] = join(assets, file);
      }
    }
    return found;
  } catch {
    return {};
  }
}

/** Cache lifetimes are bounded; an incomplete installation is retried sooner. */
export interface FontCacheOptions { ttlMs?: number; missingTtlMs?: number; now?: () => number }

/** Read-only handler: `<FONT_ROUTE>/{sans,serif,mono}.woff2` -> the located file, anything else -> 404. */
export function fontRouteHandler(locate: () => Promise<Partial<Record<FontRole, string>>>, options: FontCacheOptions = {}) {
  const now = options.now ?? Date.now;
  const ttlMs = Math.max(0, options.ttlMs ?? 60_000);
  const missingTtlMs = Math.min(ttlMs, Math.max(0, options.missingTtlMs ?? 1_000));
  type Cache = { expiresAt: number; value: Promise<Partial<Record<FontRole, string>>> };
  let cached: Cache | null = null;
  const notFound = (res: ServerResponse) => {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end('not found');
  };
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const role = NAME.exec((req.url ?? '').split('?')[0]!)?.[1] as FontRole | undefined;
    if (!role || req.method !== 'GET') { notFound(res); return; }
    if (!cached || now() >= cached.expiresAt) {
      const snapshot: Cache = { expiresAt: Infinity, value: Promise.resolve({}) };
      cached = snapshot;
      snapshot.value = Promise.resolve().then(locate).then(found => {
        const complete = (Object.keys(FAMILIES) as FontRole[]).every(key => !!found[key]);
        snapshot.expiresAt = now() + (complete ? ttlMs : missingTtlMs);
        return found;
      });
    }
    const snapshot = cached;
    try {
      const path = (await snapshot.value)[role];
      if (!path) { notFound(res); return; }
      const body = await readFile(path);
      res.writeHead(200, { 'Content-Type': 'font/woff2', 'Cache-Control': `public, max-age=${Math.floor(ttlMs / 1000)}` });
      res.end(body);
    } catch {
      // A stale concurrent read must not invalidate a newer discovery.
      if (cached === snapshot) cached = null;
      notFound(res);
    }
  };
}
