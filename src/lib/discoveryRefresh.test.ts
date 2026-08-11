import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SamGameCard, SamPage } from '../types/sam';

vi.mock('./ipc');
vi.mock('./discoveryPools');

import * as ipc from './ipc';
import * as pools from './discoveryPools';
import { refreshPoolIfStale, refreshPoolsSequential } from './discoveryRefresh';
import { RECENT_TTL_MS, SLOW_POOL_TTL_MS } from './discoveryConfig';

function page(items: SamGameCard[], pageNum = 1): SamPage {
  return { items, page: pageNum, totalPages: 5, totalRows: 75, endpoint: 'list' };
}

describe('refreshPoolIfStale', () => {
  beforeEach(() => {
    vi.mocked(ipc.samList).mockReset();
    vi.mocked(pools.upsertPool).mockReset();
    vi.mocked(pools.upsertPool).mockResolvedValue();
  });

  it('skips network when fresh', async () => {
    const now = 1_000_000;
    const result = await refreshPoolIfStale({
      key: 'likes',
      sort: 'likes',
      pages: 5,
      ttlMs: SLOW_POOL_TTL_MS,
      nowMs: now,
      cached: { key: 'likes', items: [{ threadId: '1' } as SamGameCard], fetchedAt: now - 1000 },
    });
    expect(result.refreshed).toBe(false);
    expect(ipc.samList).not.toHaveBeenCalled();
  });

  it('fetches pages sequentially when stale', async () => {
    const now = 1_000_000;
    vi.mocked(ipc.samList)
      .mockResolvedValueOnce(page([{ threadId: 'a' } as SamGameCard], 1))
      .mockResolvedValueOnce(page([{ threadId: 'b' } as SamGameCard], 2));

    const result = await refreshPoolIfStale({
      key: 'recent',
      sort: 'date',
      pages: 2,
      ttlMs: RECENT_TTL_MS,
      nowMs: now,
      cached: { key: 'recent', items: [], fetchedAt: now - RECENT_TTL_MS - 1 },
    });

    expect(result.refreshed).toBe(true);
    expect(ipc.samList).toHaveBeenCalledTimes(2);
    expect(vi.mocked(ipc.samList).mock.calls[0]![0]).toMatchObject({ page: 1, sort: 'date' });
    expect(vi.mocked(ipc.samList).mock.calls[1]![0]).toMatchObject({ page: 2, sort: 'date' });
    expect(pools.upsertPool).toHaveBeenCalled();
    expect(result.items.map((i) => i.threadId)).toEqual(['a', 'b']);
  });

  it('keeps previous cache items when fetch fails', async () => {
    const now = 1_000_000;
    const cachedItems = [{ threadId: 'stale-1' } as SamGameCard];
    vi.mocked(ipc.samList).mockRejectedValue(new Error('network down'));

    const result = await refreshPoolIfStale({
      key: 'likes',
      sort: 'likes',
      pages: 1,
      ttlMs: SLOW_POOL_TTL_MS,
      nowMs: now,
      cached: { key: 'likes', items: cachedItems, fetchedAt: now - SLOW_POOL_TTL_MS - 1 },
    });

    expect(result.refreshed).toBe(false);
    expect(result.items).toEqual(cachedItems);
    expect(result.fetchedAt).toBe(now - SLOW_POOL_TTL_MS - 1);
    expect(pools.upsertPool).not.toHaveBeenCalled();
  });

  it('keeps previous cache items when fetch returns empty', async () => {
    const now = 1_000_000;
    const cachedItems = [{ threadId: 'good-1' } as SamGameCard];
    const cachedAt = now - SLOW_POOL_TTL_MS - 1;
    vi.mocked(ipc.samList).mockResolvedValue(page([], 1));

    const result = await refreshPoolIfStale({
      key: 'likes',
      sort: 'likes',
      pages: 1,
      ttlMs: SLOW_POOL_TTL_MS,
      nowMs: now,
      cached: { key: 'likes', items: cachedItems, fetchedAt: cachedAt },
    });

    expect(result.refreshed).toBe(false);
    expect(result.items).toEqual(cachedItems);
    expect(result.fetchedAt).toBe(cachedAt);
    expect(pools.upsertPool).not.toHaveBeenCalled();
  });
});

describe('refreshPoolsSequential', () => {
  beforeEach(() => {
    vi.mocked(ipc.samList).mockReset();
    vi.mocked(pools.upsertPool).mockReset();
    vi.mocked(pools.upsertPool).mockResolvedValue();
  });

  it('processes pools one at a time', async () => {
    const order: string[] = [];
    vi.mocked(ipc.samList).mockImplementation(async (filters) => {
      const label = filters.sort === 'date' ? 'recent' : 'likes';
      order.push(`start:${label}`);
      await Promise.resolve();
      order.push(`end:${label}`);
      return page([{ threadId: label } as SamGameCard], 1);
    });

    await refreshPoolsSequential(
      [
        { key: 'recent', sort: 'date', pages: 1, ttlMs: RECENT_TTL_MS },
        { key: 'likes', sort: 'likes', pages: 1, ttlMs: SLOW_POOL_TTL_MS },
      ],
      () => null,
      1_000_000,
    );

    expect(order).toEqual(['start:recent', 'end:recent', 'start:likes', 'end:likes']);
    expect(pools.upsertPool).toHaveBeenCalledTimes(2);
  });
});
