import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LibraryGame } from '../types/library';
import type { BecauseYouCardModel } from '../types/becauseYou';
import type { SamGameCard } from '../types/sam';
import { BECAUSE_YOU_POOL_KEY } from './discoveryConfig';
import { localDayKey } from './discoveryTagRails';

const { query, execute } = vi.hoisted(() => ({
  query: vi.fn(),
  execute: vi.fn(),
}));

vi.mock('./db', () => ({
  query: (...a: unknown[]) => query(...a),
  execute: (...a: unknown[]) => execute(...a),
}));

vi.mock('./library', () => ({
  list: vi.fn(),
}));

vi.mock('./ipc', () => ({
  gameDetail: vi.fn(),
  samList: vi.fn(),
}));

vi.mock('./gamesCacheRead', () => ({
  getCachedTagIds: vi.fn(),
}));

vi.mock('./moreLikeThisFetch', () => ({
  fetchMoreLikeThis: vi.fn(),
}));

vi.mock('./storeViewHistory', () => ({
  listRecentStoreViews: vi.fn(),
}));

import * as library from './library';
import * as ipc from './ipc';
import { getCachedTagIds } from './gamesCacheRead';
import { fetchMoreLikeThis } from './moreLikeThisFetch';
import { listRecentStoreViews } from './storeViewHistory';
import {
  buildBecauseYouFingerprint,
  loadBecauseYouPack,
  mixBecauseYouSlots,
  shouldRebuildBecauseYouPack,
} from './becauseYouPack';

function game(partial: Partial<LibraryGame> & Pick<LibraryGame, 'threadId' | 'title'>): LibraryGame {
  return {
    category: 'games',
    threadUrl: 'https://x',
    thumbnailUrl: null,
    currentVersion: null,
    availableVersion: null,
    installStatus: 'installed',
    installPath: null,
    exePath: null,
    addedAt: '2026-01-01T00:00:00.000Z',
    lastPlayedAt: null,
    totalPlaytimeSeconds: 0,
    customTags: [],
    storeTags: [],
    notes: '',
    downloadLinks: [],
    downloadLinksVersion: null,
    downloadLinksFetchedAt: null,
    ...partial,
  };
}

function card(id: string): SamGameCard {
  return {
    threadId: id,
    title: id,
    version: null,
    thumbnailUrl: null,
    screens: [],
    threadUrl: `https://example.test/${id}`,
    prefixIds: [],
    tagIds: [],
    rating: null,
    views: null,
    likes: null,
    updatedAt: null,
    updatedTs: null,
    creator: null,
    watched: false,
    ignored: false,
    isNew: false,
  };
}

function becauseCard(
  id: string,
  reason: BecauseYouCardModel['reason'] = {
    kind: 'play',
    seedThreadId: 'seed-1',
    seedTitle: 'Seed',
  },
): BecauseYouCardModel {
  return { game: card(id), reason };
}

const seedGame = game({
  threadId: 'seed-1',
  title: 'Seed Game Title',
  totalPlaytimeSeconds: 600,
  lastPlayedAt: '2026-08-09T12:00:00.000Z',
});

const tagNameById = new Map<number, string>([
  [10, 'Romance'],
  [20, 'Fantasy'],
]);

const resolveTagIds = vi.fn(() => [10]);

describe('shouldRebuildBecauseYouPack', () => {
  it('keeps cache on same day even if fingerprint changed', () => {
    expect(
      shouldRebuildBecauseYouPack({
        cachedDayKey: '2026-08-25',
        todayKey: '2026-08-25',
        cachedFingerprint: 'old',
        currentFingerprint: 'new',
      }),
    ).toBe(false);
  });

  it('rebuilds when day changes', () => {
    expect(
      shouldRebuildBecauseYouPack({
        cachedDayKey: '2026-08-24',
        todayKey: '2026-08-25',
        cachedFingerprint: 'a',
        currentFingerprint: 'a',
      }),
    ).toBe(true);
  });
});

describe('mixBecauseYouSlots', () => {
  it('mixes play and interest up to 3 with no duplicate games', () => {
    const play: BecauseYouCardModel[] = [
      { game: card('p1'), reason: { kind: 'play', seedThreadId: 's1', seedTitle: 'Seed1' } },
      { game: card('p2'), reason: { kind: 'play', seedThreadId: 's2', seedTitle: 'Seed2' } },
      { game: card('p3'), reason: { kind: 'play', seedThreadId: 's3', seedTitle: 'Seed3' } },
    ];
    const interest: BecauseYouCardModel[] = [
      { game: card('i1'), reason: { kind: 'interest', tagId: 1, tagName: 'Romance' } },
      { game: card('p1'), reason: { kind: 'interest', tagId: 2, tagName: 'Fantasy' } },
      { game: card('i2'), reason: { kind: 'interest', tagId: 3, tagName: 'NTR' } },
    ];
    const mixed = mixBecauseYouSlots({ play, interest, maxCards: 3, maxPlay: 2, maxInterest: 2 });
    expect(mixed).toHaveLength(3);
    expect(mixed.filter((c) => c.reason.kind === 'play').length).toBeGreaterThanOrEqual(1);
    expect(mixed.filter((c) => c.reason.kind === 'interest').length).toBeGreaterThanOrEqual(1);
    expect(new Set(mixed.map((c) => c.game.threadId)).size).toBe(3);
  });
});

describe('buildBecauseYouFingerprint', () => {
  it('joins play seed fingerprint and view ids', () => {
    expect(
      buildBecauseYouFingerprint({
        playFingerprint: '1@t',
        viewThreadIds: ['a', 'b'],
      }),
    ).toBe('play:1@t|views:a,b');
  });
});

