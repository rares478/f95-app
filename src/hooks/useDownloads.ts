import { useCallback, useEffect, useRef, useState } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import * as downloads from '../lib/downloads';
import * as library from '../lib/library';
import { syncLibraryFromDownloads, recoverStatusAfterDownloadFailure } from '../lib/downloadLibrarySync';
import * as libraries from '../lib/libraries';
import * as ipc from '../lib/ipc';
import { loadDownloadSettings } from '../lib/downloadSettings';
import {
  archiveParentDir,
  extractDirForArchive,
  isArchivePath,
} from '../lib/archives';
import { defaultExeLabel, shouldAutoAssign } from '../lib/installAssign';
import {
  buildJobExtractDest,
  emitInstallNeedsAssign,
} from '../lib/installJobExtract';
import {
  findJobByDownloadId,
  listJobsForPlan,
  markJobAssign,
  markJobExtracted,
  recomputePlanStatus,
} from '../lib/installPlans';
import { dialog } from '../lib/dialog';
import { tStandalone } from '../lib/i18n';
import { extractRawMessage, formatIpcError } from '../lib/ipcError';
import type { DownloadProgress, DownloadRow } from '../types/download';
import type { LibraryGame } from '../types/library';

function archivePathsFromDone(payload: DonePayload): string[] {
  if (payload.filePaths && payload.filePaths.length > 0) {
    return payload.filePaths.filter((p) => isArchivePath(p));
  }
  return isArchivePath(payload.filePath) ? [payload.filePath] : [];
}

/** True when the library row still points at the archive folder, not the extract dir. */
function needsExtraction(row: DownloadRow, game: LibraryGame): boolean {
  if (!row.destPath || !isArchivePath(row.destPath)) return false;
  const extractDir = extractDirForArchive(row.destPath);
  if (game.installPath === extractDir) return false;
  if (game.installStatus === 'extracting') return false;
  if (game.installStatus === 'installed' || game.installStatus === 'update_available') {
    return false;
  }
  const archiveDir = archiveParentDir(row.destPath);
  const atArchiveStage =
    !game.installPath ||
    game.installPath === archiveDir ||
    game.installPath === row.destPath;
  return (
    game.installStatus === 'downloading' ||
    game.installStatus === 'error' ||
    (game.installStatus === 'not_installed' && atArchiveStage)
  );
}

