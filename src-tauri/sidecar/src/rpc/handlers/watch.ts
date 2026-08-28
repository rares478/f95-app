import type { AppContext } from '../../domain/context';
import { RPC_ERROR, RpcError, type RpcHandler } from '../types';

export function createWatchHandlers(ctx: AppContext): Record<string, RpcHandler> {
  return {
    getWatchedThreads: async (p) => {
      const page = typeof p?.page === 'number' ? p.page : 1;
      if (!Number.isFinite(page) || page < 1) {
        throw new RpcError(RPC_ERROR.INVALID_PARAMS, 'page must be >= 1');
      }
      return ctx.getWatch().getWatchedThreads(page);
    },
    getThreadWatchState: async (p) => {
      const threadId = String(p?.threadId ?? p?.thread_id ?? '').trim();
      if (!threadId) {
        throw new RpcError(RPC_ERROR.INVALID_PARAMS, 'threadId required');
      }
      return ctx.getWatch().getThreadWatchState(threadId);
    },
  };
}
