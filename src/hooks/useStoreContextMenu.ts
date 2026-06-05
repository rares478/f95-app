import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOffline } from '../contexts/Offline';
import { useT } from '../lib/i18n';
import { useContextMenu } from '../components/contextMenu';
import { buildStoreMenu } from '../lib/contextMenus/buildStoreMenu';
import * as library from '../lib/library';
import type { SamCategory, SamGameCard } from '../types/sam';

export function useStoreContextMenu(category: SamCategory) {
  const navigate = useNavigate();
  const { isOffline } = useOffline();
  const { t } = useT();
  const { openMenuAt } = useContextMenu();
  const [, setTick] = useState(0);

  const openStoreContextMenu = useCallback(
    async (e: React.MouseEvent, game: SamGameCard) => {
      e.preventDefault();
      e.stopPropagation();
      const x = e.clientX;
      const y = e.clientY;
      const inLibrary = await library.isInLibrary(game.threadId);
      openMenuAt(
        x,
        y,
        buildStoreMenu(game, {
          navigate,
          category,
          isOffline,
          inLibrary,
          t,
          onLibraryChange: () => setTick((n) => n + 1),
        }),
      );
    },
    [navigate, category, isOffline, t, openMenuAt],
  );

  return { openStoreContextMenu };
}
