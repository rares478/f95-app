import type { GameTag } from '../types/game';
import type { BecauseYouCardModel, BecauseYouPackPayload } from '../types/becauseYou';
import type { SamCategory, SamGameCard, SamSort } from '../types/sam';
import {
  BECAUSE_YOU_INTEREST_DENYLIST,
  BECAUSE_YOU_MAX_CARDS,
  BECAUSE_YOU_MAX_INTEREST_SLOTS,
  BECAUSE_YOU_MAX_PLAY_SLOTS,
  BECAUSE_YOU_POOL_KEY,
  VIEW_HISTORY_CAP,
} from './discoveryConfig';
import { execute, query } from './db';
import { localDayKey } from './discoveryTagRails';
import { getCachedTagIds } from './gamesCacheRead';
import * as ipc from './ipc';
import * as library from './library';
import { fetchMoreLikeThis } from './moreLikeThisFetch';
import {
  personalizationFingerprint,
  pickPersonalizationSeeds,
} from './personalizationSeeds';
import {
  pickInterestReasonTags,
  scoreInterestTags,
} from './becauseYouInterestTags';
import { listRecentStoreViews } from './storeViewHistory';

const INTEREST_SORTS: SamSort[] = ['date', 'rating', 'likes'];
const INTEREST_ROWS = 20;
const MAX_PAGE_JITTER = 8;

interface CacheRow {
  fetchedAt: number;
  payload: BecauseYouPackPayload;
}

export function shouldRebuildBecauseYouPack(args: {
  cachedDayKey: string;
  todayKey: string;
  cachedFingerprint: string;
  currentFingerprint: string;
}): boolean {
  // Mid-day fingerprint changes do not rebuild; only a new local day does.
  void args.cachedFingerprint;
  void args.currentFingerprint;
  return args.cachedDayKey !== args.todayKey;
}

export function buildBecauseYouFingerprint(args: {
  playFingerprint: string;
  viewThreadIds: string[];
}): string {
  return `play:${args.playFingerprint}|views:${args.viewThreadIds.join(',')}`;
}

export function mixBecauseYouSlots(args: {
  play: BecauseYouCardModel[];
  interest: BecauseYouCardModel[];
  maxCards: number;
  maxPlay: number;
  maxInterest: number;
}): BecauseYouCardModel[] {
  const { play, interest, maxCards, maxPlay, maxInterest } = args;
  const out: BecauseYouCardModel[] = [];
  const seen = new Set<string>();

  const tryAdd = (card: BecauseYouCardModel): boolean => {
    if (out.length >= maxCards) return false;
    if (seen.has(card.game.threadId)) return false;
    seen.add(card.game.threadId);
    out.push(card);
    return true;
  };

  let playCount = 0;
  let interestCount = 0;
  let playIdx = 0;
  let interestIdx = 0;

  while (playIdx < play.length && playCount < maxPlay && out.length < maxCards) {
    if (tryAdd(play[playIdx]!)) playCount += 1;
    playIdx += 1;
  }

  while (
    interestIdx < interest.length &&
    interestCount < maxInterest &&
    out.length < maxCards
  ) {
    if (tryAdd(interest[interestIdx]!)) interestCount += 1;
    interestIdx += 1;
  }

  while (playIdx < play.length && out.length < maxCards) {
    tryAdd(play[playIdx]!);
    playIdx += 1;
  }

  while (interestIdx < interest.length && out.length < maxCards) {
    tryAdd(interest[interestIdx]!);
    interestIdx += 1;
  }

  return out;
}

function parsePackPayload(raw: string): BecauseYouPackPayload | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.dayKey !== 'string' || typeof obj.fingerprint !== 'string') return null;
    if (!Array.isArray(obj.cards)) return null;
    return {
      dayKey: obj.dayKey,
      fingerprint: obj.fingerprint,
      cards: obj.cards as BecauseYouCardModel[],
    };
  } catch {
    return null;
  }
}

async function getPackCache(): Promise<CacheRow | null> {
  const rows = await query<{ payload: string; fetched_at: number }>(
    `SELECT payload, fetched_at FROM discovery_pools WHERE key = ? LIMIT 1`,
    [BECAUSE_YOU_POOL_KEY],
  );
  const row = rows[0];
  if (!row) return null;
  const payload = parsePackPayload(row.payload);
  if (!payload) return null;
  return { fetchedAt: Number(row.fetched_at) || 0, payload };
}

