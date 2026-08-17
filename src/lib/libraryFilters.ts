import { KNOWN_PREFIXES } from '../types/sam';
import type { LibraryGame } from '../types/library';
import { isEngineStoreTag } from './storeTagsFromDetail';

export type LibraryTagMode = 'and' | 'or';

export interface LibraryMetaFilter {
  engines: string[];
  tags: string[];
  tagMode: LibraryTagMode;
}

export const EMPTY_LIBRARY_META_FILTER: LibraryMetaFilter = {
  engines: [],
  tags: [],
  tagMode: 'or',
};

export const LIBRARY_ENGINE_OPTIONS = KNOWN_PREFIXES.filter((p) => p.group === 'engine').map(
  (p) => p.name,
);

function normalizeTag(value: string): string {
  return value.trim().toLowerCase();
}

function gameTagSet(game: LibraryGame): Set<string> {
  const out = new Set<string>();
  for (const tag of [...game.storeTags, ...game.customTags]) {
    const key = normalizeTag(tag);
    if (key) out.add(key);
  }
  return out;
}

export function gameHasEngine(game: LibraryGame, engine: string): boolean {
  const key = normalizeTag(engine);
  return game.storeTags.some((tag) => normalizeTag(tag) === key);
}

export function gameHasContentTag(game: LibraryGame, tag: string): boolean {
  const key = normalizeTag(tag);
  return [...game.storeTags, ...game.customTags].some((t) => normalizeTag(t) === key);
}

export function matchesLibraryMetaFilter(
  game: LibraryGame,
  filter: LibraryMetaFilter,
): boolean {
  if (filter.engines.length > 0) {
    const engineHit = filter.engines.some((engine) => gameHasEngine(game, engine));
    if (!engineHit) return false;
  }

  if (filter.tags.length > 0) {
    if (filter.tagMode === 'and') {
      if (!filter.tags.every((tag) => gameHasContentTag(game, tag))) return false;
    } else if (!filter.tags.some((tag) => gameHasContentTag(game, tag))) {
      return false;
    }
  }

  return true;
}

export function applyLibraryMetaFilter(
  games: LibraryGame[],
  filter: LibraryMetaFilter,
): LibraryGame[] {
  if (filter.engines.length === 0 && filter.tags.length === 0) return games;
  return games.filter((game) => matchesLibraryMetaFilter(game, filter));
}

export interface LibraryFilterOption {
  name: string;
  count: number;
}

export function buildLibraryEngineOptions(games: LibraryGame[]): LibraryFilterOption[] {
  const counts = new Map<string, number>();
  for (const engine of LIBRARY_ENGINE_OPTIONS) {
    counts.set(engine, 0);
  }
  for (const game of games) {
    for (const tag of game.storeTags) {
      if (!isEngineStoreTag(tag)) continue;
      const canonical =
        LIBRARY_ENGINE_OPTIONS.find((e) => normalizeTag(e) === normalizeTag(tag)) ?? tag;
      counts.set(canonical, (counts.get(canonical) ?? 0) + 1);
    }
  }
  return LIBRARY_ENGINE_OPTIONS.map((name) => ({
    name,
    count: counts.get(name) ?? 0,
  }));
}

export function buildLibraryTagOptions(games: LibraryGame[]): LibraryFilterOption[] {
  const counts = new Map<string, number>();
  for (const game of games) {
    const seen = new Set<string>();
    for (const raw of [...game.storeTags, ...game.customTags]) {
      const name = raw.trim();
      if (!name || isEngineStoreTag(name)) continue;
      const key = normalizeTag(name);
      if (seen.has(key)) continue;
      seen.add(key);
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function parseCsvParam(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((part) => decodeURIComponent(part.trim()))
    .filter(Boolean);
}

function writeCsvParam(values: string[]): string | null {
  if (values.length === 0) return null;
  return values.map((v) => encodeURIComponent(v)).join(',');
}

export function parseLibraryMetaFilter(params: URLSearchParams): LibraryMetaFilter {
  const tagModeRaw = params.get('tagMode');
  return {
    engines: parseCsvParam(params.get('engines')),
    tags: parseCsvParam(params.get('tags')),
    tagMode: tagModeRaw === 'and' ? 'and' : 'or',
  };
}

export function hasActiveLibraryMetaFilter(filter: LibraryMetaFilter): boolean {
  return filter.engines.length > 0 || filter.tags.length > 0;
}

export function applyLibraryMetaFilterToSearchParams(
  params: URLSearchParams,
  filter: LibraryMetaFilter,
): URLSearchParams {
  const next = new URLSearchParams(params);
  const engines = writeCsvParam(filter.engines);
  const tags = writeCsvParam(filter.tags);
  if (engines) next.set('engines', engines);
  else next.delete('engines');
  if (tags) next.set('tags', tags);
  else next.delete('tags');
  if (filter.tags.length > 1 && filter.tagMode === 'and') next.set('tagMode', 'and');
  else next.delete('tagMode');
  return next;
}
