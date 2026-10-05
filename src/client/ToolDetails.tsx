import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ToolResultNode } from '@deepseek-ai/dsh-client-ui-conversation/client';
import { IconInspectOutlineRegular, JsonTree } from '@deepseek-ai/dsh-client-ui-primitives';
import { readCardModel, diffCardModel, searchCardModel, terminalCardModel, webCardModel } from './native017/tool-models.mjs';
import { DiffBlockL, ReadBlockL, SearchBlockL, TerminalBlockL, WebBlockL } from './native/labeled-blocks.js';
import { JSON_TREE_LABELS } from './native/primitive-labels.js';
import { Blocks } from './Blocks.js';
import { contentBlocks } from './user-content.js';
import { useReaderActions } from './reader-context.js';
import { activitySummary, executionFacts, exitCodeFromOutput } from './tool-activity.js';
import type { ToolActivityEntry, ToolPhase } from './tool-activity.js';
import type { BlockRenderProps } from './types.js';
import css from './ToolDetails.module.css';

type Model = ReturnType<typeof activitySummary>;
const number = new Intl.NumberFormat('zh-CN');
const language = (path: string | undefined) => path?.split('.').at(-1);
const duration = (ms: number) => ms < 1000 ? `${Math.round(ms)} 毫秒` : `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} 秒`;

function generatedInput(content: string, target: string | undefined, preparing: boolean) {
  const lines = content.split('\n').map((text, index) => ({ number: index + 1, text }));
  const visible = preparing ? lines.slice(-12) : lines.slice(0, 1600);
  return <div data-reader-tool-file><p className={css.note}>{preparing ? '正在生成的输入 · 尚未执行 · 末尾 12 行' : '工具输入中的文件内容'}{!preparing && lines.length > visible.length ? ' · 预览前 1,600 行，完整内容在原始数据中' : ''}</p>
    <ReadBlockL label={target ?? '文件内容'} lang={language(target)} lines={visible} totalLines={lines.length} maxLines={16} />
  </div>;
}

function RawRecord({ raw, result }: { raw: string; result: string }) {
  return <div className={css.rawSection}>
    <p className={css.note}>完整记录 · 只读 · 不执行其中的代码</p>
    <h4 className={css.rawLabel}>工具输入</h4>
    <pre className={css.raw}>{raw || '输入尚未到达'}</pre>
    {result && <><h4 className={css.rawLabel}>工具结果</h4><pre className={css.raw}>{result}</pre></>}
  </div>;
}

function InputView({ model, preparing }: { model: Model; preparing: boolean }) {
  if (model.content) return generatedInput(model.content, model.target, preparing);
  if (model.command) return <div data-reader-tool-terminal><p className={css.note}>{preparing ? '正在生成命令 · 尚未执行' : '提交的命令'}</p><TerminalBlockL command={model.command} cwd={model.cwd} /></div>;
  return <JsonTree data={model.args} label={preparing ? '已收到的输入字段' : '工具输入'} labels={JSON_TREE_LABELS} />;
}

function ResultView({ entry, model, phase, ...render }: BlockRenderProps & { entry: ToolActivityEntry; model: Model; phase: ToolPhase }) {
  const block = entry.block;
  if (!block || !('kind' in block)) return <>
    <p className={css.note}>{phase === 'interrupted' ? '已中断，没有工具结果。已生成的输入仍可查看。' : phase === 'preparing' ? '模型正在生成工具输入，工具还未开始执行。' : '工具已开始执行，正在等待结果。'}</p>
    <InputView model={model} preparing={phase === 'preparing'} />
  </>;
  const terminal = terminalCardModel(block, model.cwd);
  const text = block.content.filter(item => item.type === 'text').map(item => item.text).join('\n');
  if (terminal || model.category === 'terminal') {
    const facts = executionFacts(block);
    const output = terminal?.card.output ?? text;
    const exitCode = facts.exitCode ?? (phase === 'failed' ? exitCodeFromOutput(output, true) : undefined);
    const command = terminal?.copy.kind === 'shell' ? terminal.copy.command : model.command ?? model.name;
    return <div data-reader-tool-terminal><TerminalBlockL command={command} cwd={terminal?.card.cwd ?? model.cwd}
      output={output} exitCode={exitCode} signal={facts.signal}
      labels={phase === 'failed' && exitCode === undefined ? { done: '失败' } : undefined} maxLines={18} /></div>;
  }
  const read = readCardModel(block);
  if (read) return <div data-reader-tool-file><ReadBlockL {...read} maxLines={18} /></div>;
  const diff = diffCardModel(block);
  if (diff?.card.diffs.length) return <div data-reader-tool-diff><DiffBlockL {...diff.card} maxLines={18} /></div>;
  const search = searchCardModel(block);
  if (search) return <div data-reader-tool-search><SearchBlockL {...search.card} maxLines={18} />{search.recovery && <p className={css.note}>{search.recovery}</p>}</div>;
  const web = webCardModel(block);
  if (web) return <div data-reader-tool-web><WebBlockL {...web} /></div>;
  if (model.category === 'write' && model.content && !block.isError) return <>
    <p className={css.note}>文件工具已返回。以下为提交的内容；完整返回记录可在「原始数据」查看。</p>
    {generatedInput(model.content, model.target, false)}
  </>;
  const content: ToolResultNode['content'] = block.content;
  if (content.some(item => item.type === 'text')) return <div className={css.document}><Blocks {...render} blocks={contentBlocks(content).filter(item => item.kind === 'text')} source="tool" /></div>;
  if (content.length) return <p className={css.note}>图片或扩展内容已在下方单独展示。</p>;
  return <p className={css.note}>工具没有返回可展示的内容。</p>;
}

