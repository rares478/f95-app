import bundledTagMap from '../data/f95-tag-map.json';
import type { SamTag } from '../types/sam';
import { decodeHtmlEntities } from './htmlEntities';

export type TagCatalog = Map<number, string>;

export function buildTagCatalogFromRecord(
  record: Record<string, string> | null | undefined,
): TagCatalog {
  const map = new Map<number, string>();
  if (!record) return map;
  for (const [key, name] of Object.entries(record)) {
    const id = Number(key);
    if (Number.isFinite(id) && name.trim()) {
      map.set(id, decodeHtmlEntities(name.trim()));
    }
  }
  return map;
}

export function mergeTagCatalogs(...sources: TagCatalog[]): TagCatalog {
  const out = new Map<number, string>();
  for (const src of sources) {
    for (const [id, name] of src) {
      out.set(id, name);
    }
  }
  return out;
}

export function bundledTagCatalog(): TagCatalog {
  return buildTagCatalogFromRecord(bundledTagMap as Record<string, string>);
}

export function resolveTagName(catalog: TagCatalog, id: number): string {
  return catalog.get(id) ?? `#${id}`;
}

export function resolveTags(catalog: TagCatalog, ids: number[]): SamTag[] {
  return ids.map((id) => ({ id, name: resolveTagName(catalog, id) }));
}

function normalizeTagKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

/** Match a thread-page tag (name/slug) to a SAM catalog entry. */
/** Resolve thread-page tags to SAM catalog IDs for store-style pills. */
export function contentTagIdsFromDetail(
  catalog: TagCatalog,
  tags: { slug: string; name: string }[],
): number[] {
  const ids: number[] = [];
  const seen = new Set<number>();
  for (const tag of tags) {
    const sam = findSamTagByNameOrSlug(catalog, tag);
    if (!sam || seen.has(sam.id)) continue;
    seen.add(sam.id);
    ids.push(sam.id);
  }
  return ids;
}

export function findSamTagByNameOrSlug(
  catalog: TagCatalog,
  tag: { slug: string; name: string },
): SamTag | null {
  const nameKey = normalizeTagKey(tag.name);
  const slugKey = normalizeTagKey(tag.slug);
  for (const [id, name] of catalog) {
    const key = normalizeTagKey(name);
    if (key === nameKey || key === slugKey) {
      return { id, name };
    }
  }
  return null;
}

export function catalogToRecord(catalog: TagCatalog): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [id, name] of catalog) {
    out[String(id)] = name;
  }
  return out;
}
