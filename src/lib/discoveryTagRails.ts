import type { DiscoveryTagRail } from './discoveryHomeModel';
import { TAG_RAIL_COUNT, TAG_RAIL_POOL } from './discoveryConfig';
import { findSamTagByNameOrSlug } from './tagCatalog';

/** Local calendar day as YYYY-MM-DD. */
export function localDayKey(nowMs = Date.now()): string {
  const d = new Date(nowMs);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** FNV-1a style seed → deterministic full shuffle of names (same pattern as pickSample). */
function shuffleNames(names: readonly string[], seed: string): string[] {
  const copy = names.slice();
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
  return copy;
}

export function pickTagRailsForDay(args: {
  catalog: Map<number, string>;
  dayKey: string;
  pool?: readonly string[];
  count?: number;
}): DiscoveryTagRail[] {
  const pool = args.pool ?? TAG_RAIL_POOL;
  const count = args.count ?? TAG_RAIL_COUNT;
  if (count <= 0 || pool.length === 0) return [];

  const shuffled = shuffleNames(pool, args.dayKey);
  const out: DiscoveryTagRail[] = [];
  const seen = new Set<number>();

  for (const name of shuffled) {
    if (out.length >= count) break;
    const tag = findSamTagByNameOrSlug(args.catalog, { name, slug: name });
    if (!tag || seen.has(tag.id)) continue;
    seen.add(tag.id);
    out.push({ key: `tag:${tag.id}`, tag, name: tag.name });
  }

  return out;
}
