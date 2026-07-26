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

export function catalogToRecord(catalog: TagCatalog): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [id, name] of catalog) {
    out[String(id)] = name;
  }
  return out;
}
