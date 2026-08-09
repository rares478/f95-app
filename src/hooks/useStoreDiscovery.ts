import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTagCatalog } from '../contexts/TagCatalogContext';
import {
  RECENT_PAGES,
  RECENT_TTL_MS,
  SLOW_POOL_PAGES,
  SLOW_POOL_TTL_MS,
  TAG_RAIL_NAMES,
} from '../lib/discoveryConfig';
import {
  buildDiscoveryHomeModel,
  type DiscoveryHomeRail,
  type DiscoveryTagRail,
} from '../lib/discoveryHomeModel';
import { getPools, type DiscoveryPoolRecord } from '../lib/discoveryPools';
import { refreshPoolIfStale, type PoolSpec } from '../lib/discoveryRefresh';
import { formatIpcError } from '../lib/ipcError';
import { findSamTagByNameOrSlug } from '../lib/tagCatalog';
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

function sampleSeed(nowMs = Date.now()): string {
  return `${Math.floor(nowMs / RECENT_TTL_MS)}`;
}

function tagPoolKey(tagId: number): string {
  return `tag:${tagId}`;
}

function resolveTagRails(catalog: Map<number, string>): DiscoveryTagRail[] {
  const out: DiscoveryTagRail[] = [];
  for (const name of TAG_RAIL_NAMES) {
    const tag = findSamTagByNameOrSlug(catalog, { slug: name, name });
    if (!tag) continue;
    out.push({ key: tagPoolKey(tag.id), tag, name: tag.name });
  }
  return out;
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

  const poolsRef = useRef(pools);
  poolsRef.current = pools;
  const specsRef = useRef(poolSpecs);
  specsRef.current = poolSpecs;
  const genRef = useRef(0);

  const reload = useCallback(() => {
    setReloadToken((n) => n + 1);
  }, []);

  const retryOne = useCallback(async (poolKey: string) => {
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
  }, []);

  useEffect(() => {
    const myGen = ++genRef.current;
    let cancelled = false;
    const keys = specsRef.current.map((s) => s.key);

    async function boot() {
      setBootstrapping(true);
      setFatalError(null);
      setLoadingKeys(new Set(keys));
      setErrorKeys(new Map());

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
        for (const spec of specsRef.current) {
          if (cancelled || genRef.current !== myGen) return;
          try {
            await refreshPoolIfStale({
              ...spec,
              cached: poolsRef.current.get(spec.key) ?? cached.get(spec.key) ?? null,
            });
          } catch (err) {
            nextErrors.set(spec.key, formatIpcError(err));
          }
        }
        if (cancelled || genRef.current !== myGen) return;

        const refreshed = await getPools(keys);
        if (cancelled || genRef.current !== myGen) return;
        setPools(refreshed);
        setErrorKeys(nextErrors);
        setBootstrapping(false);

        if (!hasAnyCachedItems(refreshed) && nextErrors.size > 0) {
          setFatalError([...nextErrors.values()][0] ?? null);
        }
      } catch (err) {
        if (cancelled || genRef.current !== myGen) return;
        setFatalError(formatIpcError(err));
        setBootstrapping(false);
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
  }, [poolKeysKey, reloadToken]);

  const model = buildDiscoveryHomeModel({
    pools,
    tagRails,
    seed,
    loadingKeys,
    errorKeys,
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
