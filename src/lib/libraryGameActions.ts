import { open as openFileDialog } from '@tauri-apps/plugin-dialog';
import { openUrl } from '@tauri-apps/plugin-opener';
import type { NavigateFunction } from 'react-router-dom';
import * as ipc from './ipc';
import * as library from './library';
import * as downloads from './downloads';
import * as updates from './updates';
import { inFlightLibraryStatus } from './downloadLibrarySync';
import * as uninstall from './uninstall';
import { dialog } from './dialog';
import { formatIpcError } from './ipcError';
import type { LibraryGame } from '../types/library';

export type TranslateFn = (
  key: string,
  vars?: Record<string, string | number>,
) => string;

export interface LibraryGameActionsDeps {
  navigate: NavigateFunction;
  launch: (
    game: LibraryGame,
    opts?: { exePath?: string; exeId?: string },
  ) => Promise<void>;
  running: Set<string>;
  isOffline: boolean;
  t: TranslateFn;
  onReload?: () => void | Promise<void>;
  onInstallOrUpdate?: (game: LibraryGame) => void | Promise<void>;
}

export async function playOrStop(
  game: LibraryGame,
  deps: LibraryGameActionsDeps,
): Promise<void> {
  const { running, launch, navigate } = deps;
  if (running.has(game.threadId)) {
    try {
      await ipc.stopGame(game.threadId);
    } catch (err) {
      await dialog.alert(formatIpcError(err), { kind: 'error' });
    }
    return;
  }
  if (game.installStatus === 'update_available') {
    if (deps.onInstallOrUpdate) {
      await deps.onInstallOrUpdate(game);
    } else {
      navigate(`/store/game/${game.threadId}?cat=${game.category}`);
    }
    return;
  }
  const dlRows = await downloads.listByThread(game.threadId);
  const inFlight = inFlightLibraryStatus(dlRows, game.threadId);
  if (inFlight === 'needs_attention') {
    navigate('/downloads');
    return;
  }
  if (inFlight) return;
  if (game.installStatus === 'installed' && game.installPath && game.category !== 'games') {
    navigate(`/library/game/${game.threadId}/view`);
    return;
  }
  if (game.installStatus === 'installed' && game.category === 'mods' && game.exePath) {
    try {
      await launch(game);
    } catch (err) {
      await dialog.alert(formatIpcError(err), { kind: 'error' });
    }
    return;
  }
  if (game.installStatus === 'installed' && game.exePath) {
    try {
      await launch(game);
    } catch (err) {
      await dialog.alert(formatIpcError(err), { kind: 'error' });
    }
    return;
  }
  if (
    (game.installStatus === 'not_installed' ||
      (game.installStatus === 'error' && !game.installPath && !game.exePath)) &&
    game.category === 'games'
  ) {
    if (deps.onInstallOrUpdate) {
      await deps.onInstallOrUpdate(game);
    } else {
      await pickExeFor(game, deps);
    }
    return;
  }
  if (
    game.installStatus === 'not_installed' ||
    (game.installStatus === 'installed' && !game.exePath)
  ) {
    await pickExeFor(game, deps);
  }
}

export async function pickExeFor(
  game: LibraryGame,
  deps: LibraryGameActionsDeps,
): Promise<void> {
  const selected = await openFileDialog({
    multiple: false,
    directory: false,
    title: deps.t('contextMenu.pickExeTitle', { title: game.title }),
    filters: [
      { name: deps.t('contextMenu.exeFilter'), extensions: ['exe', 'html', 'htm', 'sh', 'app', 'bat', 'cmd'] },
      { name: deps.t('contextMenu.allFilter'), extensions: ['*'] },
    ],
  });
  if (typeof selected !== 'string') return;
  const filename = selected.replace(/^.*[/\\]/, '');
  const label = await dialog.prompt(deps.t('libdetail.exe.labelPrompt'), {
    title: deps.t('libdetail.exe.labelTitle'),
    defaultValue: filename,
  });
  if (label === null) return;
  try {
    await library.addExe(game.threadId, selected, label);
  } catch (err) {
    if (err instanceof Error && err.message === 'DUPLICATE_EXE_PATH') {
      await dialog.alert(deps.t('libdetail.exe.duplicate'), { kind: 'warning' });
      return;
    }
    throw err;
  }
  await deps.onReload?.();
}

