import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { Line } from 'fixture-source/Line.tsx';
import { ToolRow } from 'fixture-source/ToolRow.tsx';
import { ToolGroupRow } from 'fixture-source/ToolGroupRow.tsx';
import { ThoughtRow } from 'fixture-source/ThoughtRow.tsx';
import { RecordRow } from 'fixture-source/RecordRows.tsx';
import { ReaderActionsContext } from 'fixture-source/reader-context.ts';
import readerCss from 'fixture-source/Reader.module.css';
import { IconQueueOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives';
import { chatNode, chatOf, settledTool, toolCall, toolEntry, turnLocation } from '../support/chat-fixture.ts';
import { sessionHook } from '../support/session.ts';

// Only synthetic records and local disclosures. The CDP driver sends real pointer/key input here.
const failures: string[] = [];
const checks: Record<string, unknown> = {};
const check = (ok: unknown, message: string) => { if (!ok) failures.push(message); };
const settle = () => new Promise(resolve => setTimeout(resolve, 350));
const host = document.createElement('div');
host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;overflow:auto;background:white;padding:32px 12px;box-sizing:border-box';
document.body.append(host);
const root = createRoot(host);
const renderProps = { renderSlotChain: (_name: string, _props: unknown, value: { fallback: unknown }) => value.fallback, loadImage: async () => '' };
const noop = () => {};
const tool = toolEntry('read-example', 1, settledTool('read-example', 'read', { path: 'src/main.ts' }));
const failed = toolEntry('failed-example', 1, settledTool('failed-example', 'bash', { command: 'npm run build' }, { isError: true, content: [{ type: 'text', text: 'exit code: 2' }] }));
const preparing = toolEntry('preparing-example', 1, undefined, toolCall('preparing-example', 'bash', { command: 'npm test' }));
const members = [tool, toolEntry('read-second', 1, settledTool('read-second', 'read', { path: 'src/styles.css' }))]
  .map(entry => ({ kind: 'tool' as const, key: entry.key, entry, step: 1 }));
const group = { kind: 'group' as const, key: 'group:example', items: members, facts: { counts: { read: 2 }, order: ['read' as const], failed: 0, running: false } };
const turn = turnLocation({ steps: [1] });
const record = chatNode('compaction', { shadowedItemCount: 12 }, turn);
const hook = sessionHook(chatOf([record], [turn]));
let motion = true;
function draw() {
  flushSync(() => root.render(<ReaderActionsContext.Provider value={{ motion }}><main className={readerCss.root} data-dsh-clearview="fixture"
    data-motion={motion ? 'on' : 'off'} style={{ maxWidth: 748, margin: '0 auto' }}>
    <button data-focus-entry style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}>Keyboard entry</button>
    <div data-example="tool"><ToolRow {...renderProps as any} entry={tool} turnClosed onRead={noop} /></div>
    <div data-example="thought"><ThoughtRow durationMs={12000} motion={motion} onRead={noop}>完整思考内容仍在原有的限高区域中。</ThoughtRow></div>
    <div data-example="group"><ToolGroupRow group={group} motion={motion} onRead={noop} renderItem={item => item.kind === 'tool'
      ? <ToolRow {...renderProps as any} entry={item.entry} turnClosed onRead={noop} /> : null} /></div>
    <div data-example="record"><RecordRow {...renderProps as any} useSession={hook} nodeKey={record.key} t={(key: string) => key} turnClosed onRead={noop} /></div>
    <div data-example="failed"><ToolRow {...renderProps as any} entry={failed} turnClosed onRead={noop} /></div>
    <div data-example="running"><ToolRow {...renderProps as any} entry={preparing} turnClosed={false} onRead={noop} /></div>
    <div data-example="static"><Line icon={<IconQueueOutlineRegular size={14} />} label="后台任务状态更新" /></div>
  </main></ReaderActionsContext.Provider>));
}
const row = (name: string) => host.querySelector<HTMLElement>(`[data-example="${name}"] [data-reader-line]`)!;
function snapshot(name: string) {
  const element = row(name), button = element.querySelector<HTMLElement>(':scope > button'), leading = element.querySelector<HTMLElement>('[data-reader-line-leading]')!;
  const icon = element.querySelector<HTMLElement>('[data-reader-line-icon]')!, arrow = element.querySelector<SVGElement>('[data-reader-line-chevron]');
  const lead = leading.getBoundingClientRect(), label = element.querySelector('[data-reader-line-label]')!.getBoundingClientRect();
  const iconBox = icon.getBoundingClientRect(), arrowBox = arrow?.getBoundingClientRect();
  return { expanded: button?.getAttribute('aria-expanded'), focusVisible: button?.matches(':focus-visible'), leadingCount: element.querySelectorAll('[data-reader-line-leading]').length,
    leadingWidth: lead.width, iconOpacity: Number(getComputedStyle(icon).opacity), arrowOpacity: arrow ? Number(getComputedStyle(arrow).opacity) : null,
    arrowTransform: arrow && getComputedStyle(arrow).transform, arrowColor: arrow && getComputedStyle(arrow).stroke, leadingColor: getComputedStyle(leading).color,
    transition: getComputedStyle(icon).transitionDuration, labelX: label.left,
    sharedCenter: !!arrowBox && Math.abs(iconBox.x + iconBox.width / 2 - arrowBox.x - arrowBox.width / 2) < .1
      && Math.abs(iconBox.y + iconBox.height / 2 - arrowBox.y - arrowBox.height / 2) < .1 };
}
let initialLabelX = 0;
(window as any).runClearviewPerformance = async () => {
  draw(); await settle();
  for (const name of ['tool', 'thought', 'group', 'record', 'failed', 'running']) {
    const s = snapshot(name);
    check(s.leadingCount === 1 && s.leadingWidth === 16 && s.sharedCenter, `${name}: icons must occupy one 16px slot`);
    check(s.iconOpacity === 1 && s.arrowOpacity === 0, `${name}: collapsed row must show its operation icon`);
  }
  const staticRow = snapshot('static');
  check(staticRow.arrowOpacity === null && staticRow.iconOpacity === 1, 'Static row has a redundant arrow');
  initialLabelX = snapshot('tool').labelX;
  return { failures };
};
const STEPS = ['hover', 'pointer-open', 'open-away', 'pointer-close', 'keyboard-focus', 'enter-open', 'space-close', 'failed-hover', 'static-hover', 'motion-off-hover', 'motion-off-away', 'reduce-hover', 'reduce-away'];
(window as any).processIconInputSteps = () => STEPS;
(window as any).prepareProcessIconInput = (step: string) => {
  if (step.startsWith('motion-off')) { motion = false; draw(); }
  if (step.startsWith('reduce')) { motion = true; draw(); }
  const target = step === 'failed-hover' ? 'failed' : step === 'static-hover' ? 'static' : 'tool';
  const rect = row(target).getBoundingClientRect();
  if (step === 'keyboard-focus') { host.querySelector<HTMLElement>('[data-focus-entry]')!.focus(); return { key: 'Tab', code: 'Tab', keyCode: 9, x: 1, y: 1 }; }
  if (step === 'enter-open') return { key: 'Enter', code: 'Enter', keyCode: 13 };
  if (step === 'space-close') return { key: ' ', code: 'Space', keyCode: 32 };
  // Isolate pointer-only cases from the deliberately retained keyboard focus above.
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  return { x: step.endsWith('away') ? 1 : rect.x + rect.width / 2, y: step.endsWith('away') ? 1 : rect.y + rect.height / 2,
    click: step.startsWith('pointer-'), ...(step.startsWith('reduce') ? { reducedMotion: true } : {}) };
};
(window as any).assertProcessIconInput = async (step: string) => {
  await settle();
  const name = step === 'failed-hover' ? 'failed' : step === 'static-hover' ? 'static' : 'tool';
  const s = snapshot(name); checks[step] = s;
  const arrowVisible = step !== 'static-hover' && !step.endsWith('away') || step === 'open-away';
  check(s.iconOpacity === (arrowVisible ? 0 : 1) && s.arrowOpacity === (step === 'static-hover' ? null : arrowVisible ? 1 : 0), `${step}: incorrect icon swap`);
  if (name === 'tool') check(Math.abs(s.labelX - initialLabelX) < .1, `${step}: label moved when swapping icons`);
  if (['pointer-open', 'open-away', 'enter-open'].includes(step)) check(s.expanded === 'true' && s.arrowTransform !== 'none', `${step}: expanded arrow is missing`);
  if (['pointer-close', 'space-close'].includes(step)) check(s.expanded === 'false', `${step}: row failed to collapse`);
  if (step === 'keyboard-focus') check(s.focusVisible, 'Native Tab did not expose the keyboard disclosure affordance');
  if (step === 'failed-hover') check(s.arrowColor === s.leadingColor, 'Failure colour did not survive the hover swap');
  if (step.startsWith('motion-off') || step.startsWith('reduce')) check(s.transition === '0s', `${step}: reduced-motion swap is animated`);
};
(window as any).processIconInputReport = () => ({ checks, failures });
(window as any).prepareClearviewScreenshot = async (theme: string) => {
  document.activeElement instanceof HTMLElement && document.activeElement.blur();
  motion = true; draw(); document.body.toggleAttribute('data-ds-dark-theme', theme === 'dark');
  host.style.background = theme === 'dark' ? '#141413' : '#fff'; await settle();
  const facts = { theme, width: innerWidth, overflow: host.scrollWidth - host.clientWidth, labelX: snapshot('tool').labelX };
  check(facts.overflow <= 1, `${theme}: rows overflow horizontally`); return facts;
};
(window as any).clearviewPerformanceFailures = () => [...failures];
