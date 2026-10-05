import type { Context } from '@deepseek-ai/cordis';
import { resolveWorkspacePath } from './path-utils.js';
import type { SessionId } from '@deepseek-ai/dsh-session/types';
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type {} from '@deepseek-ai/dsh-client-locale/client';
import type {} from '@deepseek-ai/dsh-api-job-controller/client';
import { Reader } from './Reader.js';
import { createReaderStore } from './store.js';
import { installReaderEntry } from './entry.js';
import { startCompat } from './compat/index.js';
import type { ReaderInjected } from './types.js';

export type { ReaderBlockOwner } from './types.js';
export const name = 'dsh-clearview-client';
// 'remote' 是 0.1.2 打开文件 / 列目录的通道（0.1.1 走 workspaces 服务，用不到但
// 两版都提供该服务，注入无害）。
export const inject = ['slots', 'sessions', 'workspaces', 'remote', 'locale', 'jobs'];

export function apply(ctx: Context): void {
  startCompat(ctx);
  const store = createReaderStore();
  const faces = new Map<SessionId, ReaderInjected>();
  ctx.effect(() => () => { faces.clear(); });
  ctx.slots.inject('conversation.view', function* () {
    yield ctx.slots.register({
    name: 'conversation.view',
    id: 'reader',
    order: -5,
    label: () => '阅读',
    locale: 'conversation',
    children: { 'dsh-clearview.block': { kind: 'chain', scope: 'session' } },
    store,
    inject: (sessionId: SessionId): ReaderInjected => {
      const existing = faces.get(sessionId);
      if (existing) return existing;
      const session = () => {
        const current = ctx.sessions.binding(sessionId)?.session;
        if (!current) throw new Error('阅读页对应的会话已关闭。');
        return current;
      };
      const face: ReaderInjected = {
        jobsSource: ctx.jobs.state,
        watchJobs: () => ctx.jobs.watchRows(sessionId),
        contextT: ctx.locale.bind('chat'),
        loadOlder: async () => { await session().loadOlder(); },
        loadImage: async attachment => {
          const receipt = await session().readAttachment(attachment.attachmentId);
          if (!receipt.ok) throw new Error(receipt.error.message);
          return { data: Uint8Array.from(receipt.value.data), mediaType: receipt.value.attachment.mediaType };
        },
        openFile: path => {
          // 0.1.1：workspaces 服务有 openPath。0.1.2 的 workspaces 服务不再携带
          // 打开能力，改走 session 远端 openWorkspacePath（与原生对话视图同一打开器）。
          const cwd = ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd;
          const workspaces = ctx.workspaces as { openPath?: (path: string) => Promise<void> } | undefined;
          if (typeof workspaces?.openPath === 'function') return workspaces.openPath(resolveWorkspacePath(cwd, path));
          const remote = (ctx as unknown as { remote?: { session?: { openWorkspacePath?: (input: { path: string }) => Promise<{ ok: boolean; error?: { message: string } }> } } }).remote;
          const open = remote?.session?.openWorkspacePath;
          if (typeof open !== 'function') throw new Error('宿主未提供文件打开能力。');
          return (async () => {
            const result = await open.call(remote!.session, { path: resolveWorkspacePath(cwd, path) });
            if (!result.ok) throw new Error(result.error?.message ?? '路径打开失败。');
          })();
        },
        listDirNames: async path => {
          // 目录条目名集合（存在性校准用）。0.1.1：workspaces.listDirectory；
          // 0.1.2：directoryPicker 远端（同一浏览能力，不同挂载面）。
          const cwd = ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd;
          const resolved = resolveWorkspacePath(cwd, path);
          const workspaces = ctx.workspaces as {
            listDirectory?: (path: string, signal?: AbortSignal) => Promise<{ entries: readonly { name: string }[] }>;
          } | undefined;
          if (typeof workspaces?.listDirectory === 'function') {
            const listing = await workspaces.listDirectory(resolved);
            return new Set(listing.entries.map(entry => entry.name));
          }
          type PickerResult = { ok: boolean; value?: { entries: readonly { name: string }[] }; error?: { message: string } };
          type Picker = { list?: (path: string, signal?: AbortSignal) => Promise<PickerResult> };
          const remote = (ctx as unknown as { remote?: { directoryPicker?: Picker } }).remote;
          const list = remote?.directoryPicker?.list;
          if (typeof list !== 'function') throw new Error('宿主未提供目录列取能力。');
          const result = await list.call(remote!.directoryPicker, resolved);
          if (!result.ok) throw new Error(result.error?.message ?? '目录列取失败。');
          return new Set(result.value!.entries.map(entry => entry.name));
        },
      };
      faces.set(sessionId, face);
      return face;
    },
    }, Reader);
    yield installReaderEntry(ctx);
  });
}
