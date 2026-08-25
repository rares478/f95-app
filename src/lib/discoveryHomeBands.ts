import type { SamGameCard, SamSort, SamTag } from '../types/sam';

export interface StoreDiscoveryRailLike {
  id: string;
  titleKey: string;
  titleParams?: Record<string, string>;
  items: SamGameCard[];
  loading: boolean;
  error: string | null;
  seeAll: { sort?: SamSort; includeTag?: SamTag };
  /** Optional so full `StoreDiscoveryRail` (with required retry) remains assignable. */
  retry?: () => void;
}

export type HomeBand<T extends StoreDiscoveryRailLike = StoreDiscoveryRailLike> =
  | { type: 'recent'; rail: T }
  | { type: 'popular'; tabs: T[] }
  | { type: 'tags'; panels: T[] };

const POPULAR_IDS = ['likes', 'views', 'rating'] as const;

export function groupHomeBands<T extends StoreDiscoveryRailLike>(rails: T[]): HomeBand<T>[] {
  const byId = new Map(rails.map((rail) => [rail.id, rail]));
  const bands: HomeBand<T>[] = [];

  const recent = byId.get('recent');
  if (recent) {
    bands.push({ type: 'recent', rail: recent });
  }

  const popular = POPULAR_IDS.map((id) => byId.get(id)).filter((rail): rail is T => rail != null);
  if (popular.length > 0) {
    bands.push({ type: 'popular', tabs: popular });
  }

  const tags = rails.filter((rail) => rail.id.startsWith('tag:'));
  if (tags.length > 0) {
    bands.push({ type: 'tags', panels: tags });
  }

  return bands;
}
