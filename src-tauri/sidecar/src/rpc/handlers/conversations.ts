import type { AppContext } from '../../domain/context';
import { RPC_ERROR, RpcError, type RpcHandler } from '../types';

export function createConversationsHandlers(ctx: AppContext): Record<string, RpcHandler> {
  return {
    fetchConversationsList: async (p) => {
      const page = typeof p?.page === 'number' ? p.page : 1;
      return ctx.requireClient().fetchConversationsList(page);
    },
    fetchConversation: async (p) => {
      const conversationPath = String(
        p?.conversationPath ?? p?.conversation_path ?? p?.conversationId ?? '',
      ).trim();
      const page = Number(p?.page ?? 1);
      if (!conversationPath) {
        throw new RpcError(RPC_ERROR.INVALID_PARAMS, 'conversationPath required');
      }
      if (!Number.isFinite(page) || page < 1) {
        throw new RpcError(RPC_ERROR.INVALID_PARAMS, 'page must be >= 1');
      }
      return ctx.requireClient().fetchConversation(conversationPath, page);
    },
    conversationReply: async (p) => {
      const conversationPath = String(
        p?.conversationPath ?? p?.conversation_path ?? '',
      ).trim();
      const message = String(p?.message ?? '');
      if (!conversationPath) {
        throw new RpcError(RPC_ERROR.INVALID_PARAMS, 'conversationPath required');
      }
      if (!message.trim()) {
        throw new RpcError(RPC_ERROR.INVALID_PARAMS, 'message required');
      }
      return ctx.requireClient().sendConversationReply(conversationPath, message);
    },
    conversationBbcodePreview: async (p) => {
      const conversationPath = String(
        p?.conversationPath ?? p?.conversation_path ?? '',
      ).trim();
      const bbCode = String(p?.bbCode ?? p?.bb_code ?? '');
      if (!conversationPath) {
        throw new RpcError(RPC_ERROR.INVALID_PARAMS, 'conversationPath required');
      }
      return ctx.requireClient().previewConversationBbcode(conversationPath, bbCode);
    },
  };
}
