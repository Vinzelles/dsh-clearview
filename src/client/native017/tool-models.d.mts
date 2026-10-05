import type { ToolCallBlock } from '@deepseek-ai/dsh-client-ui-conversation/client';
import type { ReadBlockProps, DiffBlockProps, SearchBlockProps, TerminalBlockProps, WebBlockProps } from '@deepseek-ai/dsh-client-ui-primitives';
type Without<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export function parsedToolCall(block: ToolCallBlock): { name: string; args: Record<string, unknown> } | null;
export function readCardModel(block: ToolCallBlock, cwd?: string, home?: string): Pick<ReadBlockProps, 'label' | 'lines' | 'totalLines' | 'lang'> | null;
export function diffCardModel(block: ToolCallBlock): { card: Pick<DiffBlockProps, 'diffs'> } | null;
export function searchCardModel(block: ToolCallBlock): { card: Without<SearchBlockProps, 'labels' | 'maxLines' | 'className'>; recovery: string | undefined } | null;
export function webCardModel(block: ToolCallBlock): Without<WebBlockProps, 'labels' | 'className'> | null;
export function terminalCardModel(block: ToolCallBlock, cwd?: string): {
  card: Pick<TerminalBlockProps, 'cwd' | 'output' | 'exitCode' | 'signal' | 'running'>;
  copy: { kind: 'shell'; command: string; description: string | undefined } | { kind: 'terminal-send'; text: string; sessionId: string };
} | null;
