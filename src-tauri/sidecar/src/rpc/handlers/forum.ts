import type { AppContext } from '../../domain/context';
import {
  fetchForumSearch,
  fetchForumSearchFormOptions,
} from '../../domain/f95/forumSearch';
import { parseForumSearchRpcParams } from '../../domain/f95/forumSearchParams';
import { RPC_ERROR, RpcError, type RpcHandler } from '../types';

export function createForumHandlers(ctx: AppContext): Record<string, RpcHandler> {
  return {
    forumSearch: async (p) => {
      const params = parseForumSearchRpcParams((p ?? {}) as Record<string, unknown>);
      if (!params.query) throw new RpcError(RPC_ERROR.INVALID_PARAMS, 'query required');
      if (params.page != null && (!Number.isInteger(params.page) || params.page < 1)) {
        throw new RpcError(RPC_ERROR.INVALID_PARAMS, 'page must be >= 1');
      }
      return fetchForumSearch(ctx.requireClient().http, params);
    },
    forumSearchFormOptions: async () => {
      return fetchForumSearchFormOptions(ctx.requireClient().http);
    },
  };
}
