import type { AppContext } from '../../domain/context';
import {
  fetchForumSearch,
  type ForumSearchIn,
  type ForumSearchSort,
} from '../../domain/f95/forumSearch';
import { RPC_ERROR, RpcError, type RpcHandler } from '../types';

export function createForumHandlers(ctx: AppContext): Record<string, RpcHandler> {
  return {
    forumSearch: async (p) => {
      const query = String(p?.query ?? '').trim();
      if (!query) throw new RpcError(RPC_ERROR.INVALID_PARAMS, 'query required');
      const page = Number(p?.page ?? 1);
      if (!Number.isInteger(page) || page < 1) {
        throw new RpcError(RPC_ERROR.INVALID_PARAMS, 'page must be >= 1');
      }
      const searchIn = (p?.searchIn === 'titles' ? 'titles' : 'posts') as ForumSearchIn;
      const sort = (p?.sort === 'date' ? 'date' : 'relevance') as ForumSearchSort;
      const titleOnly = Boolean(p?.titleOnly);
      return fetchForumSearch(ctx.requireClient().http, {
        query,
        titleOnly,
        searchIn,
        sort,
        page,
      });
    },
  };
}
