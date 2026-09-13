import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import DOMPurify from 'dompurify';
import { dialog } from '../lib/dialog';
import { openUrl } from '@tauri-apps/plugin-opener';
import * as ipc from '../lib/ipc';
import { GameDescription } from '../components/game/GameDescription';
import * as library from '../lib/library';
import * as libraries from '../lib/libraries';
import * as sessions from '../lib/sessions';
import * as updates from '../lib/updates';
import * as uninstall from '../lib/uninstall';
import { useRunningGames } from '../contexts/RunningGames';
import { useOffline } from '../contexts/Offline';
import { InstallLocationModal } from '../components/InstallLocationModal';
import { MoveProgressModal } from '../components/MoveProgressModal';
import { useCachedImageUrl } from '../lib/libraryThumbnailCache';
import { clearLibraryPreviewCache } from '../lib/libraryPreviewQueue';
import { clearGridPreviewCache } from '../lib/gridPreviewQueue';
import { clearRemoteImageQueue } from '../lib/remoteImageQueue';
import {
  GameDetailBackBar,
  GameDetailBody,
  GameDetailBtnPrimary,
  GameDetailBtnSecondary,
  GameDetailChip,
  GameDetailError,
  GameDetailHero,
  GameDetailLoading,
  GameDetailMain,
  GameDetailShell,
  GameDetailSection,
  GameDetailAside,
} from '../components/game/GameDetailLayout';
import { ThreadDiscussion } from '../components/game/ThreadDiscussion';
import { useLibraryGameActions } from '../hooks/useLibraryGameActions';
import { useLibraryInstallFlow } from '../hooks/useLibraryInstallFlow';
import { useDownloads } from '../contexts/Downloads';
import { inFlightLibraryStatus } from '../lib/downloadLibrarySync';
import { pickExeFor } from '../lib/libraryGameActions';
import { resolvePlayExe, type LibraryGameExe } from '../lib/libraryExes';
import { SplitInstallButton } from '../components/library/SplitInstallButton';
import { SplitPlayButton } from '../components/library/SplitPlayButton';
import { catalogHasMultipleSeasons } from '../lib/installCatalog';
import { LibraryGameManageModal } from '../components/library/LibraryGameManageModal';
import { useT } from '../lib/i18n';
import { translateBackendMessage } from '../lib/backendMessage';
import { formatIpcError } from '../lib/ipcError';
import type { GameDetail } from '../types/game';
import type { LibraryGame } from '../types/library';
import type { PlaySession } from '../types/session';
import type { InstallLibraryWithDisk } from '../types/install-library';
import { formatPlaytime } from '../types/library';
import type { SamCategory } from '../types/sam';
import { shouldShowSaveEditor } from '../lib/saveEditorGate';
import { detectInstallPlatform } from '../lib/installSections';

function categoryLabelKey(cat: SamCategory): string {
  return `libdetail.category.${cat}`;
}

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'missing' }
  | { kind: 'ready'; game: LibraryGame };

