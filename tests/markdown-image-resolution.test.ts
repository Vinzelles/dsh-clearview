import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { fileMediaUrl, resolveImagePath } from '../src/client/host.js'
import { MarkdownText } from '../src/client/markdown/MarkdownText.js'

/**
 * 模型正文里的图片目标本来就写在会话 cwd 下（比如 `![x](.perf-results/a.png)`）。
 * 阅读页必须把它解析成宿主文件路由，否则只会退化成 alt 文字——原生对话能看到、
 * 阅读页看不到的那个 bug。
 */

test('relative markdown image paths join the session cwd', () => {
  assert.equal(resolveImagePath('D:\\work\\proj', '.perf-results/a.png'), 'D:/work/proj/.perf-results/a.png')
  assert.equal(resolveImagePath('/home/work/proj', 'docs/b.png'), '/home/work/proj/docs/b.png')
  assert.equal(resolveImagePath('D:\\work\\proj', 'C:\\shots\\c.png'), 'C:/shots/c.png')
  assert.equal(resolveImagePath('D:\\work\\proj', './docs/../a.png'), 'D:/work/proj/docs/../a.png')
})

test('destinations that name no workspace file stay unresolved', () => {
  assert.equal(resolveImagePath(undefined, 'a.png'), undefined)
  assert.equal(resolveImagePath('D:\\work\\proj', 'https://example.test/a.png'), undefined)
  assert.equal(resolveImagePath('D:\\work\\proj', '//host/share/a.png'), undefined)
  assert.equal(resolveImagePath('D:\\work\\proj', '#fragment'), undefined)
  assert.equal(resolveImagePath('D:\\work\\proj', 'data:image/png;base64,AA'), undefined)
  assert.equal(resolveImagePath('D:\\work\\proj', '  '), undefined)
})

test('workspace images address the host file route', () => {
  assert.equal(
    fileMediaUrl('http://127.0.0.1:3100/', 'D:/work/proj/a.png'),
    'http://127.0.0.1:3100/api/file?path=D%3A%2Fwork%2Fproj%2Fa.png',
  )
  assert.equal(fileMediaUrl('http://h/app/', '/w/a.png'), 'http://h/app/api/file?path=%2Fw%2Fa.png')
  // Only网络与 app scheme 的基址能寻址该路由；file:// 与相对路径一律拒绝。
  assert.equal(fileMediaUrl('file:///x/', '/w/a.png'), undefined)
  assert.equal(fileMediaUrl(undefined, '/w/a.png'), undefined)
  assert.equal(fileMediaUrl('http://h/', 'relative.png'), undefined)
})

test('the reader resolves model images instead of dropping them to alt text', () => {
  const mediaUrl = (url: string) => {
    const path = resolveImagePath('D:/work/proj', url)
    return path === undefined ? undefined : fileMediaUrl('http://127.0.0.1:3100/', path)
  }
  const html = renderToStaticMarkup(createElement(MarkdownText, { text: '![cap](.perf-results/a.png)', mediaUrl }))
  assert.match(html, /<img[^>]+src="http:\/\/127\.0\.0\.1:3100\/api\/file\?path=D%3A%2Fwork%2Fproj%2F\.perf-results%2Fa\.png"/)
  assert.match(html, /alt="cap"/)
})

test('without a resolver the renderer keeps the documented alt-text fallback', () => {
  const html = renderToStaticMarkup(createElement(MarkdownText, { text: '![cap](.perf-results/a.png)' }))
  assert.doesNotMatch(html, /<img/)
  assert.match(html, /cap/)
})

test('remote images still render directly and keep the allowlist', () => {
  const mediaUrl = () => undefined
  const html = renderToStaticMarkup(createElement(MarkdownText, { text: '![cap](https://cdn.test/a.png)', mediaUrl }))
  assert.match(html, /<img[^>]+src="https:\/\/cdn\.test\/a\.png"/)
  // 解析器给回非 http(s) 的答案也不得进入 DOM。
  const rejected = renderToStaticMarkup(createElement(MarkdownText, { text: '![cap](.perf-results/a.png)', mediaUrl: () => 'javascript:alert(1)' }))
  assert.doesNotMatch(rejected, /javascript:/)
})
