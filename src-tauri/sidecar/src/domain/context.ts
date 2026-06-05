import { F95Client } from './f95/client';
import { SamClient } from './sam/client';
import { GameClient } from './game/client';
import { SocialClient } from './social/client';
import { RPC_ERROR, RpcError } from '../rpc';

export class AppContext {
  client: F95Client | null = null;
  private sam: SamClient | null = null;
  private game: GameClient | null = null;
  private social: SocialClient | null = null;

  requireClient(): F95Client {
    if (!this.client) {
      throw new RpcError(RPC_ERROR.NOT_INITIALIZED, 'client not initialized; call init first');
    }
    return this.client;
  }

  resetDerivedClients(): void {
    this.sam = null;
    this.game = null;
    this.social = null;
  }

  getSam(): SamClient {
    const c = this.requireClient();
    if (!this.sam) this.sam = new SamClient(c.http);
    return this.sam;
  }

  getGame(): GameClient {
    const c = this.requireClient();
    if (!this.game) this.game = new GameClient(c.http);
    return this.game;
  }

  getSocial(): SocialClient {
    const c = this.requireClient();
    if (!this.social) this.social = new SocialClient(c.http);
    return this.social;
  }
}
