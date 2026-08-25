import type { SamGameCard } from '../types/sam';

export function isPoolFresh(fetchedAtMs: number, ttlMs: number, nowMs: number): boolean {
  return nowMs - fetchedAtMs < ttlMs;
}

export function dedupeByThreadId(items: SamGameCard[]): SamGameCard[] {
  const seen = new Set<string>();
  const out: SamGameCard[] = [];
  for (const item of items) {
    if (seen.has(item.threadId)) continue;
    seen.add(item.threadId);
    out.push(item);
  }
  return out;
}

export function withoutIgnored(items: SamGameCard[]): SamGameCard[] {
  return items.filter((item) => !item.ignored);
}

export function pickHead(items: SamGameCard[], n: number): SamGameCard[] {
  return items.slice(0, Math.max(0, n));
}

/** FNV-1a style seed → deterministic shuffle copy, then take n. */
export function pickSample(items: SamGameCard[], n: number, seed: string): SamGameCard[] {
  if (n <= 0 || items.length === 0) return [];
  const copy = items.slice();
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  for (let i = copy.length - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 13), 16777619);
    const j = Math.abs(h) % (i + 1);
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy.slice(0, Math.min(n, copy.length));
}

/** Like pickSample, but skips threadIds already claimed (e.g. by earlier tag panels). */
export function pickSampleExcluding(
  items: SamGameCard[],
  n: number,
  seed: string,
  exclude: ReadonlySet<string>,
): SamGameCard[] {
  if (exclude.size === 0) return pickSample(items, n, seed);
  return pickSample(
    items.filter((item) => !exclude.has(item.threadId)),
    n,
    seed,
  );
}

export function buildSpotlight(
  recent: SamGameCard[],
  likes: SamGameCard[],
  views: SamGameCard[],
  count: number,
  seed: string,
): SamGameCard[] {
  const mixed = dedupeByThreadId([
    ...pickHead(recent, Math.ceil(count / 2)),
    ...pickSample(likes, count, `${seed}:likes`),
    ...pickSample(views, count, `${seed}:views`),
  ]);
  return pickSample(mixed, count, `${seed}:spot`);
}
