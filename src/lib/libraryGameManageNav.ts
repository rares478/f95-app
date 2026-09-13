import type { SamCategory } from '../types/sam';

export type LibraryManageSectionId =
  | 'general'
  | 'files'
  | 'sessions'
  | 'tags'
  | 'tools';

export const LIBRARY_MANAGE_SECTION_IDS: readonly LibraryManageSectionId[] = [
  'general',
  'files',
  'sessions',
  'tags',
  'tools',
] as const;

export function libraryManageSectionsFor(
  category: SamCategory,
): LibraryManageSectionId[] {
  const base: LibraryManageSectionId[] = ['general', 'files', 'tags', 'tools'];
  if (category === 'games') {
    return ['general', 'files', 'sessions', 'tags', 'tools'];
  }
  return base;
}

export function libraryManageSectionLabelKey(id: LibraryManageSectionId): string {
  return `libdetail.manage.nav.${id}`;
}

export function defaultLibraryManageSection(
  category: SamCategory,
): LibraryManageSectionId {
  return libraryManageSectionsFor(category)[0] ?? 'general';
}
