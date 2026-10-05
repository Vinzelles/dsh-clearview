// Link the host packages of one DSH generation into node_modules, so typecheck
// and tests read the exact 0.2.0 contracts the reader runs against.
// Usage: node scripts/link-generation-dependencies.mjs <generation>/packages
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmdirSync, rmSync, symlinkSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const packagesDir = resolve(process.argv[2] ?? '');
if (!process.argv[2] || !existsSync(packagesDir)) throw new Error('Pass the generation packages directory.');
const wanted = new Set([
  '@deepseek-ai/cordis', '@deepseek-ai/dsh-attachment', '@deepseek-ai/dsh-session',
  '@deepseek-ai/dsh-client-store', '@deepseek-ai/dsh-client-locale',
  '@deepseek-ai/dsh-client-ui-slots', '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-conversation', '@deepseek-ai/dsh-client-ui-chat',
  '@deepseek-ai/dsh-client-ui-session', '@deepseek-ai/dsh-client-ui-renderer',
  '@deepseek-ai/dsh-api-session-controller', '@deepseek-ai/dsh-api-job-controller',
]);
const found = new Map();
for (const dir of readdirSync(packagesDir)) {
  let name;
  try { name = JSON.parse(readFileSync(join(packagesDir, dir, 'package.json'), 'utf8')).name; } catch { continue; }
  if (wanted.has(name)) found.set(name, join(packagesDir, dir));
}
const missing = [...wanted].filter(name => !found.has(name));
if (missing.length) throw new Error(`Generation is missing: ${missing.join(', ')}`);

function remove(path) {
  let stat;
  try { stat = lstatSync(path); } catch { return; }
  if (stat.isSymbolicLink()) { try { unlinkSync(path); } catch { rmdirSync(path); } return; }
  rmSync(path, { recursive: true, force: true });
}

const local = resolve('node_modules');
for (const [name, target] of found) {
  const destination = join(local, name);
  mkdirSync(dirname(destination), { recursive: true });
  remove(destination);
  symlinkSync(target, destination, 'junction');
}
console.log(`Linked ${found.size} generation packages from ${packagesDir}.`);
