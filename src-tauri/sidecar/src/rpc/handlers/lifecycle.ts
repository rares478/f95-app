import { F95Client, type InitOptions } from '../../domain/f95/client';
import type { AppContext } from '../../domain/context';
import { RPC_ERROR, RpcError, type RpcHandler } from '../../rpc';
import { closePlaywrightBrowser } from '../../infra/playwright/browser';

export function createLifecycleHandlers(ctx: AppContext): Record<string, RpcHandler> {
  return {
    init: async (p: Record<string, unknown>) => {
      const opts = p as unknown as InitOptions;
      if (!opts.sessionDir || typeof opts.sessionDir !== 'string') {
        throw new RpcError(RPC_ERROR.INVALID_PARAMS, 'sessionDir required');
      }
      ctx.client = new F95Client(opts);
      ctx.resetDerivedClients();
      return { sessionId: ctx.client.sessionId };
    },
    ping: async () => ({ ok: true }),
    close: async () => {
      if (ctx.client) {
        await ctx.client.close();
        ctx.client = null;
      }
      ctx.resetDerivedClients();
      await closePlaywrightBrowser();
      setImmediate(() => process.exit(0));
      return { ok: true };
    },
  };
}
