import type { ContextMenuItem } from '../../components/contextMenu/types';
import type { LibraryGameActionsDeps } from '../libraryGameActions';
import {
  checkUpdateForGame,
  openInstallFolder,
  openLibraryDetail,
  openMediaViewer,
  openThreadOnF95,
  canUninstallGame,
  hasInstalledFiles,
  pickExeFor,
  playOrStop,
  removeFromLibrary,
  uninstallGameFromMenu,
} from '../libraryGameActions';
import type { LibraryGame } from '../../types/library';
import { openManageCollections } from '../collections';
import { isRenPyEngine, isRpgmEngine, isUnityEngine, isWolfEngine } from '../storeEngine';
import { item, offlineTitle, sep } from './helpers';

function primaryLabel(
  game: LibraryGame,
  isRunning: boolean,
  t: LibraryGameActionsDeps['t'],
): { label: string; disabled: boolean; hidden: boolean } {
  if (isRunning && game.category === 'games') {
    return { label: t('contextMenu.stop'), disabled: false, hidden: false };
  }
  switch (game.installStatus) {
    case 'installed':
      if (game.category !== 'games' && game.installPath) {
        if (game.category === 'comics') {
          return { label: t('contextMenu.read'), disabled: false, hidden: false };
        }
        if (game.category === 'animations') {
          return { label: t('contextMenu.watch'), disabled: false, hidden: false };
        }
        return { label: t('contextMenu.browseMedia'), disabled: false, hidden: false };
      }
      if (game.exePath) return { label: t('contextMenu.play'), disabled: false, hidden: false };
      return { label: t('contextMenu.pickExe'), disabled: false, hidden: false };
    case 'update_available':
      return {
        label: game.availableVersion
          ? t('contextMenu.updateTo', { version: game.availableVersion })
          : t('contextMenu.update'),
        disabled: false,
        hidden: false,
      };
    case 'downloading':
    case 'extracting':
      return { label: '', disabled: true, hidden: true };
    case 'error':
      if (game.category === 'games' && !game.installPath && !game.exePath) {
        return { label: t('contextMenu.install'), disabled: false, hidden: false };
      }
      return { label: '', disabled: true, hidden: true };
    case 'not_installed':
    default:
      if (game.category === 'games') {
        return { label: t('contextMenu.install'), disabled: false, hidden: false };
      }
      return { label: t('contextMenu.pickExe'), disabled: false, hidden: false };
  }
}

export function buildLibraryMenu(
  game: LibraryGame,
  deps: LibraryGameActionsDeps,
): ContextMenuItem[] {
  const { running, isOffline, t, navigate } = deps;
  const isRunning = running.has(game.threadId);
  const primary = primaryLabel(game, isRunning, t);
  const off = offlineTitle(isOffline, t);

  const items: ContextMenuItem[] = [];

  if (!primary.hidden) {
    items.push(
      item('primary', primary.label, () => playOrStop(game, deps), {
        disabled: primary.disabled,
        title: primary.disabled ? off : undefined,
      }),
    );
  }

  items.push(
    item('detail', t('contextMenu.openDetail'), () => openLibraryDetail(game, navigate)),
    item('collections', t('contextMenu.addToCollection'), () =>
      openManageCollections({ threadId: game.threadId, title: game.title }),
    ),
  );

  if (game.installPath) {
    items.push(
      item('folder', t('contextMenu.openFolder'), () => openInstallFolder(game)),
    );
    if (game.category !== 'games') {
      items.push(
        item('viewer', t('contextMenu.openMediaViewer'), () => openMediaViewer(game, navigate)),
      );
    }
    // Sync fast-path of shouldShowSaveEditor (tag gate); probe path is async-only on detail page.
    if (
      game.installStatus === 'installed' &&
      (isRenPyEngine(game.storeTags) ||
        isRpgmEngine(game.storeTags) ||
        isUnityEngine(game.storeTags) ||
        isWolfEngine(game.storeTags))
    ) {
      items.push(
        item('saveEditor', t('libdetail.action.saveEditor'), () =>
          navigate(`/library/game/${game.threadId}/saves`),
        ),
      );
    }
  }

  const showPickExe =
    game.category === 'games' &&
    (game.installStatus === 'not_installed' ||
      (game.installStatus === 'installed' && !game.exePath));

  items.push(
    item(
      'checkUpdate',
      t('contextMenu.checkUpdate'),
      () => checkUpdateForGame(game, deps),
      { disabled: isOffline, title: off },
    ),
    item('f95', t('contextMenu.openOnF95'), () => openThreadOnF95(game), {
      disabled: isOffline,
      title: off,
    }),
  );

  if (showPickExe) {
    items.push(
      item('pickExe', t('contextMenu.pickExe'), () => pickExeFor(game, deps)),
    );
  }

  items.push(sep('sep2'));

  if (hasInstalledFiles(game)) {
    const canUninstall = canUninstallGame(game, running);
    items.push(
      item('uninstall', t('contextMenu.uninstall'), () => uninstallGameFromMenu(game, deps), {
        danger: true,
        disabled: !canUninstall,
        title: !canUninstall && isRunning ? t('libdetail.uninstall.notRunning') : undefined,
      }),
    );
  } else {
    items.push(
      item('remove', t('contextMenu.removeFromLibrary'), () => removeFromLibrary(game, deps), {
        danger: true,
      }),
    );
  }

  return items;
}
