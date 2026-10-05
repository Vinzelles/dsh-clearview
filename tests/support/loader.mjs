// node:test loader: CSS modules resolve to a class-name proxy, and the host
// primitives package resolves to light stubs generated from its real export
// list, so components can be server-rendered without a browser module table.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const PRIMITIVES = '@deepseek-ai/dsh-client-ui-primitives';
const STUB_URL = new URL('./primitives-stub.virtual.mjs', import.meta.url).href;
const OVERRIDES = new Set(['DisclosureRow', 'TextShimmer', 'StateDot', 'writeClipboard']);

function primitiveNames() {
  const require = createRequire(join(process.cwd(), 'package.json'));
  const manifest = require.resolve(`${PRIMITIVES}/package.json`);
  const source = readFileSync(join(dirname(manifest), 'lib', 'index.js'), 'utf8');
  const names = new Set();
  for (const block of source.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of block[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).at(-1)?.trim();
      if (name && /^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
  }
  return [...names];
}

function primitivesStub() {
  const generic = primitiveNames().filter(name => !OVERRIDES.has(name))
    .map(name => `export const ${name} = stub(${JSON.stringify(name)});`).join('\n');
  return `import { createElement } from 'react';
const stub = name => { const C = props => createElement('span', { 'data-stub': name }, props?.children ?? null); C.displayName = name; return C; };
export const writeClipboard = async () => true;
export const StateDot = props => createElement('span', { 'data-stub': 'StateDot', 'data-state': props.state, className: props.className });
export const TextShimmer = props => createElement('span', { 'data-stub': 'TextShimmer', 'data-active': props.active ? 'true' : 'false', className: props.className }, props.children);
export const DisclosureRow = props => createElement('div', { 'data-stub': 'DisclosureRow', 'data-open': String(props.open), 'data-running': props.running ? 'true' : undefined, className: props.rowClassName },
  props.icon, createElement('span', { 'data-row-title': '', className: props.titleClassName }, props.title), props.collapsedContent ?? null, props.open ? props.children ?? null : null);
${generic}
`;
}

export async function resolve(specifier, context, next) {
  if (specifier === PRIMITIVES) return { url: STUB_URL, format: 'module', shortCircuit: true };
  return next(specifier, context);
}

export async function load(url, context, next) {
  if (url === STUB_URL) return { format: 'module', source: primitivesStub(), shortCircuit: true };
  if (/\.css(\?|$)/.test(url)) return { format: 'module', source: 'export default new Proxy({}, { get: (_, key) => typeof key === "string" ? key : undefined });', shortCircuit: true };
  return next(url, context);
}
