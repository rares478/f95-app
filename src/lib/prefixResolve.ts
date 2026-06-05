import type { PrefixMeta } from './prefixCatalog';
import { prefixPillColor } from './prefixCatalog';

export function resolvePrefixByName(
  catalog: Map<number, PrefixMeta>,
  name: string,
): PrefixMeta | null {
  const needle = name.trim().toLowerCase();
  if (!needle) return null;
  for (const meta of catalog.values()) {
    if (meta.name.toLowerCase() === needle) return meta;
  }
  return {
    id: -1,
    name: name.trim(),
    groupId: 0,
    groupName: 'Other',
    cssClass: null,
  };
}

export function metaForDisplay(meta: PrefixMeta) {
  return {
    name: meta.name,
    color: prefixPillColor(meta),
  };
}
