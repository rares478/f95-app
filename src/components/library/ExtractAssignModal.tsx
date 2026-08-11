import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { defaultExeLabel } from '../../lib/installAssign';
import * as downloads from '../../lib/downloads';
import { loadDownloadSettings } from '../../lib/downloadSettings';
import { dialog } from '../../lib/dialog';
import { useT } from '../../lib/i18n';
import * as ipc from '../../lib/ipc';
import { formatIpcError } from '../../lib/ipcError';
import * as library from '../../lib/library';
import {
  exeDisplayName,
  exeParentDir,
  type LibraryGameExe,
} from '../../lib/libraryExes';
import {
  findJob,
  markJobAndBundleSiblingsAssign,
  recomputePlanStatus,
  type InstallJob,
} from '../../lib/installPlans';
import type { LibraryGame } from '../../types/library';
import '../../styles/install-plan.css';

export interface PendingAssign {
  jobId: string;
  planId: string;
  threadId: string;
  exePath: string | null;
}

export interface ExtractAssignModalProps {
  pending: PendingAssign | null;
  onClose: () => void;
  onDone: () => void | Promise<void>;
}

type Mode = 'choose' | 'replace';

export function ExtractAssignModal({
  pending,
  onClose,
  onDone,
}: ExtractAssignModalProps) {
  const { t } = useT();
  const [job, setJob] = useState<InstallJob | null>(null);
  const [game, setGame] = useState<LibraryGame | null>(null);
  const [exes, setExes] = useState<LibraryGameExe[]>([]);
  const [label, setLabel] = useState('');
  const [mode, setMode] = useState<Mode>('choose');
  const [replaceId, setReplaceId] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const open = pending != null;
  const exePath = pending?.exePath ?? null;

  useEffect(() => {
    if (!pending) {
      setJob(null);
      setGame(null);
      setExes([]);
      setLabel('');
      setMode('choose');
      setReplaceId('');
      setLoadError(null);
      setBusy(false);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const [j, g, rows] = await Promise.all([
          findJob(pending.jobId),
          library.get(pending.threadId),
          library.listExes(pending.threadId),
        ]);
        if (cancelled) return;
        if (!j) {
          setLoadError(t('modal.assign.jobMissing'));
          return;
        }
        setJob(j);
        setGame(g);
        setExes(rows);
        setLabel(defaultExeLabel(j.sectionLabel, pending.exePath));
        setMode('choose');
        setReplaceId(rows[0]?.id ?? '');
        setLoadError(null);
      } catch (err) {
        if (!cancelled) {
          setLoadError(formatIpcError(err));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pending, t]);

  if (!open) return null;

  const title = t('modal.assign.title', {
    section: job?.sectionLabel ?? '…',
    title: game?.title ?? pending.threadId,
  });

  async function afterAssigned(assignedExePath: string | null) {
    if (!job || !pending) return;

    if (assignedExePath) {
      const dlSettings = await loadDownloadSettings();
      if (dlSettings.createShortcuts && game) {
        try {
          await ipc.createGameShortcuts({
            exePath: assignedExePath,
            title: game.title,
          });
        } catch (err) {
          console.warn('[assign] failed to create shortcuts', err);
        }
      }
    }

    let gameVersion: string | null = null;
    if (job.downloadId != null) {
      try {
        const row = await downloads.get(job.downloadId);
        gameVersion = row?.gameVersion ?? null;
      } catch {
        /* ignore */
      }
    }
    if (gameVersion) {
      try {
        await library.applyVersion(pending.threadId, gameVersion);
      } catch (err) {
        console.warn('[assign] failed to apply version', err);
      }
    }

    await onDone();
  }

  async function onAdd() {
    if (!job || !pending || !exePath || busy) return;
    setBusy(true);
    try {
      const exe = await library.addExe(pending.threadId, exePath, label);
      await markJobAndBundleSiblingsAssign(job, 'assigned', { exeId: exe.id });
      await recomputePlanStatus(job.planId);
      await afterAssigned(exePath);
    } catch (err) {
      if (err instanceof Error && err.message === 'DUPLICATE_EXE_PATH') {
        await dialog.alert(t('libdetail.exe.duplicate'), { kind: 'warning' });
      } else {
        await dialog.alert(
          t('modal.assign.failed', { error: formatIpcError(err) }),
          { kind: 'error' },
        );
      }
    } finally {
      setBusy(false);
    }
  }

  async function onReplaceConfirm() {
    if (!job || !pending || !exePath || !replaceId || busy) return;
    setBusy(true);
    try {
      const installPath = exeParentDir(exePath) || job.extractPath;
      await library.updateExePaths(replaceId, exePath, installPath);
      await markJobAndBundleSiblingsAssign(job, 'assigned', { exeId: replaceId });
      await recomputePlanStatus(job.planId);
      await afterAssigned(exePath);
    } catch (err) {
      if (err instanceof Error && err.message === 'DUPLICATE_EXE_PATH') {
        await dialog.alert(t('libdetail.exe.duplicate'), { kind: 'warning' });
      } else {
        await dialog.alert(
          t('modal.assign.failed', { error: formatIpcError(err) }),
          { kind: 'error' },
        );
      }
    } finally {
      setBusy(false);
    }
  }

  async function onSkip() {
    if (!job || busy) return;
    setBusy(true);
    try {
      await markJobAndBundleSiblingsAssign(job, 'skipped');
      await recomputePlanStatus(job.planId);
      await onDone();
    } catch (err) {
      await dialog.alert(
        t('modal.assign.failed', { error: formatIpcError(err) }),
        { kind: 'error' },
      );
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div className="install-assign-overlay" onClick={onClose}>
      <div
        className="install-assign-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="install-assign-title"
      >
        <h2 id="install-assign-title" className="install-assign-title">
          {title}
        </h2>

        {loadError ? (
          <p className="install-assign-error">{loadError}</p>
        ) : (
          <>
            <dl className="install-assign-meta">
              <dt>{t('modal.assign.extractPath')}</dt>
              <dd>{job?.extractPath ?? '—'}</dd>
              <dt>{t('modal.assign.exePath')}</dt>
              <dd>{exePath ?? t('modal.assign.noExe')}</dd>
            </dl>

            {mode === 'choose' ? (
              <>
                <div className="install-assign-field">
                  <label htmlFor="install-assign-label">
                    {t('modal.assign.label')}
                  </label>
                  <input
                    id="install-assign-label"
                    type="text"
                    value={label}
                    disabled={!exePath || busy}
                    onChange={(e) => setLabel(e.target.value)}
                  />
                </div>

                <div className="install-assign-actions">
                  <button
                    type="button"
                    className="dl-action-btn"
                    disabled={busy}
                    onClick={onSkip}
                  >
                    {t('modal.assign.skip')}
                  </button>
                  <button
                    type="button"
                    className="dl-action-btn"
                    disabled={busy || !exePath || exes.length === 0}
                    onClick={() => setMode('replace')}
                  >
                    {t('modal.assign.replace')}
                  </button>
                  <button
                    type="button"
                    className="dl-action-btn dl-action-btn-accent"
                    disabled={busy || !exePath}
                    onClick={onAdd}
                  >
                    {t('modal.assign.add')}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="install-assign-field">
                  <label htmlFor="install-assign-replace">
                    {t('modal.assign.pickExe')}
                  </label>
                  {exes.length === 0 ? (
                    <p className="install-assign-meta">{t('modal.assign.noExes')}</p>
                  ) : (
                    <select
                      id="install-assign-replace"
                      value={replaceId}
                      disabled={busy}
                      onChange={(e) => setReplaceId(e.target.value)}
                    >
                      {exes.map((row) => (
                        <option key={row.id} value={row.id}>
                          {exeDisplayName(row)}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                <div className="install-assign-actions">
                  <button
                    type="button"
                    className="dl-action-btn"
                    disabled={busy}
                    onClick={() => setMode('choose')}
                  >
                    {t('common.back')}
                  </button>
                  <button
                    type="button"
                    className="dl-action-btn dl-action-btn-accent"
                    disabled={busy || !exePath || !replaceId}
                    onClick={onReplaceConfirm}
                  >
                    {t('modal.assign.replaceConfirm')}
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
