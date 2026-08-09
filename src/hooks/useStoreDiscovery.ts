import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTagCatalog } from '../contexts/TagCatalogContext';
import {
  RAIL_DISPLAY_COUNT,
  RECENT_PAGES,
  RECENT_TTL_MS,
  SLOW_POOL_PAGES,
  SLOW_POOL_TTL_MS,
} from '../lib/discoveryConfig';
import {
  buildDiscoveryHomeModel,
  type DiscoveryHomeRail,
  type DiscoveryTagRail,
} from '../lib/discoveryHomeModel';
import { getPools, type DiscoveryPoolRecord } from '../lib/discoveryPools';
import { refreshPoolIfStale, type PoolSpec } from '../lib/discoveryRefresh';
import { localDayKey, pickTagRailsForDay } from '../lib/discoveryTagRails';
import { formatIpcError } from '../lib/ipcError';
import * as library from '../lib/library';
import { loadPersonalizationRail } from '../lib/personalizationRail';
import {
  pickPersonalizationSeeds,
  truncateRailTitle,
} from '../lib/personalizationSeeds';
import {
  listRecentStoreViews,
  viewRecordToSamCard,
} from '../lib/storeViewHistory';
import { findSamTagByNameOrSlug } from '../lib/tagCatalog';
import type { GameTag } from '../types/game';
import type { SamCategory, SamGameCard, SamSort, SamTag } from '../types/sam';

export interface StoreDiscoveryRail {
  id: string;
  titleKey: string;
  titleParams?: Record<string, string>;
  items: SamGameCard[];
  loading: boolean;
  error: string | null;
  seeAll: { sort?: SamSort; includeTag?: SamTag };
  retry: () => void;
}

export interface StoreDiscoveryState {
  category: SamCategory;
  spotlight: SamGameCard[];
  rails: StoreDiscoveryRail[];
  bootstrapping: boolean;
  fatalError: string | null;
  reload: () => void;
}

const HISTORY_RAIL_ID = 'recently-viewed';
const PERSONAL_RAIL_ID = 'because-you-play';

function sampleSeed(nowMs = Date.now()): string {
  return `${Math.floor(nowMs / RECENT_TTL_MS)}`;
}

function resolveGameTagIds(catalog: Map<number, string>, tags: GameTag[]): number[] {
  const ids: number[] = [];
  const seen = new Set<number>();
  for (const tag of tags) {
    const sam = findSamTagByNameOrSlug(catalog, tag);
    if (!sam || seen.has(sam.id)) continue;
    seen.add(sam.id);
    ids.push(sam.id);
  }
  return ids;
}

function resolveTagRails(catalog: Map<number, string>): DiscoveryTagRail[] {
  return pickTagRailsForDay({ catalog, dayKey: localDayKey() });
}

function buildPoolSpecs(tagRails: DiscoveryTagRail[]): PoolSpec[] {
  return [
    { key: 'recent', sort: 'date', pages: RECENT_PAGES, ttlMs: RECENT_TTL_MS },
    { key: 'likes', sort: 'likes', pages: SLOW_POOL_PAGES, ttlMs: SLOW_POOL_TTL_MS },
    { key: 'views', sort: 'views', pages: SLOW_POOL_PAGES, ttlMs: SLOW_POOL_TTL_MS },
    { key: 'rating', sort: 'rating', pages: SLOW_POOL_PAGES, ttlMs: SLOW_POOL_TTL_MS },
    ...tagRails.map((r) => ({
      key: r.key,
      sort: 'likes' as const,
      tags: [r.tag.id],
      pages: SLOW_POOL_PAGES,
      ttlMs: SLOW_POOL_TTL_MS,
    })),
  ];
}

function hasAnyCachedItems(pools: Map<string, DiscoveryPoolRecord>): boolean {
  for (const rec of pools.values()) {
    if (rec.items.length > 0) return true;
  }
  return false;
}

function mapRails(
  modelRails: DiscoveryHomeRail[],
  retryOne: (poolKey: string) => void,
): StoreDiscoveryRail[] {
  return modelRails.map((rail) => ({
    id: rail.id,
    titleKey: rail.titleKey,
    titleParams: rail.titleParams,
    items: rail.items,
    loading: rail.loading,
    error: rail.error,
    seeAll: rail.seeAll,
    retry: () => retryOne(rail.poolKey),
  }));
}

function historyRailFromViews(
  items: SamGameCard[],
  error: string | null = null,
): DiscoveryHomeRail | null {
  if (items.length === 0 && !error) return null;
  return {
    id: HISTORY_RAIL_ID,
    poolKey: HISTORY_RAIL_ID,
    titleKey: 'store.home.rail.recentlyViewed',
    items,
    loading: false,
    error,
    seeAll: {},
  };
}

