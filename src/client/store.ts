import type { EngineStoreHandle } from '@deepseek-ai/dsh-client-store';

export interface ReaderState { expanded: Record<string, boolean>; motion: boolean }
type ReaderActions = {
  setExpanded: (draft: ReaderState, key: string, value: boolean) => void;
  setMotion: (draft: ReaderState, value: boolean) => void;
};

/** 阅读页交给 ui-slots 的 store 句柄（两版内核同形状）。 */
export type ReaderStore = EngineStoreHandle<ReaderState, ReaderActions>;

/**
 * store 引擎在模块表里的两个拼写，新平台优先：0.1.2 删掉了 runtime 包、改为预置
 * `@deepseek-ai/dsh-client-store` 种子，而 0.1.1 只有前者是真实预载模块。两版没有
 * 交集，因此引擎只能在运行时查表，不能靠构建期静态导入。
 */
const STORE_ENGINE_SPECIFIERS = [
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-runtime/client',
] as const;

/** 懒 CJS 工厂作用域内的解析器签名（即构建器 banner 里的 `require`）。 */
type ModuleRequire = (specifier: string) => unknown;

type StoreEngine = typeof import('@deepseek-ai/dsh-client-store');

// 插件 bundle 由 client-modules 以 `factory: (require) => {…}` 包裹执行，这个
// `require` 就是内核模块表本身。构建期静态导入会被提升成一次不可捕获的 bundle
// 级 require（0.1.2 无此模块时整个插件导入失败），所以这里只做类型声明。
declare const require: ModuleRequire | undefined;

/** 取当前作用域的模块表解析器；Node/测试环境没有它时返回 undefined。 */
function moduleRequire(): ModuleRequire | undefined {
  return typeof require === 'function' ? require : undefined;
}

/**
 * 运行时取 store 引擎：逐拼写 try/catch 查表，命中即用。
 * 静态 `import { defineStore }` 无法跨版——bundle 只携带一个写死的 require，而
 * 0.1.2 已删除该包，于是报「missed the module table」并让整个插件导入失败。
 */
function storeEngine(): StoreEngine {
  const resolve = moduleRequire();
  const attempts: string[] = [];
  if (resolve !== undefined) {
    for (const specifier of STORE_ENGINE_SPECIFIERS) {
      try {
        const engine = resolve(specifier) as Partial<StoreEngine> | undefined;
        if (typeof engine?.defineStore === 'function') return engine as StoreEngine;
        attempts.push(`${specifier}: 无 defineStore 导出`);
      } catch (error) {
        attempts.push(`${specifier}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  throw new Error(resolve === undefined
    ? '阅读页取不到模块表解析器（bundle 需在 client-modules 工厂内执行）。'
    : `阅读页在当前内核上找不到 store 引擎：${attempts.join('；')}。`);
}

export function createReaderStore(): ReaderStore {
  return storeEngine().defineStore({
    init: (): ReaderState => ({ expanded: {}, motion: true }),
    persist: 'dsh.reader.v1',
    actions: {
      setExpanded: (draft, key: string, value: boolean) => { draft.expanded[key] = value; },
      setMotion: (draft, value: boolean) => { draft.motion = value; },
    },
  });
}
