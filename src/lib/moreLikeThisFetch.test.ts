import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as ipc from './ipc';
import type { SamGameCard, SamPage } from '../types/sam';

vi.mock('./ipc');

import { fetchMoreLikeThis } from './moreLikeThisFetch';

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

function page(items: SamGameCard[], totalPages = 1): SamPage {
  return { page: 1, totalPages, totalRows: items.length, items, endpoint: 'test' };
}

describe('fetchMoreLikeThis', () => {
  beforeEach(() => {
    vi.mocked(ipc.samList).mockReset();
  });

  it('returns [] when no tag ids', async () => {
    await expect(
      fetchMoreLikeThis({ category: 'games', excludeThreadIds: ['1'], tagIds: [] }),
    ).resolves.toEqual([]);
    expect(ipc.samList).not.toHaveBeenCalled();
  });

  it('excludes provided thread ids and dedupes', async () => {
    vi.mocked(ipc.samList).mockResolvedValue(page([card('1'), card('2'), card('2'), card('3')]));
    const out = await fetchMoreLikeThis({
      category: 'games',
      excludeThreadIds: ['1'],
      tagIds: [10],
      limit: 12,
    });
    expect(out.map((c) => c.threadId)).toEqual(['2', '3']);
  });
});
