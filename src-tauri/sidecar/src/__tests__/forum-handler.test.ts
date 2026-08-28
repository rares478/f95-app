import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppContext } from '../domain/context';
import type { F95Client } from '../domain/f95/client';

const fetchForumSearchMock = vi.fn();

vi.mock('../domain/f95/forumSearch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../domain/f95/forumSearch')>();
  return {
    ...actual,
    fetchForumSearch: (...args: unknown[]) => fetchForumSearchMock(...args),
  };
});

import { createForumHandlers } from '../rpc/handlers/forum';

describe('forumSearch handler', () => {
  beforeEach(() => {
    fetchForumSearchMock.mockReset();
    fetchForumSearchMock.mockResolvedValue({
      results: [],
      page: 1,
      hasMore: false,
      totalPages: null,
    });
  });

  it('passes threadId to fetchForumSearch', async () => {
    const ctx = new AppContext();
    const http = {} as F95Client['http'];
    ctx.client = { http } as F95Client;

    const handlers = createForumHandlers(ctx);
    await handlers.forumSearch({
      query: 'test',
      page: 1,
      threadId: '25332',
    });

    expect(fetchForumSearchMock).toHaveBeenCalledOnce();
    expect(fetchForumSearchMock).toHaveBeenCalledWith(http, {
      query: 'test',
      titleOnly: false,
      searchIn: 'posts',
      sort: 'relevance',
      page: 1,
      threadId: '25332',
    });
  });

  it('omits threadId when empty or non-string', async () => {
    const ctx = new AppContext();
    const http = {} as F95Client['http'];
    ctx.client = { http } as F95Client;

    const handlers = createForumHandlers(ctx);
    await handlers.forumSearch({
      query: 'test',
      page: 1,
      threadId: '   ',
    });

    expect(fetchForumSearchMock).toHaveBeenCalledWith(
      http,
      expect.objectContaining({ threadId: undefined }),
    );
  });
});
