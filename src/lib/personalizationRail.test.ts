import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LibraryGame } from '../types/library';
import type { SamGameCard } from '../types/sam';
import type { GameDetail, GameTag } from '../types/game';
import { PERSONAL_POOL_KEY, PERSONAL_TTL_MS, RAIL_DISPLAY_COUNT } from './discoveryConfig';

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
}));

vi.mock('./gamesCacheRead', () => ({
  getCachedTagIds: vi.fn(),
}));

vi.mock('./moreLikeThisFetch', () => ({
  fetchMoreLikeThis: vi.fn(),
}));

import * as library from './library';
import * as ipc from './ipc';
import { getCachedTagIds } from './gamesCacheRead';
import { fetchMoreLikeThis } from './moreLikeThisFetch';
import { loadPersonalizationRail } from './personalizationRail';

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
    threadUrl: `https://x/${id}`,
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

const seedGame = game({
  threadId: 'seed-1',
  title: 'Seed Game Title',
  totalPlaytimeSeconds: 600,
  lastPlayedAt: '2026-08-09T12:00:00.000Z',
});

const fingerprint = 'seed-1@2026-08-09T12:00:00.000Z';

const resolveTagIds = vi.fn((tags: GameTag[]) =>
  tags.map((_, i) => 100 + i).filter((_, i) => i < tags.length),
);

