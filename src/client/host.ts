import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment';
import type { TurnLocation } from '@deepseek-ai/dsh-client-ui-conversation/client';
import type { MarkdownFileMentions } from './markdown/render.js';

export const FILE_ADDRESS_PREFIX = 'dsh-resource://file/';
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

function encodeSegment(segment: string): string { return encodeURIComponent(segment).replace(/%3A/gi, ':'); }
function encodePath(path: string): string { return path.split('/').map(encodeSegment).join('/'); }
export function isWindowsStylePath(value: string): boolean { return /^[A-Za-z]:[/\\]/.test(value) || value.startsWith('\\\\'); }
export function isAbsoluteWorkspacePath(path: string): boolean { return path.startsWith('/') || isWindowsStylePath(path); }

/** `dsh-resource://file/session/<sessionId>/<path>`, the address native Chat opens in the right sidebar. */
export function sessionFileAddress(sessionId: string, path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '');
  return `${FILE_ADDRESS_PREFIX}session/${encodeSegment(sessionId)}/${encodePath(normalized)}`;
}

/** Workspace-rooted paths address relative to the Session cwd, like native fileAddressFor. */
export function fileAddressFor(sessionId: string, cwd: string | undefined, path: string): string {
  const normalized = path.replace(/\\/g, '/');
  if (!isAbsoluteWorkspacePath(normalized)) return sessionFileAddress(sessionId, normalized);
  const root = cwd === undefined ? '' : cwd.replace(/\\/g, '/').replace(/\/+$/, '');
  if (root !== '' && normalized === root) return sessionFileAddress(sessionId, '');
  if (root !== '' && normalized.startsWith(`${root}/`)) return sessionFileAddress(sessionId, normalized.slice(root.length + 1));
  return sessionFileAddress(sessionId, normalized);
}

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/u;
const WINDOWS_ABSOLUTE = /^[A-Za-z]:[/\\]/;
const URI_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/u;

/**
 * Resolve one authored Markdown image destination to an absolute workspace
 * file path: absolute paths pass through, relative paths join the session cwd
 * the way native Chat's resolveWorkspacePath does, and everything that names
 * no workspace file (remote URLs, fragments, control characters) returns
 * undefined.
 */
export function resolveImagePath(cwd: string | undefined, url: string): string | undefined {
  let decoded = url;
  try { decoded = decodeURIComponent(url); } catch { /* keep the authored text */ }
  const trimmed = decoded.trim();
  if (trimmed === '' || trimmed.startsWith('#') || CONTROL_CHARS.test(trimmed)) return undefined;
  // A scheme means a URL — except a Windows drive letter, which names a file.
  if (URI_SCHEME.test(trimmed) && !WINDOWS_ABSOLUTE.test(trimmed)) return undefined;
  if (trimmed.startsWith('//')) return undefined;
  const normalized = trimmed.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '');
  if (isAbsoluteWorkspacePath(normalized)) return normalized;
  if (cwd === undefined || cwd === '') return undefined;
  return `${cwd.replace(/\\/g, '/').replace(/\/+$/, '')}/${normalized}`;
}

/**
 * Absolute URL on the host file route (`api/file?path=…`) for one workspace
 * path, mirroring the native Chat attachment resolver: the base must be
 * http(s) or the app scheme, and the path absolute, UNC-free and free of
 * control characters.
 */
export function fileMediaUrl(base: string | undefined, path: string): string | undefined {
  if (base === undefined || base === '') return undefined;
  if (!/^https?:/u.test(base) && !base.startsWith('dsh-app://app/')) return undefined;
  if (!isAbsoluteWorkspacePath(path) || path.startsWith('//') || CONTROL_CHARS.test(path)) return undefined;
  return new URL(`api/file?path=${encodeURIComponent(path)}`, base).href;
}

/** Structural view of the optional host services, read through ctx.get at call time. */
export interface HostServices {
  sidebarRight?: { openResource(address: string): void } | undefined;
  uiConversation?: { imageUrl(sessionId: string, attachment: ImageAttachmentRef): Promise<string> } | undefined;
  uiWorkspace?: { openSession(target: string): void } | undefined;
  chatFileMentions?: {
    forClosing(owner: { turn: TurnLocation; seq: number; openFile: (path: string) => void }, sessionId: string): MarkdownFileMentions | undefined;
  } | undefined;
}

export interface HostFallbacks {
  cwd: () => string | undefined;
  openWithSystem?: (path: string) => Promise<void>;
  readAttachment?: (attachment: ImageAttachmentRef) => Promise<{ data: Uint8Array; mediaType: string }>;
  fork: (atSeq: number) => Promise<string>;
}

export interface ReaderHost {
  openFile(path: string): Promise<void>;
  imageUrl(attachment: ImageAttachmentRef): Promise<string>;
  fork(atSeq: number): Promise<void>;
  fileMentions(turn: TurnLocation, seq: number): MarkdownFileMentions | undefined;
  dispose(): void;
}

export function createReaderHost(sessionId: string, services: () => HostServices, fallbacks: HostFallbacks): ReaderHost {
  const owned = new Map<string, Promise<string>>();
  const urls: string[] = [];
  const openFile = async (path: string): Promise<void> => {
    const sidebar = services().sidebarRight;
    if (sidebar) { sidebar.openResource(fileAddressFor(sessionId, fallbacks.cwd(), path)); return; }
    if (fallbacks.openWithSystem) return fallbacks.openWithSystem(path);
    throw new Error('宿主未提供文件打开能力。');
  };
  return {
    openFile,
    imageUrl(attachment) {
      const conversation = services().uiConversation;
      if (conversation) return conversation.imageUrl(sessionId, attachment);
      const read = fallbacks.readAttachment;
      if (!read) return Promise.reject(new Error('宿主未提供图片读取能力。'));
      const cached = owned.get(attachment.attachmentId);
      if (cached) return cached;
      const pending = read(attachment).then(result => {
        if (!IMAGE_TYPES.has(result.mediaType)) throw new Error('Unsupported image media type');
        const url = URL.createObjectURL(new Blob([Uint8Array.from(result.data)], { type: result.mediaType }));
        urls.push(url);
        return url;
      });
      pending.catch(() => { owned.delete(attachment.attachmentId); });
      owned.set(attachment.attachmentId, pending);
      return pending;
    },
    async fork(atSeq) {
      const child = await fallbacks.fork(atSeq);
      services().uiWorkspace?.openSession(child);
    },
    fileMentions(turn, seq) {
      return services().chatFileMentions?.forClosing({ turn, seq, openFile: path => { void openFile(path).catch(() => {}); } }, sessionId);
    },
    dispose() {
      for (const url of urls.splice(0)) URL.revokeObjectURL(url);
      owned.clear();
    },
  };
}
