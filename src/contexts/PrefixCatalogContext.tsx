import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { buildPrefixCatalog, type PrefixMeta } from '../lib/prefixCatalog';
import { loadStoredPrefixCatalog, savePrefixCatalog } from '../lib/prefixCatalogStorage';
import type { SamPrefixGroup } from '../types/sam';

type PrefixCatalogContextValue = {
  catalog: Map<number, PrefixMeta>;
  setFromGroups: (groups: SamPrefixGroup[]) => void;
  resolve: (id: number) => PrefixMeta | null;
};

const PrefixCatalogContext = createContext<PrefixCatalogContextValue | null>(null);

export function PrefixCatalogProvider({ children }: { children: ReactNode }) {
  const [catalog, setCatalog] = useState<Map<number, PrefixMeta>>(() => loadStoredPrefixCatalog());

  const setFromGroups = useCallback((groups: SamPrefixGroup[]) => {
    if (groups.length === 0) return;
    const next = buildPrefixCatalog(groups);
    setCatalog(next);
    savePrefixCatalog(groups);
  }, []);

  const resolve = useCallback(
    (id: number): PrefixMeta | null => catalog.get(id) ?? null,
    [catalog],
  );

  const value = useMemo(
    () => ({ catalog, setFromGroups, resolve }),
    [catalog, setFromGroups, resolve],
  );

  return (
    <PrefixCatalogContext.Provider value={value}>{children}</PrefixCatalogContext.Provider>
  );
}

export function usePrefixCatalog(): PrefixCatalogContextValue {
  const ctx = useContext(PrefixCatalogContext);
  if (!ctx) {
    throw new Error('usePrefixCatalog must be used within PrefixCatalogProvider');
  }
  return ctx;
}
