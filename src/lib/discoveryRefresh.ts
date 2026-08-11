import { samList } from './ipc';
import { upsertPool, type DiscoveryPoolRecord } from './discoveryPools';
import { DISCOVERY_PAGE_ROWS } from './discoveryConfig';
import { dedupeByThreadId, isPoolFresh } from './discoverySelection';
import type { SamCategory, SamGameCard, SamSort } from '../types/sam';

export interface PoolSpec {
  key: string;
  sort: SamSort;
  tags?: number[];
  pages: number;
  ttlMs: number;
}

export async function fetchPoolPages(args: {
  sort: SamSort;
  tags?: number[];
  pages: number;
  category?: SamCategory;
}): Promise<SamGameCard[]> {
  const category = args.category ?? 'games';
  const collected: SamGameCard[] = [];
  for (let page = 1; page <= args.pages; page++) {
    const result = await samList({
      category,
      sort: args.sort,
      tags: args.tags,
      tagtype: args.tags && args.tags.length > 1 ? 'and' : undefined,
      rows: DISCOVERY_PAGE_ROWS,
      page,
    });
    collected.push(...result.items);
    if (page >= result.totalPages) break;
  }
  return dedupeByThreadId(collected);
}

export async function refreshPoolIfStale(args: {
  key: string;
  sort: SamSort;
  tags?: number[];
  pages: number;
  ttlMs: number;
  nowMs?: number;
  cached?: DiscoveryPoolRecord | null;
}): Promise<{ items: SamGameCard[]; fetchedAt: number; refreshed: boolean }> {
  const now = args.nowMs ?? Date.now();
  const cached = args.cached ?? null;
  if (cached && isPoolFresh(cached.fetchedAt, args.ttlMs, now)) {
    return { items: cached.items, fetchedAt: cached.fetchedAt, refreshed: false };
  }
  try {
    const items = await fetchPoolPages({
      sort: args.sort,
      tags: args.tags,
      pages: args.pages,
    });
    if (items.length === 0 && cached && cached.items.length > 0) {
      return { items: cached.items, fetchedAt: cached.fetchedAt, refreshed: false };
    }
    await upsertPool(args.key, items, now);
    return { items, fetchedAt: now, refreshed: true };
  } catch (err) {
    if (cached && cached.items.length > 0) {
      return { items: cached.items, fetchedAt: cached.fetchedAt, refreshed: false };
    }
    throw err;
  }
}

export async function refreshPoolsSequential(
  specs: PoolSpec[],
  getCached: (key: string) => DiscoveryPoolRecord | null | undefined,
  nowMs = Date.now(),
): Promise<void> {
  for (const spec of specs) {
    await refreshPoolIfStale({
      ...spec,
      nowMs,
      cached: getCached(spec.key) ?? null,
    });
  }
}
