import type { GameDetail } from '../types/game';
import { KNOWN_PREFIXES, type PrefixOption } from '../types/sam';

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

const PREFIX_BY_KEY = new Map(
  KNOWN_PREFIXES.map((p) => [p.name.trim().toLowerCase(), p] as const),
);

export function isEngineStoreTag(name: string): boolean {
  return ENGINE_NAMES_LOWER.has(name.trim().toLowerCase());
}

export function knownPrefixMeta(name: string): PrefixOption | undefined {
  return PREFIX_BY_KEY.get(name.trim().toLowerCase());
}

export function isKnownPrefixStoreTag(name: string): boolean {
  return PREFIX_BY_KEY.has(name.trim().toLowerCase());
}

export function splitStoreTags(tags: string[]): { engines: string[]; contentTags: string[] } {
  const engines: string[] = [];
  const contentTags: string[] = [];
  const seenEngine = new Set<string>();
  const seenTag = new Set<string>();

  for (const raw of tags) {
    const name = raw.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (ENGINE_NAMES_LOWER.has(key)) {
      if (seenEngine.has(key)) continue;
      seenEngine.add(key);
      engines.push(ENGINE_CANONICAL.get(key) ?? name);
    } else {
      if (seenTag.has(key)) continue;
      seenTag.add(key);
      contentTags.push(name);
    }
  }

  return { engines, contentTags };
}

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
    const meta = PREFIX_BY_KEY.get(key);
    if (!meta) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(meta.name);
  }

  return out;
}
