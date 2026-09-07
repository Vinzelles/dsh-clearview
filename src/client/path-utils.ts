function isWindowsStylePath(value: string): boolean {
  return /^[A-Za-z]:[/\\]/.test(value) || value.startsWith('\\\\');
}

export function resolveWorkspacePath(cwd: string | undefined, path: string): string {
  if (path.startsWith('/') || isWindowsStylePath(path)) return path;
  if (cwd === undefined || cwd === '') return path;
  return `${cwd.replace(/[/\\]+$/, '')}/${path.replace(/^[/\\]+/, '')}`;
}

export function abbreviateHomePath(path: string, home?: string): string {
  if (home === undefined || home === '') return path;
  if (isWindowsStylePath(path) || isWindowsStylePath(home)) return path;
  const root = home.replace(/\/+$/, '');
  if (root === '' || root === '/') return path;
  if (path.replace(/\/+$/, '') === root) return '~';
  if (path.startsWith(`${root}/`)) return `~${path.slice(root.length)}`;
  return path;
}
