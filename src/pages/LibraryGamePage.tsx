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
  GameDetailActionItem,
  GameDetailActionList,
  GameDetailBackBar,
  GameDetailBody,
  GameDetailBtnPrimary,
  GameDetailBtnSecondary,
  GameDetailBtnDanger,
  GameDetailChip,
  GameDetailError,
  GameDetailField,
  GameDetailFields,
  GameDetailHero,
  GameDetailLoading,
  GameDetailMain,
  GameDetailShell,
  GameDetailSection,
  GameDetailStat,
  GameDetailStatGrid,
  GameDetailAside,
  GameDetailTag,
} from '../components/game/GameDetailLayout';
import { useLibraryGameActions } from '../hooks/useLibraryGameActions';
import { useLibraryInstallFlow } from '../hooks/useLibraryInstallFlow';
import { useDownloads } from '../contexts/Downloads';
import { inFlightLibraryStatus } from '../lib/downloadLibrarySync';
import { pickExeFor } from '../lib/libraryGameActions';
import { resolvePlayExe, type LibraryGameExe } from '../lib/libraryExes';
import { SplitPlayButton } from '../components/library/SplitPlayButton';
import { catalogHasMultipleSeasons } from '../lib/installCatalog';
import { LibraryExesSection } from '../components/library/LibraryExesSection';
import { useT } from '../lib/i18n';
import { translateBackendMessage } from '../lib/backendMessage';
import { formatIpcError } from '../lib/ipcError';
import type { GameDetail } from '../types/game';
import type { LibraryGame } from '../types/library';
import type { PlaySession } from '../types/session';
import type { InstallLibraryWithDisk } from '../types/install-library';
import { formatPlaytime, statusColor, statusKey } from '../types/library';
import type { SamCategory } from '../types/sam';
import { shouldShowSaveEditor } from '../lib/saveEditorGate';

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
  const [tagDraft, setTagDraft] = useState('');
  const [recentSessions, setRecentSessions] = useState<PlaySession[]>([]);
  const [launching, setLaunching] = useState(false);
  const [exes, setExes] = useState<LibraryGameExe[]>([]);
  const [uninstalling, setUninstalling] = useState(false);
  const [movePickerOpen, setMovePickerOpen] = useState(false);
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
      const recs = await sessions.recent(threadId, 12);
      setRecentSessions(recs);
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

  async function onPickExe() {
    if (downloadInFlight) return;
    await pickExeFor(g, libraryActionDeps);
  }

  async function onRemove() {
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

  async function onAddTag() {
    const tag = tagDraft.trim();
    if (!tag) return;
    if (g.customTags.includes(tag)) {
      setTagDraft('');
      return;
    }
    await library.setCustomTags(g.threadId, [...g.customTags, tag]);
    setTagDraft('');
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

  const statusBg = isRunning ? 'var(--status-success)' : statusColor(displayStatus);

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
          <>
            <span
              className="game-detail-prefix"
              style={{ background: 'var(--border-strong)' }}
            >
              {t(categoryLabelKey(g.category))}
            </span>
            <span
              className="game-detail-prefix"
              style={{ background: statusBg }}
            >
              {isRunning ? t('libdetail.running') : t(statusKey(displayStatus))}
            </span>
          </>
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
                <GameDetailBtnPrimary
                  onClick={() => void installFlow.beginInstallOrUpdate(g)}
                  disabled={installFlow.busy}
                  title={t('libcard.cta.install.title')}
                >
                  {t('libcard.cta.install')}
                </GameDetailBtnPrimary>
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
              {exes.length === 0 && (
                <GameDetailBtnSecondary onClick={onPickExe} disabled={downloadInFlight}>
                  {t('libdetail.exe.add')}
                </GameDetailBtnSecondary>
              )}
              <GameDetailBtnSecondary onClick={onCheckUpdate}>
                {t('libdetail.action.checkUpdate')}
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
            </>
          )
        }
      />

      <GameDetailStatGrid>
        <GameDetailStat
          label={t('libdetail.location.status')}
          value={isRunning ? t('libdetail.running') : t(statusKey(displayStatus))}
          highlight={isRunning}
        />
        {isGame && (
          <GameDetailStat
            label={t('libdetail.stats.playtime')}
            value={formatPlaytime(g.totalPlaytimeSeconds)}
          />
        )}
        <GameDetailStat
          label={t('libdetail.location.version')}
          value={g.currentVersion ?? '—'}
          highlight={!!g.availableVersion && g.availableVersion !== g.currentVersion}
        />
        {isGame && (
          <>
            <GameDetailStat
              label={t('libdetail.stats.sessions')}
              value={recentSessions.length}
            />
            {g.lastPlayedAt && (
              <GameDetailStat
                label={t('libdetail.stats.lastPlayed')}
                value={new Date(g.lastPlayedAt).toLocaleDateString()}
              />
            )}
          </>
        )}
      </GameDetailStatGrid>

      <GameDetailBody>
        <GameDetailMain>
          {storeDetail?.changelogHtml ? (
            <GameDetailSection title={t('libdetail.section.changelog')}>
              <details className="libdetail-changelog">
                <summary>{t('libdetail.changelog.show')}</summary>
                <GameDescription
                  html={DOMPurify.sanitize(storeDetail.changelogHtml, {
                    ADD_TAGS: ['details', 'summary', 'button'],
                    ADD_ATTR: ['target', 'rel', 'loading', 'type', 'hidden'],
                  })}
                  className="libdetail-changelog-body"
                  style={{ fontSize: 13.5, lineHeight: 1.65, wordBreak: 'break-word' }}
                />
              </details>
            </GameDetailSection>
          ) : null}

          <GameDetailSection title={t('libdetail.section.notes')}>
            <textarea
              value={notesDraft}
              onChange={(e) => setNotesDraft(e.target.value)}
              onBlur={onSaveNotes}
              placeholder={t('libdetail.notes.placeholder')}
              rows={6}
              className="game-detail-notes"
            />
          </GameDetailSection>

          {isGame && (
          <GameDetailSection title={t('libdetail.section.sessions')}>
            {recentSessions.length === 0 ? (
              <div className="game-detail-empty-hint">{t('libdetail.sessions.empty')}</div>
            ) : (
              <ul className="game-detail-session-list">
                {recentSessions.map((s) => (
                  <li key={s.id} className="game-detail-session-row">
                    <span className="game-detail-session-when">
                      {new Date(s.startedAt).toLocaleString()}
                    </span>
                    <span className="game-detail-session-dur">
                      {s.endedAt
                        ? formatPlaytime(s.durationSeconds ?? 0)
                        : isRunning
                          ? t('libdetail.sessions.running')
                          : t('libdetail.sessions.interrupted')}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </GameDetailSection>
          )}

          <GameDetailSection title={t('libdetail.section.storeTags')}>
            <div className="game-detail-tags">
              {g.storeTags.length === 0 && (
                <span className="game-detail-empty-hint">
                  {t('libdetail.storeTags.empty')}
                </span>
              )}
              {g.storeTags.map((tag) => (
                <GameDetailTag key={tag}>{tag}</GameDetailTag>
              ))}
            </div>
          </GameDetailSection>

          <GameDetailSection title={t('libdetail.section.tags')}>
            <div className="game-detail-tags">
              {g.customTags.length === 0 && (
                <span className="game-detail-empty-hint">{t('libdetail.tags.empty')}</span>
              )}
              {g.customTags.map((tag) => (
                <span key={tag} className="game-detail-custom-tag">
                  {tag}
                  <button
                    type="button"
                    onClick={() => onRemoveTag(tag)}
                    className="game-detail-tag-remove"
                    aria-label={t('common.remove')}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <div className="game-detail-tag-input-row">
              <input
                type="text"
                value={tagDraft}
                onChange={(e) => setTagDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onAddTag();
                }}
                placeholder={t('libdetail.tags.input')}
                className="game-detail-tag-input"
              />
              <button type="button" onClick={onAddTag} className="game-detail-tag-add">
                {t('common.add')}
              </button>
            </div>
          </GameDetailSection>
        </GameDetailMain>

        <GameDetailAside>
          <GameDetailSection title={t('libdetail.section.location')}>
            <GameDetailFields>
              <GameDetailField
                label={t('libdetail.location.status')}
                value={t(statusKey(displayStatus))}
              />
              <GameDetailField
                label={t('libdetail.location.version')}
                value={g.currentVersion ?? '—'}
              />
              {g.availableVersion && g.availableVersion !== g.currentVersion && (
                <GameDetailField
                  label={t('libdetail.location.available')}
                  value={g.availableVersion}
                />
              )}
              <GameDetailField
                label={t('libdetail.location.folder')}
                value={g.installPath ?? '—'}
                actionLabel={g.installPath ? t('common.open') : undefined}
                onAction={onOpenInstallFolder}
              />
              <GameDetailField
                label={t('libdetail.location.added')}
                value={new Date(g.addedAt).toLocaleString()}
              />
            </GameDetailFields>

            <div style={{ marginTop: 14 }}>
              <h3
                className="game-detail-section-title"
                style={{ marginTop: 0, marginBottom: 10, borderBottom: 'none', paddingBottom: 0 }}
              >
                {t('libdetail.exe.section')}
              </h3>
              <LibraryExesSection
                game={g}
                exes={exes}
                resolvedId={resolvedExe?.id ?? null}
                onChanged={reload}
                onPlayExe={onPlayExe}
                deps={libraryActionDeps}
                disabled={downloadInFlight || isRunning || launching}
              />
            </div>

            {hasInstallFiles && (
              <div className="game-detail-uninstall-block">
                <p className="game-detail-uninstall-hint">
                  {t('libdetail.uninstall.hint')}
                </p>
                <GameDetailBtnDanger
                  onClick={onUninstall}
                  disabled={!canUninstall || uninstalling}
                  title={
                    isRunning
                      ? t('libdetail.uninstall.notRunning')
                      : g.installStatus === 'downloading' || g.installStatus === 'extracting' || downloadInFlight
                        ? t('libdetail.uninstall.waitDownload')
                        : t('libdetail.action.uninstall.title')
                  }
                >
                  {uninstalling
                    ? t('libdetail.action.uninstalling')
                    : t('libdetail.action.uninstall')}
                </GameDetailBtnDanger>
              </div>
            )}
          </GameDetailSection>

          <GameDetailSection title={t('libdetail.section.actions')}>
            <GameDetailActionList>
              <GameDetailActionItem to={`/store/game/${g.threadId}?cat=${g.category}`}>
                {t('libdetail.action.viewStore')}
              </GameDetailActionItem>
              <GameDetailActionItem onClick={() => openUrl(g.threadUrl)}>
                {t('libdetail.action.openThread')}
              </GameDetailActionItem>
              {showSaveEditor && (
                <GameDetailActionItem to={`/library/game/${g.threadId}/saves`}>
                  {t('libdetail.action.saveEditor')}
                </GameDetailActionItem>
              )}
              {g.installPath && (
                <GameDetailActionItem
                  disabled={isRunning}
                  title={
                    isRunning
                      ? t('libdetail.action.move.disabledTitle')
                      : t('libdetail.action.move.title')
                  }
                  onClick={() => setMovePickerOpen(true)}
                >
                  {t('libdetail.action.move')}
                </GameDetailActionItem>
              )}
              <GameDetailActionItem onClick={onRemove} danger>
                {t('libdetail.action.removeFromLibrary')}
              </GameDetailActionItem>
            </GameDetailActionList>
          </GameDetailSection>
        </GameDetailAside>
      </GameDetailBody>

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
