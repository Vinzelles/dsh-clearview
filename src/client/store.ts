import { defineStore } from '@deepseek-ai/dsh-client-runtime/client';
import type { EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client';

export interface ReaderState { expanded: Record<string, boolean>; motion: boolean; collapseThinking: boolean }
type ReaderActions = {
  setExpanded: (draft: ReaderState, key: string, value: boolean) => void;
  setMotion: (draft: ReaderState, value: boolean) => void;
  setCollapseThinking: (draft: ReaderState, value: boolean) => void;
};

export function createReaderStore(): EngineStoreHandle<ReaderState, ReaderActions> {
  return defineStore({
    init: (): ReaderState => ({ expanded: {}, motion: true, collapseThinking: true }),
    persist: 'dsh.reader.v1',
    actions: {
      setExpanded: (draft, key: string, value: boolean) => { draft.expanded[key] = value; },
      setMotion: (draft, value: boolean) => { draft.motion = value; },
      setCollapseThinking: (draft, value: boolean) => { draft.collapseThinking = value; },
    },
  });
}
