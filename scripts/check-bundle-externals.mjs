// The lazy-CJS bundle may require only the modules every supported host preloads.
//
// Accepted exception this check cannot see: store.ts resolves the engine store at runtime through a
// guarded lookup of '@deepseek-ai/dsh-client-store' and '@deepseek-ai/dsh-client-runtime/client' (one per
// host generation, each wrapped in try/catch). It calls the factory-scoped require under another name with
// a computed specifier, not a literal require("..."), so the regex below never matches it.
// tests/client-store-resolution.test.ts pins that shape and fails if either package becomes a hard-coded
// require in source or in the built bundle.
import { readFileSync } from 'node:fs';

const bundle = readFileSync(process.argv[2] ?? 'lib/client.js', 'utf8');
const allowed = new Set(['react', 'react/jsx-runtime', '@deepseek-ai/dsh-client-ui-primitives']);
const found = [...new Set([...bundle.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g)].map(match => match[1]))].sort();
const extra = found.filter(name => !allowed.has(name));
if (extra.length) {
  console.error(`Unexpected runtime externals: ${extra.join(', ')}`);
  process.exit(1);
}
console.log(`Runtime externals: ${found.join(', ')}`);
