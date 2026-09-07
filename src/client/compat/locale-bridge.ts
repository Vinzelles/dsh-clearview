/**
 * Locale 兼容桥（0.1.1 ↔ 0.1.2）。
 *
 * 0.1.2 的 fold-product 重构把上下文注入行从 ui-conversation 迁进 ui-chat，一批
 * `message.context*` / `message.unknownBlock` / `json.truncated` 词典键随之从
 * `'conversation'` NS 迁到 ui-chat 的 `'chat'` NS。阅读页的 `t` seat 绑定的是注册
 * 时声明的 `'conversation'` NS——0.1.2 上这些键查不到，seat 按缺失约定回显键名
 * （用户看到的就是「message.contextInjection」）。
 *
 * 本桥按「回显即缺失」检测：seat 命中（0.1.1 的 conversation NS / 宿主其他键）
 * 时原样透传零开销；仅对回显的键回退到内置中文词典（文案与原生 0.1.2 zh 词典逐
 * 条一致），`{param}` 模板就地插值。词典之外的真实未知键仍原样回显，不吞错。
 */

/** seat 缺失（键名回显）时使用的中文回退词典；键集 = 阅读页实际消费的迁移键。 */
const FALLBACK_ZH: Readonly<Record<string, string>> = {
  'message.contextInjection': '上下文注入',
  'message.contextRecall': '跨会话召回',
  'message.unknownBlock': '未知内容块',
  'message.context.instructions.loaded': '已载入',
  'message.context.instructions.added': '已新增',
  'message.context.instructions.updated': '已更新',
  'message.context.instructions.removed': '已移除',
  'message.context.catalog.replaced': '替换目录',
  'message.context.catalog.more': '…还有 {count} 条',
  'message.context.snapshot.supersedes': '取代先前的快照',
  'message.context.relay.from': '来自会话 {session}',
  'message.context.recall.counts': '保留 {retained} 条 · 省略 {omitted} 条',
  'message.context.recall.truncated': '已截断',
  'json.truncated': '… 已截断，共 {total} 字符',
};

function interpolate(template: string, params: Record<string, unknown> | undefined): string {
  if (params === undefined) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

/**
 * 包装一个 NS 绑定的 translate seat：命中透传，回显键名时查回退词典。
 * 泛型保持调用面的键域与返回类型不变，包装对下游完全透明。
 */
export function bridgeLocaleSeat<K extends string>(
  t: (key: K, params?: Record<string, unknown>) => string,
): (key: K, params?: Record<string, unknown>) => string {
  return (key, params) => {
    const value = t(key, params);
    if (value !== key) return value;
    const fallback = FALLBACK_ZH[key];
    if (fallback === undefined) return value;
    return interpolate(fallback, params);
  };
}
