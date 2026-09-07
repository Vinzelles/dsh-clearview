import { defineStore } from '@deepseek-ai/dsh-client-runtime/client';
import type { EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client';

export interface ReaderState { expanded: Record<string, boolean>; motion: boolean; collapseThinking: boolean }
type ReaderActions = {
  setExpanded: (draft: ReaderState, key: string, value: boolean) => void;
  setMotion: (draft: ReaderState, value: boolean) => void;
  setCollapseThinking: (draft: ReaderState, value: boolean) => void;
};

// The store engine specifier is the one seam both supported cores answer:
// 0.1.1 ships dsh-client-runtime/client as a real preloaded module, and 0.1.2
// removed the package but keeps a compat seed of the same name that spreads the
// dsh-client-store engine (same defineStore contract). Never switch this to
// `@deepseek-ai/dsh-client-store` — that specifier does not exist on 0.1.1.
export function createReaderStore(): EngineStoreHandle<ReaderState, ReaderActions> {
  return defineStore({
    init: (): ReaderState => ({ expanded: {}, motion: true, collapseThinking: false }),
    persist: 'dsh.reader.v1',
    actions: {
      setExpanded: (draft, key: string, value: boolean) => { draft.expanded[key] = value; },
      setMotion: (draft, value: boolean) => { draft.motion = value; },
      setCollapseThinking: (draft, value: boolean) => { draft.collapseThinking = value; },
    },
  });
}
