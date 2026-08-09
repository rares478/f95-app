import type { SamCategory, SamSort, SamTag } from '../types/sam';
import type { StoreFiltersState } from '../contexts/StoreFilters';

export const BROWSE_PATH = '/store/browse';

export function buildBrowseHandoff(input: {
  category?: SamCategory;
  search?: string;
  sort?: SamSort;
  includeTag?: SamTag;
}): Pick<StoreFiltersState, 'category' | 'search' | 'sort' | 'includeTags'> {
  return {
    category: input.category ?? 'games',
    search: input.search ?? '',
    sort: input.sort ?? 'date',
    includeTags: input.includeTag ? [input.includeTag] : [],
  };
}
