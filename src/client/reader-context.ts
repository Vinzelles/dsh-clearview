import { createContext, useContext } from 'react';
import type { TurnLocation } from '@deepseek-ai/dsh-client-ui-conversation/client';
import type { MarkdownFileMentions } from './markdown/render.js';

/** Host actions and the motion switch, provided once by Reader for every row. */
export interface ReaderActions {
  motion: boolean;
  openFile?: (path: string) => void;
  fork?: (atSeq: number) => Promise<void>;
  fileMentions?: (turn: TurnLocation, seq: number) => MarkdownFileMentions | undefined;
  inspectCall?: (callId: string) => void;
  showInChat?: (focus: string) => void;
}

export const ReaderActionsContext = createContext<ReaderActions>({ motion: false });

export function useReaderActions(): ReaderActions {
  return useContext(ReaderActionsContext);
}
