/**
 * 阅读视图兼容层汇总（原 dsh-custom-patcher patches/client 下与 better-display
 * 配套的 13 个补丁内聚于此）：
 *   - styles.ts               7 个 CSS → 运行时注入 <style id="dsh-better-display-compat">
 *   - composer-readability.ts 画布色变量 + 统计行毛玻璃标记
 *   - memory-tail-keep.ts     收尾总结被折叠吞掉时自动展开执行过程
 *   - perf-guard.ts           内容规模超阈值点亮 data-dshcp-heavy 降级动效
 *   - reasoning-catchup.ts    思考卡片自动跟随追赶
 *   - rewind-bridge.ts        dsh-rewind 撤回/复制按钮兼容桥
 *   - turn-metrics-footer.ts  补回轮次统计行
 *
 * 由插件客户端 apply(ctx) 启动（startCompat），生命周期挂插件 fiber：
 * 插件卸载时各模块经 ctx.effect 自动清理。
 */
import { injectCompatStyles } from './styles.js';
import * as composerReadability from './composer-readability.js';
import * as memoryTailKeep from './memory-tail-keep.js';
import * as perfGuard from './perf-guard.js';
import * as reasoningCatchup from './reasoning-catchup.js';
import * as rewindBridge from './rewind-bridge.js';
import * as turnMetricsFooter from './turn-metrics-footer.js';

/**
 * 可重入守卫：宿主 boot handoff/HMR 可能对插件 apply() 触发两次；若不先销毁
 * 上一实例，观察者与定时器会翻倍（实测日志里每个模块 applied ×2）。第二次
 * startCompat 先 dispose 全部旧资源再重建。
 */
let activeDispose: (() => void) | null = null;

export function startCompat(ctx: any): void {
  if (typeof document === 'undefined') return;
  if (activeDispose) { try { activeDispose(); } catch { /* 吞错 */ } activeDispose = null; }
  injectCompatStyles();
  const cleanups: Array<() => void> = [];
  const patches: Array<[string, (ctx: any) => (() => void) | void]> = [
    ['composer-readability', composerReadability.apply],
    ['memory-tail-keep', memoryTailKeep.apply],
    ['perf-guard', perfGuard.apply],
    ['reasoning-catchup', reasoningCatchup.apply],
    ['rewind-bridge', rewindBridge.apply],
    ['turn-metrics-footer', turnMetricsFooter.apply],
  ];
  for (const [name, fn] of patches) {
    try {
      const cleanup = fn(ctx);
      if (typeof cleanup === 'function') cleanups.push(cleanup);
    } catch (err) {
      try { console.warn(`[dsh-better-display:compat] ${name} failed: ${String(err)}`); } catch { /* 忽略 */ }
    }
  }
  const dispose = () => { for (const c of cleanups) { try { c(); } catch { /* 单个失败不阻塞其余 */ } } };
  activeDispose = dispose;
  if (typeof ctx?.effect === 'function') ctx.effect(() => dispose);
}
