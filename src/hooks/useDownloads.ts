import { useCallback, useEffect, useRef, useState } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import * as downloads from '../lib/downloads';
import * as library from '../lib/library';
import { syncLibraryFromDownloads, recoverStatusAfterDownloadFailure } from '../lib/downloadLibrarySync';
import {
  libraryPathForDownloadRow,
  rememberDownloadLibrary,
} from '../lib/downloadLibraryPath';
import { isHtmlEngine } from '../lib/storeEngine';
import * as libraries from '../lib/libraries';
import * as ipc from '../lib/ipc';
import { loadDownloadSettings } from '../lib/downloadSettings';
import {
  averageSpeedBps,
  EMPTY_GRAPH_HISTORY,
  pushByteSample,
  pushGraphHistory,
  SPEED_SAMPLE_MS,
  sumSpeeds,
  type ByteSample,
  type GraphHistory,
} from '../lib/downloadSpeed';
import { applyDownloadProgress, createGenerationGuard, progressAfterDownloadDone } from '../lib/downloadProgress';
import {
  archiveParentDir,
  extractDirForArchive,
  isArchivePath,
} from '../lib/archives';
import { defaultExeLabel, shouldAutoAssign } from '../lib/installAssign';
import {
  buildBundleExtractDest,
  buildJobExtractDest,
  bundleAlreadyAssigned,
  emitInstallNeedsAssign,
  pickBundleLeadJob,
  shouldAutoExtractDownload,
  shouldRevertExtractFailure,
  withBundleAssignLock,
  withBundleExtractLock,
} from '../lib/installJobExtract';
import {
  bundleExtractReady,
  findJobByDownloadId,
  listJobsForBundle,
  listJobsForPlan,
  markJobAssign,
  markJobExtracted,
  recomputePlanStatus,
} from '../lib/installPlans';
import { dialog } from '../lib/dialog';
import { tStandalone } from '../lib/i18n';
import { extractRawMessage, formatIpcError } from '../lib/ipcError';
import { isExtractCancelled } from '../lib/extractCancel';
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
    if (resolvedDownloadId != null) {
      await downloads.markExtracting(resolvedDownloadId);
    }
    await library.setStatus(threadId, 'extracting');
    onExtracting?.();
  } catch {
    /* row may have been removed mid-extract */
  }
  try {
    if (linkedJob) {
      const planJobs = await listJobsForPlan(linkedJob.planId);
      const bundleSiblings =
        linkedJob.bundleId != null
          ? await listJobsForBundle(linkedJob.bundleId)
          : null;
      const destDir =
        linkedJob.bundleId != null
          ? buildBundleExtractDest({
              archivePath,
              sectionLabel: linkedJob.sectionLabel,
              jobId: linkedJob.id,
              installPath: game.installPath,
              siblingExtractPaths: (bundleSiblings ?? [])
                .filter((j) => j.id !== linkedJob.id)
                .map((j) => j.extractPath),
            })
          : buildJobExtractDest({
              archivePath,
              sectionLabel: linkedJob.sectionLabel,
              jobId: linkedJob.id,
              installPath: game.installPath,
              takenPaths: planJobs
                .filter((j) => j.id !== linkedJob.id)
                .map((j) => j.extractPath),
              jobCount: planJobs.length,
            });
      const preferHtml = isHtmlEngine(game.storeTags);
      const runExtract = async () => {
        const result = await ipc.extractArchive({
          archivePath,
          gameTitle: game.title,
          downloadId: resolvedDownloadId,
          destDir,
          preferHtml,
        });
        await markJobExtracted(linkedJob.id, result.destDir);
        return result;
      };
      const result =
        linkedJob.bundleId != null
          ? await withBundleExtractLock(linkedJob.bundleId, runExtract)
          : await runExtract();

      const dlSettings = await loadDownloadSettings();

      if (linkedJob.bundleId != null) {
        const siblings = await listJobsForBundle(linkedJob.bundleId);
        if (!bundleExtractReady(siblings)) {
          if (wasInstalled) {
            await library.setStatus(threadId, previousStatus);
          } else {
            await library.setStatus(threadId, 'not_installed');
          }
        } else {
          // Claimed lead under lock: only one finishing extract assigns/emits for the lead.
          await withBundleAssignLock(linkedJob.bundleId, async () => {
            const lockedSiblings = await listJobsForBundle(linkedJob.bundleId!);
            if (!bundleExtractReady(lockedSiblings)) return;
            if (bundleAlreadyAssigned(lockedSiblings)) return;

            const lead = pickBundleLeadJob(lockedSiblings) ?? linkedJob;

            const sharedDest = result.destDir;
            let exePath = result.exePath ?? null;
            try {
              const found = await ipc.findMainExe({
                root: sharedDest,
                gameTitle: game.title,
                preferHtml,
              });
              if (found) exePath = found;
            } catch (err) {
              console.warn('[extract] findMainExe on shared dest failed', err);
            }

            if (
              shouldAutoAssign({
                jobCount: 1,
                sectionKind: lead.sectionKind,
                exePath,
              }) &&
              exePath
            ) {
              const exe = await library.addExe(
                threadId,
                exePath,
                defaultExeLabel(lead.sectionLabel, exePath),
              );
              for (const sibling of lockedSiblings) {
                await markJobAssign(sibling.id, 'assigned', { exeId: exe.id });
              }
              await recomputePlanStatus(linkedJob.planId);

              if (gameVersion) {
                await library.applyVersion(threadId, gameVersion);
              }

              if (dlSettings.createShortcuts) {
                try {
                  await ipc.createGameShortcuts({
                    exePath,
                    title: game.title,
                  });
                } catch (err) {
                  console.warn('[extract] failed to create shortcuts', err);
                }
              }
            } else {
              await markJobAssign(lead.id, 'pending', { errorMessage: null });
              await recomputePlanStatus(linkedJob.planId);
              if (wasInstalled) {
                await library.setStatus(threadId, previousStatus);
              } else {
                await library.setStatus(threadId, 'not_installed');
              }
              emitInstallNeedsAssign({
                jobId: lead.id,
                planId: lead.planId,
                threadId,
                exePath,
              });
            }
          });
        }
      } else if (
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

        if (gameVersion) {
          await library.applyVersion(threadId, gameVersion);
        }

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
        // Reset pending after successful extract (clears prior failed + error).
        // Do not applyVersion here — Assigner (Task 7) applies after assign.
        await markJobAssign(linkedJob.id, 'pending', { errorMessage: null });
        await recomputePlanStatus(linkedJob.planId);
        // Do not clobber install_path / exe via setExe.
        if (wasInstalled) {
          await library.setStatus(threadId, previousStatus);
        } else {
          await library.setStatus(threadId, 'not_installed');
        }
        emitInstallNeedsAssign({
          jobId: linkedJob.id,
          planId: linkedJob.planId,
          threadId,
          exePath: result.exePath,
        });
      }

      if (dlSettings.deleteArchiveAfterExtract) {
        try {
          await ipc.deletePath(archivePath);
        } catch (err) {
          console.warn('[extract] failed to delete archive', err);
        }
      }
      try {
        if (resolvedDownloadId != null) {
          await downloads.markExtracted(resolvedDownloadId, result.destDir);
        }
      } catch {
        /* ignore */
      }
      return;
    }

    const result = await ipc.extractArchive({
      archivePath,
      gameTitle: game.title,
      downloadId: resolvedDownloadId,
      preferHtml: isHtmlEngine(game.storeTags),
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
      if (resolvedDownloadId != null) {
        await downloads.markExtracted(resolvedDownloadId, result.destDir);
      }
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
    if (isExtractCancelled(err)) {
      try {
        if (resolvedDownloadId != null) {
          await downloads.markCancelled(resolvedDownloadId);
        }
      } catch {
        /* ignore */
      }
      try {
        const game = await library.get(threadId);
        if (game) {
          await library.setStatus(
            threadId,
            recoverStatusAfterDownloadFailure(game),
          );
        }
      } catch {
        /* ignore */
      }
      return;
    }
    const revert = shouldRevertExtractFailure(linkedJob);
    if (revert) {
      try {
        if (resolvedDownloadId != null) {
          await downloads.markExtractFailed(
            resolvedDownloadId,
            extractRawMessage(err),
          );
        }
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
    } else {
      try {
        if (resolvedDownloadId != null) {
          await downloads.markExtracted(resolvedDownloadId);
        }
      } catch {
        /* ignore */
      }
      try {
        await library.setStatus(
          threadId,
          previousStatus === 'extracting' ? 'installed' : previousStatus,
        );
      } catch {
        /* ignore */
      }
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
  const rows = await downloads.list();
  for (const row of rows) {
    if (row.state !== 'completed' || !row.destPath) continue;
    const linkedJob = await findJobByDownloadId(row.id);
    // After delete-archive, dest_path can still point at the missing .7z/.zip.
    // Point it at the extract folder so Reveal works and Extract is not offered.
    if (linkedJob?.extractPath && isArchivePath(row.destPath)) {
      await downloads.markExtracted(row.id, linkedJob.extractPath);
      continue;
    }
    if (!dlSettings.autoExtract || !isArchivePath(row.destPath)) continue;
    const game = await library.get(row.threadId);
    if (!game || !needsExtraction(row, game)) continue;
    if (!shouldAutoExtractDownload({ job: linkedJob })) continue;
    await tryAutoExtract(row.threadId, row.destPath, row.gameVersion, row.id);
  }
}

export function useDownloads(options?: UseDownloadsOptions): {
  rows: DownloadRow[];
  progress: Record<number, DownloadProgress>;
  speedHistory: GraphHistory;
  reload: () => Promise<void>;
} {
  const [rows, setRows] = useState<DownloadRow[]>([]);
  const [progress, setProgress] = useState<Record<number, DownloadProgress>>({});
  const [speedHistory, setSpeedHistory] = useState<GraphHistory>(EMPTY_GRAPH_HISTORY);
  const progressRef = useRef(progress);
  progressRef.current = progress;
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const extractingRef = useRef(new Set<string>());
  const byteSamplesRef = useRef<Record<number, ByteSample[]>>({});
  const extractSamplesRef = useRef<Record<number, ByteSample[]>>({});
  const reloadGuardRef = useRef(createGenerationGuard());

  const reload = useCallback(async () => {
    const token = reloadGuardRef.current.begin();
    const list = await downloads.list();
    await syncLibraryFromDownloads(list);
    if (!reloadGuardRef.current.isCurrent(token)) return;
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
    const samples = byteSamplesRef.current;
    for (const id of Object.keys(samples)) {
      if (!activeIds.has(Number(id))) delete samples[Number(id)];
    }
    const extractSamples = extractSamplesRef.current;
    for (const id of Object.keys(extractSamples)) {
      if (!activeIds.has(Number(id))) delete extractSamples[Number(id)];
    }
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
        if (!isExtractCancelled(err)) {
          await dialog.alert(
            tStandalone('dllist.extract.failed', { error: formatIpcError(err) }),
            { kind: 'error' },
          );
        }
        if (!cancelled) reload();
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
          if (row?.destPath) {
            await rememberDownloadLibrary(
              e.payload.id,
              await libraryPathForDownloadRow(row),
            );
          }
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
          const now = Date.now();
          const id = e.payload.id;
          const prev = progressRef.current[id];
          const row = rowsRef.current.find((r) => r.id === id);
          const archiveBytes = prev?.total ?? row?.bytesTotal ?? 0;
          const extractedBytes =
            archiveBytes > 0
              ? Math.round((Math.min(100, Math.max(0, e.payload.percent)) / 100) * archiveBytes)
              : 0;
          if (archiveBytes > 0) {
            const samples = extractSamplesRef.current[id] ?? [];
            extractSamplesRef.current[id] = pushByteSample(samples, {
              t: now,
              bytes: extractedBytes,
            });
          }
          const extractSpeedBps = averageSpeedBps(
            extractSamplesRef.current[id] ?? [],
            now,
          );
          setProgress((p) => ({
            ...p,
            [id]: {
              ...(p[id] ?? {
                id,
                bytes: 0,
                total: null,
                speedBps: 0,
              }),
              extractPercent: e.payload.percent,
              extractEtaSecs: e.payload.etaSecs,
              extractSpeedBps,
            },
          }));
        }),
      );
      unlisten.push(
        await listen<ProgressPayload>('download:progress', (e) => {
          if (cancelled) return;
          const now = Date.now();
          const id = e.payload.id;
          const prev = byteSamplesRef.current[id] ?? [];
          byteSamplesRef.current[id] = pushByteSample(prev, {
            t: now,
            bytes: e.payload.bytes,
          });
          const speedBps = averageSpeedBps(byteSamplesRef.current[id]!, now);
          setProgress((p) => ({
            ...p,
            [id]: applyDownloadProgress(p[id], {
              id,
              bytes: e.payload.bytes,
              total: e.payload.total,
              speedBps,
            }),
          }));
        }),
      );
      unlisten.push(
        await listen<DonePayload>('download:done', async (e) => {
          // Snap the bar to 100% before extract so throttled ticks cannot leave
          // the UI under 100% while auto-extract already started.
          if (!cancelled) {
            setProgress((p) => ({
              ...p,
              [e.payload.id]: progressAfterDownloadDone(
                p[e.payload.id],
                e.payload.id,
                e.payload.bytes,
              ),
            }));
          }
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
          if (
            dlSettings.autoExtract &&
            archivePaths.length > 0 &&
            shouldAutoExtractDownload({ job: linkedJob })
          ) {
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
          const linkedJob = await findJobByDownloadId(e.payload.id);
          if (linkedJob) {
            try {
              await markJobAssign(linkedJob.id, 'failed', {
                errorMessage: e.payload.message || 'download failed',
              });
              await recomputePlanStatus(linkedJob.planId);
            } catch {
              /* ignore */
            }
          }
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

    const historyTimer = window.setInterval(() => {
      if (cancelled) return;
      const now = Date.now();
      const downloadSpeeds: number[] = [];
      for (const samples of Object.values(byteSamplesRef.current)) {
        downloadSpeeds.push(averageSpeedBps(samples, now));
      }
      const extractSpeeds: number[] = [];
      for (const samples of Object.values(extractSamplesRef.current)) {
        extractSpeeds.push(averageSpeedBps(samples, now));
      }
      const downloadBps = sumSpeeds(downloadSpeeds);
      const extractBps = sumSpeeds(extractSpeeds);
      setSpeedHistory((prev) => pushGraphHistory(prev, downloadBps, extractBps));
    }, SPEED_SAMPLE_MS);

    return () => {
      cancelled = true;
      window.clearInterval(historyTimer);
      for (const u of unlisten) u();
    };
  }, [reload, options?.onNeedsFileChoice]);

  return { rows, progress, speedHistory, reload };
}
