// Browser safety policy shared by live verification, recording and performance workers.
// Default deny. Only named reads and same-origin static resources can reach the host.
// Decisions and summaries never retain request bodies, query strings or headers.
export const READ_ONLY_RPC_METHODS = Object.freeze([
  'session/list', 'session/search', 'session/page', 'session/follow', 'session/projections', 'session/control', 'session/modelCatalog', 'session/canOpenWorkspacePath', 'session/workspaceDesktop',
  // e95fc396 runtime.links: metadata reads; attachment only reads an authorized image.
  'session/attachment', 'credentials/describe', 'account/getProfile', 'commands/list', 'agentPresets/list', 'skills/list',
  'dynamicCordisRunner/inventory', 'permissionPresets/catalog', 'workspaceFiles/stat', 'workspaceFiles/read', 'workspaceFiles/list', 'workspaceFiles/changes',
  'llm/listProviders', 'llm/listConfigurableProviders',
  // Validates and publishes only the process-local client inspection directory, never executes a query or writes user data.
  'dynamicCordisRunner/syncInspectManifest',
  'workspace/list', 'jobs/list', 'jobs/watch', 'job/list', 'job/watch',
  'settings/describe', 'settings/get', 'host/describe', 'host/listDirectory',
  'session.list', 'session.search', 'session.history', 'session.models',
  'subagent.list', 'subagent.history', 'workspace.list', 'host.describe', 'host.listDirectory',
  'settings.describe', 'skill.list', 'agentPreset.list', 'agentPreset.read', 'llm.providers', 'llm.models',
]);
const READ_ONLY_RPCS = new Set(READ_ONLY_RPC_METHODS);
// Exact routes audited against generation e95fc396, not a blanket plugin GET exemption.
export const READ_ONLY_GET_PATHS = Object.freeze([
  '/api/events.mux', '/api/events.host', '/api/file', '/api/present.host', '/api/changes.summary',
  '/api/desktop/dsh-tauri-scheduler/tasks', '/api/desktop/dsh-tauri-scheduler/history',
  '/api/desktop/dsh-tauri-worktree/bindings', '/api/desktop/dsh-tauri-worktree/status',
  '/dsh-claude-style/model-descriptions.json', '/dsh-claude-style/username', '/dsh-claude-style/hdsl', '/dsh-claude-style/hdsl-skin.png',
  ...['JetBrainsMonoVariable.ttf', 'JetBrainsMonoItalicVariable.ttf', 'AnthropicSansWebText.ttf', 'AnthropicSerifWebText.ttf', 'InterVariable.woff2', 'NotoSerifVariable.woff2'].map(name => '/dsh-claude-style/fonts/' + name),
  '/dsh-custom-patcher/manifest.json', '/dsh-custom-patcher/manifest', '/modsearch/config', '/api/auto-continue-bridge',
  '/open-in-app/apps', '/thoughtdag/api/version', '/subagent-profiles/reminders', '/knowledge/events',
  '/memory-evolve/api/notifications/unread', '/memory-evolve/api/config', '/memory-evolve/api/coi/config', '/memory-evolve/api/broadcast/messages',
  '/memory-evolve/api/ui-settings/state', '/memory-evolve/api/prompts/sources', '/memory-evolve/api/bookmarks/state', '/memory-evolve/api/canvas/state',
  ...['status', 'instructions', 'config', 'scopes', 'events'].map(name => '/memory-evolve/api/advisor/' + name),
  '/scheduler/api/notifications', '/scheduler/api/tasks', '/favicon-dark.svg', '/favicon-light.svg', '/manifest.webmanifest',
]);
const READ_ONLY_API_GETS = new Set(READ_ONLY_GET_PATHS);
const READ_ONLY_PLUGIN_RPCS = new Map([
  ['/smooth-stream/settings.read', 'settings.read'], ['/sidebar/api/settings.get', 'settings.get'], ['/sidebar/api/fs.read', 'fs.read'],
]);
// These verified background routes have durable effects. Even their startup requests stay denied.
const BLOCKED_PREREQUISITES = new Map([
  ['POST /api/desktop/dsh-tauri-scheduler/runs/recover', 'scheduler-recovery'],
  ['POST /prompt-enhancer/diag', 'prompt-enhancer-diagnostic-write'],
  ['GET /dsh-claude-style/usage', 'usage-event-scan-and-cache-write'],
  ['HEAD /dsh-claude-style/usage', 'usage-event-scan-and-cache-write'],
]);
export function readonlyDecision(request, baseUrl) {
  let url; try { url = new URL(request.url); } catch { return { allowed: false, reason: 'invalid URL' }; }
  if (url.origin !== new URL(baseUrl).origin) return { allowed: false, reason: 'external origin' };
  const verb = request.method.toUpperCase();
  const endpoint = READ_ONLY_PLUGIN_RPCS.get(url.pathname) ?? (url.pathname.startsWith('/api/') ? url.pathname.slice(5) : null);
  let envelope; try { envelope = JSON.parse(request.postData ?? 'null'); } catch {}
  if (['/session/create', '/api/session/create', '/session.create', '/api/session.create'].includes(url.pathname) || ['session/create', 'session.create'].includes(envelope?.method)) {
    return { allowed: false, reason: 'session/create forbidden', endpoint };
  }
  const prerequisite = BLOCKED_PREREQUISITES.get(verb + ' ' + url.pathname);
  if (prerequisite) return { allowed: false, reason: 'verified host background side effect', blockedPrerequisite: prerequisite };
  // dsh-context DETAIL_ROUTE reads projections/cold history without activating an Agent.
  if (verb === 'POST' && url.pathname === '/api/dsh-context/detail' && envelope && typeof envelope === 'object' && !Array.isArray(envelope) && typeof envelope.sessionId === 'string' && envelope.sessionId !== '') return { allowed: true };
  if (verb === 'POST' && endpoint && (READ_ONLY_RPCS.has(endpoint) || READ_ONLY_PLUGIN_RPCS.get(url.pathname) === endpoint)
      && envelope?.type === 'client-request' && envelope.method === endpoint && typeof envelope.rpcId === 'string') {
    return { allowed: true, endpoint };
  }
  if (verb === 'GET' || verb === 'HEAD') {
    // Modsearch's optional doctor probe launches a subprocess; do not authorize it as a config read.
    if (url.pathname === '/modsearch/config' && url.searchParams.has('doctor')) return { allowed: false, reason: 'unverified readiness probe' };
    if (/^\/dsh-(?:custom-patcher|claude-style)\/assets\/[A-Za-z0-9_.-]+\.(?:css|js|json|woff2|ttf|png|svg)$/.test(url.pathname) && !url.pathname.includes('..')) return { allowed: true };
    if (READ_ONLY_API_GETS.has(url.pathname)) return { allowed: true, endpoint };
    if (url.pathname === '/' || ['/assets/', '/plugins/', '/dsh-clearview/fonts/'].some(prefix => url.pathname.startsWith(prefix)) || ['/favicon.ico', '/favicon.png', '/favicon.svg'].includes(url.pathname)) return { allowed: true };
  }
  return { allowed: false, reason: 'not an explicitly read-only request', endpoint };
}
// Only the already observed native chat slot's undefined-element React 130 is noise.
// A bare React 130 (including one in the reader) remains a failure.
export function knownNativeReact130(text, phase) {
  return phase === 'native-chat' && text.startsWith("slot entry crashed in 'conversation.chat.node': Error: Minified React error #130;")
    && /invariant=130&args\[\]=undefined&args\[\]=/.test(text);
}