export async function runExtraction(
  threadId: string,
  archivePath: string,
  gameVersion?: string | null,
  downloadId?: number | null,
  onExtracting?: () => void,
): Promise<void> {
  let game = await library.get(threadId);
  if (!game) {
    throw new Error('Game is not in the library');
  }
  let resolvedDownloadId = downloadId ?? null;
  if (resolvedDownloadId == null) {
    const rows = await downloads.listByThread(threadId);
    resolvedDownloadId =
      rows.find((row) => row.destPath === archivePath)?.id ?? null;
  }
  const linkedJob =
    resolvedDownloadId != null
      ? await findJobByDownloadId(resolvedDownloadId)
      : null;
  const previousInstallDir = game.installPath;
  const previousStatus = game.installStatus;
  const wasInstalled =
    game.installStatus === 'installed' || game.installStatus === 'update_available';

  try {
    await downloads.markExtracting(threadId, archivePath);
    await library.setStatus(threadId, 'extracting');
    onExtracting?.();
  } catch {
    /* row may have been removed mid-extract */
  }
  try {
    if (linkedJob) {
      const planJobs = await listJobsForPlan(linkedJob.planId);
      const destDir = buildJobExtractDest({
        archivePath,
        sectionLabel: linkedJob.sectionLabel,
        jobId: linkedJob.id,
        installPath: game.installPath,
        takenPaths: planJobs
          .filter((j) => j.id !== linkedJob.id)
          .map((j) => j.extractPath),
        jobCount: planJobs.length,
      });
      const result = await ipc.extractArchive({
        archivePath,
        gameTitle: game.title,
        downloadId: resolvedDownloadId,
        destDir,
      });
      await markJobExtracted(linkedJob.id, result.destDir);

      const dlSettings = await loadDownloadSettings();

      if (
        shouldAutoAssign({
          jobCount: planJobs.length,
          sectionKind: linkedJob.sectionKind,
          exePath: result.exePath,
        }) &&
        result.exePath
      ) {
        const exe = await library.addExe(
          threadId,
          result.exePath,
          defaultExeLabel(linkedJob.sectionLabel, result.exePath),
        );
        await markJobAssign(linkedJob.id, 'assigned', { exeId: exe.id });
        await recomputePlanStatus(linkedJob.planId);

        if (dlSettings.createShortcuts) {
          try {
            await ipc.createGameShortcuts({
              exePath: result.exePath,
              title: game.title,
            });
          } catch (err) {
            console.warn('[extract] failed to create shortcuts', err);
          }
        }
      } else {
        // Leave assign_status pending; do not clobber install_path / exe via setExe.
        if (wasInstalled) {
          await library.setStatus(threadId, previousStatus);
        } else {
          await library.setStatus(threadId, 'not_installed');
        }
        emitInstallNeedsAssign({
          jobId: linkedJob.id,
          planId: linkedJob.planId,
          threadId,
        });
      }

      if (gameVersion) {
        await library.applyVersion(threadId, gameVersion);
      }

      if (dlSettings.deleteArchiveAfterExtract) {
        try {
          await ipc.deletePath(archivePath);
        } catch (err) {
          console.warn('[extract] failed to delete archive', err);
        }
      }
      try {
        await downloads.markExtracted(threadId, archivePath);
      } catch {
        /* ignore */
      }
      return;
    }

    const result = await ipc.extractArchive({
      archivePath,
      gameTitle: game.title,
      downloadId: resolvedDownloadId,
    });
    const cat = game.category ?? 'games';
    const mediaOnly = cat === 'comics' || cat === 'animations' || cat === 'assets';

    await library.setInstallPath(threadId, result.destDir);
    if (result.exePath) {
      await library.setExe(threadId, result.exePath);
    } else if (mediaOnly) {
      await library.markInstalled(threadId, result.destDir);
    } else if (cat === 'mods') {
      await library.markInstalled(threadId, result.destDir);
    } else {
      await library.setStatus(threadId, 'not_installed');
    }
    if (gameVersion) {
      await library.applyVersion(threadId, gameVersion);
    }

    const dlSettings = await loadDownloadSettings();
    if (dlSettings.deleteArchiveAfterExtract) {
      try {
        await ipc.deletePath(archivePath);
      } catch (err) {
        console.warn('[extract] failed to delete archive', err);
      }
    }
    try {
      await downloads.markExtracted(threadId, archivePath);
    } catch {
      /* ignore */
    }
    if (dlSettings.createShortcuts && result.exePath) {
      try {
        await ipc.createGameShortcuts({
          exePath: result.exePath,
          title: game.title,
        });
      } catch (err) {
        console.warn('[extract] failed to create shortcuts', err);
      }
    }

    if (
      wasInstalled &&
      previousInstallDir &&
      previousInstallDir !== result.destDir
    ) {
      try {
        const migration = await ipc.migrateSaves({
          oldInstallDir: previousInstallDir,
          newInstallDir: result.destDir,
        });
        if (migration.copied > 0) {
          console.info(
            `[update] migrated ${migration.copied} save dir(s) ` +
              `(${migration.bytes_copied} bytes) from old install`,
          );
        }
      } catch (err) {
        console.warn('[update] save migration failed', err);
      }
      try {
        const safeRoots = await libraries.allPaths();
        const deleted = await ipc.deleteInstallDir({
          path: previousInstallDir,
          safeRoots,
        });
        if (!deleted) {
          console.warn(
            '[update] previous install was outside every install library; left in place',
            previousInstallDir,
          );
        }
      } catch (err) {
        console.warn('[update] failed to remove old install dir', err);
      }
    }
  } catch (err) {
    console.error('[extract] failed', err);
    try {
      await downloads.markExtractFailed(threadId, archivePath, extractRawMessage(err));
    } catch {
      /* ignore */
    }
    if (linkedJob) {
      try {
        await markJobAssign(linkedJob.id, 'failed', {
          errorMessage: extractRawMessage(err),
        });
        await recomputePlanStatus(linkedJob.planId);
      } catch {
        /* ignore */
      }
    }
    try {
      const game = await library.get(threadId);
      if (game) {
        await library.setStatus(threadId, recoverStatusAfterDownloadFailure(game));
      }
    } catch {
      /* ignore */
    }
    throw err;
  }
}

