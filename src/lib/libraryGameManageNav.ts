import type { SamCategory } from '../types/sam';

export type LibraryManageSectionId =
  | 'general'
  | 'files'
  | 'sessions'
  | 'saves'
  | 'tags'
  | 'tools';

export const LIBRARY_MANAGE_SECTION_IDS: readonly LibraryManageSectionId[] = [
  'general',
  'files',
  'sessions',
  'saves',
  'tags',
  'tools',
] as const;

export type LibraryManageSectionsOptions = {
  showSaveEditor?: boolean;
};

export function libraryManageSectionsFor(
  category: SamCategory,
  opts: LibraryManageSectionsOptions = {},
): LibraryManageSectionId[] {
  const sections: LibraryManageSectionId[] = ['general', 'files'];
  if (category === 'games') {
    sections.push('sessions');
  }
  if (opts.showSaveEditor) {
    sections.push('saves');
  }
  sections.push('tags', 'tools');
  return sections;
}

export function libraryManageSectionLabelKey(id: LibraryManageSectionId): string {
  return `libdetail.manage.nav.${id}`;
}

export function defaultLibraryManageSection(
  category: SamCategory,
  opts: LibraryManageSectionsOptions = {},
): LibraryManageSectionId {
  return libraryManageSectionsFor(category, opts)[0] ?? 'general';
}
