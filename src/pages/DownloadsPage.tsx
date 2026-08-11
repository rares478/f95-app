import { Link, useNavigate } from 'react-router-dom';
import { dialog } from '../lib/dialog';
import { useCallback, useEffect, useMemo, useState, Fragment } from 'react';
import { runExtraction } from '../hooks/useDownloads';
import { useDownloads } from '../contexts/Downloads';
import { useDownloadSettings } from '../contexts/DownloadSettings';
import { useInstallAssign } from '../contexts/InstallAssign';
import { formatDownloadSpeed } from '../lib/downloadSettings';
import type { DownloadGameInfo } from '../components/downloads/DownloadCard';
import { DownloadActiveCard, DownloadHistoryRow } from '../components/downloads/DownloadRowItem';
import * as downloads from '../lib/downloads';
import * as library from '../lib/library';
import * as ipc from '../lib/ipc';
import {
  findJobByDownloadId,
  getPlan,
  listJobsByThread,
  markJobAssign,
  recomputePlanStatus,
  type InstallJob,
  type InstallPlan,
} from '../lib/installPlans';
import {
  countAssignProgress,
  groupDownloadRowsByThread,
  selectPlanJobs,
} from '../lib/groupDownloadRows';
import { OfflineGate } from '../components/OfflineGate';
import { useContextMenu } from '../components/contextMenu';
import { useOffline } from '../contexts/Offline';
import { buildDownloadMenu } from '../lib/contextMenus/buildDownloadMenu';
import type { DownloadMenuCallbacks } from '../lib/contextMenus/buildDownloadMenu';
import { useT } from '../lib/i18n';
import { formatIpcError } from '../lib/ipcError';
import type { DownloadRow } from '../types/download';
import { formatBytes } from '../types/download';
import { useLibraryInstallFlow } from '../hooks/useLibraryInstallFlow';
import {
  canChangeDownloadProvider,
  recoverStatusAfterDownloadFailure,
} from '../lib/downloadLibrarySync';
import '../styles/install-plan.css';