describe('loadBecauseYouPack', () => {
  const now = new Date(2026, 7, 25, 15, 0, 0).getTime();
  const today = localDayKey(now);

  beforeEach(() => {
    query.mockReset();
    execute.mockReset();
    execute.mockResolvedValue({ rowsAffected: 1 });
    vi.mocked(library.list).mockReset();
    vi.mocked(ipc.gameDetail).mockReset();
    vi.mocked(ipc.samList).mockReset();
    vi.mocked(getCachedTagIds).mockReset();
    vi.mocked(fetchMoreLikeThis).mockReset();
    vi.mocked(listRecentStoreViews).mockReset();
    resolveTagIds.mockReset();
    resolveTagIds.mockReturnValue([10]);
    vi.mocked(library.list).mockResolvedValue([seedGame]);
    vi.mocked(listRecentStoreViews).mockResolvedValue([]);
  });

  it('returns same-day cache without rebuilding', async () => {
    const cachedCards = [becauseCard('c1'), becauseCard('c2')];
    query.mockResolvedValueOnce([
      {
        payload: JSON.stringify({
          dayKey: today,
          fingerprint: 'any-fp',
          cards: cachedCards,
        }),
        fetched_at: now - 60_000,
      },
    ]);

    const result = await loadBecauseYouPack({
      category: 'games',
      resolveTagIds,
      tagNameById,
      nowMs: now,
    });

    expect(result).toEqual({ cards: cachedCards, fromCache: true });
    expect(fetchMoreLikeThis).not.toHaveBeenCalled();
    expect(ipc.samList).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it('force rebuilds even on same-day cache', async () => {
    const cachedCards = [becauseCard('cached')];
    query.mockResolvedValueOnce([
      {
        payload: JSON.stringify({
          dayKey: today,
          fingerprint: 'any-fp',
          cards: cachedCards,
        }),
        fetched_at: now - 1_000,
      },
    ]);
    vi.mocked(getCachedTagIds).mockResolvedValue([10]);
    vi.mocked(fetchMoreLikeThis).mockResolvedValue([card('fresh-1'), card('fresh-2')]);

    const result = await loadBecauseYouPack({
      category: 'games',
      force: true,
      resolveTagIds,
      tagNameById,
      nowMs: now,
    });

    expect(fetchMoreLikeThis).toHaveBeenCalled();
    expect(result.fromCache).toBe(false);
    expect(result.cards.map((c) => c.game.threadId)).toContain('fresh-1');
    expect(execute).toHaveBeenCalled();
    const [sql, params] = execute.mock.calls[0]!;
    expect(String(sql)).toMatch(/INSERT INTO discovery_pools/i);
    expect(params[0]).toBe(BECAUSE_YOU_POOL_KEY);
  });

  it('on rebuild failure returns prior cache when present', async () => {
    const cachedCards = [becauseCard('prev-1'), becauseCard('prev-2')];
    query.mockResolvedValueOnce([
      {
        payload: JSON.stringify({
          dayKey: localDayKey(now - 86_400_000),
          fingerprint: 'old-fp',
          cards: cachedCards,
        }),
        fetched_at: now - 86_400_000,
      },
    ]);
    vi.mocked(getCachedTagIds).mockResolvedValue([10]);
    vi.mocked(fetchMoreLikeThis).mockRejectedValueOnce(new Error('sam down'));

    const result = await loadBecauseYouPack({
      category: 'games',
      resolveTagIds,
      tagNameById,
      nowMs: now,
    });

    expect(result).toEqual({ cards: cachedCards, fromCache: true });
    expect(execute).not.toHaveBeenCalled();
  });

  it('does not persist empty rebuild over prior non-empty pack', async () => {
    const cachedCards = [
      becauseCard('prev-1'),
      becauseCard('prev-2'),
      becauseCard('prev-3'),
    ];
    query.mockResolvedValueOnce([
      {
        payload: JSON.stringify({
          dayKey: localDayKey(now - 86_400_000),
          fingerprint: 'old-fp',
          cards: cachedCards,
        }),
        fetched_at: now - 86_400_000,
      },
    ]);
    vi.mocked(getCachedTagIds).mockResolvedValue([10]);
    vi.mocked(fetchMoreLikeThis).mockResolvedValue([]);
    vi.mocked(listRecentStoreViews).mockResolvedValue([]);

    const result = await loadBecauseYouPack({
      category: 'games',
      resolveTagIds,
      tagNameById,
      nowMs: now,
    });

    expect(result).toEqual({ cards: cachedCards, fromCache: true });
    expect(execute).not.toHaveBeenCalled();
  });

  it('allows empty when there is no prior non-empty pack', async () => {
    query.mockResolvedValueOnce([]);
    vi.mocked(library.list).mockResolvedValue([
      game({ threadId: '1', title: 'Unplayed', totalPlaytimeSeconds: 0 }),
    ]);
    vi.mocked(listRecentStoreViews).mockResolvedValue([]);

    const result = await loadBecauseYouPack({
      category: 'games',
      resolveTagIds,
      tagNameById,
      nowMs: now,
    });

    expect(result).toEqual({ cards: [], fromCache: false });
    expect(execute).toHaveBeenCalledTimes(1);
    const written = JSON.parse(String(execute.mock.calls[0]![1][1])) as {
      cards: BecauseYouCardModel[];
      dayKey: string;
    };
    expect(written.cards).toEqual([]);
    expect(written.dayKey).toBe(today);
  });
});
