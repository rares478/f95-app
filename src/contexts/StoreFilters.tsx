import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from 'react';
import type {
  PrefixFilterMode,
  SamCategory,
  SamSort,
  SamTag,
  SamTagMode,
} from '../types/sam';

export interface StoreFiltersState {
  category: SamCategory;
  search: string;
  sort: SamSort;
  prefixFilter: Record<number, PrefixFilterMode>;
  includeTags: SamTag[];
  excludeTags: SamTag[];
  tagMode: SamTagMode;
}

const DEFAULT_FILTERS: StoreFiltersState = {
  category: 'games',
  search: '',
  sort: 'date',
  prefixFilter: {},
  includeTags: [],
  excludeTags: [],
  tagMode: 'and',
};

interface StoreFiltersValue extends StoreFiltersState {
  setSearch: (search: string) => void;
  setSort: (sort: SamSort) => void;
  setPrefixFilter: (filter: Record<number, PrefixFilterMode>) => void;
  setIncludeTags: (tags: SamTag[]) => void;
  setExcludeTags: (tags: SamTag[]) => void;
  setTagMode: (mode: SamTagMode) => void;
  changeCategory: (category: SamCategory) => void;
  clearAll: () => void;
}

const Ctx = createContext<StoreFiltersValue | null>(null);

export function StoreFiltersProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<StoreFiltersState>(DEFAULT_FILTERS);

  const changeCategory = useCallback((next: SamCategory) => {
    setState((prev) => {
      if (prev.category === next) return prev;
      return { ...DEFAULT_FILTERS, category: next };
    });
  }, []);

  const clearAll = useCallback(() => {
    setState((prev) => ({ ...DEFAULT_FILTERS, category: prev.category }));
  }, []);

  const value: StoreFiltersValue = {
    ...state,
    setSearch: (search) => setState((prev) => ({ ...prev, search })),
    setSort: (sort) => setState((prev) => ({ ...prev, sort })),
    setPrefixFilter: (prefixFilter) => setState((prev) => ({ ...prev, prefixFilter })),
    setIncludeTags: (includeTags) => setState((prev) => ({ ...prev, includeTags })),
    setExcludeTags: (excludeTags) => setState((prev) => ({ ...prev, excludeTags })),
    setTagMode: (tagMode) => setState((prev) => ({ ...prev, tagMode })),
    changeCategory,
    clearAll,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStoreFilters(): StoreFiltersValue {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error('useStoreFilters must be used within StoreFiltersProvider');
  }
  return ctx;
}