function personalLoadingRail(title: string): DiscoveryHomeRail {
  return {
    id: PERSONAL_RAIL_ID,
    poolKey: PERSONAL_RAIL_ID,
    titleKey: 'store.home.rail.becauseYouPlay',
    titleParams: { title },
    items: [],
    loading: true,
    error: null,
    seeAll: {},
  };
}

function personalReadyRail(
  title: string,
  items: SamGameCard[],
): DiscoveryHomeRail | null {
  if (items.length === 0) return null;
  return {
    id: PERSONAL_RAIL_ID,
    poolKey: PERSONAL_RAIL_ID,
    titleKey: 'store.home.rail.becauseYouPlay',
    titleParams: { title },
    items,
    loading: false,
    error: null,
    seeAll: {},
  };
}

export function useStoreDiscovery(): StoreDiscoveryState {
  const { catalog } = useTagCatalog();
  const tagRails = useMemo(() => resolveTagRails(catalog), [catalog]);
  const poolSpecs = useMemo(() => buildPoolSpecs(tagRails), [tagRails]);
  const poolKeysKey = poolSpecs.map((s) => s.key).join(',');

  const [pools, setPools] = useState<Map<string, DiscoveryPoolRecord>>(new Map());
  const [loadingKeys, setLoadingKeys] = useState<Set<string>>(() => new Set());
  const [errorKeys, setErrorKeys] = useState<Map<string, string>>(() => new Map());
  const [bootstrapping, setBootstrapping] = useState(true);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [seed] = useState(() => sampleSeed());
  const [historyRail, setHistoryRail] = useState<DiscoveryHomeRail | null>(null);
  const [personalRail, setPersonalRail] = useState<DiscoveryHomeRail | null>(null);

  const poolsRef = useRef(pools);
  poolsRef.current = pools;
  const specsRef = useRef(poolSpecs);
  specsRef.current = poolSpecs;
  const catalogRef = useRef(catalog);
  catalogRef.current = catalog;
  const historyIdsRef = useRef<Set<string>>(new Set());
  const libraryThreadIdsRef = useRef<Set<string>>(new Set());
  const genRef = useRef(0);
  const personalGenRef = useRef(0);

  const reload = useCallback(() => {
    setReloadToken((n) => n + 1);
  }, []);

  const loadHistory = useCallback(async (opts?: { isCancelled?: () => boolean }) => {
    try {
      const rows = await listRecentStoreViews(RAIL_DISPLAY_COUNT);
      if (opts?.isCancelled?.()) return;
      historyIdsRef.current = new Set(rows.map((r) => r.threadId));
      setHistoryRail(historyRailFromViews(rows.map(viewRecordToSamCard)));
    } catch (err) {
      if (opts?.isCancelled?.()) return;
      historyIdsRef.current = new Set();
      setHistoryRail(historyRailFromViews([], formatIpcError(err)));
    }
  }, []);

  const loadPersonal = useCallback(async (force = false) => {
    const myGen = ++personalGenRef.current;
    try {
      const games = await library.list({ category: 'games' });
      if (personalGenRef.current !== myGen) return;
      libraryThreadIdsRef.current = new Set(games.map((g) => g.threadId));

      const seeds = pickPersonalizationSeeds(games);
      if (seeds.length === 0) {
        setPersonalRail(null);
        return;
      }

      const seedTitle = truncateRailTitle(seeds[0]!.title);
      setPersonalRail(personalLoadingRail(seedTitle));

      const result = await loadPersonalizationRail({
        category: 'games',
        libraryThreadIds: libraryThreadIdsRef.current,
        excludeViewedIds: historyIdsRef.current,
        force,
        resolveTagIds: (tags) => resolveGameTagIds(catalogRef.current, tags),
      });
      if (personalGenRef.current !== myGen) return;

      const title = result.seedTitle ?? seedTitle;
      setPersonalRail(personalReadyRail(title, result.items));
    } catch (err) {
      if (personalGenRef.current !== myGen) return;
      // Only surface retry UI if we already knew seeds (had a loading rail).
      setPersonalRail((prev) => {
        if (!prev || prev.id !== PERSONAL_RAIL_ID) return null;
        return {
          ...prev,
          items: [],
          loading: false,
          error: formatIpcError(err),
        };
      });
    }
  }, []);

  const retryOne = useCallback(
    async (poolKey: string) => {
      if (poolKey === HISTORY_RAIL_ID) {
        await loadHistory();
        return;
      }
      if (poolKey === PERSONAL_RAIL_ID) {
        await loadPersonal(true);
        return;
      }

      const spec = specsRef.current.find((s) => s.key === poolKey);
      if (!spec) return;
      const myGen = genRef.current;
      setLoadingKeys((prev) => new Set(prev).add(poolKey));
      setErrorKeys((prev) => {
        const next = new Map(prev);
        next.delete(poolKey);
        return next;
      });
      try {
        await refreshPoolIfStale({
          ...spec,
          ttlMs: 0,
          cached: poolsRef.current.get(poolKey) ?? null,
        });
        if (genRef.current !== myGen) return;
        const next = await getPools([poolKey]);
        if (genRef.current !== myGen) return;
        setPools((prev) => {
          const merged = new Map(prev);
          const rec = next.get(poolKey);
          if (rec) merged.set(poolKey, rec);
          return merged;
        });
      } catch (err) {
        if (genRef.current !== myGen) return;
        setErrorKeys((prev) => new Map(prev).set(poolKey, formatIpcError(err)));
      } finally {
        if (genRef.current === myGen) {
          setLoadingKeys((prev) => {
            const next = new Set(prev);
            next.delete(poolKey);
            return next;
          });
        }
      }
    },
    [loadHistory, loadPersonal],
  );

  useEffect(() => {
    let cancelled = false;
    void loadHistory({ isCancelled: () => cancelled });
    return () => {
      cancelled = true;
    };
  }, [reloadToken, loadHistory]);

  useEffect(() => {
    const myGen = ++genRef.current;
    let cancelled = false;
    const keys = specsRef.current.map((s) => s.key);

    async function boot() {
      setBootstrapping(true);
      setFatalError(null);
      setLoadingKeys(new Set(keys));
      setErrorKeys(new Map());
      personalGenRef.current += 1;
      setPersonalRail(null);

      try {
        const cached = await getPools(keys);
        if (cancelled || genRef.current !== myGen) return;

        setPools(cached);
        const hadCache = hasAnyCachedItems(cached);
        if (hadCache) setBootstrapping(false);

        setLoadingKeys((prev) => {
          const next = new Set(prev);
          for (const key of keys) {
            const rec = cached.get(key);
            if (rec && rec.items.length > 0) next.delete(key);
          }
          return next;
        });

        const nextErrors = new Map<string, string>();
        const mergedPools = new Map(cached);
        for (const spec of specsRef.current) {
          if (cancelled || genRef.current !== myGen) return;
          try {
            await refreshPoolIfStale({
              ...spec,
              cached: poolsRef.current.get(spec.key) ?? cached.get(spec.key) ?? null,
            });
            if (cancelled || genRef.current !== myGen) return;
            const next = await getPools([spec.key]);
            if (cancelled || genRef.current !== myGen) return;
            const rec = next.get(spec.key);
            if (rec) mergedPools.set(spec.key, rec);
            setPools((prev) => {
              const merged = new Map(prev);
              if (rec) merged.set(spec.key, rec);
              return merged;
            });
            setErrorKeys((prev) => {
              if (!prev.has(spec.key)) return prev;
              const cleared = new Map(prev);
              cleared.delete(spec.key);
              return cleared;
            });
          } catch (err) {
            if (cancelled || genRef.current !== myGen) return;
            const message = formatIpcError(err);
            nextErrors.set(spec.key, message);
            setErrorKeys((prev) => new Map(prev).set(spec.key, message));
          } finally {
            if (!cancelled && genRef.current === myGen) {
              setLoadingKeys((prev) => {
                const next = new Set(prev);
                next.delete(spec.key);
                return next;
              });
            }
          }
        }
        if (cancelled || genRef.current !== myGen) return;

        setBootstrapping(false);

        if (!hasAnyCachedItems(mergedPools) && nextErrors.size > 0) {
          setFatalError([...nextErrors.values()][0] ?? null);
        }

        // Prefer personalization after global sequential refresh (SAM manners).
        if (!cancelled && genRef.current === myGen) {
          await loadPersonal(false);
        }
      } catch (err) {
        if (cancelled || genRef.current !== myGen) return;
        setFatalError(formatIpcError(err));
        setBootstrapping(false);
        if (!cancelled && genRef.current === myGen) {
          await loadPersonal(false);
        }
      } finally {
        if (!cancelled && genRef.current === myGen) {
          setLoadingKeys(new Set());
        }
      }
    }

    void boot();
    return () => {
      cancelled = true;
    };
  }, [poolKeysKey, reloadToken, loadPersonal]);

  const userRails = useMemo(() => {
    const out: DiscoveryHomeRail[] = [];
    if (historyRail) out.push(historyRail);
    if (personalRail) out.push(personalRail);
    return out;
  }, [historyRail, personalRail]);

  const model = buildDiscoveryHomeModel({
    pools,
    tagRails,
    seed,
    loadingKeys,
    errorKeys,
    userRails,
  });

  return {
    category: 'games',
    spotlight: model.spotlight,
    rails: mapRails(model.rails, (key) => {
      void retryOne(key);
    }),
    bootstrapping,
    fatalError,
    reload,
  };
}
