/**
 * 0.1.2 primitives 的本地化契约修复：这批展示组件（JsonTree / TerminalBlock /
 * ReadBlock / DiffBlock / SearchBlock / WebBlock / MarkdownText）在 0.1.1 里自带
 * 内置默认文案（labels 可选），0.1.2 起一律改为必传 `labels`（原生各包经
 * xxxBlockLabels(t) 提供），缺失时在渲染期直接 TypeError——而阅读页把这些组件
 * 全放在折叠区内懒挂载，折叠无事、点开即被 BlockBoundary 吞成
 * 「此内容暂时无法在阅读页显示」。本模块提供与原生 0.1.2 zh 词典逐条一致的
 * labels 常量（模块级常量保证引用稳定，0.1.1 的 useMemo([labels]) 不空转）。
 *
 * 版本兼容：0.1.1 对 labels 的处理是 `{...DEFAULT, ...labels}` 合并（JsonTree/
 * TerminalBlock）或忽略（其余组件本来没有该形参），传入完整集合在两版都安全。
 * 文案与阅读页其余硬编码中文一致（阅读页不做英文面）。
 */

/** 复制成功/复制 等公共词，与 dsh-client-locale 公共词典一致。 */
const COPY = '复制';
const COPIED = '复制成功';
const COLLAPSE = '收起';

/** JsonTree 复制菜单与展开态 aria 文案（原生 chat/公共词典）。 */
export const JSON_TREE_LABELS = {
  copyValue: '复制值',
  copyJson: '复制 JSON',
  copyPath: '复制属性路径',
  copyPrettyJson: '复制格式化 JSON',
  copyCompactJson: '复制紧凑 JSON',
  copied: COPIED,
  copyFailed: '复制失败',
  collapseNode: '收起 JSON 节点',
  expandNode: '展开 JSON 节点',
  copyButtonTitle: (action: string) => `${action}；右键点击可选择复制方式`,
} as const;

/** Markdown 代码块复制与脚注 chrome（0.1.2 MarkdownText.labels）。 */
export const MARKDOWN_LABELS = {
  code: { copyLabel: COPY, copiedLabel: COPIED },
  footnotes: '脚注',
} as const;

/**
 * JsonBlock 的截断脚注（0.1.2 必传 truncatedLabel）。0.1.1 内置同名默认
 * （defaultTruncatedLabel），0.1.2 删除默认后在 useMemo 里无守卫直调
 * `truncatedLabel(s.length)`（正文超 20000 字符且展开时）——缺失即
 * TypeError。文案与 0.1.1 内置默认及原生 zh 词典 json.truncated 逐字一致；
 * 模块级常量引用稳定，不触发 0.1.1/0.1.2 的 useMemo([truncatedLabel]) 重算。
 */
export const JSON_TRUNCATED = (total: number): string => `… 已截断，共 ${total} 字符`;

/** 终端卡（terminal.* 词典；fold 文案含单位，与原生 expandRest 模板一致）。 */
export const TERMINAL_LABELS = {
  signal: (signal: string) => `信号 ${signal}`,
  exitCode: (code: number) => `退出码 ${code}`,
  running: '运行中',
  failed: '失败',
  done: '已完成',
  copy: COPY,
  copied: COPIED,
  noOutput: '无输出',
  collapseAria: '收起输出',
  collapse: COLLAPSE,
  expandAria: (hidden: number) => `展开其余 ${hidden} 行输出`,
  expand: (hidden: number) => `… 其余 ${hidden} 行`,
} as const;

/** 读文件卡（read.* 词典）。 */
export const READ_LABELS = {
  window: (shown: number, total: number) => `显示 ${shown} / ${total} 行`,
  copy: COPY,
  copied: COPIED,
  collapseAria: '收起内容',
  expandAria: (count: number) => `展开其余 ${count} 行`,
  collapse: COLLAPSE,
  expand: (count: number) => `… 其余 ${count} 行`,
} as const;

/** 差异卡（diff.* 词典；one/other 同形，单数复数一个函数）。 */
export const DIFF_LABELS = {
  copy: COPY,
  copied: COPIED,
  collapseAria: '收起差异',
  expandAria: (count: number) => `展开其余 ${count} 行差异`,
  collapse: COLLAPSE,
  expand: (count: number) => `… 其余 ${count} 行`,
  files: (count: number) => `${count} 个文件`,
} as const;

/** 搜索卡（search.* 词典；摘要区分截断态）。 */
export const SEARCH_LABELS = {
  pathsSummary: (shown: number, total: number, truncated: boolean) =>
    truncated ? `显示 ${shown} / 共 ${total} 个路径` : `${shown} 个路径`,
  matchesSummary: (shown: number, total: number, files: number, truncated: boolean) =>
    truncated ? `显示 ${shown} / 共 ${total} 处匹配 · ${files} 个文件` : `${shown} 处匹配 · ${files} 个文件`,
  copy: COPY,
  copied: COPIED,
  noResults: '无结果',
  collapseAria: '收起结果',
  expandAria: (count: number) => `展开其余 ${count} 行结果`,
  collapse: COLLAPSE,
  expand: (count: number) => `… 其余 ${count} 行`,
} as const;

/** Web 卡（web.* 词典；markdown 子集供来源摘要内的代码引用）。 */
export const WEB_LABELS = {
  noResults: '未找到结果',
  sourcesTruncated: '来源列表已截断',
  http: 'HTTP',
  contentTruncated: '内容已截断',
  markdown: MARKDOWN_LABELS,
} as const;
