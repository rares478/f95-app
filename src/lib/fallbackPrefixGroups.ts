import { KNOWN_PREFIXES, type SamCategory, type SamPrefixGroup } from '../types/sam';

/** Static F95 games prefix catalog when SAM options/bootstrap are unavailable. */
const GAMES_GROUP_IDS: Record<'engine' | 'status' | 'other', { id: number; name: string }> = {
  engine: { id: 3, name: 'Engine' },
  status: { id: 4, name: 'Status' },
  other: { id: 5, name: 'Other' },
};

export function fallbackPrefixGroupsForCategory(category: SamCategory): SamPrefixGroup[] {
  if (category !== 'games') return [];

  const groups: SamPrefixGroup[] = [];
  for (const key of ['engine', 'status', 'other'] as const) {
    const meta = GAMES_GROUP_IDS[key];
    const prefixes = KNOWN_PREFIXES.filter((p) => p.group === key).map((p) => ({
      id: p.id,
      name: p.name,
      cssClass: null,
    }));
    if (prefixes.length > 0) {
      groups.push({ id: meta.id, name: meta.name, prefixes });
    }
  }
  return groups;
}