/** Safe evidence for a denied request; never copy postData or URL queries into reports. */
export function readonlyRequestSummary(request, decision) {
  let path = null; try { path = new URL(request.url).pathname; } catch {}
  return { method: request.method, path, reason: decision.reason, ...(decision.blockedPrerequisite ? { blockedPrerequisite: decision.blockedPrerequisite } : {}) };
}

/** Absent optional UI targets are explicit skips, never null boolean gates. */
export function interactionCoverage(name, value, { optional = false, title, skippedChecks, uncovered }) {
  if (value == null) {
    const detail = { kind: 'interaction', title, name, reason: 'No applicable target in the selected session' };
    if (optional) { skippedChecks.push(detail); return true; }
    uncovered.push(detail); return false;
  }
  return value === true;
}

/** Only a correlated console failure from the exact denied background endpoint is uncovered.
 * Runtime exceptions and unrelated FailedToFetch errors always remain failures. */
export function classifyBrowserError(error, blockedRequests) {
  if (error.kind !== 'runtime' && knownNativeReact130(error.text, error.phase)) return 'nativeReact130';
  if (error.kind !== 'console') return 'failure';
  // These exact native owners fail during boot, before any reader is selected.
  // Retain them as whole-host uncovered evidence; never classify reader/runtime
  // errors or later interaction failures through this startup-only branch.
  if (error.phase === 'startup' && (
    error.text.startsWith('[cordis-client-runner] syncing inspect providers failed: Error: gateway/internal: client api: dynamicCordisRunner/syncInspectManifest failed: Failed to fetch')
    || error.text.startsWith('[ui-cordis] reading the Cordis inventory failed: Error: gateway/internal: client api: dynamicCordisRunner/inventory failed: Failed to fetch')
    || error.text.startsWith('[dsh-claude-style] "permissions" failed and was switched off: Error: permission: unexpected permissionPresets catalog shape')
  )) return 'hostStartup';
  if (!/Failed to fetch|FailedToFetch/.test(error.text)) return 'failure';
  const recover = blockedRequests.some(request => request.blockedPrerequisite === 'scheduler-recovery');
  if (recover && error.text.startsWith('[dsh-tauri-scheduler]') && error.text.includes('/api/desktop/dsh-tauri-scheduler/runs/recover')) return 'blockedPrerequisite';
  const usage = blockedRequests.some(request => request.blockedPrerequisite === 'usage-event-scan-and-cache-write');
  if (usage && error.text.startsWith('[dsh-claude-style] "usage" failed and was switched off: ')) return 'blockedPrerequisite';
  return 'failure';
}

