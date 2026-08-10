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
    threadPosts: async (p) => {
      const threadId = String(p?.threadId ?? p?.thread_id ?? '');
      const page = Number(p?.page ?? 1);
      if (!threadId) throw new RpcError(RPC_ERROR.INVALID_PARAMS, 'threadId required');
      if (!Number.isFinite(page) || page < 1) {
        throw new RpcError(RPC_ERROR.INVALID_PARAMS, 'page must be >= 1');
      }
      return ctx.getGame().getPosts(threadId, page);
    },
    threadReply: async (p) => {
      const threadId = String(p?.threadId ?? p?.thread_id ?? '');
      const message = String(p?.message ?? '');
      if (!threadId) throw new RpcError(RPC_ERROR.INVALID_PARAMS, 'threadId required');
      if (!message.trim()) throw new RpcError(RPC_ERROR.INVALID_PARAMS, 'message required');
      return ctx.getGame().reply(threadId, message);
    },
    bbcodePreview: async (p) => {
      const threadId = String(p?.threadId ?? p?.thread_id ?? '');
      const bbCode = String(p?.bbCode ?? p?.bb_code ?? '');
      if (!threadId) throw new RpcError(RPC_ERROR.INVALID_PARAMS, 'threadId required');
      return ctx.getGame().previewBbcode(threadId, bbCode);
    },
    resolvePost: async (p) => {
      const url = typeof p?.url === 'string' ? p.url.trim() : '';
      if (url) return ctx.getGame().resolveF95Url(url);
      const postId = String(p?.postId ?? p?.post_id ?? '');
      if (!postId) throw new RpcError(RPC_ERROR.INVALID_PARAMS, 'postId or url required');
      return ctx.getGame().resolvePost(postId);
    },
    getFollowing: async () => ctx.getSocial().getFollowing(),
  };
}
