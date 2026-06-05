import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { ContextMenuPortal } from './ContextMenuPortal';
import type { ContextMenuItem, OpenContextMenuOptions } from './types';

interface ContextMenuState {
  open: boolean;
  x: number;
  y: number;
  items: ContextMenuItem[];
}

interface ContextMenuContextValue {
  openMenu: (options: OpenContextMenuOptions) => void;
  closeMenu: () => void;
}

const ContextMenuContext = createContext<ContextMenuContextValue | null>(null);

const CLOSED: ContextMenuState = { open: false, x: 0, y: 0, items: [] };

export function ContextMenuProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ContextMenuState>(CLOSED);

  const closeMenu = useCallback(() => {
    setState(CLOSED);
  }, []);

  const openMenu = useCallback(({ x, y, items }: OpenContextMenuOptions) => {
    const visible = items.filter((it) => !it.hidden && !it.separator);
    if (visible.length === 0) return;
    setState({ open: true, x, y, items });
  }, []);

  const value = useMemo(
    () => ({ openMenu, closeMenu }),
    [openMenu, closeMenu],
  );

  return (
    <ContextMenuContext.Provider value={value}>
      {children}
      {state.open && (
        <ContextMenuPortal
          x={state.x}
          y={state.y}
          items={state.items}
          onClose={closeMenu}
        />
      )}
    </ContextMenuContext.Provider>
  );
}

export function useContextMenuApi(): ContextMenuContextValue {
  const ctx = useContext(ContextMenuContext);
  if (!ctx) {
    throw new Error('useContextMenuApi must be used within ContextMenuProvider');
  }
  return ctx;
}
