import { describe, expect, it } from 'vitest';
import {
  defaultLibraryManageSection,
  libraryManageSectionLabelKey,
  libraryManageSectionsFor,
} from './libraryGameManageNav';

describe('libraryManageSectionsFor', () => {
  it('includes sessions for games', () => {
    expect(libraryManageSectionsFor('games')).toEqual([
      'general',
      'files',
      'sessions',
      'tags',
      'tools',
    ]);
  });

  it('inserts saves when save editor is available', () => {
    expect(libraryManageSectionsFor('games', { showSaveEditor: true })).toEqual([
      'general',
      'files',
      'sessions',
      'saves',
      'tags',
      'tools',
    ]);
    expect(libraryManageSectionsFor('mods', { showSaveEditor: true })).toEqual([
      'general',
      'files',
      'saves',
      'tags',
      'tools',
    ]);
  });

  it('omits sessions for non-games', () => {
    expect(libraryManageSectionsFor('mods')).toEqual([
      'general',
      'files',
      'tags',
      'tools',
    ]);
    expect(libraryManageSectionsFor('comics')).not.toContain('sessions');
  });
});

describe('defaultLibraryManageSection', () => {
  it('defaults to general', () => {
    expect(defaultLibraryManageSection('games')).toBe('general');
    expect(defaultLibraryManageSection('mods')).toBe('general');
  });
});

describe('libraryManageSectionLabelKey', () => {
  it('returns i18n key', () => {
    expect(libraryManageSectionLabelKey('files')).toBe('libdetail.manage.nav.files');
    expect(libraryManageSectionLabelKey('saves')).toBe('libdetail.manage.nav.saves');
  });
});
