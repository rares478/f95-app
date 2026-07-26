import type { SamPrefixGroup } from '../types/sam';
import { buildPrefixCatalog, type PrefixMeta } from './prefixCatalog';
import { decodeHtmlEntities } from './htmlEntities';

const STORAGE_KEY = 'f95-prefix-catalog-v1';

/** Decode entity-encoded names so filter UI / storage stay readable. */
export function sanitizePrefixGroups(groups: SamPrefixGroup[]): SamPrefixGroup[] {
  return groups.map((group) => ({
    ...group,
    name: decodeHtmlEntities(group.name),
    prefixes: group.prefixes.map((p) => ({
      ...p,
      name: decodeHtmlEntities(p.name),
    })),
  }));
}

export function loadStoredPrefixCatalog(): Map<number, PrefixMeta> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Map();
    const parsed = JSON.parse(raw) as { groups?: SamPrefixGroup[] };
    if (!Array.isArray(parsed.groups) || parsed.groups.length === 0) return new Map();
    return buildPrefixCatalog(sanitizePrefixGroups(parsed.groups));
  } catch {
    return new Map();
  }
}

export function savePrefixCatalog(groups: SamPrefixGroup[]): void {
  if (groups.length === 0) return;
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ groups: sanitizePrefixGroups(groups), savedAt: Date.now() }),
    );
  } catch {
    // ignore
  }
}

export function loadStoredPrefixGroups(): SamPrefixGroup[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { groups?: SamPrefixGroup[] };
    return Array.isArray(parsed.groups) ? sanitizePrefixGroups(parsed.groups) : [];
  } catch {
    return [];
  }
}
