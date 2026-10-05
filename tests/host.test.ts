import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { TurnLocation } from '@deepseek-ai/dsh-client-ui-conversation/client';
import { createReaderHost, fileAddressFor, sessionFileAddress, type HostServices } from '../src/client/host.ts';

test('file addresses match the native dsh-resource spelling', () => {
  assert.equal(sessionFileAddress('s1', 'src/a.ts'), 'dsh-resource://file/session/s1/src/a.ts');
  assert.equal(sessionFileAddress('s1', './src/a.ts'), 'dsh-resource://file/session/s1/src/a.ts');
  assert.equal(sessionFileAddress('s1', 'src\\a b.ts'), 'dsh-resource://file/session/s1/src/a%20b.ts');
  assert.equal(sessionFileAddress('s 1', 'x'), 'dsh-resource://file/session/s%201/x');
  assert.equal(fileAddressFor('s1', 'D:\\repo', 'D:\\repo\\src\\x.ts'), 'dsh-resource://file/session/s1/src/x.ts');
  assert.equal(fileAddressFor('s1', '/home/u/repo/', '/home/u/repo'), 'dsh-resource://file/session/s1/');
  assert.equal(fileAddressFor('s1', 'D:\\repo', 'C:\\other\\f.md'), 'dsh-resource://file/session/s1/C:/other/f.md');
  assert.equal(fileAddressFor('s1', undefined, 'notes/todo.md'), 'dsh-resource://file/session/s1/notes/todo.md');
  assert.equal(fileAddressFor('s1', 'D:\\repo', '\\\\srv\\share\\f'), 'dsh-resource://file/session/s1///srv/share/f');
});

function fallbacks(overrides: Partial<Parameters<typeof createReaderHost>[2]> = {}) {
  return { cwd: () => 'D:\\repo', fork: async (_seq: number) => 'child-1', ...overrides };
}

test('openFile prefers the sidebar preview and falls back to the system opener', async () => {
  const opened: string[] = [];
  const system: string[] = [];
  const withSidebar = createReaderHost('s1', () => ({ sidebarRight: { openResource: (address: string) => { opened.push(address); } } }), fallbacks({ openWithSystem: async path => { system.push(path); } }));
  await withSidebar.openFile('D:\\repo\\README.md');
  assert.deepEqual(opened, ['dsh-resource://file/session/s1/README.md']);
  assert.deepEqual(system, []);
  const withoutSidebar = createReaderHost('s1', () => ({}), fallbacks({ openWithSystem: async path => { system.push(path); } }));
  await withoutSidebar.openFile('README.md');
  assert.deepEqual(system, ['README.md']);
  const neither = createReaderHost('s1', () => ({}), fallbacks());
  await assert.rejects(neither.openFile('README.md'), /宿主未提供文件打开能力/);
});

test('imageUrl uses the session image cache, then owned blob URLs with a media-type gate', async () => {
  const attachment = { attachmentId: 'a1', mediaType: 'image/png' } as never;
  const cached = createReaderHost('s1', () => ({ uiConversation: { imageUrl: async () => 'blob:cached' } }), fallbacks());
  assert.equal(await cached.imageUrl(attachment), 'blob:cached');
  let reads = 0;
  const owned = createReaderHost('s1', () => ({}), fallbacks({ readAttachment: async () => { reads++; return { data: new Uint8Array([1, 2, 3]), mediaType: 'image/png' }; } }));
  const first = await owned.imageUrl(attachment);
  const second = await owned.imageUrl(attachment);
  assert.match(first, /^blob:/);
  assert.equal(first, second);
  assert.equal(reads, 1);
  owned.dispose();
  const rejected = createReaderHost('s1', () => ({}), fallbacks({ readAttachment: async () => ({ data: new Uint8Array([1]), mediaType: 'text/html' }) }));
  await assert.rejects(rejected.imageUrl(attachment), /Unsupported image media type/);
  const missing = createReaderHost('s1', () => ({}), fallbacks());
  await assert.rejects(missing.imageUrl(attachment), /宿主未提供图片读取能力/);
});

test('fork opens the child session when the workspace navigator exists', async () => {
  const forked: number[] = [];
  const opened: string[] = [];
  const host = createReaderHost('s1', () => ({ uiWorkspace: { openSession: (id: string) => { opened.push(id); } } }), fallbacks({ fork: async seq => { forked.push(seq); return 'child-9'; } }));
  await host.fork(88);
  assert.deepEqual(forked, [88]);
  assert.deepEqual(opened, ['child-9']);
  const headless = createReaderHost('s1', () => ({}), fallbacks());
  await headless.fork(88);
});

test('file mentions delegate to the deliverables service and are absent without it', () => {
  const turn = { turn: 3 } as unknown as TurnLocation;
  const calls: unknown[] = [];
  const services: HostServices = { chatFileMentions: { forClosing: (owner, sessionId) => { calls.push([owner.turn, owner.seq, sessionId]); return { resolve: () => undefined }; } } };
  const host = createReaderHost('s1', () => services, fallbacks());
  assert.ok(host.fileMentions(turn, 88));
  assert.deepEqual(calls, [[turn, 88, 's1']]);
  assert.equal(createReaderHost('s1', () => ({}), fallbacks()).fileMentions(turn, 88), undefined);
});
