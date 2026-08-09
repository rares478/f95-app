import {
  RAIL_DISPLAY_COUNT,
  SPOTLIGHT_COUNT,
} from './discoveryConfig';
import type { DiscoveryPoolRecord } from './discoveryPools';
import { buildSpotlight, pickHead, pickSample } from './discoverySelection';
import type { SamGameCard, SamSort, SamTag } from '../types/sam';

export interface DiscoveryTagRail {
  key: string;
  tag: SamTag;
  name: string;
}

export interface DiscoveryHomeRail {
  id: string;
  poolKey: string;
  titleKey: string;
  titleParams?: Record<string, string>;
  items: SamGameCard[];
  loading: boolean;
  error: string | null;
  seeAll: { sort?: SamSort; includeTag?: SamTag };
}

export interface DiscoveryHomeModel {
  spotlight: SamGameCard[];
  rails: DiscoveryHomeRail[];
}

const SORT_RAILS: Array<{
  id: string;
  poolKey: string;
  titleKey: string;
  sort: SamSort;
  mode: 'head' | 'sample';
}> = [
  {
    id: 'recent',
    poolKey: 'recent',
    titleKey: 'store.home.rail.recent',
    sort: 'date',
    mode: 'head',
  },
  {
    id: 'likes',
    poolKey: 'likes',
    titleKey: 'store.home.rail.likes',
    sort: 'likes',
    mode: 'sample',
  },
  {
    id: 'views',
    poolKey: 'views',
    titleKey: 'store.home.rail.views',
    sort: 'views',
    mode: 'sample',
  },
  {
    id: 'rating',
    poolKey: 'rating',
    titleKey: 'store.home.rail.rating',
    sort: 'rating',
    mode: 'sample',
  },
];

function itemsOf(pools: Map<string, DiscoveryPoolRecord>, key: string): SamGameCard[] {
  return pools.get(key)?.items ?? [];
}

export function buildDiscoveryHomeModel(args: {
  pools: Map<string, DiscoveryPoolRecord>;
  tagRails: DiscoveryTagRail[];
  seed: string;
  loadingKeys: Set<string>;
  errorKeys: Map<string, string>;
}): DiscoveryHomeModel {
  const { pools, tagRails, seed, loadingKeys, errorKeys } = args;

  const spotlight = buildSpotlight(
    itemsOf(pools, 'recent'),
    itemsOf(pools, 'likes'),
    itemsOf(pools, 'views'),
    SPOTLIGHT_COUNT,
    seed,
  );

  const rails: DiscoveryHomeRail[] = SORT_RAILS.map((spec) => {
    const poolItems = itemsOf(pools, spec.poolKey);
    const items =
      spec.mode === 'head'
        ? pickHead(poolItems, RAIL_DISPLAY_COUNT)
        : pickSample(poolItems, RAIL_DISPLAY_COUNT, seed);
    return {
      id: spec.id,
      poolKey: spec.poolKey,
      titleKey: spec.titleKey,
      items,
      loading: loadingKeys.has(spec.poolKey),
      error: errorKeys.get(spec.poolKey) ?? null,
      seeAll: { sort: spec.sort },
    };
  });

  for (const tagRail of tagRails) {
    const poolItems = itemsOf(pools, tagRail.key);
    rails.push({
      id: tagRail.key,
      poolKey: tagRail.key,
      titleKey: 'store.home.rail.tag',
      titleParams: { name: tagRail.name },
      items: pickSample(poolItems, RAIL_DISPLAY_COUNT, seed),
      loading: loadingKeys.has(tagRail.key),
      error: errorKeys.get(tagRail.key) ?? null,
      seeAll: { sort: 'likes', includeTag: tagRail.tag },
    });
  }

  return { spotlight, rails };
}