interface ResolvingPayload {
  id: number;
}
interface ResolvedPayload {
  id: number;
  fileName: string;
  fileSize: number | null;
  directUrl: string;
  destPath: string;
}
interface ProgressPayload {
  id: number;
  bytes: number;
  total: number | null;
  speedBps: number;
}
interface ExtractProgressPayload {
  id: number;
  percent: number;
  etaSecs: number | null;
}
interface DonePayload {
  id: number;
  bytes: number;
  filePath: string;
  filePaths?: string[];
}
interface ErrorPayload {
  id: number;
  message: string;
}
interface NeedsBrowserPayload {
  id: number;
  url: string;
  host: string;
  captcha?: boolean;
}

export interface NeedsFileChoicePayload {
  id: number;
  threadId: string;
  libraryPath?: string | null;
  host: string;
  sourceUrl: string;
  platformGroup: string | null;
  recommendedFileId?: string | null;
  files: Array<{
    id: string;
    fileName: string;
    fileSize: number | null;
    platformLabel: string | null;
  }>;
}

export interface UseDownloadsOptions {
  onNeedsFileChoice?: (req: {
    downloadId: number;
    threadId: string;
    libraryPath?: string | null;
    host: string;
    platformGroup: string | null;
    recommendedFileId?: string | null;
    files: NeedsFileChoicePayload['files'];
  }) => void;
}

async function reconcilePendingExtractions(
  tryAutoExtract: (
    threadId: string,
    archivePath: string,
    gameVersion?: string | null,
    downloadId?: number,
  ) => Promise<void>,
): Promise<void> {
  const dlSettings = await loadDownloadSettings();
  if (!dlSettings.autoExtract) return;

  const rows = await downloads.list();
  for (const row of rows) {
    if (row.state !== 'completed' || !row.destPath || !isArchivePath(row.destPath)) continue;
    const game = await library.get(row.threadId);
    if (!game || !needsExtraction(row, game)) continue;
    await tryAutoExtract(row.threadId, row.destPath, row.gameVersion, row.id);
  }
}

