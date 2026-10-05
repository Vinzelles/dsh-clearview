import { useEffect, useRef, useState } from 'react';
import type { TurnLocation } from '@deepseek-ai/dsh-client-ui-conversation/client';
import { IconBranchOutlineRegular, IconCopyOutlineRegular, IconDeliverDocRegular, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives';
import { useReaderActions } from './reader-context.js';
import { branchUnavailable, presentedFiles, turnMeta, turnMetaText, type PresentedFileRef } from './turn-meta.js';
import css from './TurnFooter.module.css';

const DELIVERY_LIMIT = 4;

function basename(path: string): string {
  return path.split(/[/\\]/).filter(Boolean).at(-1) ?? path;
}

/** Files the turn explicitly delivered; a card opens the sidebar preview. */
export function Deliverables({ files, openFile }: { files: readonly PresentedFileRef[]; openFile?: (path: string) => void }) {
  const [showAll, setShowAll] = useState(false);
  if (files.length === 0) return null;
  const visible = showAll ? files : files.slice(0, DELIVERY_LIMIT);
  return <div className={css.deliverables} data-count={files.length === 1 ? '1' : undefined} data-reader-deliverables>
    {visible.map(file => <button key={file.path} type="button" className={css.card} disabled={!openFile} title={file.path} onClick={() => openFile?.(file.path)}>
      <span className={css.cardIcon} aria-hidden="true"><IconDeliverDocRegular size={16} /></span>
      <span className={css.cardText}>
        <span className={css.cardName}>{basename(file.path)}</span>
        <span className={css.cardDesc}>{file.description ?? file.path}</span>
      </span>
    </button>)}
    {files.length > visible.length && <button type="button" className={css.more} onClick={() => setShowAll(true)}>展开其余 {files.length - visible.length} 个</button>}
  </div>;
}

/** Closing row of a finished turn: deliveries, copy, fork, and clock · duration · usage. */
export function TurnFooter({ turn, answerText, now }: { turn: TurnLocation | undefined; answerText: string; now?: Date }) {
  const { fork, openFile } = useReaderActions();
  const [receipt, setReceipt] = useState('');
  const [failed, setFailed] = useState(false);
  const [forking, setForking] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const meta = turnMetaText(turnMeta(turn, now));
  const files = presentedFiles(turn);
  const endSeq = turn?.end?.seq;
  const canCopy = answerText.trim() !== '';
  // Later non-rendered evidence makes the closing reply a non-tail message, which cannot be forked.
  const forkSeq = fork !== undefined && typeof endSeq === 'number' && !branchUnavailable(turn) ? endSeq : undefined;
  if (!canCopy && !meta && files.length === 0) return null;
  const flash = (text: string, error: boolean, ms: number) => {
    setReceipt(text); setFailed(error);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { setReceipt(''); setFailed(false); }, ms);
  };
  return <div className={css.footer} data-reader-turn-footer>
    <Deliverables files={files} openFile={openFile} />
    <div className={css.actions} data-reader-answer-actions>
      {canCopy && <button type="button" className={css.action} aria-label="复制回答" title="复制回答" onClick={async () => {
        const accepted = await writeClipboard(answerText);
        flash(accepted ? '已复制' : '未能复制，请手动选择文字', false, 2000);
      }}><IconCopyOutlineRegular size={15} /></button>}
      {fork && forkSeq !== undefined && <button type="button" className={css.action} aria-label="从这里分支" title="从这里分支" disabled={forking} onClick={async () => {
        setForking(true);
        try { await fork(forkSeq); } catch (error) { flash(`分支失败：${error instanceof Error ? error.message : String(error)}`, true, 5000); } finally { setForking(false); }
      }}><IconBranchOutlineRegular size={15} /></button>}
      {meta && <span className={css.meta}>{meta}</span>}
      <span role="status" className={failed ? css.error : css.receipt}>{receipt}</span>
    </div>
  </div>;
}