async function setPackCache(payload: BecauseYouPackPayload, fetchedAt: number): Promise<void> {
  await execute(
    `INSERT INTO discovery_pools (key, payload, fetched_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       payload = excluded.payload,
       fetched_at = excluded.fetched_at`,
    [BECAUSE_YOU_POOL_KEY, JSON.stringify(payload), fetchedAt],
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

/** Soft-exclude viewed when ≥1 alternative remains (lighter than rail’s keep-if-<4). */
function softExcludeViewed(
  items: SamGameCard[],
  excludeViewedIds?: Set<string>,
): SamGameCard[] {
  if (!excludeViewedIds || excludeViewedIds.size === 0) return items;
  const filtered = items.filter((c) => !excludeViewedIds.has(c.threadId));
  return filtered.length >= 1 ? filtered : items;
}

function randomPage(totalPages: number): number {
  const max = Math.min(Math.max(1, totalPages), MAX_PAGE_JITTER);
  return 1 + Math.floor(Math.random() * max);
}

async function fetchInterestPool(
  category: SamCategory,
  tagId: number,
  sortIndex: number,
): Promise<SamGameCard[]> {
  const sort = INTEREST_SORTS[sortIndex % INTEREST_SORTS.length]!;
  const base = {
    category,
    tags: [tagId],
    sort,
    rows: INTEREST_ROWS,
  };
  const first = await ipc.samList({ ...base, page: 1 });
  const items = [...first.items];
  const page = randomPage(first.totalPages);
  if (page > 1) {
    const deeper = await ipc.samList({ ...base, page });
    items.push(...deeper.items);
  }
  return items;
}

function pickEligible(
  items: SamGameCard[],
  exclude: Set<string>,
  viewedIds: Set<string>,
): SamGameCard | null {
  const pool = softExcludeViewed(items, viewedIds);
  for (const g of pool) {
    if (g.ignored) continue;
    if (exclude.has(g.threadId)) continue;
    return g;
  }
  return null;
}

function defaultDenylist(): Set<string> {
  return new Set(BECAUSE_YOU_INTEREST_DENYLIST.map((n) => n.trim().toLowerCase()));
}

export async function loadBecauseYouPack(args: {
  category: SamCategory;
  force?: boolean;
  resolveTagIds: (tags: GameTag[]) => number[];
  tagNameById: Map<number, string>;
  denylistNames?: Set<string>;
  nowMs?: number;
}): Promise<{ cards: BecauseYouCardModel[]; fromCache: boolean }> {
  const {
    category,
    force = false,
    resolveTagIds,
    tagNameById,
    denylistNames = defaultDenylist(),
    nowMs = Date.now(),
  } = args;

  const games = await library.list({ category: 'games', sort: 'last_played' });
  const seeds = pickPersonalizationSeeds(games);
  const libraryThreadIds = new Set(games.map((g) => g.threadId));

  const views = await listRecentStoreViews(VIEW_HISTORY_CAP);
  const viewThreadIds = views.map((v) => v.threadId);
  const viewedIds = new Set(viewThreadIds);

  const fingerprint = buildBecauseYouFingerprint({
    playFingerprint: personalizationFingerprint(seeds),
    viewThreadIds,
  });
  const today = localDayKey(nowMs);
  const previous = await getPackCache();

  if (
    !force &&
    previous &&
    !shouldRebuildBecauseYouPack({
      cachedDayKey: previous.payload.dayKey,
      todayKey: today,
      cachedFingerprint: previous.payload.fingerprint,
      currentFingerprint: fingerprint,
    })
  ) {
    return { cards: previous.payload.cards, fromCache: true };
  }

  try {
    const exclude = new Set<string>([
      ...libraryThreadIds,
      ...seeds.map((s) => s.threadId),
    ]);

    const play: BecauseYouCardModel[] = [];
    for (const seed of seeds.slice(0, BECAUSE_YOU_MAX_PLAY_SLOTS)) {
      const tagIds = await collectTagIds([seed.threadId], resolveTagIds);
      if (tagIds.length === 0) continue;
      const fetched = await fetchMoreLikeThis({
        category,
        excludeThreadIds: [...exclude],
        tagIds,
        limit: BECAUSE_YOU_MAX_CARDS + 8,
      });
      const pick = pickEligible(fetched, exclude, viewedIds);
      if (!pick) continue;
      exclude.add(pick.threadId);
      play.push({
        game: pick,
        reason: {
          kind: 'play',
          seedThreadId: seed.threadId,
          seedTitle: seed.title,
        },
      });
    }

    const viewsTagIds: number[][] = [];
    for (const view of views) {
      viewsTagIds.push(await collectTagIds([view.threadId], resolveTagIds));
    }
    const scored = scoreInterestTags({
      viewsTagIds,
      tagNameById,
      denylistNames,
    });
    const reasonTags = pickInterestReasonTags(
      scored,
      BECAUSE_YOU_MAX_INTEREST_SLOTS + 1,
    );

    const interest: BecauseYouCardModel[] = [];
    for (let i = 0; i < reasonTags.length; i++) {
      const tag = reasonTags[i]!;
      const pool = await fetchInterestPool(category, tag.tagId, i);
      const pick = pickEligible(pool, exclude, viewedIds);
      if (!pick) continue;
      exclude.add(pick.threadId);
      interest.push({
        game: pick,
        reason: { kind: 'interest', tagId: tag.tagId, tagName: tag.tagName },
      });
      if (interest.length >= BECAUSE_YOU_MAX_INTEREST_SLOTS + 1) break;
    }

    const cards = mixBecauseYouSlots({
      play,
      interest,
      maxCards: BECAUSE_YOU_MAX_CARDS,
      maxPlay: BECAUSE_YOU_MAX_PLAY_SLOTS,
      maxInterest: BECAUSE_YOU_MAX_INTEREST_SLOTS,
    });

    const payload: BecauseYouPackPayload = { dayKey: today, fingerprint, cards };
    await setPackCache(payload, nowMs);
    return { cards, fromCache: false };
  } catch {
    if (previous) {
      return { cards: previous.payload.cards, fromCache: true };
    }
    return { cards: [], fromCache: false };
  }
}