export function useDownloads(options?: UseDownloadsOptions): {
  rows: DownloadRow[];
  progress: Record<number, DownloadProgress>;
  reload: () => Promise<void>;
} {
  const [rows, setRows] = useState<DownloadRow[]>([]);
  const [progress, setProgress] = useState<Record<number, DownloadProgress>>({});
  const progressRef = useRef(progress);
  progressRef.current = progress;
  const extractingRef = useRef(new Set<string>());

  const reload = useCallback(async () => {
    const list = await downloads.list();
    await syncLibraryFromDownloads(list);
    setRows(list);
    const activeIds = new Set(
      list
        .filter(
          (r) =>
            r.state === 'downloading' ||
            r.state === 'resolving' ||
            r.state === 'awaiting_choice' ||
            r.state === 'extracting',
        )
        .map((r) => r.id),
    );
    setProgress((p) => {
      let mutated = false;
      const out: Record<number, DownloadProgress> = {};
      for (const [k, v] of Object.entries(p)) {
        const id = Number(k);
        if (activeIds.has(id)) out[id] = v;
        else mutated = true;
      }
      return mutated ? out : p;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    const unlisten: UnlistenFn[] = [];

    async function tryAutoExtract(
      threadId: string,
      archivePath: string,
      gameVersion?: string | null,
      downloadId?: number,
    ): Promise<void> {
      const key = `${threadId}:${archivePath}`;
      if (extractingRef.current.has(key)) return;
      extractingRef.current.add(key);
      try {
        await runExtraction(threadId, archivePath, gameVersion, downloadId, () => {
          if (!cancelled) reload();
        });
        if (!cancelled) reload();
      } catch (err) {
        console.error('[extract] auto failed', err);
        await dialog.alert(
          tStandalone('dllist.extract.failed', { error: formatIpcError(err) }),
          { kind: 'error' },
        );
      } finally {
        extractingRef.current.delete(key);
      }
    }

    reload();

    async function setup() {
      unlisten.push(
        await listen<ResolvingPayload>('download:resolving', async (e) => {
          await downloads.markResolving(e.payload.id);
          const row = await downloads.get(e.payload.id);
          if (row) {
            try {
              await library.setStatus(row.threadId, 'downloading');
            } catch {
              /* not in library */
            }
          }
          if (!cancelled) reload();
        }),
      );
      unlisten.push(
        await listen<ResolvedPayload>('download:resolved', async (e) => {
          await downloads.markResolved(e.payload.id, {
            resolvedUrl: e.payload.directUrl,
            destPath: e.payload.destPath,
            bytesTotal: e.payload.fileSize,
          });
          const row = await downloads.get(e.payload.id);
          if (row) {
            try {
              await library.setStatus(row.threadId, 'downloading');
            } catch {
              /* not in library */
            }
          }
          if (!cancelled) reload();
        }),
      );
      unlisten.push(
        await listen<ExtractProgressPayload>('extract:progress', (e) => {
          if (cancelled) return;
          setProgress((p) => ({
            ...p,
            [e.payload.id]: {
              ...(p[e.payload.id] ?? {
                id: e.payload.id,
                bytes: 0,
                total: null,
                speedBps: 0,
              }),
              extractPercent: e.payload.percent,
              extractEtaSecs: e.payload.etaSecs,
            },
          }));
        }),
      );
      unlisten.push(
        await listen<ProgressPayload>('download:progress', (e) => {
          if (cancelled) return;
          setProgress((p) => ({
            ...p,
            [e.payload.id]: {
              id: e.payload.id,
              bytes: e.payload.bytes,
              total: e.payload.total,
              speedBps: e.payload.speedBps,
            },
          }));
        }),
      );
      unlisten.push(
        await listen<DonePayload>('download:done', async (e) => {
          await downloads.markDone(e.payload.id, {
            bytes: e.payload.bytes,
            filePath: e.payload.filePath,
          });
          const row = await downloads.get(e.payload.id);
          if (!row) {
            if (!cancelled) reload();
            return;
          }
          const linkedJob = await findJobByDownloadId(e.payload.id);
          if (!linkedJob) {
            // Legacy / Browse-all: point install_path at the archive folder until extract.
            // Plan jobs must not clobber an existing multi-part install_path here.
            const archiveFolder = e.payload.filePath.replace(/[\\/][^\\/]+$/, '');
            try {
              await library.setInstallPath(row.threadId, archiveFolder);
            } catch {
              /* not in library */
            }
          }
          const archivePaths = archivePathsFromDone(e.payload);
          const dlSettings = await loadDownloadSettings();
          if (dlSettings.autoExtract && archivePaths.length > 0) {
            for (const archivePath of archivePaths) {
              await tryAutoExtract(row.threadId, archivePath, row.gameVersion, row.id);
            }
          }
          if (!cancelled) reload();
        }),
      );
      unlisten.push(
        await listen<ErrorPayload>('download:error', async (e) => {
          const liveBytes = progressRef.current[e.payload.id]?.bytes;
          await downloads.markError(e.payload.id, e.payload.message, liveBytes);
          const row = await downloads.get(e.payload.id);
          if (row) {
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
          }
          if (!cancelled) reload();
        }),
      );
      unlisten.push(
        await listen<NeedsFileChoicePayload>('download:needs-choice', async (e) => {
          await downloads.markAwaitingChoice(e.payload.id);
          options?.onNeedsFileChoice?.({
            downloadId: e.payload.id,
            threadId: e.payload.threadId,
            libraryPath: e.payload.libraryPath,
            host: e.payload.host,
            platformGroup: e.payload.platformGroup,
            recommendedFileId: e.payload.recommendedFileId,
            files: e.payload.files,
          });
          if (!cancelled) reload();
        }),
      );
      unlisten.push(
        await listen<NeedsBrowserPayload>('download:needs-browser', async (e) => {
          await downloads.markNeedsBrowser(e.payload.id, {
            host: e.payload.host,
            url: e.payload.url,
          });
          if (e.payload.captcha) {
            try {
              await ipc.openCaptchaWindow({
                downloadId: e.payload.id,
                url: e.payload.url,
                host: e.payload.host,
              });
            } catch (err) {
              console.warn('[captcha] open webview failed', err);
            }
          }
          if (!cancelled) reload();
        }),
      );

      if (!cancelled) {
        await reconcilePendingExtractions(tryAutoExtract);
        if (!cancelled) reload();
      }
    }
    setup();

    return () => {
      cancelled = true;
      for (const u of unlisten) u();
    };
  }, [reload, options?.onNeedsFileChoice]);

  return { rows, progress, reload };
}