export function LibraryGamePage() {
  const { t } = useT();
  const { isOffline } = useOffline();
  const { threadId } = useParams<{ threadId: string }>();
  const navigate = useNavigate();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [storeDetail, setStoreDetail] = useState<GameDetail | null>(null);
  const [notesDraft, setNotesDraft] = useState('');
  const [recentSessions, setRecentSessions] = useState<PlaySession[]>([]);
  const [sessionCount, setSessionCount] = useState(0);
  const [launching, setLaunching] = useState(false);
  const [exes, setExes] = useState<LibraryGameExe[]>([]);
  const [uninstalling, setUninstalling] = useState(false);
  const [movePickerOpen, setMovePickerOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [currentLibId, setCurrentLibId] = useState<number | undefined>(undefined);
  const [moveInFlight, setMoveInFlight] = useState<{
    destPath: string;
    totalBytes: number;
  } | null>(null);
  const { running, launch } = useRunningGames();
  const isRunning = threadId ? running.has(threadId) : false;
  const { rows: downloadRows } = useDownloads();
  const downloadSyncKey = useMemo(
    () =>
      downloadRows
        .filter((r) => threadId != null && r.threadId === threadId)
        .map((r) => `${r.id}:${r.state}`)
        .join('|'),
    [downloadRows, threadId],
  );
  const readyGame = state.kind === 'ready' ? state.game : null;
  const [showSaveEditor, setShowSaveEditor] = useState(false);
  const bannerRemote = readyGame
    ? storeDetail?.bannerUrl ?? readyGame.thumbnailUrl
    : null;
  const coverRemote = readyGame
    ? readyGame.thumbnailUrl ?? storeDetail?.bannerUrl
    : null;
  const cachedBannerUrl = useCachedImageUrl(bannerRemote, 0);
  const cachedCoverUrl = useCachedImageUrl(coverRemote, 0);

  const reload = useCallback(async () => {
    if (!threadId) return;
    setState({ kind: 'loading' });
    try {
      const game = await library.get(threadId);
      if (!game) {
        setState({ kind: 'missing' });
        return;
      }
      setNotesDraft(game.notes);
      const [recs, count] = await Promise.all([
        sessions.recent(threadId, 12),
        sessions.countForThread(threadId),
      ]);
      setRecentSessions(recs);
      setSessionCount(count);
      const exeRows = await library.listExes(threadId);
      setExes(exeRows);
      setState({ kind: 'ready', game });
      if (game.installPath) {
        const owning = await libraries.findContaining(game.installPath);
        setCurrentLibId(owning?.id);
      } else {
        setCurrentLibId(undefined);
      }
    } catch (err) {
      setState({ kind: 'error', message: formatIpcError(err) });
    }
  }, [threadId]);

  const installFlow = useLibraryInstallFlow({ onStarted: () => { void reload(); } });
  const { deps: libraryActionDeps, openLibraryDetailContextMenu } = useLibraryGameActions({
    onReload: reload,
    onInstallOrUpdate: installFlow.beginInstallOrUpdate,
  });

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    if (!threadId || !downloadSyncKey) return;
    let cancelled = false;
    library.get(threadId).then((game) => {
      if (cancelled || !game) return;
      setState((prev) => (prev.kind === 'ready' ? { kind: 'ready', game } : prev));
    });
    return () => {
      cancelled = true;
    };
  }, [downloadSyncKey, threadId]);

  useEffect(
    () => () => {
      clearRemoteImageQueue();
      clearGridPreviewCache();
      clearLibraryPreviewCache();
    },
    [],
  );

  useEffect(() => {
    if (!threadId || state.kind !== 'ready') return;
    let cancelled = false;
    ipc
      .gameDetail(threadId)
      .then((detail) => {
        if (!cancelled) setStoreDetail(detail);
      })
      .catch(() => {
        if (!cancelled) setStoreDetail(null);
      });
    return () => {
      cancelled = true;
    };
  }, [threadId, state.kind]);

  useEffect(() => {
    if (!isRunning && state.kind === 'ready') {
      reload();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRunning]);

  useEffect(() => {
    if (!readyGame) {
      setShowSaveEditor(false);
      return;
    }
    let cancelled = false;
    setShowSaveEditor(false);
    shouldShowSaveEditor(readyGame)
      .then((v) => {
        if (!cancelled) setShowSaveEditor(v);
      })
      .catch(() => {
        if (!cancelled) setShowSaveEditor(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    readyGame?.threadId,
    readyGame?.installStatus,
    readyGame?.installPath,
    readyGame?.storeTags,
  ]);

  if (state.kind === 'loading') {
    return (
      <Shell>
        <GameDetailLoading />
      </Shell>
    );
  }

  if (state.kind === 'error') {
    return (
      <Shell>
        <GameDetailError message={state.message} />
      </Shell>
    );
  }

  if (state.kind === 'missing') {
    return (
      <Shell>
        <div className="game-detail-state">
          {t('libdetail.missing')}
          <div style={{ marginTop: 12 }}>
            <button
              type="button"
              className="game-detail-btn game-detail-btn-secondary"
              onClick={() => navigate('/library')}
            >
              {t('libdetail.missing.back')}
            </button>
          </div>
        </div>
      </Shell>
    );
  }

  const g = state.game;
  const displayStatus =
    inFlightLibraryStatus(downloadRows, g.threadId) ?? g.installStatus;
  const downloadInFlight =
    displayStatus === 'downloading' || displayStatus === 'extracting';
  const resolvedExe = resolvePlayExe(exes);
  const otherExes = resolvedExe
    ? exes.filter((e) => e.id !== resolvedExe.id)
    : exes;
  const playDisabled = (!g.exePath && !resolvedExe) || launching;
  const isWindows = detectInstallPlatform() === 'windows';
  const hasLaunchExe = Boolean(g.exePath || resolvedExe);

  async function onPickExe() {
    if (downloadInFlight) return;
    await pickExeFor(g, libraryActionDeps);
  }

  async function onRemove() {
    setManageOpen(false);
    const ok = await dialog.confirm(t('libdetail.confirmRemove', { title: g.title }), {
      title: t('libdetail.confirmRemoveTitle'),
      kind: 'warning',
    });
    if (!ok) return;
    await library.remove(g.threadId);
    navigate('/library');
  }

  async function onSaveNotes() {
    if (notesDraft === g.notes) return;
    await library.setNotes(g.threadId, notesDraft);
    await reload();
  }

  async function onLocaleEmulatorChange(enabled: boolean) {
    await library.updateLocaleEmulatorEnabled(g.threadId, enabled);
    await reload();
  }

  async function onRemoveTag(tag: string) {
    await library.setCustomTags(
      g.threadId,
      g.customTags.filter((t) => t !== tag),
    );
    await reload();
  }

  async function onOpenInstallFolder() {
    if (!g.installPath) return;
    try {
      await ipc.revealInExplorer(g.installPath);
    } catch (err) {
      console.warn('open install folder failed', err);
    }
  }

  async function onPlay() {
    if (!g.exePath && exes.length === 0) {
      await dialog.alert(t('libdetail.play.needExe'));
      return;
    }
    if (isRunning || launching) return;
    setLaunching(true);
    try {
      // Goes through the context's `launch` helper so the Hydra-style
      // overlay shows up while the game spawns. The overlay clears
      // itself once `game:started` fires. Prefer the resolved row so a
      // stale game.exePath cache can't spawn the wrong binary.
      await launch(
        g,
        resolvedExe
          ? { exePath: resolvedExe.exePath, exeId: resolvedExe.id }
          : undefined,
      );
      await reload();
    } catch (err) {
      await dialog.alert(t('libdetail.play.failed', { error: formatIpcError(err) }));
    } finally {
      setLaunching(false);
    }
  }

  async function onPlayExe(exe: LibraryGameExe) {
    if (isRunning || launching) return;
    setLaunching(true);
    try {
      await launch(g, { exePath: exe.exePath, exeId: exe.id });
      await reload();
    } catch (err) {
      await dialog.alert(t('libdetail.play.failed', { error: formatIpcError(err) }));
    } finally {
      setLaunching(false);
    }
  }

  async function onStop() {
    try {
      await ipc.stopGame(g.threadId);
    } catch (err) {
      await dialog.alert(t('libdetail.stop.failed', { error: formatIpcError(err) }));
    }
  }

  async function onCheckUpdate() {
    if (isOffline) {
      await dialog.alert(t('offline.actionBlocked'), { kind: 'info' });
      return;
    }
    try {
      const result = await updates.checkOne(g);
      await reload();
      if (result.error) {
        await dialog.alert(t('libdetail.update.failed', { error: result.error }));
      } else if (result.hasUpdate) {
        await dialog.alert(t('libdetail.update.found', { version: result.latestVersion ?? '' }));
      } else {
        await dialog.alert(t('libdetail.update.uptodate'));
      }
    } catch (err) {
      await dialog.alert(t('libdetail.update.generic', { error: formatIpcError(err) }));
    }
  }

  function onOpenViewer() {
    navigate(`/library/game/${g.threadId}/view`);
  }

  const isGame = g.category === 'games';
  const canInstallSeason =
    isGame && catalogHasMultipleSeasons(g.downloadLinks ?? []);
  const canOpenViewer =
    !isGame &&
    !!g.installPath &&
    (g.installStatus === 'installed' || g.installStatus === 'update_available');

  async function onMoveLibraryPicked(lib: InstallLibraryWithDisk) {
    setMovePickerOpen(false);
    if (!g.installPath) return;
    if (isRunning) {
      await dialog.alert(t('libdetail.move.notRunning'));
      return;
    }
    try {
      const result = await ipc.moveInstallStart({
        threadId: g.threadId,
        oldInstallPath: g.installPath,
        oldExePath: g.exePath,
        newLibraryPath: lib.path,
      });
      setMoveInFlight({
        destPath: result.destInstallPath,
        totalBytes: result.totalBytes,
      });
    } catch (err) {
      await dialog.alert(t('libdetail.move.failed', { error: formatIpcError(err) }));
    }
  }

  async function onMoveComplete(args: {
    newInstallPath: string;
    newExePath: string | null;
  }) {
    try {
      await library.setInstallPath(g.threadId, args.newInstallPath);
      if (args.newExePath) {
        await library.setExe(g.threadId, args.newExePath);
      }
    } catch (err) {
      console.warn('[move] failed to repoint DB', err);
    }
    setMoveInFlight(null);
    await reload();
  }

  async function onMoveClosed(reason: 'cancelled' | 'error', message?: string) {
    setMoveInFlight(null);
    if (reason === 'error' && message) {
      await dialog.alert(t('libdetail.move.error', { error: translateBackendMessage(message, t) }), {
        kind: 'error',
      });
    }
  }

  const hasInstallFiles = !!(g.installPath || g.exePath);
  const canUninstall =
    hasInstallFiles &&
    !isRunning &&
    g.installStatus !== 'downloading' &&
    g.installStatus !== 'extracting' &&
    !downloadInFlight;

  async function onUninstall() {
    if (isRunning) {
      await dialog.alert(t('libdetail.uninstall.notRunning'));
      return;
    }
    if (g.installStatus === 'downloading' || g.installStatus === 'extracting' || downloadInFlight) {
      await dialog.alert(t('libdetail.uninstall.waitDownload'));
      return;
    }
    setManageOpen(false);
    const ok = await dialog.confirm(t('libdetail.confirmUninstall', { title: g.title }), {
      title: t('libdetail.confirmUninstallTitle'),
      kind: 'warning',
    });
    if (!ok) return;
    setUninstalling(true);
    try {
      const result = await uninstall.uninstallGame(g.threadId);
      const removeFromLibrary = await dialog.ask(
        t('libdetail.uninstall.askRemoveLibrary', { title: g.title }),
        {
          title: t('libdetail.uninstall.askRemoveLibraryTitle'),
          kind: 'warning',
        },
      );
      if (removeFromLibrary) {
        await library.remove(g.threadId);
        navigate('/library');
        return;
      }
      await reload();
      if (result.skippedPaths.length > 0) {
        await dialog.alert(t('libdetail.uninstall.partial', { paths: result.skippedPaths.join('\n') }));
      } else if (!result.deleted && hasInstallFiles) {
        await dialog.alert(t('libdetail.uninstall.outsideLibrary'));
      }
    } catch (err) {
      await dialog.alert(t('libdetail.uninstall.failed', { error: formatIpcError(err) }));
    } finally {
      setUninstalling(false);
    }
  }

  return (
    <Shell
      onContextMenu={(e) =>
        openLibraryDetailContextMenu(e, g, {
          onPickExe,
        })
      }
    >
      <GameDetailHero
        bannerUrl={cachedBannerUrl}
        coverUrl={cachedCoverUrl}
        badges={
          <span
            className="game-detail-prefix"
            style={{ background: 'var(--border-strong)' }}
          >
            {t(categoryLabelKey(g.category))}
          </span>
        }
        title={g.title}
        meta={
          <>
            {g.currentVersion && (
              <GameDetailChip accent title={t('libdetail.location.version')}>
                {g.currentVersion}
              </GameDetailChip>
            )}
            {g.availableVersion && g.availableVersion !== g.currentVersion && (
              <GameDetailChip title={t('libdetail.location.available')}>
                → {g.availableVersion}
              </GameDetailChip>
            )}
            {isGame && (
              <>
                <GameDetailChip>{formatPlaytime(g.totalPlaytimeSeconds)}</GameDetailChip>
                <GameDetailChip>
                  {t('libdetail.chip.sessions', { count: sessionCount })}
                </GameDetailChip>
                {g.lastPlayedAt && (
                  <GameDetailChip>
                    {t('libdetail.lastPlayed', {
                      when: new Date(g.lastPlayedAt).toLocaleString(),
                    })}
                  </GameDetailChip>
                )}
              </>
            )}
          </>
        }
        actions={
          isGame ? (
            <>
              {isRunning ? (
                <GameDetailBtnPrimary
                  onClick={onStop}
                  className="game-detail-btn-stop"
                >
                  {t('libdetail.action.stop')}
                </GameDetailBtnPrimary>
              ) : downloadInFlight ? (
                <GameDetailBtnPrimary disabled title={t('libcard.cta.inFlight.title')}>
                  {displayStatus === 'extracting'
                    ? t('libcard.cta.extracting')
                    : t('libcard.cta.downloading')}
                </GameDetailBtnPrimary>
              ) : displayStatus === 'not_installed' ? (
                <SplitInstallButton
                  busy={installFlow.busy}
                  disabled={downloadInFlight}
                  onInstall={() => void installFlow.beginInstallOrUpdate(g)}
                  onAddExe={() => void onPickExe()}
                  title={t('libcard.cta.install.title')}
                />
              ) : displayStatus === 'update_available' ? (
                <GameDetailBtnPrimary
                  onClick={() => void installFlow.beginInstallOrUpdate(g)}
                  disabled={installFlow.busy}
                  className="game-detail-btn-update"
                  title={
                    g.availableVersion
                      ? t('libcard.cta.update.title', { version: g.availableVersion })
                      : t('libcard.cta.update.titleSimple')
                  }
                >
                  {g.availableVersion
                    ? t('libcard.cta.updateTo', { version: g.availableVersion })
                    : t('libcard.cta.update')}
                </GameDetailBtnPrimary>
              ) : (
                <SplitPlayButton
                  launching={launching}
                  disabled={playDisabled || isRunning}
                  others={otherExes}
                  onPlay={() => void onPlay()}
                  onPlayExe={(exe) => void onPlayExe(exe)}
                  onInstallSeason={
                    canInstallSeason
                      ? () =>
                          void installFlow.beginInstallOrUpdate(g, {
                            preferSeasonStep: true,
                          })
                      : undefined
                  }
                  installSeasonBusy={installFlow.busy}
                  title={
                    !g.exePath && !resolvedExe
                      ? t('libdetail.action.play.hintExe')
                      : launching
                        ? t('libdetail.action.play.hintLaunch')
                        : t('libdetail.action.play.title')
                  }
                />
              )}
              <GameDetailBtnSecondary
                onClick={() => navigate(`/store/game/${g.threadId}?cat=${g.category}`)}
              >
                {t('libdetail.action.storePage')}
              </GameDetailBtnSecondary>
              <GameDetailBtnSecondary onClick={() => setManageOpen(true)}>
                {t('libdetail.action.manage')}
              </GameDetailBtnSecondary>
            </>
          ) : (
            <>
              {canOpenViewer && (
                <GameDetailBtnPrimary onClick={onOpenViewer}>
                  {t('libdetail.action.openViewer')}
                </GameDetailBtnPrimary>
              )}
              {g.category === 'mods' && (g.exePath || exes.length > 0) && (
                otherExes.length > 0 ? (
                  <SplitPlayButton
                    variant="secondary"
                    launching={launching}
                    disabled={playDisabled || isRunning}
                    others={otherExes}
                    onPlay={() => void onPlay()}
                    onPlayExe={(exe) => void onPlayExe(exe)}
                  />
                ) : (
                  <GameDetailBtnSecondary onClick={onPlay} disabled={launching || isRunning}>
                    {launching ? t('libdetail.action.launching') : t('libdetail.action.play')}
                  </GameDetailBtnSecondary>
                )
              )}
              <GameDetailBtnSecondary onClick={onOpenInstallFolder}>
                {t('common.open')}
              </GameDetailBtnSecondary>
              <GameDetailBtnSecondary
                onClick={() => navigate(`/store/game/${g.threadId}?cat=${g.category}`)}
              >
                {t('libdetail.action.storePage')}
              </GameDetailBtnSecondary>
              <GameDetailBtnSecondary onClick={() => setManageOpen(true)}>
                {t('libdetail.action.manage')}
              </GameDetailBtnSecondary>
            </>
          )
        }
      />

      <GameDetailBody>
        <GameDetailMain>
          {storeDetail?.changelogHtml ? (
            <GameDetailSection title={t('libdetail.section.changelog')}>
              <GameDescription
                html={DOMPurify.sanitize(storeDetail.changelogHtml, {
                  ADD_TAGS: ['details', 'summary', 'button'],
                  ADD_ATTR: ['target', 'rel', 'loading', 'type', 'hidden'],
                })}
                className="libdetail-changelog-body"
                style={{ fontSize: 13.5, lineHeight: 1.65, wordBreak: 'break-word' }}
              />
            </GameDetailSection>
          ) : null}

          <GameDetailSection title={t('gamedetail.section.discussion')}>
            <ThreadDiscussion threadId={g.threadId} offline={isOffline} />
          </GameDetailSection>
        </GameDetailMain>

        <GameDetailAside>
          <GameDetailSection title={t('libdetail.section.notes')}>
            <textarea
              value={notesDraft}
              onChange={(e) => setNotesDraft(e.target.value)}
              onBlur={onSaveNotes}
              placeholder={t('libdetail.notes.placeholder')}
              rows={10}
              className="game-detail-notes"
            />
          </GameDetailSection>
        </GameDetailAside>
      </GameDetailBody>

      <LibraryGameManageModal
        open={manageOpen}
        game={g}
        exes={exes}
        recentSessions={recentSessions}
        resolvedExeId={resolvedExe?.id ?? null}
        isRunning={isRunning}
        downloadInFlight={downloadInFlight}
        launching={launching}
        uninstalling={uninstalling}
        showSaveEditor={showSaveEditor}
        isWindows={isWindows}
        hasLaunchExe={hasLaunchExe}
        hasInstallFiles={hasInstallFiles}
        canUninstall={canUninstall}
        libraryActionDeps={libraryActionDeps}
        onClose={() => setManageOpen(false)}
        onCheckUpdate={onCheckUpdate}
        onOpenInstallFolder={onOpenInstallFolder}
        onOpenThread={() => void openUrl(g.threadUrl)}
        onLocaleEmulatorChange={onLocaleEmulatorChange}
        onMove={() => {
          setManageOpen(false);
          setMovePickerOpen(true);
        }}
        onUninstall={onUninstall}
        onRemove={onRemove}
        onPlayExe={(exe) => void onPlayExe(exe)}
        onExesChanged={reload}
        onAddTag={async (tag) => {
          const trimmed = tag.trim();
          if (!trimmed) return;
          if (g.customTags.includes(trimmed)) return;
          await library.setCustomTags(g.threadId, [...g.customTags, trimmed]);
          await reload();
        }}
        onRemoveTag={onRemoveTag}
      />

      <InstallLocationModal
        open={movePickerOpen}
        title={t('libdetail.move.modalTitle', { title: g.title })}
        description={<span>{t('libdetail.move.modalHint')}</span>}
        primaryLabel={t('libdetail.move.modalConfirm')}
        excludeLibraryId={currentLibId}
        onCancel={() => setMovePickerOpen(false)}
        onConfirm={onMoveLibraryPicked}
      />

      {installFlow.modal}

      {moveInFlight && (
        <MoveProgressModal
          open
          threadId={g.threadId}
          totalBytesHint={moveInFlight.totalBytes}
          destPath={moveInFlight.destPath}
          onComplete={onMoveComplete}
          onClosed={onMoveClosed}
        />
      )}
    </Shell>
  );
}

function Shell({
  children,
  onContextMenu,
}: {
  children: React.ReactNode;
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  const navigate = useNavigate();
  const { t } = useT();
  return (
    <GameDetailShell onContextMenu={onContextMenu}>
      <GameDetailBackBar
        onBack={() => navigate('/library')}
        breadcrumbTo="/library"
        breadcrumbLabel={t('nav.library')}
      />
      {children}
    </GameDetailShell>
  );
}
