/**
 * 0.1.2 必传文案的 primitives 的阅读页绑定面（primitive-labels 词典 + 包装）。
 *
 * 版本差异：
 *   - TerminalBlock / MarkdownText：0.1.1 有 labels 形参（部分合并/无此概念），
 *     0.1.2 必传完整集合——包装内合并默认词典后透传。
 *   - ReadBlock / DiffBlock / SearchBlock / WebBlock：0.1.1 根本没有 labels 形参
 *     （TS 会拒绝多余 prop），0.1.2 必传——包装内部以 spread 附加（spread 不触发
 *     多余属性检查），0.1.1 运行时忽略该 prop。
 *   - JsonBlock：0.1.1 有内置 defaultTruncatedLabel，0.1.2 删除并改为必传——
 *     两版形参同名（0.1.1 可选/0.1.2 必填），直传即可。
 * 词典引用稳定（模块级常量），不破坏 0.1.1 TerminalBlock 的 useMemo([labels])。
 */
import type { ComponentProps, ReactNode } from 'react';
import { DiffBlock, JsonBlock, ReadBlock, SearchBlock, TerminalBlock, WebBlock, MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives';
import { DIFF_LABELS, JSON_TRUNCATED, MARKDOWN_LABELS, READ_LABELS, SEARCH_LABELS, TERMINAL_LABELS, WEB_LABELS } from './primitive-labels.js';

type ReadBlockProps = ComponentProps<typeof ReadBlock>;
type DiffBlockProps = ComponentProps<typeof DiffBlock>;
type SearchBlockProps = ComponentProps<typeof SearchBlock>;
type WebBlockProps = ComponentProps<typeof WebBlock>;
type TerminalBlockProps = ComponentProps<typeof TerminalBlock>;
type MarkdownTextProps = ComponentProps<typeof MarkdownText>;
type JsonBlockProps = ComponentProps<typeof JsonBlock>;
type WithoutLabels<T> = T extends unknown ? Omit<T, 'labels'> : never;

/**
 * 原始 JSON 记录块：绑定截断脚注。0.1.2 把 0.1.1 内置的 defaultTruncatedLabel
 * 删成了必传 `truncatedLabel`（>20k 字符展开即无守卫调用）；0.1.1 本就接受该
 * 可选 prop，直传两版安全。调用点不再各自记得传。
 */
export function JsonBlockL({ truncatedLabel, ...props }: Omit<JsonBlockProps, 'truncatedLabel'> & { truncatedLabel?: JsonBlockProps['truncatedLabel'] }): ReactNode {
  return <JsonBlock {...props} truncatedLabel={truncatedLabel ?? JSON_TRUNCATED} />;
}

/** 读文件卡：始终携带完整 READ_LABELS。 */
export function ReadBlockL(props: Omit<ReadBlockProps, 'labels'>): ReactNode {
  return <ReadBlock {...props} labels={READ_LABELS} />;
}

/** 差异卡：始终携带完整 DIFF_LABELS。 */
export function DiffBlockL(props: Omit<DiffBlockProps, 'labels'>): ReactNode {
  return <DiffBlock {...props} labels={DIFF_LABELS} />;
}

/** 搜索卡：始终携带完整 SEARCH_LABELS。 */
export function SearchBlockL(props: WithoutLabels<SearchBlockProps>): ReactNode {
  return <SearchBlock {...props} labels={SEARCH_LABELS} />;
}

/** Web 卡：始终携带完整 WEB_LABELS。 */
export function WebBlockL(props: WithoutLabels<WebBlockProps>): ReactNode {
  return <WebBlock {...props} labels={WEB_LABELS} />;
}

/** 终端卡：默认完整 TERMINAL_LABELS，调用方可用 labels 覆盖个别字段（如失败态 done）。 */
export function TerminalBlockL({ labels, ...props }: Omit<TerminalBlockProps, 'labels'> & { labels?: Partial<TerminalBlockProps['labels']> }): ReactNode {
  return <TerminalBlock {...props} labels={{ ...TERMINAL_LABELS, ...labels }} />;
}

/** Markdown 正文（0.1.2 labels 必传；0.1.1 该 prop 不存在，运行时忽略）。 */
export function MarkdownTextL(props: Omit<MarkdownTextProps, 'labels'>): ReactNode {
  return <MarkdownText {...props} labels={MARKDOWN_LABELS} />;
}
