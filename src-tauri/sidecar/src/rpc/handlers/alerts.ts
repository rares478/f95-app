import type { SamCategory } from '../../domain/sam/client';
import type { AppContext } from '../../domain/context';
import { RPC_ERROR, RpcError, type RpcHandler } from '../types';

export function createAlertsHandlers(ctx: AppContext): Record<string, RpcHandler> {
  return {
    fetchRss: async (p) => {
      const category = (p?.category ?? 'games') as SamCategory;
      return ctx.getSam().fetchRss(category);
    },
    fetchAlertsPopup: async () => ctx.requireClient().fetchAlertsPopup(),
    fetchAlertsList: async (p) => {
      const page = typeof p?.page === 'number' ? p.page : 1;
      return ctx.requireClient().fetchAlertsList(page);
    },
  };
}
