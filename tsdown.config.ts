import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Builds use an explicit checkout, never an implicit production configuration.
const root = process.env.DSHX_HARNESS;
if (!root) throw new Error('Set DSHX_HARNESS to the checkout used for this build.');
const adapter = resolve(root, 'tools/dshx/src/client-build.js');
if (!existsSync(adapter)) throw new Error('DSHX externalClientBundle adapter is missing.');
const { externalClientBundle } = await import(pathToFileURL(adapter).href);
const configs = externalClientBundle('dsh-clearview', ['lib/types/dsh-clearview.js'], {
  clientEntry: 'src/client/index.tsx',
});
// The devkit adapter defaults the browser half to ES2024. The oldest supported
// browser is WebKit on macOS 13.7 (Safari 16.5, JavaScriptCore 605.1.15): its
// syntax ceiling is ES2023 (no new syntax, so ES2022 is the safe floor) and it
// lacks every ES2024/25 runtime API. Any post-ES2022 syntax — notably the
// ES2025 `using` declaration — is a hard SyntaxError at parse time on that
// engine, so the browser bundle is pinned to es2022; runtime API usage is
// forbidden separately by scripts/browser-syntax-gate.mjs (no bundler
// transpiles that axis) and locked in tests/browser-target.test.ts.
for (const config of configs) {
  if (config.platform === 'browser') config.target = 'es2022';
}
export default configs;
