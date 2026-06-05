import type { SamFilters } from '../../domain/sam/client';
import type { AppContext } from '../../domain/context';
import { RPC_ERROR, RpcError, type RpcHandler } from '../../rpc';

export function createSamHandlers(ctx: AppContext): Record<string, RpcHandler> {
  return {
    samList: async (p) => {
      const filters = (p?.filters ?? p ?? {}) as SamFilters;
      return ctx.getSam().list(filters);
    },
    samTagSearch: async (p) => {
      const category = (p?.category ?? 'games') as SamFilters['category'];
      const search = typeof p?.search === 'string' ? p.search : '';
      return ctx.getSam().searchTags(category ?? 'games', search);
    },
    samOptions: async (p) => {
      const category = (p?.category ?? 'games') as SamFilters['category'];
      return ctx.getSam().options(category ?? 'games');
    },
  };
}

export function createGameHandlers(ctx: AppContext): Record<string, RpcHandler> {
  return {
    gameDetail: async (p) => {
      const id = (p?.threadId ?? p?.thread_id ?? p?.url) as string | undefined;
      if (typeof id !== 'string' || id.length === 0) {
        throw new RpcError(RPC_ERROR.INVALID_PARAMS, 'threadId required');
      }
      return ctx.getGame().getDetail(id);
    },
    getFollowing: async () => ctx.getSocial().getFollowing(),
  };
}
