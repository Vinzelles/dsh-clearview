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