/** Ledger + result / input / raw tabs for one tool call, inside a recessed block. */
export function ToolDetails({ entry, model, phase, ...render }: BlockRenderProps & { entry: ToolActivityEntry; model: Model; phase: ToolPhase }) {
  const { inspectCall } = useReaderActions();
  const [tab, setTab] = useState<'result' | 'input' | 'raw'>('result');
  const panel = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState(false);
  const detailId = useId();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const heldPreview = useRef({ entry, model, phase });
  if (!selected) heldPreview.current = { entry, model, phase };
  const preview = heldPreview.current;
  useEffect(() => {
    const track = () => {
      const selection = document.getSelection();
      setSelected(!!selection && !selection.isCollapsed && !!selection.anchorNode && !!panel.current?.contains(selection.anchorNode));
    };
    document.addEventListener('selectionchange', track);
    return () => document.removeEventListener('selectionchange', track);
  }, []);
  const facts = executionFacts(entry.block);
  const elapsed = entry.block && 'kind' in entry.block && entry.block.callTime != null ? Math.max(0, entry.block.time - entry.block.callTime) : null;
  const rawResult = useMemo(() => {
    const block = preview.entry.block;
    return block && 'kind' in block ? JSON.stringify({ content: block.content, isError: block.isError, meta: block.meta, resultView: Reflect.get(block, 'resultView') }, null, 2) : '';
  }, [preview.entry.block]);
  const tabs = [['result', phase === 'preparing' ? '生成预览' : '结果'], ['input', '输入'], ['raw', '原始数据']] as const;
  const activate = (index: number) => { const next = (index + tabs.length) % tabs.length; setTab(tabs[next]![0]); tabRefs.current[next]?.focus(); };
  return <div className={css.details} data-reader-tool-details>
    <div className={css.ledger} aria-live="off">
      <span>工具 · <span className={css.engine}>{model.name}</span></span>
      <span data-reader-tool-progress>{phase === 'preparing' ? `已接收 ${number.format(model.raw.length)} 字符输入` : phase === 'running' ? '已提交 · 等待工具返回' : phase === 'interrupted' ? '已停止 · 输入记录保留' : elapsed !== null ? `执行 ${duration(elapsed)}` : '结果已记录'}</span>
      {facts.exitCode !== undefined && <span>退出码 {facts.exitCode}</span>}
      {facts.signal && <span>信号 {facts.signal}</span>}
      {inspectCall && <button type="button" className={css.inspect} onClick={() => inspectCall(entry.callId)} data-reader-inspect><IconInspectOutlineRegular size={12} />在轨迹中查看</button>}
    </div>
    <div className={css.tabs} role="tablist" aria-label={`${model.title}的执行数据`} onKeyDown={event => {
      const index = tabs.findIndex(item => item[0] === tab);
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); activate(index + (event.key === 'ArrowRight' ? 1 : -1)); }
      else if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); activate(event.key === 'Home' ? 0 : tabs.length - 1); }
    }}>{tabs.map(([id, title], index) => <button key={id} ref={element => { tabRefs.current[index] = element; }} type="button" role="tab" id={`${detailId}-${id}`} aria-selected={tab === id} aria-controls={`${detailId}-panel`} tabIndex={tab === id ? 0 : -1} onClick={() => setTab(id)}>{title}</button>)}</div>
    <div ref={panel} id={`${detailId}-panel`} className={css.panel} role="tabpanel" aria-labelledby={`${detailId}-${tab}`} tabIndex={0}>
      {selected && <p className={css.note}>为保留选区，预览暂停更新；当前状态见行标题。</p>}
      {tab === 'result' && <ResultView {...render} {...preview} />}
      {tab === 'input' && <><InputView model={preview.model} preparing={preview.phase === 'preparing'} /><details className={css.detail}><summary>全部输入字段</summary><JsonTree data={preview.model.args} label="输入字段" labels={JSON_TREE_LABELS} /></details></>}
      {tab === 'raw' && <RawRecord raw={preview.model.raw} result={rawResult} />}
    </div>
  </div>;
}
