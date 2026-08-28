import type { GameDetail } from '../types/game';
import * as ipc from './ipc';

const cache = new Map<string, GameDetail>();
const inflight = new Map<string, Promise<GameDetail>>();

/** Read a cached game detail without fetching. */
export function peekGameDetail(threadId: string): GameDetail | undefined {
  return cache.get(threadId);
}

/** Seed the cache (e.g. after a fresh fetch elsewhere). */
export function seedGameDetail(detail: GameDetail): void {
  cache.set(detail.threadId, detail);
}

/** Load game detail, deduping concurrent requests and reusing cache hits. */
export async function loadGameDetail(threadId: string): Promise<GameDetail> {
  const cached = cache.get(threadId);
  if (cached) return cached;

  let pending = inflight.get(threadId);
  if (!pending) {
    pending = ipc
      .gameDetail(threadId)
      .then((detail) => {
        cache.set(threadId, detail);
        inflight.delete(threadId);
        return detail;
      })
      .catch((err) => {
        inflight.delete(threadId);
        throw err;
      });
    inflight.set(threadId, pending);
  }

  return pending;
}

export type PrefetchGameDetailsOptions = {
  concurrency?: number;
  onLoaded?: (detail: GameDetail) => void;
};

/** Prefetch thread pages for card enrichment; shares cache with detail navigation. */
export async function prefetchGameDetails(
  threadIds: string[],
  options?: PrefetchGameDetailsOptions,
): Promise<void> {
  const unique = [...new Set(threadIds.filter(Boolean))];
  if (unique.length === 0) return;

  const limit = Math.max(1, options?.concurrency ?? 4);
  let index = 0;

  async function worker(): Promise<void> {
    while (true) {
      const pos = index++;
      if (pos >= unique.length) return;
      try {
        const detail = await loadGameDetail(unique[pos]!);
        options?.onLoaded?.(detail);
      } catch {
        // Cards fall back to search-hit data when a detail fetch fails.
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, unique.length) }, () => worker()),
  );
}
