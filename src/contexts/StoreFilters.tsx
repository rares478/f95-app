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
  showIgnored: boolean;
}

const DEFAULT_FILTERS: StoreFiltersState = {
  category: 'games',
  search: '',
  sort: 'date',
  prefixFilter: {},
  includeTags: [],
  excludeTags: [],
  tagMode: 'and',
  showIgnored: false,
};

interface StoreFiltersValue extends StoreFiltersState {
  setSearch: (search: string) => void;
  setSort: (sort: SamSort) => void;
  setPrefixFilter: (filter: Record<number, PrefixFilterMode>) => void;
  setIncludeTags: (tags: SamTag[]) => void;
  setExcludeTags: (tags: SamTag[]) => void;
  setTagMode: (mode: SamTagMode) => void;
  setShowIgnored: (showIgnored: boolean) => void;
  changeCategory: (category: SamCategory) => void;
  /** Reset other filters and include a single tag (used from game detail). */
  filterByTag: (tag: SamTag, category?: SamCategory) => void;
  /** Reset to defaults, then apply provided fields (Browse handoff). */
  seedFilters: (partial: Partial<StoreFiltersState>) => void;
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

  const filterByTag = useCallback((tag: SamTag, category?: SamCategory) => {
    setState((prev) => ({
      ...DEFAULT_FILTERS,
      category: category ?? prev.category,
      includeTags: [tag],
    }));
  }, []);

  const seedFilters = useCallback((partial: Partial<StoreFiltersState>) => {
    setState({
      ...DEFAULT_FILTERS,
      ...partial,
      category: partial.category ?? DEFAULT_FILTERS.category,
    });
  }, []);

  const setShowIgnored = useCallback((showIgnored: boolean) => {
    setState((s) => ({ ...s, showIgnored }));
  }, []);

  const value: StoreFiltersValue = {
    ...state,
    setSearch: (search) => setState((prev) => ({ ...prev, search })),
    setSort: (sort) => setState((prev) => ({ ...prev, sort })),
    setPrefixFilter: (prefixFilter) => setState((prev) => ({ ...prev, prefixFilter })),
    setIncludeTags: (includeTags) => setState((prev) => ({ ...prev, includeTags })),
    setExcludeTags: (excludeTags) => setState((prev) => ({ ...prev, excludeTags })),
    setTagMode: (tagMode) => setState((prev) => ({ ...prev, tagMode })),
    setShowIgnored,
    changeCategory,
    filterByTag,
    seedFilters,
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
