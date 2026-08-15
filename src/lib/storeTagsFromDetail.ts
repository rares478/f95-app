import type { GameDetail } from '../types/game';
import { KNOWN_PREFIXES } from '../types/sam';

const ENGINE_NAMES_LOWER = new Set(
  KNOWN_PREFIXES.filter((p) => p.group === 'engine').map((p) =>
    p.name.trim().toLowerCase(),
  ),
);

const ENGINE_CANONICAL = new Map(
  KNOWN_PREFIXES.filter((p) => p.group === 'engine').map((p) => [
    p.name.trim().toLowerCase(),
    p.name,
  ]),
);

export function buildStoreTagsFromDetail(detail: GameDetail): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const tag of detail.tags ?? []) {
    const name = (tag.name ?? '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }

  for (const prefix of detail.prefixes ?? []) {
    const raw = (prefix.name ?? '').trim();
    if (!raw) continue;
    const key = raw.toLowerCase();
    if (!ENGINE_NAMES_LOWER.has(key)) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ENGINE_CANONICAL.get(key) ?? raw);
  }

  return out;
}
