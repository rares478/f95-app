import { useEffect, useState } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import * as ipc from '../lib/ipc';
import { useT } from '../lib/i18n';
import { formatBytes, formatEta, formatSpeed } from '../types/download';

interface Props {
  open: boolean;
  threadId: string;
  /** Pre-computed total bytes from `moveInstallStart`. Used while the first
   *  progress event hasn't landed yet. */
  totalBytesHint: number;
  /** Where the game will end up. Shown so the user knows what's happening. */
  destPath: string;
  /** Called when the move finished successfully. Args: new install_path and
   *  the remapped exe_path. */
  onComplete: (args: { newInstallPath: string; newExePath: string | null }) => void;
  /** User cancelled / move errored — caller closes the modal. */
  onClosed: (reason: 'cancelled' | 'error', message?: string) => void;
}

interface ProgressPayload {
  threadId: string;
  bytesCopied: number;
  totalBytes: number;
  speedBps: number;
}
interface DonePayload {
  threadId: string;
  newInstallPath: string;
  newExePath: string | null;
}
interface ErrorPayload {
  threadId: string;
  message: string;
}
interface CancelledPayload {
  threadId: string;
}

/**
 * Live progress modal for an in-flight install-move. Subscribes to the four
 * `install_move:*` events the backend emits and renders a non-cancellable
 * progress bar (cancel button still works — backend cleans up the partial).
 */
export function MoveProgressModal({
  open,
  threadId,
  totalBytesHint,
  destPath,
  onComplete,
  onClosed,
}: Props) {
  const { t } = useT();
  const [bytes, setBytes] = useState(0);
  const [total, setTotal] = useState(totalBytesHint);
  const [speed, setSpeed] = useState(0);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    if (!open) return;
    setBytes(0);
    setTotal(totalBytesHint);
    setSpeed(0);
    setCancelling(false);

    let unlistens: UnlistenFn[] = [];
    let stopped = false;

    (async () => {
      unlistens.push(
        await listen<ProgressPayload>('install_move:progress', (e) => {
          if (stopped || e.payload.threadId !== threadId) return;
          setBytes(e.payload.bytesCopied);
          setTotal(e.payload.totalBytes || totalBytesHint);
          setSpeed(e.payload.speedBps);
        }),
      );
      unlistens.push(
        await listen<DonePayload>('install_move:done', (e) => {
          if (stopped || e.payload.threadId !== threadId) return;
          stopped = true;
          onComplete({
            newInstallPath: e.payload.newInstallPath,
            newExePath: e.payload.newExePath,
          });
        }),
      );
      unlistens.push(
        await listen<ErrorPayload>('install_move:error', (e) => {
          if (stopped || e.payload.threadId !== threadId) return;
          stopped = true;
          onClosed('error', e.payload.message);
        }),
      );
      unlistens.push(
        await listen<CancelledPayload>('install_move:cancelled', (e) => {
          if (stopped || e.payload.threadId !== threadId) return;
          stopped = true;
          onClosed('cancelled');
        }),
      );
    })();

    return () => {
      stopped = true;
      for (const u of unlistens) u();
    };
  }, [open, threadId, totalBytesHint, onComplete, onClosed]);

  async function onCancel() {
    if (cancelling) return;
    setCancelling(true);
    try {
      await ipc.moveInstallCancel(threadId);
    } catch (err) {
      console.warn('[move-modal] cancel failed', err);
      setCancelling(false);
    }
  }

  if (!open) return null;

  const pct = total > 0 ? Math.min(100, (bytes / total) * 100) : null;
  const remaining = total > 0 ? Math.max(0, total - bytes) : 0;

  return (
    <div style={overlayStyle}>
      <div style={modalStyle}>
        <h2 style={titleStyle}>{t('modal.move.progress.title')}</h2>
        <div style={destStyle} title={destPath}>
          {t('modal.move.progress.dest')}: <code style={pathStyle}>{destPath}</code>
        </div>

        {pct !== null && (
          <div style={progressOuter}>
            <div style={{ ...progressInner, width: `${pct}%` }} />
          </div>
        )}

        <div style={metaRow}>
          <span>
            {formatBytes(bytes)}
            {total > 0 && ` / ${formatBytes(total)}`}
            {pct !== null && `  ·  ${pct.toFixed(1)}%`}
          </span>
          {speed > 0 && (
            <>
              <span>{formatSpeed(speed)}</span>
              {total > 0 && <span>{t('dllist.meta.eta', { eta: formatEta(remaining, speed) })}</span>}
            </>
          )}
        </div>

        <div style={noteStyle}>{t('modal.move.progress.hint')}</div>

        <div style={footerStyle}>
          <button
            style={{ ...cancelBtnStyle, ...(cancelling ? cancellingBtn : {}) }}
            disabled={cancelling}
            onClick={onCancel}
          >
            {cancelling ? t('modal.move.progress.cancelling') : t('common.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.75)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1001,
};
const modalStyle: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: '20px 22px',
  width: 'min(520px, calc(100vw - 40px))',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
};
const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 17,
  fontWeight: 700,
  color: 'var(--text-primary)',
};
const destStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--text-tertiary)',
};
const pathStyle: React.CSSProperties = {
  fontFamily: 'monospace',
  color: 'var(--text-secondary)',
  background: 'var(--bg-sunken)',
  padding: '2px 6px',
  borderRadius: 2,
  marginLeft: 4,
};
const progressOuter: React.CSSProperties = {
  background: 'var(--bg-sunken)',
  borderRadius: 2,
  height: 8,
  overflow: 'hidden',
};
const progressInner: React.CSSProperties = {
  background: 'var(--status-info)',
  height: '100%',
  transition: 'width 200ms linear',
};
const metaRow: React.CSSProperties = {
  display: 'flex',
  gap: 14,
  fontSize: 12,
  color: 'var(--text-muted)',
  flexWrap: 'wrap',
};
const noteStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--text-faint)',
  fontStyle: 'italic',
};
const footerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
};
const cancelBtnStyle: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--text-tertiary)',
  border: '1px solid var(--border-strong)',
  padding: '6px 14px',
  borderRadius: 3,
  fontSize: 13,
  cursor: 'pointer',
};
const cancellingBtn: React.CSSProperties = {
  opacity: 0.5,
  cursor: 'wait',
};