export async function openInstallFolder(game: LibraryGame): Promise<void> {
  if (!game.installPath) return;
  try {
    await ipc.revealInExplorer(game.installPath);
  } catch (err) {
    await dialog.alert(formatIpcError(err), { kind: 'error' });
  }
}

export function openLibraryDetail(
  game: LibraryGame,
  navigate: NavigateFunction,
): void {
  navigate(`/library/game/${game.threadId}`);
}

export function openMediaViewer(
  game: LibraryGame,
  navigate: NavigateFunction,
): void {
  navigate(`/library/game/${game.threadId}/view`);
}

export async function checkUpdateForGame(
  game: LibraryGame,
  deps: LibraryGameActionsDeps,
): Promise<void> {
  if (deps.isOffline) {
    await dialog.alert(deps.t('offline.actionBlocked'), { kind: 'info' });
    return;
  }
  const result = await updates.checkOne(game);
  await deps.onReload?.();
  if (result.error) {
    await dialog.alert(deps.t('libdetail.update.failed', { error: result.error }));
  } else if (result.hasUpdate) {
    await dialog.alert(
      deps.t('libdetail.update.found', { version: result.latestVersion ?? '' }),
    );
  } else {
    await dialog.alert(deps.t('libdetail.update.uptodate'), { kind: 'info' });
  }
}

export function hasInstalledFiles(game: LibraryGame): boolean {
  return !!(game.installPath || game.exePath);
}

export function canUninstallGame(game: LibraryGame, running: Set<string>): boolean {
  return (
    hasInstalledFiles(game) &&
    !running.has(game.threadId) &&
    game.installStatus !== 'downloading' &&
    game.installStatus !== 'extracting'
  );
}

export async function uninstallGameFromMenu(
  game: LibraryGame,
  deps: LibraryGameActionsDeps,
): Promise<void> {
  const { running, navigate, t, onReload } = deps;
  if (running.has(game.threadId)) {
    await dialog.alert(t('libdetail.uninstall.notRunning'));
    return;
  }
  if (game.installStatus === 'downloading' || game.installStatus === 'extracting') {
    await dialog.alert(t('libdetail.uninstall.waitDownload'));
    return;
  }
  const ok = await dialog.confirm(t('libdetail.confirmUninstall', { title: game.title }), {
    title: t('libdetail.confirmUninstallTitle'),
    kind: 'warning',
  });
  if (!ok) return;

  const hadInstallFiles = hasInstalledFiles(game);
  try {
    const result = await uninstall.uninstallGame(game.threadId);
    const removeFromLibrary = await dialog.ask(
      t('libdetail.uninstall.askRemoveLibrary', { title: game.title }),
      {
        title: t('libdetail.uninstall.askRemoveLibraryTitle'),
        kind: 'warning',
      },
    );
    if (removeFromLibrary) {
      await library.remove(game.threadId);
      navigate('/library');
      return;
    }
    await onReload?.();
    if (result.skippedPaths.length > 0) {
      await dialog.alert(
        t('libdetail.uninstall.partial', { paths: result.skippedPaths.join('\n') }),
      );
    } else if (!result.deleted && hadInstallFiles) {
      await dialog.alert(t('libdetail.uninstall.outsideLibrary'));
    }
  } catch (err) {
    await dialog.alert(t('libdetail.uninstall.failed', { error: formatIpcError(err) }));
  }
}

export async function removeFromLibrary(
  game: LibraryGame,
  deps: LibraryGameActionsDeps,
): Promise<void> {
  const ok = await dialog.confirm(
    deps.t('contextMenu.removeFromLibraryConfirm', { title: game.title }),
    { title: deps.t('contextMenu.removeFromLibraryTitle'), kind: 'warning' },
  );
  if (!ok) return;
  await library.remove(game.threadId);
  await deps.onReload?.();
}

export function openThreadOnF95(game: LibraryGame): void {
  void openUrl(game.threadUrl);
}