describe('loadPersonalizationRail', () => {
  beforeEach(() => {
    query.mockReset();
    execute.mockReset();
    execute.mockResolvedValue({ rowsAffected: 1 });
    vi.mocked(library.list).mockReset();
    vi.mocked(ipc.gameDetail).mockReset();
    vi.mocked(getCachedTagIds).mockReset();
    vi.mocked(fetchMoreLikeThis).mockReset();
    resolveTagIds.mockClear();
    resolveTagIds.mockImplementation((tags: GameTag[]) =>
      tags.flatMap((t) => {
        const n = Number(t.slug);
        return Number.isFinite(n) ? [n] : [];
      }),
    );
  });

  it('returns empty when no seeds and does not fetch SAM', async () => {
    vi.mocked(library.list).mockResolvedValue([
      game({ threadId: '1', title: 'Unplayed', totalPlaytimeSeconds: 0 }),
    ]);

    const result = await loadPersonalizationRail({
      category: 'games',
      libraryThreadIds: new Set(['1']),
      resolveTagIds,
    });

    expect(result).toEqual({
      items: [],
      seedTitle: null,
      fingerprint: null,
      fromCache: false,
    });
    expect(fetchMoreLikeThis).not.toHaveBeenCalled();
    expect(getCachedTagIds).not.toHaveBeenCalled();
    expect(ipc.gameDetail).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it('returns fresh cache matching fingerprint without fetching', async () => {
    const cachedItems = [card('c1'), card('c2')];
    vi.mocked(library.list).mockResolvedValue([seedGame]);
    const now = 1_700_000_000_000;
    query.mockResolvedValueOnce([
      {
        payload: JSON.stringify({
          fingerprint,
          seedTitle: 'Seed Game Title',
          items: cachedItems,
        }),
        fetched_at: now - 60_000,
      },
    ]);

    const result = await loadPersonalizationRail({
      category: 'games',
      libraryThreadIds: new Set(['seed-1', 'lib-2']),
      nowMs: now,
      resolveTagIds,
    });

    expect(result).toEqual({
      items: cachedItems,
      seedTitle: 'Seed Game Title',
      fingerprint,
      fromCache: true,
    });
    expect(fetchMoreLikeThis).not.toHaveBeenCalled();
    expect(getCachedTagIds).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it('fetches on stale/mismatch, excludes library+seeds, soft-filters viewed, upserts cache', async () => {
    vi.mocked(library.list).mockResolvedValue([seedGame]);
    const now = 1_700_000_000_000;
    query.mockResolvedValueOnce([
      {
        payload: JSON.stringify({
          fingerprint: 'old@fp',
          seedTitle: 'Old',
          items: [card('stale')],
        }),
        fetched_at: now - PERSONAL_TTL_MS - 1,
      },
    ]);
    vi.mocked(getCachedTagIds).mockResolvedValueOnce([10, 20]);
    vi.mocked(fetchMoreLikeThis).mockResolvedValueOnce([
      card('viewed-a'),
      card('fresh-1'),
      card('viewed-b'),
      card('fresh-2'),
      card('fresh-3'),
      card('fresh-4'),
    ]);

    const result = await loadPersonalizationRail({
      category: 'games',
      libraryThreadIds: new Set(['seed-1', 'lib-other']),
      excludeViewedIds: new Set(['viewed-a', 'viewed-b']),
      nowMs: now,
      resolveTagIds,
    });

    expect(fetchMoreLikeThis).toHaveBeenCalledTimes(1);
    const fetchArgs = vi.mocked(fetchMoreLikeThis).mock.calls[0]![0];
    expect(fetchArgs.category).toBe('games');
    expect(fetchArgs.tagIds).toEqual([10, 20]);
    expect(fetchArgs.limit).toBe(RAIL_DISPLAY_COUNT + 8);
    expect(new Set(fetchArgs.excludeThreadIds)).toEqual(new Set(['seed-1', 'lib-other']));

    expect(result.fromCache).toBe(false);
    expect(result.fingerprint).toBe(fingerprint);
    expect(result.seedTitle).toBe('Seed Game Title');
    expect(result.items.map((c) => c.threadId)).toEqual([
      'fresh-1',
      'fresh-2',
      'fresh-3',
      'fresh-4',
    ]);
    expect(result.items).toHaveLength(4);

    expect(execute).toHaveBeenCalledTimes(1);
    const [sql, params] = execute.mock.calls[0]!;
    expect(String(sql)).toMatch(/INSERT INTO discovery_pools/i);
    expect(params[0]).toBe(PERSONAL_POOL_KEY);
    expect(params[2]).toBe(now);
    const written = JSON.parse(String(params[1])) as {
      fingerprint: string;
      seedTitle: string;
      items: SamGameCard[];
    };
    expect(written.fingerprint).toBe(fingerprint);
    expect(written.seedTitle).toBe('Seed Game Title');
    expect(written.items.map((c) => c.threadId)).toEqual([
      'fresh-1',
      'fresh-2',
      'fresh-3',
      'fresh-4',
    ]);
  });

  it('force bypasses fresh TTL and refetches', async () => {
    vi.mocked(library.list).mockResolvedValue([seedGame]);
    const now = 1_700_000_000_000;
    query.mockResolvedValueOnce([
      {
        payload: JSON.stringify({
          fingerprint,
          seedTitle: 'Seed Game Title',
          items: [card('cached')],
        }),
        fetched_at: now - 1_000,
      },
    ]);
    vi.mocked(getCachedTagIds).mockResolvedValueOnce([5]);
    vi.mocked(fetchMoreLikeThis).mockResolvedValueOnce([card('new-1')]);

    const result = await loadPersonalizationRail({
      category: 'games',
      libraryThreadIds: new Set(['seed-1']),
      nowMs: now,
      force: true,
      resolveTagIds,
    });

    expect(fetchMoreLikeThis).toHaveBeenCalled();
    expect(result.fromCache).toBe(false);
    expect(result.items.map((c) => c.threadId)).toEqual(['new-1']);
  });

  it('on fetch failure returns previous cache when present', async () => {
    vi.mocked(library.list).mockResolvedValue([seedGame]);
    const now = 1_700_000_000_000;
    const cachedItems = [card('prev-1'), card('prev-2')];
    query.mockResolvedValueOnce([
      {
        payload: JSON.stringify({
          fingerprint: 'other@fp',
          seedTitle: 'Prev Title',
          items: cachedItems,
        }),
        fetched_at: now - PERSONAL_TTL_MS - 5_000,
      },
    ]);
    vi.mocked(getCachedTagIds).mockResolvedValueOnce([1]);
    vi.mocked(fetchMoreLikeThis).mockRejectedValueOnce(new Error('sam down'));

    const result = await loadPersonalizationRail({
      category: 'games',
      libraryThreadIds: new Set(['seed-1']),
      nowMs: now,
      resolveTagIds,
    });

    expect(result).toEqual({
      items: cachedItems,
      seedTitle: 'Prev Title',
      fingerprint: 'other@fp',
      fromCache: true,
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('on fetch failure with no cache returns empty', async () => {
    vi.mocked(library.list).mockResolvedValue([seedGame]);
    query.mockResolvedValueOnce([]);
    vi.mocked(getCachedTagIds).mockResolvedValueOnce(null);
    vi.mocked(ipc.gameDetail).mockResolvedValueOnce({
      tags: [{ slug: '7', name: 'Tag Seven' }],
    } as GameDetail);
    resolveTagIds.mockReturnValueOnce([7]);
    vi.mocked(fetchMoreLikeThis).mockRejectedValueOnce(new Error('sam down'));

    const result = await loadPersonalizationRail({
      category: 'games',
      libraryThreadIds: new Set(['seed-1']),
      resolveTagIds,
    });

    expect(result).toEqual({
      items: [],
      seedTitle: null,
      fingerprint: null,
      fromCache: false,
    });
    expect(ipc.gameDetail).toHaveBeenCalledWith('seed-1');
    expect(resolveTagIds).toHaveBeenCalled();
  });

  it('keeps viewed items when soft-filter would leave fewer than 4', async () => {
    vi.mocked(library.list).mockResolvedValue([seedGame]);
    query.mockResolvedValueOnce([]);
    vi.mocked(getCachedTagIds).mockResolvedValueOnce([10]);
    vi.mocked(fetchMoreLikeThis).mockResolvedValueOnce([
      card('viewed-a'),
      card('viewed-b'),
      card('only-fresh'),
    ]);

    const result = await loadPersonalizationRail({
      category: 'games',
      libraryThreadIds: new Set(['seed-1']),
      excludeViewedIds: new Set(['viewed-a', 'viewed-b']),
      resolveTagIds,
    });

    expect(result.items.map((c) => c.threadId)).toEqual([
      'viewed-a',
      'viewed-b',
      'only-fresh',
    ]);
  });
});