export function DownloadsPage() {
  const { t } = useT();
  const navigate = useNavigate();
  const { isOffline } = useOffline();
  const { openContextMenu } = useContextMenu();
  const { rows, progress, reload } = useDownloads();
  const { settings: dlSettings } = useDownloadSettings();
  const { openAssign, pending: assignPending } = useInstallAssign();
  const installFlow = useLibraryInstallFlow({ onStarted: () => { void reload(); } });
  const [libraryMap, setLibraryMap] = useState<Record<string, DownloadGameInfo>>({});
  const [clearing, setClearing] = useState(false);
  const [jobsByThread, setJobsByThread] = useState<Record<string, InstallJob[]>>({});
  const [plansById, setPlansById] = useState<Record<string, InstallPlan>>({});
  const [jobByDownloadId, setJobByDownloadId] = useState<Record<number, InstallJob>>({});

  const loadLibraryMeta = useCallback(async () => {
    try {
      const games = await library.list();
      const next: Record<string, DownloadGameInfo> = {};
      for (const g of games) {
        next[g.threadId] = { title: g.title, thumbnailUrl: g.thumbnailUrl };
      }
      setLibraryMap(next);
    } catch {
      /* ignore */
    }
  }, []);

  const loadInstallJobs = useCallback(async () => {
    const threadIds = [...new Set(rows.map((r) => r.threadId))];
    if (threadIds.length === 0) {
      setJobsByThread({});
      setPlansById({});
      setJobByDownloadId({});
      return;
    }
    try {
      const nextJobs: Record<string, InstallJob[]> = {};
      const nextPlans: Record<string, InstallPlan> = {};
      const nextByDl: Record<number, InstallJob> = {};
      await Promise.all(
        threadIds.map(async (threadId) => {
          const jobs = await listJobsByThread(threadId);
          if (jobs.length === 0) return;
          nextJobs[threadId] = jobs;
          const planIds = [...new Set(jobs.map((j) => j.planId))];
          await Promise.all(
            planIds.map(async (planId) => {
              if (nextPlans[planId]) return;
              const plan = await getPlan(planId);
              if (plan) nextPlans[planId] = plan;
            }),
          );
          for (const j of jobs) {
            if (j.downloadId != null) nextByDl[j.downloadId] = j;
          }
        }),
      );
      setJobsByThread(nextJobs);
      setPlansById(nextPlans);
      setJobByDownloadId(nextByDl);
    } catch {
      /* ignore — downloads page still works without plan metadata */
    }
  }, [rows]);

  useEffect(() => {
    loadLibraryMeta();
  }, [loadLibraryMeta, rows.length]);

  useEffect(() => {
    void loadInstallJobs();
  }, [loadInstallJobs, assignPending]);

  const active = useMemo(
    () =>
      rows.filter(
        (r) =>
          r.state === 'downloading' ||
          r.state === 'extracting' ||
          r.state === 'resolving' ||
          r.state === 'awaiting_choice' ||
          r.state === 'pending',
      ),
    [rows],
  );
  const completed = useMemo(() => rows.filter((r) => r.state === 'completed'), [rows]);
  const other = useMemo(
    () =>
      rows.filter(
        (r) =>
          r.state === 'failed' ||
          r.state === 'cancelled' ||
          r.state === 'needs_browser',
      ),
    [rows],
  );
  const history = useMemo(() => [...completed, ...other], [completed, other]);

  const activeGroups = useMemo(() => groupDownloadRowsByThread(active), [active]);
  const historyGroups = useMemo(() => groupDownloadRowsByThread(history), [history]);

  const plansMap = useMemo(() => new Map(Object.entries(plansById)), [plansById]);

  const totalSpeed = useMemo(() => {
    let bps = 0;
    for (const r of active) {
      if (r.state === 'downloading') {
        bps += progress[r.id]?.speedBps ?? 0;
      }
    }
    return bps;
  }, [active, progress]);

  const totalDownloaded = useMemo(() => {
    let bytes = 0;
    for (const r of rows) {
      if (r.state === 'completed' || r.state === 'downloading') {
        bytes += progress[r.id]?.bytes ?? r.bytesDone ?? 0;
      }
    }
    return bytes;
  }, [rows, progress]);

  const canClearHistory = history.length > 0;

  function planJobsForGroup(threadId: string, groupRows: DownloadRow[]): InstallJob[] {
    const all = jobsByThread[threadId] ?? [];
    if (all.length === 0) return [];
    return selectPlanJobs(
      all,
      plansMap,
      new Set(groupRows.map((r) => r.id)),
    );
  }

  function needsAssign(row: DownloadRow): boolean {
    return jobByDownloadId[row.id]?.assignStatus === 'pending';
  }

  async function onAssign(row: DownloadRow) {
    const job =
      jobByDownloadId[row.id] ?? (await findJobByDownloadId(row.id));
    if (!job || job.assignStatus !== 'pending') return;
    let exePath: string | null = null;
    if (job.extractPath) {
      const gameTitle =
        libraryMap[row.threadId]?.title ??
        (await library.get(row.threadId))?.title ??
        '';
      try {
        exePath = await ipc.findMainExe({
          root: job.extractPath,
          gameTitle,
        });
      } catch {
        exePath = null;
      }
    }
    openAssign({
      jobId: job.id,
      planId: job.planId,
      threadId: row.threadId,
      exePath,
    });
  }

  async function onCancel(row: DownloadRow) {
    await ipc.downloadCancel(row.id);
    const liveBytes = progress[row.id]?.bytes ?? row.bytesDone;
    await downloads.markCancelled(row.id, liveBytes);
    const linkedJob =
      jobByDownloadId[row.id] ?? (await findJobByDownloadId(row.id));
    if (linkedJob) {
      try {
        await markJobAssign(linkedJob.id, 'failed', {
          errorMessage: 'cancelled',
        });
        await recomputePlanStatus(linkedJob.planId);
      } catch {
        /* ignore */
      }
    }
    try {
      const game = await library.get(row.threadId);
      if (game) {
        await library.setStatus(
          row.threadId,
          recoverStatusAfterDownloadFailure(game),
        );
      }
    } catch {
      /* not in library */
    }
    await reload();
  }

  async function onContinueCaptcha(row: DownloadRow) {
    if (isOffline) {
      await dialog.alert(t('offline.actionBlocked'), { kind: 'info' });
      return;
    }
    const pageUrl = row.resolvedUrl ?? row.sourceUrl;
    try {
      await downloads.markRetry(row.id);
      await ipc.downloadContinueCaptcha({
        id: row.id,
        sourceUrl: row.sourceUrl,
        pageUrl,
        threadId: row.threadId,
      });
      await reload();
    } catch (err) {
      await dialog.alert(t('downloads.captcha.failed', { error: formatIpcError(err) }), {
        kind: 'error',
      });
    }
  }

  async function onOpenCaptcha(row: DownloadRow) {
    if (isOffline) {
      await dialog.alert(t('offline.actionBlocked'), { kind: 'info' });
      return;
    }
    const pageUrl = row.resolvedUrl ?? row.sourceUrl;
    await ipc.openCaptchaWindow({
      downloadId: row.id,
      url: pageUrl,
      host: row.host,
    });
  }

  async function onRetry(row: DownloadRow) {
    if (isOffline) {
      await dialog.alert(t('offline.actionBlocked'), { kind: 'info' });
      return;
    }
    await downloads.markRetry(row.id);
    try {
      await library.setStatus(row.threadId, 'downloading');
    } catch {
      /* not in library */
    }
    await ipc.downloadStart({
      id: row.id,
      sourceUrl: row.sourceUrl,
      threadId: row.threadId,
    });
    await reload();
  }

  async function onRemove(row: DownloadRow) {
    await downloads.remove(row.id);
    await reload();
  }

  async function onChangeProvider(row: DownloadRow) {
    if (isOffline) {
      await dialog.alert(t('offline.actionBlocked'), { kind: 'info' });
      return;
    }
    if (!canChangeDownloadProvider(row)) return;
    const game = await library.get(row.threadId);
    if (!game) {
      await dialog.alert(t('downloads.changeProvider.notInLibrary'), { kind: 'error' });
      return;
    }
    try {
      await ipc.downloadCancel(row.id);
    } catch {
      /* row may already be idle */
    }
    try {
      await downloads.remove(row.id);
    } catch {
      /* ignore */
    }
    try {
      const fresh = await library.get(row.threadId);
      if (
        fresh &&
        (fresh.installStatus === 'downloading' || fresh.installStatus === 'extracting')
      ) {
        await library.setStatus(
          row.threadId,
          recoverStatusAfterDownloadFailure(fresh),
        );
      }
    } catch {
      /* not in library */
    }
    await reload();
    await installFlow.beginInstallOrUpdate(game);
  }

  async function onReveal(row: DownloadRow) {
    if (!row.destPath) return;
    try {
      await ipc.revealInExplorer(row.destPath);
    } catch (err) {
      console.warn('[reveal] failed', err);
      await dialog.alert(t('dllist.reveal.failed', { error: formatIpcError(err) }), { kind: 'error' });
    }
  }

  async function onExtract(row: DownloadRow) {
    if (!row.destPath) return;
    try {
      await runExtraction(row.threadId, row.destPath, row.gameVersion, row.id, reload);
      await reload();
    } catch (err) {
      await dialog.alert(t('dllist.extract.failed', { error: formatIpcError(err) }), { kind: 'error' });
    }
  }

  function openDownloadContextMenu(
    e: React.MouseEvent,
    row: DownloadRow,
    callbacks: DownloadMenuCallbacks,
  ) {
    openContextMenu(
      e,
      buildDownloadMenu(row, { navigate, isOffline, t, callbacks }),
    );
  }

  async function onClearHistory() {
    const ok = await dialog.confirm(t('settings.maintenance.confirmFinished'), {
      title: t('downloads.action.clearHistory'),
      kind: 'warning',
    });
    if (!ok) return;
    setClearing(true);
    try {
      await downloads.clearFinished();
      await reload();
    } finally {
      setClearing(false);
    }
  }

  function renderPlanHeader(threadId: string, groupRows: DownloadRow[]) {
    const planJobs = planJobsForGroup(threadId, groupRows);
    if (planJobs.length === 0) return null;
    const counts = countAssignProgress(planJobs);
    const title = libraryMap[threadId]?.title ?? t('dl.thread', { id: threadId });
    return (
      <div className="downloads-plan-header" key={`plan-${threadId}`}>
        <div className="downloads-plan-header-text">
          <span className="downloads-plan-title">{title}</span>
          <span className="downloads-plan-progress">
            {t('downloads.plan.progress', {
              done: counts.done,
              total: counts.total,
              pending: counts.pending,
              assigned: counts.assigned,
              skipped: counts.skipped,
              failed: counts.failed,
            })}
          </span>
        </div>
      </div>
    );
  }

  return (
    <OfflineGate allowReadOnly>
    <div className="downloads-page">
      <header className="downloads-top">
        <div className="downloads-top-text">
          <h1 className="downloads-title">{t('downloads.title')}</h1>
          <p className="downloads-subtitle">
            {rows.length > 0 ? t('downloads.subtitle') : t('downloads.subtitleEmpty')}
          </p>
        </div>
        <div className="downloads-top-actions">
          {canClearHistory && (
            <button
              type="button"
              className="downloads-toolbar-btn"
              onClick={onClearHistory}
              disabled={clearing}
            >
              {clearing ? t('downloads.action.clearing') : t('downloads.action.clearHistory')}
            </button>
          )}
          <button type="button" className="downloads-toolbar-btn" onClick={() => reload()}>
            {t('common.refresh')}
          </button>
        </div>
      </header>

      {rows.length > 0 && (
        <div className="downloads-summary">
          <SummaryItem
            label={t('downloads.stats.active')}
            value={String(active.length)}
            active={active.length > 0}
          />
          <SummaryItem label={t('downloads.stats.completed')} value={String(completed.length)} />
          <SummaryItem label={t('downloads.stats.other')} value={String(other.length)} />
          <SummaryItem
            label={t('downloads.stats.totalSize')}
            value={totalDownloaded > 0 ? formatBytes(totalDownloaded) : '—'}
          />
          <SummaryItem
            label={t('downloads.stats.speed')}
            value={
              totalSpeed > 0
                ? formatDownloadSpeed(totalSpeed, dlSettings.speedInMbps)
                : '—'
            }
            active={totalSpeed > 0}
          />
        </div>
      )}

      {rows.length === 0 && (
        <div className="downloads-empty">
          <div className="downloads-empty-icon" aria-hidden>
            ↓
          </div>
          <p className="downloads-empty-title">{t('downloads.empty.title')}</p>
          <p className="downloads-empty-hint">{t('downloads.empty.hint')}</p>
          <Link to="/store" className="dl-action-btn dl-action-btn-accent downloads-empty-cta">
            {t('downloads.empty.cta')} →
          </Link>
        </div>
      )}

      {active.length > 0 && (
        <section className="downloads-block">
          <h2 className="downloads-block-title">{t('downloads.section.active')}</h2>
          <div className="downloads-active-list">
            {activeGroups.map((group) => (
              <div key={group.threadId} className="downloads-thread-group">
                {renderPlanHeader(group.threadId, group.rows)}
                {group.rows.map((r) => (
                  <DownloadActiveCard
                    key={r.id}
                    row={r}
                    progress={progress[r.id]}
                    game={libraryMap[r.threadId]}
                    showAssign={needsAssign(r)}
                    onAssign={() => void onAssign(r)}
                    onCancel={() => onCancel(r)}
                    onContextMenu={(e) =>
                      openDownloadContextMenu(e, r, { onCancel: () => onCancel(r) })
                    }
                  />
                ))}
              </div>
            ))}
          </div>
        </section>
      )}

      {history.length > 0 && (
        <section className="downloads-block">
          <div className="downloads-history-panel">
            <div className="dl-history-panel-head">
              <h2 className="downloads-block-title">
                {t('downloads.section.history')}
                <span className="downloads-block-count">{history.length}</span>
              </h2>
              <p className="dl-history-panel-meta">
                {t('downloads.panel.meta', {
                  completed: completed.length,
                  size: totalDownloaded > 0 ? formatBytes(totalDownloaded) : '—',
                })}
              </p>
            </div>
            <div className="dl-history-table">
              <div className="dl-history-header">
                <span aria-hidden />
                <span>{t('downloads.col.game')}</span>
                <span>{t('downloads.col.status')}</span>
                <span>{t('downloads.col.host')}</span>
                <span>{t('downloads.col.version')}</span>
                <span>{t('downloads.col.size')}</span>
                <span>{t('downloads.col.date')}</span>
                <span className="dl-history-head-actions">{t('downloads.col.actions')}</span>
              </div>
              {historyGroups.map((group) => (
                <Fragment key={group.threadId}>
                  {renderPlanHeader(group.threadId, group.rows)}
                  {group.rows.map((r) => (
                    <DownloadHistoryRow
                      key={r.id}
                      row={r}
                      game={libraryMap[r.threadId]}
                      showAssign={needsAssign(r)}
                      onAssign={() => void onAssign(r)}
                      onRemove={() => onRemove(r)}
                      onReveal={() => onReveal(r)}
                      onRetry={() => onRetry(r)}
                      onExtract={() => onExtract(r)}
                      onContinueCaptcha={() => onContinueCaptcha(r)}
                      onOpenCaptcha={() => onOpenCaptcha(r)}
                      onChangeProvider={() => onChangeProvider(r)}
                      onContextMenu={(e) =>
                        openDownloadContextMenu(e, r, {
                          onRemove: () => onRemove(r),
                          onReveal: () => onReveal(r),
                          onRetry: () => onRetry(r),
                          onExtract: () => onExtract(r),
                          onContinueCaptcha: () => onContinueCaptcha(r),
                          onOpenCaptcha: () => onOpenCaptcha(r),
                        })
                      }
                    />
                  ))}
                </Fragment>
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
    {installFlow.modal}
    </OfflineGate>
  );
}

function SummaryItem({
  label,
  value,
  active,
}: {
  label: string;
  value: string;
  active?: boolean;
}) {
  return (
    <div className={`downloads-summary-item${active ? ' downloads-summary-item-active' : ''}`}>
      <span className="downloads-summary-value">{value}</span>
      <span className="downloads-summary-label">{label}</span>
    </div>
  );
}
