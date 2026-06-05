import { useCallback } from 'react';
import type { ContextMenuItem } from './types';
import { useContextMenuApi } from './ContextMenuProvider';

export function useContextMenu() {
  const { openMenu, closeMenu } = useContextMenuApi();

  const openContextMenu = useCallback(
    (e: React.MouseEvent, items: ContextMenuItem[]) => {
      e.preventDefault();
      e.stopPropagation();
      openMenu({ x: e.clientX, y: e.clientY, items });
    },
    [openMenu],
  );

  const openMenuAt = useCallback(
    (x: number, y: number, items: ContextMenuItem[]) => {
      openMenu({ x, y, items });
    },
    [openMenu],
  );

  return { openContextMenu, openMenuAt, closeMenu };
}
