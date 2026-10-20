import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { MarkdownText } from 'fixture-source/markdown/MarkdownText.tsx';
import readerCss from 'fixture-source/Reader.module.css';

// Real Markdown renderer and host React; all content is synthetic.
const failures: string[] = [];
const check = (value: boolean, message: string) => { if (!value) failures.push(message); };
const host = document.createElement('div');
host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;overflow:auto;padding:32px 24px;box-sizing:border-box;background:white';
document.body.append(host);
const root = createRoot(host);
const table = '| 位置 | 改动 |\n| --- | --- |\n| openai_tools.py:98 | 补齐缺失字段，保留已有数据。 |\n| openai_tools.py:166 | 验证请求参数与实际结果。 |';
const wide = '| 文件 | 读取 | 编辑 | 验证 | 说明 |\n| --- | --- | --- | --- | --- |\n| src/components/HistoryPanel.vue | 已完成 | 已完成 | 已通过 | 保留完整正文与动画 |';
const three = '| 路径 | 状态 | 最后改动 |\n| --- | --- | --- |\n| .agents/skills/project-architecture/SKILL.md | 现行版，保持更新 | `04ff1e05` 2026-10-12 |\n| .claude/skills/project-architecture/SKILL.md | 陈旧快照 | `dba05c80` 2026-10-05（落后 12 个提交） |';
const documents = [
  ['three-column', three],
  ['paragraph', `${table}\n\n语义安全性：保留正文间距，便于继续阅读。`],
  ['wide', `${wide}\n\n宽表格后的正文仍然有独立间距。`],
  ['list', `${table}\n\n- 验证完成\n- 结果一致`],
  ['terminal', table],
  ['header-only', '| 位置 | 状态 |\n| --- | --- |'],
  ['quoted', `> ${table.replaceAll('\n', '\n> ')}\n>\n> 引用内的正文同样保持间距。`],
  ['quoted-terminal', `> ${table.replaceAll('\n', '\n> ')}`],
  ['nested-quoted-terminal', `> > ${table.replaceAll('\n', '\n> > ')}`],
] as const;
function frameFacts(wrapper: HTMLElement) {
  const table = wrapper.querySelector('table')!, lastRow = table.rows[table.rows.length - 1]!;
  const cells = [...lastRow.cells];
  const own = getComputedStyle(wrapper), inner = getComputedStyle(table);
  return { wrapperBorder: own.borderBottomWidth, wrapperPadding: own.paddingBottom, tableBorder: inner.borderBottomWidth,
    tableMargin: inner.marginBottom, tableDisplay: inner.display, lastRowBottom: lastRow.getBoundingClientRect().bottom,
    tableBottom: table.getBoundingClientRect().bottom, wrapperBottom: wrapper.getBoundingClientRect().bottom,
    lastCellBorders: cells.map(cell => getComputedStyle(cell).borderBottomWidth) };
}
function matchingFrameRules() {
  const wrapper = host.querySelector<HTMLElement>('[data-case="three-column"] table')!.parentElement!;
  const elements = [wrapper, wrapper.querySelector('table')!, wrapper.querySelector('tbody tr:last-child td')!];
  const result: string[][] = elements.map(() => []);
  const visit = (rules: CSSRuleList) => { for (const rule of rules) {
    if (rule instanceof CSSStyleRule) elements.forEach((element, index) => {
      try { if (element.matches(rule.selectorText) && /border|margin|padding|display/.test(rule.style.cssText)) result[index]!.push(rule.cssText); } catch { }
    });
    else if ('cssRules' in rule) visit((rule as CSSGroupingRule).cssRules);
  } };
  for (const sheet of document.styleSheets) { try { visit(sheet.cssRules); } catch { } }
  return result;
}
const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
function render(width: number, size: number, streaming: boolean, dark: boolean) {
  document.body.toggleAttribute('data-ds-dark-theme', dark);
  host.style.background = dark ? '#141413' : '#fff';
  flushSync(() => root.render(
    <div className={readerCss.root} data-dsh-clearview="table-spacing-fixture" data-motion="on"
      style={{ width: '100%', maxWidth: width, margin: '0 auto', '--dsh-content-font-size': `${size}px`, fontSize: size } as React.CSSProperties}>
      {documents.map(([name, text]) => <section key={name} data-case={name} style={{ marginBottom: 28 }}>
        <MarkdownText text={text} streaming={streaming} />
      </section>)}
    </div>,
  ));
}
function inspect(label: string) {
  const rows = documents.map(([name]) => {
    const section = host.querySelector<HTMLElement>(`[data-case="${name}"]`)!;
    const wrapper = section.querySelector('table')!.parentElement!;
    const next = wrapper.nextElementSibling;
    const expectedGap = parseFloat(getComputedStyle(wrapper).fontSize) * .75;
    const gap = next ? next.getBoundingClientRect().top - wrapper.getBoundingClientRect().bottom : null;
    const margin = parseFloat(getComputedStyle(wrapper).marginBottom);
    check(next ? gap !== null && Math.abs(gap - expectedGap) <= .5 : margin === 0,
      `${label}/${name}: expected ${next ? expectedGap : 0}px, got ${next ? gap : margin}px`);
    check(wrapper.getBoundingClientRect().width <= section.getBoundingClientRect().width + 1,
      `${label}/${name}: table wrapper exceeds column`);
    const frame = frameFacts(wrapper);
    check(parseFloat(frame.wrapperBorder) === 1 && parseFloat(frame.tableBorder) === 0 && frame.lastCellBorders.every(border => parseFloat(border) === 0),
      `${label}/${name}: expected one wrapper frame and no duplicate terminal edge`);
    check(frame.tableDisplay === 'table' && parseFloat(frame.tableMargin) === 0,
      `${label}/${name}: table adds a separate baseline or margin inside its frame`);
    return { name, gap, expectedGap: next ? expectedGap : 0, margin, overflow: wrapper.scrollWidth - wrapper.clientWidth, frame };
  });
  check(host.scrollWidth <= host.clientWidth + 1, `${label}: page horizontal overflow`);
  return { label, viewport: innerWidth, rows };
}
(window as any).runClearviewPerformance = async () => {
  const cases = [];
  for (const width of [900, 392]) for (const size of [14, 16]) for (const streaming of [false, true]) for (const dark of [false, true]) {
    render(width, size, streaming, dark);
    await document.fonts.ready;
    await frame();
    cases.push(inspect(`${width}/${size}/${streaming ? 'streaming' : 'settled'}/${dark ? 'dark' : 'light'}`));
  }
  return { failures, tableSpacing: { cases }, frameRules: matchingFrameRules() };
};
(window as any).prepareClearviewScreenshot = async (theme: string) => {
  render(900, 14, false, theme === 'dark');
  host.scrollTop = 0;
  await frame();
  return inspect(`${theme}/${innerWidth}`);
};
(window as any).clearviewPerformanceFailures = () => [...failures];
