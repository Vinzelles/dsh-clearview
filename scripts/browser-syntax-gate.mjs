#!/usr/bin/env node
/**
 * Browser compatibility gate for the built client bundle.
 *
 * Oldest supported browser: WebKit on macOS 13.7 (Safari 16.5, JavaScriptCore
 * 605.1.15). That engine parses at most ES2023 syntax (ES2023 added none, so
 * ES2022 is the safe ceiling) and ships none of the ES2024/25 runtime APIs.
 *
 * The gate checks two independent axes because a bundler only transpiles one:
 *
 * 1. Syntax — the bundle is re-emitted by esbuild for target es2022. If the
 *    source contained post-ES2022 syntax, the marker of the transformation
 *    appears in the output: `using`/`await using` (the only ES2025 syntax
 *    feature) yields `__using`/`__callDispose` helpers; a regex `v`/`d` flag
 *    literal (untranspilable) is rewritten to a runtime `new RegExp(..., "v")`
 *    call that Safari 16.5 rejects at construction.
 *
 * 2. Runtime APIs — ES2024/25 globals are not transpilable by any bundler;
 *    any direct usage is a hard TypeError on Safari 16.5 and must be rewritten
 *    at source level (Object.groupBy, Promise.withResolvers, Array.fromAsync,
 *    Set relational methods, Float8Array, iterator helpers, …).
 *
 * Usage:  node scripts/browser-syntax-gate.mjs [path-to-client.js]
 *         (default: lib/client.js at the repo root)
 * Exit 0 when the bundle is loadable on Safari 16.5, 1 otherwise.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// esbuild re-emits for es2022; a hit means post-ES2022 syntax was present.
const SYNTAX_MARKERS = [
  {
    name: 'using/await using declaration (ES2025) — parse-time SyntaxError on Safari 16.5',
    pattern: /__using\(|__callDispose\(|__knownSymbol\(/,
    in: 'transformed',
  },
  {
    name: 'regex v/d flag (ES2024/ES2026) — TypeError at RegExp construction on Safari 16.5',
    pattern: /new RegExp\([^)]{0,300}?"[vd]"[)\s]/,
    in: 'transformed',
  },
];

// Direct runtime usage of globals absent from Safari 16.5 (ES2024/25).
const RUNTIME_MARKERS = [
  { name: 'Promise.withResolvers (Safari 18+)', pattern: /Promise\.withResolvers/ },
  { name: 'Object.groupBy (Safari 18+)', pattern: /Object\.groupBy/ },
  { name: 'Map.groupBy (Safari 18+)', pattern: /\bMap\.groupBy/ },
  { name: 'Array.fromAsync (Safari 18+)', pattern: /Array\.fromAsync/ },
  { name: 'Promise.try (Safari 26+)', pattern: /Promise\.try(?![\w.])/ },
  { name: 'Float8Array (Safari 18+)', pattern: /\bFloat8Array\b/ },
  {
    name: 'Set relational methods (Safari 18+)',
    pattern: /\.(isDisjointFrom|isSubsetOf|isSupersetOf|isIntDisjointFrom|isIntSubsetOf|isIntSupersetOf|isIntProperSubsetOf)\(/,
  },
  { name: 'Symbol.dispose / Symbol.asyncDispose (Safari 19+)', pattern: /Symbol\.(async)?Dispose/ },
  { name: 'iterator helpers (Safari 18+)', pattern: /(?:Async)?Iterator\.prototype/ },
];

/**
 * @param {string} code full text of the built browser bundle
 * @returns {Promise<{ ok: boolean, issues: string[], transformedChars: number }>}
 */
export async function browserSyntaxGate(code) {
  const issues = [];
  let transformed = '';
  try {
    const { transform } = await import('esbuild');
    ({ code: transformed } = await transform(code, { target: 'es2022', format: 'cjs', loader: 'js' }));
  } catch (error) {
    issues.push(`esbuild could not even parse the bundle: ${String(error.message).split('\n')[0]}`);
    return { ok: false, issues, transformedChars: 0 };
  }

  for (const marker of SYNTAX_MARKERS) {
    const match = transformed.match(marker.pattern);
    if (match) issues.push(`post-ES2022 syntax: ${marker.name} (matched ${JSON.stringify(match[0])})`);
  }
  for (const marker of RUNTIME_MARKERS) {
    const match = code.match(marker.pattern);
    if (match) issues.push(`missing runtime API on Safari 16.5: ${marker.name} (matched ${JSON.stringify(match[0])})`);
  }
  return { ok: issues.length === 0, issues, transformedChars: transformed.length };
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const file = process.argv[2] ? resolve(process.argv[2]) : join(repoRoot, 'lib', 'client.js');
  let code;
  try {
    code = readFileSync(file, 'utf8');
  } catch (error) {
    console.error(`[browser-syntax-gate] cannot read ${file}: ${error.message}`);
    process.exit(1);
  }
  const report = await browserSyntaxGate(code);
  if (report.issues.length > 0) {
    for (const issue of report.issues) console.error(`[browser-syntax-gate] FAIL ${issue}`);
  }
  console.log(
    report.ok
      ? `[browser-syntax-gate] ${file}: OK — loadable on WebKit (macOS 13.7 / Safari 16.5)`
      : `[browser-syntax-gate] ${file}: FAILED — ${report.issues.length} issue(s)`,
  );
  process.exit(report.ok ? 0 : 1);
}
