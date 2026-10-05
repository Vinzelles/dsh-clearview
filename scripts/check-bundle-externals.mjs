// The lazy-CJS bundle may require only the modules every supported host preloads.
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
