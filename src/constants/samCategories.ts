import type { SamCategory } from '../types/sam';

export const SAM_CATEGORIES: { id: SamCategory; labelKey: string; literal?: string }[] = [
  { id: 'games', labelKey: 'filter.category.games' },
  { id: 'mods', labelKey: '', literal: 'Mods' },
  { id: 'comics', labelKey: 'filter.category.comics' },
  { id: 'animations', labelKey: 'filter.category.animations' },
  { id: 'assets', labelKey: 'filter.category.assets' },
];

const VALID: SamCategory[] = ['games', 'mods', 'comics', 'animations', 'assets'];

export function parseSamCategory(raw: string | null | undefined): SamCategory {
  if (raw && (VALID as string[]).includes(raw)) return raw as SamCategory;
  return 'games';
}
