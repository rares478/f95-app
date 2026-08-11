import type { ContextMenuItem } from '../../components/contextMenu/types';
import type { NavigateFunction } from 'react-router-dom';
import { openUrl } from '@tauri-apps/plugin-opener';
import * as library from '../library';
import * as ipc from '../ipc';
import { saveLinksFromDetail } from '../libraryDownloadLinks';
import { copyTextWithFeedback } from '../clipboard';
import type { SamCategory, SamGameCard } from '../../types/sam';

/** Fields required for store context menu actions. */
export type StoreMenuGame = Pick<
  SamGameCard,
  'threadId' | 'title' | 'threadUrl' | 'thumbnailUrl' | 'version'
>;
import type { TranslateFn } from '../libraryGameActions';
import { item, offlineTitle, sep } from './helpers';

export interface StoreMenuDeps {
  navigate: NavigateFunction;
  category: SamCategory;
  isOffline: boolean;
  inLibrary: boolean;
  t: TranslateFn;
  onLibraryChange?: () => void;
}

export function buildStoreMenu(game: StoreMenuGame, deps: StoreMenuDeps): ContextMenuItem[] {
  const { navigate, category, isOffline, inLibrary, t, onLibraryChange } = deps;
  const off = offlineTitle(isOffline, t);

  return [
    item('detail', t('contextMenu.openStoreDetail'), () => {
      navigate(`/store/game/${game.threadId}?cat=${category}`);
    }),
    item(
      'add',
      t('contextMenu.addToLibrary'),
      async () => {
        await library.add({
          threadId: game.threadId,
          category,
          title: game.title,
          threadUrl: game.threadUrl,
          thumbnailUrl: game.thumbnailUrl,
          currentVersion: game.version,
        });
        try {
          const detail = await ipc.gameDetail(game.threadId);
          await saveLinksFromDetail(game.threadId, detail);
        } catch (err) {
          console.warn('[library] failed to cache download links on add', err);
        }
        onLibraryChange?.();
      },
      { hidden: inLibrary, disabled: isOffline, title: off },
    ),
    item('f95', t('contextMenu.openOnF95'), () => openUrl(game.threadUrl), {
      disabled: isOffline,
      title: off,
    }),
    item('copy', t('contextMenu.copyLink'), () => copyTextWithFeedback(game.threadUrl)),
    sep('sep'),
    item('library', t('contextMenu.openInLibrary'), () => {
      navigate(`/library/game/${game.threadId}`);
    }, { hidden: !inLibrary }),
  ];
}
