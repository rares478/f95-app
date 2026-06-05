import type { ContextMenuItem } from '../../components/contextMenu/types';
import type { LibraryGameActionsDeps } from '../libraryGameActions';
import { buildLibraryMenu } from './buildLibraryMenu';
import { item, offlineTitle } from './helpers';
import type { LibraryGame } from '../../types/library';

export interface LibraryDetailMenuExtra {
  onPickExe?: () => void | Promise<void>;
  onOpenStore?: () => void;
}

export function buildLibraryDetailMenu(
  game: LibraryGame,
  deps: LibraryGameActionsDeps,
  extra: LibraryDetailMenuExtra = {},
): ContextMenuItem[] {
  const items = buildLibraryMenu(game, deps);
  const off = offlineTitle(deps.isOffline, deps.t);

  if (extra.onPickExe && game.category === 'games') {
    items.splice(
      items.findIndex((i) => i.id === 'checkUpdate') || items.length,
      0,
      item('pickExeDetail', deps.t('contextMenu.pickExe'), extra.onPickExe),
    );
  }

  if (game.installStatus === 'update_available' && extra.onOpenStore) {
    items.splice(
      0,
      0,
      item('updateNow', deps.t('contextMenu.update'), extra.onOpenStore, {
        disabled: deps.isOffline,
        title: off,
      }),
    );
  }

  return items;
}
