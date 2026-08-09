import type { GameTag } from '../types/game';
import type { SamCategory, SamGameCard } from '../types/sam';
import {
  PERSONAL_POOL_KEY,
  PERSONAL_TTL_MS,
  RAIL_DISPLAY_COUNT,
} from './discoveryConfig';
import { execute, query } from './db';
import { getCachedTagIds } from './gamesCacheRead';
import * as ipc from './ipc';
import * as library from './library';
import { fetchMoreLikeThis } from './moreLikeThisFetch';
import {
  personalizationFingerprint,
  pickPersonalizationSeeds,
  truncateRailTitle,
} from './personalizationSeeds';

export interface PersonalizationRailResult {
  seedTitle: string | null;
  items: SamGameCard[];
  fingerprint: string | null;
  fromCache: boolean;
}

interface PersonalCachePayload {
  fingerprint: string;
  seedTitle: string;
  items: SamGameCard[];
}

interface PersonalCacheRow {
  fetchedAt: number;
  payload: PersonalCachePayload;
}

const EMPTY_RESULT: PersonalizationRailResult = {
  items: [],
  seedTitle: null,
  fingerprint: null,
  fromCache: false,
};

function parsePersonalPayload(raw: string): PersonalCachePayload | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.fingerprint !== 'string' || typeof obj.seedTitle !== 'string') return null;
    if (!Array.isArray(obj.items)) return null;
    return {
      fingerprint: obj.fingerprint,
      seedTitle: obj.seedTitle,
      items: obj.items as SamGameCard[],
    };
  } catch {
    return null;
  }
}

async function getPersonalCache(): Promise<PersonalCacheRow | null> {
  const rows = await query<{ payload: string; fetched_at: number }>(
    `SELECT payload, fetched_at FROM discovery_pools WHERE key = ? LIMIT 1`,
    [PERSONAL_POOL_KEY],
  );
  const row = rows[0];
  if (!row) return null;
  const payload = parsePersonalPayload(row.payload);
  if (!payload) return null;
  return { fetchedAt: Number(row.fetched_at) || 0, payload };
}

async function setPersonalCache(
  payload: PersonalCachePayload,
  fetchedAt: number,
): Promise<void> {
  await execute(
    `INSERT INTO discovery_pools (key, payload, fetched_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       payload = excluded.payload,
       fetched_at = excluded.fetched_at`,
    [PERSONAL_POOL_KEY, JSON.stringify(payload), fetchedAt],
  );
}

async function collectTagIds(
  threadIds: string[],
  resolveTagIds: (tags: GameTag[]) => number[],
): Promise<number[]> {
  const ids: number[] = [];
  const seen = new Set<number>();
  for (const threadId of threadIds) {
    let tagIds = await getCachedTagIds(threadId);
    if (!tagIds) {
      try {
        const detail = await ipc.gameDetail(threadId);
        tagIds = resolveTagIds(detail.tags ?? []);
      } catch {
        tagIds = [];
      }
    }
    for (const id of tagIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

function softExcludeViewed(
  items: SamGameCard[],
  excludeViewedIds?: Set<string>,
): SamGameCard[] {
  if (!excludeViewedIds || excludeViewedIds.size === 0) return items;
  const filtered = items.filter((c) => !excludeViewedIds.has(c.threadId));
  return filtered.length >= 4 ? filtered : items;
}

export async function loadPersonalizationRail(args: {
  category: SamCategory;
  libraryThreadIds: Set<string>;
  excludeViewedIds?: Set<string>;
  nowMs?: number;
  force?: boolean;
  resolveTagIds: (tags: GameTag[]) => number[];
}): Promise<PersonalizationRailResult> {
  const {
    category,
    libraryThreadIds,
    excludeViewedIds,
    force = false,
    resolveTagIds,
  } = args;
  const now = args.nowMs ?? Date.now();

  const games = await library.list({ category: 'games', sort: 'last_played' });
  const seeds = pickPersonalizationSeeds(games);
  if (seeds.length === 0) return EMPTY_RESULT;

  const fingerprint = personalizationFingerprint(seeds);
  const seedTitle = truncateRailTitle(seeds[0]!.title);
  const previous = await getPersonalCache();

  if (
    !force &&
    previous &&
    previous.payload.fingerprint === fingerprint &&
    previous.payload.items.length > 0 &&
    now - previous.fetchedAt < PERSONAL_TTL_MS
  ) {
    return {
      items: previous.payload.items,
      seedTitle: previous.payload.seedTitle,
      fingerprint: previous.payload.fingerprint,
      fromCache: true,
    };
  }

  const tagIds = await collectTagIds(
    seeds.map((s) => s.threadId),
    resolveTagIds,
  );

  const exclude = new Set<string>([
    ...seeds.map((s) => s.threadId),
    ...libraryThreadIds,
  ]);

  let fetched: SamGameCard[];
  try {
    fetched = await fetchMoreLikeThis({
      category,
      excludeThreadIds: [...exclude],
      tagIds,
      limit: RAIL_DISPLAY_COUNT + 8,
    });
  } catch {
    if (previous && previous.payload.items.length > 0) {
      return {
        items: previous.payload.items,
        seedTitle: previous.payload.seedTitle,
        fingerprint: previous.payload.fingerprint,
        fromCache: true,
      };
    }
    return EMPTY_RESULT;
  }

  const items = softExcludeViewed(fetched, excludeViewedIds).slice(0, RAIL_DISPLAY_COUNT);
  const payload: PersonalCachePayload = { fingerprint, seedTitle, items };
  await setPersonalCache(payload, now);

  return { seedTitle, items, fingerprint, fromCache: false };
}