/** Compact repeated poll evidence by method/path/tag without retaining request bodies. */
export function recordBlockedRequest(records, request) {
  const tag = request.blockedPrerequisite ?? request.tag ?? request.reason;
  const previous = records.find(item => item.method === request.method && item.path === request.path && item.tag === tag);
  const counter = Number.isSafeInteger(request.counter) && request.counter > 0 ? request.counter : 1;
  if (previous) previous.counter += counter;
  else records.push({ method: request.method, path: request.path, tag, reason: request.reason,
    ...(request.blockedPrerequisite ? { blockedPrerequisite: request.blockedPrerequisite } : {}), counter });
}

export function aggregateBlockedRequests(records) {
  const compact = [];
  for (const request of records) recordBlockedRequest(compact, request);
  return compact;
}

/** Reader gate applies only to explicitly covered cases; missing cases remain visible in full coverage. */
export function summarizeReaderGate(report, expectedVersion, { intercept = false } = {}) {
  const cases = report.sessions.map(item => {
    const covered = !!item.readerMounted && !!item.checks;
    const pass = covered && !!item.opened && item.sessionSelected === true && item.readerTabSelected === true
      && item.initial?.version === expectedVersion && item.final?.version === expectedVersion
      && item.initial?.blockErrors.length === 0 && item.final?.blockErrors.length === 0
      && item.initial?.retired === 0 && item.final?.retired === 0 && item.checks.pass === true;
    return { title: item.title, covered, pass: covered ? pass : null };
  });
  const covered = cases.filter(item => item.covered);
  const readerScope = {
    gate: 'covered-reader-cases-only', requested: cases.length, covered: covered.length,
    passed: covered.filter(item => item.pass).length, complete: covered.length === cases.length && cases.length > 0,
    missing: cases.filter(item => !item.covered).map(item => item.title), cases,
  };
  const readerPass = covered.length > 0 && covered.every(item => item.pass)
    && !report.fatal && (report.readerErrors?.length ?? 0) === 0 && report.handlerErrors.length === 0
    && report.profileRemoved === true && report.sessionCreates === 0
    && report.sessionCountBefore != null && report.sessionCountAfter != null && report.sessionCountBefore === report.sessionCountAfter
    && (!intercept || report.replacements + report.spliced > 0);
  return { readerScope, readerPass };
}
