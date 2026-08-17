import { KNOWN_PREFIXES } from '../types/sam';
import type { LibraryGame } from '../types/library';
import { isEngineStoreTag, isKnownPrefixStoreTag } from './storeTagsFromDetail';

export type LibraryTagMode = 'and' | 'or';

export interface LibraryMetaFilter {
  engines: string[];
  statuses: string[];
  prefixes: string[];
  tags: string[];
  tagMode: LibraryTagMode;
}

export const EMPTY_LIBRARY_META_FILTER: LibraryMetaFilter = {
  engines: [],
  statuses: [],
  prefixes: [],
  tags: [],
  tagMode: 'or',
};

export const LIBRARY_ENGINE_OPTIONS = KNOWN_PREFIXES.filter((p) => p.group === 'engine').map(
  (p) => p.name,
);

export const LIBRARY_STATUS_OPTIONS = KNOWN_PREFIXES.filter((p) => p.group === 'status').map(
  (p) => p.name,
);

export const LIBRARY_PREFIX_OPTIONS = KNOWN_PREFIXES.filter((p) => p.group === 'other').map(
  (p) => p.name,
);

function normalizeTag(value: string): string {
  return value.trim().toLowerCase();
}

export function gameHasEngine(game: LibraryGame, engine: string): boolean {
  const key = normalizeTag(engine);
  return game.storeTags.some((tag) => normalizeTag(tag) === key);
}

export function gameHasContentTag(game: LibraryGame, tag: string): boolean {
  const key = normalizeTag(tag);
  return [...game.storeTags, ...game.customTags].some((t) => normalizeTag(t) === key);
}

function matchesNamedGroup(game: LibraryGame, names: string[]): boolean {
  if (names.length === 0) return true;
  return names.some((name) => gameHasEngine(game, name));
}

export function matchesLibraryMetaFilter(
  game: LibraryGame,
  filter: LibraryMetaFilter,
): boolean {
  if (!matchesNamedGroup(game, filter.engines)) return false;
  if (!matchesNamedGroup(game, filter.statuses)) return false;
  if (!matchesNamedGroup(game, filter.prefixes)) return false;

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
  if (!hasActiveLibraryMetaFilter(filter)) return games;
  return games.filter((game) => matchesLibraryMetaFilter(game, filter));
}

export interface LibraryFilterOption {
  name: string;
  count: number;
}

function countCatalogOptions(catalog: string[], games: LibraryGame[]): LibraryFilterOption[] {
  const counts = new Map<string, number>();
  for (const name of catalog) counts.set(name, 0);
  for (const game of games) {
    for (const tag of game.storeTags) {
      const canonical = catalog.find((e) => normalizeTag(e) === normalizeTag(tag));
      if (!canonical) continue;
      counts.set(canonical, (counts.get(canonical) ?? 0) + 1);
    }
  }
  return catalog.map((name) => ({
    name,
    count: counts.get(name) ?? 0,
  }));
}

export function buildLibraryEngineOptions(games: LibraryGame[]): LibraryFilterOption[] {
  return countCatalogOptions(LIBRARY_ENGINE_OPTIONS, games);
}

export function buildLibraryStatusOptions(games: LibraryGame[]): LibraryFilterOption[] {
  return countCatalogOptions(LIBRARY_STATUS_OPTIONS, games);
}

export function buildLibraryPrefixOptions(games: LibraryGame[]): LibraryFilterOption[] {
  return countCatalogOptions(LIBRARY_PREFIX_OPTIONS, games);
}

export function buildLibraryTagOptions(games: LibraryGame[]): LibraryFilterOption[] {
  const counts = new Map<string, number>();
  for (const game of games) {
    const seen = new Set<string>();
    for (const raw of [...game.storeTags, ...game.customTags]) {
      const name = raw.trim();
      if (!name || isEngineStoreTag(name) || isKnownPrefixStoreTag(name)) continue;
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

const IDLE_TAG_SUGGESTION_LIMIT = 12;
const QUERY_TAG_SUGGESTION_LIMIT = 20;

/** Combobox suggestions: top tags when idle, name matches when typing. */
export function libraryTagSuggestions(
  options: readonly LibraryFilterOption[],
  query: string,
): LibraryFilterOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return options.slice(0, IDLE_TAG_SUGGESTION_LIMIT);
  return options
    .filter((opt) => opt.name.toLowerCase().includes(q))
    .slice(0, QUERY_TAG_SUGGESTION_LIMIT);
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
    statuses: parseCsvParam(params.get('statuses')),
    prefixes: parseCsvParam(params.get('prefixes')),
    tags: parseCsvParam(params.get('tags')),
    tagMode: tagModeRaw === 'and' ? 'and' : 'or',
  };
}

export function hasActiveLibraryMetaFilter(filter: LibraryMetaFilter): boolean {
  return (
    filter.engines.length > 0 ||
    filter.statuses.length > 0 ||
    filter.prefixes.length > 0 ||
    filter.tags.length > 0
  );
}

export function applyLibraryMetaFilterToSearchParams(
  params: URLSearchParams,
  filter: LibraryMetaFilter,
): URLSearchParams {
  const next = new URLSearchParams(params);
  const engines = writeCsvParam(filter.engines);
  const statuses = writeCsvParam(filter.statuses);
  const prefixes = writeCsvParam(filter.prefixes);
  const tags = writeCsvParam(filter.tags);
  if (engines) next.set('engines', engines);
  else next.delete('engines');
  if (statuses) next.set('statuses', statuses);
  else next.delete('statuses');
  if (prefixes) next.set('prefixes', prefixes);
  else next.delete('prefixes');
  if (tags) next.set('tags', tags);
  else next.delete('tags');
  if (filter.tags.length > 1 && filter.tagMode === 'and') next.set('tagMode', 'and');
  else next.delete('tagMode');
  return next;
}
