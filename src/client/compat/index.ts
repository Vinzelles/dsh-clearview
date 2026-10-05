/**
 * 阅读视图兼容层汇总（原 dsh-custom-patcher patches/client 下与 clearview
 * 配套的 12 个补丁内聚于此）：
 *   - styles.ts               7 个 CSS → 运行时注入 <style id="dsh-clearview-compat">
 *   - memory-tail-keep.ts     收尾总结被折叠吞掉时自动展开执行过程
 *   - perf-guard.ts           内容规模超阈值点亮 data-dshcp-heavy 优化离屏布局
 *   - rewind-bridge.ts        dsh-rewind 撤回/复制按钮兼容桥
 *   - （统计行与 composer 标记已于 0.2.0 移除：统计改由 TurnFooter 读 turn-tail 公开数据）
 *
 * 思考跟随追赶（原 reasoning-catchup.ts）已于 0.1.2 移除：外部观察者与插件
 * 步进两个滚动管理器竞争同一轨道，滑移被插件下一步掐断，正是「滚动反弹」的
 * 来源。0.1.3 起跟随改为 ReasoningRow 自身的连续速度匹配控制器
 * （followAdvance），追赶内聚于逐帧循环，无需任何外围补偿。
 *
 * 由插件客户端 apply(ctx) 启动（startCompat），生命周期挂插件 fiber：
 * 插件卸载时各模块经 ctx.effect 自动清理。
 */
import { injectCompatStyles } from './styles.js';
import * as memoryTailKeep from './memory-tail-keep.js';
import * as perfGuard from './perf-guard.js';
import * as rewindBridge from './rewind-bridge.js';

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
    ['memory-tail-keep', memoryTailKeep.apply],
    ['perf-guard', perfGuard.apply],
    ['rewind-bridge', rewindBridge.apply],
  ];
  for (const [name, fn] of patches) {
    try {
      const cleanup = fn(ctx);
      if (typeof cleanup === 'function') cleanups.push(cleanup);
    } catch (err) {
      try { console.warn(`[dsh-clearview:compat] ${name} failed: ${String(err)}`); } catch { /* 忽略 */ }
    }
  }
  const dispose = () => { for (const c of cleanups) { try { c(); } catch { /* 单个失败不阻塞其余 */ } } };
  activeDispose = dispose;
  if (typeof ctx?.effect === 'function') ctx.effect(() => dispose);
}
