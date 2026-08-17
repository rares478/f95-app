import { describe, expect, it } from 'vitest';
import type { LibraryGame } from '../types/library';
import {
  applyLibraryMetaFilter,
  buildLibraryEngineOptions,
  buildLibraryPrefixOptions,
  buildLibraryStatusOptions,
  buildLibraryTagOptions,
  libraryTagSuggestions,
  matchesLibraryMetaFilter,
  parseLibraryMetaFilter,
} from './libraryFilters';

function game(overrides: Partial<LibraryGame> = {}): LibraryGame {
  return {
    threadId: '1',
    category: 'games',
    title: 'Test',
    threadUrl: '',
    thumbnailUrl: null,
    currentVersion: null,
    availableVersion: null,
    installStatus: 'installed',
    installPath: null,
    exePath: null,
    addedAt: '',
    lastPlayedAt: null,
    totalPlaytimeSeconds: 0,
    customTags: [],
    storeTags: [],
    notes: '',
    downloadLinks: [],
    downloadLinksVersion: null,
    downloadLinksFetchedAt: null,
    ...overrides,
  };
}

describe('matchesLibraryMetaFilter', () => {
  it('matches engine filter by store tag name', () => {
    const g = game({ storeTags: ["Ren'Py", 'Adventure'] });
    expect(
      matchesLibraryMetaFilter(g, {
        engines: ["Ren'Py"],
        statuses: [],
        prefixes: [],
        tags: [],
        tagMode: 'or',
      }),
    ).toBe(true);
    expect(
      matchesLibraryMetaFilter(g, {
        engines: ['Unity'],
        statuses: [],
        prefixes: [],
        tags: [],
        tagMode: 'or',
      }),
    ).toBe(false);
  });

  it('matches F95 status and other prefixes separately from tags', () => {
    const g = game({ storeTags: ['Completed', 'VN', 'Adventure'] });
    expect(
      matchesLibraryMetaFilter(g, {
        engines: [],
        statuses: ['Completed'],
        prefixes: [],
        tags: [],
        tagMode: 'or',
      }),
    ).toBe(true);
    expect(
      matchesLibraryMetaFilter(g, {
        engines: [],
        statuses: [],
        prefixes: ['VN'],
        tags: [],
        tagMode: 'or',
      }),
    ).toBe(true);
    expect(
      matchesLibraryMetaFilter(g, {
        engines: [],
        statuses: ['Abandoned'],
        prefixes: [],
        tags: [],
        tagMode: 'or',
      }),
    ).toBe(false);
  });

  it('matches tag filters in OR and AND modes', () => {
    const g = game({ storeTags: ['Adventure', 'RPG'] });
    expect(
      matchesLibraryMetaFilter(g, {
        engines: [],
        statuses: [],
        prefixes: [],
        tags: ['Adventure', 'Horror'],
        tagMode: 'or',
      }),
    ).toBe(true);
    expect(
      matchesLibraryMetaFilter(g, {
        engines: [],
        statuses: [],
        prefixes: [],
        tags: ['Adventure', 'Horror'],
        tagMode: 'and',
      }),
    ).toBe(false);
    expect(
      matchesLibraryMetaFilter(g, {
        engines: [],
        statuses: [],
        prefixes: [],
        tags: ['Adventure', 'RPG'],
        tagMode: 'and',
      }),
    ).toBe(true);
  });
});

describe('applyLibraryMetaFilter', () => {
  it('returns all games when no meta filter is active', () => {
    const games = [game({ threadId: '1' }), game({ threadId: '2' })];
    expect(
      applyLibraryMetaFilter(games, {
        engines: [],
        statuses: [],
        prefixes: [],
        tags: [],
        tagMode: 'or',
      }),
    ).toHaveLength(2);
  });
});

describe('buildLibraryFilterOptions', () => {
  it('counts engines and content tags separately', () => {
    const games = [
      game({ storeTags: ["Ren'Py", 'Adventure'] }),
      game({ storeTags: ["Ren'Py", 'RPG'] }),
    ];
    const engines = buildLibraryEngineOptions(games);
    const renpy = engines.find((e) => e.name === "Ren'Py");
    expect(renpy?.count).toBe(2);
    const tags = buildLibraryTagOptions(games);
    expect(tags.map((t) => t.name)).toEqual(['Adventure', 'RPG']);
  });

  it('counts status and other prefixes and keeps them out of tags', () => {
    const games = [
      game({ storeTags: ['Completed', 'VN', 'Adventure'] }),
      game({ storeTags: ['Abandoned', 'Adventure'] }),
    ];
    expect(buildLibraryStatusOptions(games).find((o) => o.name === 'Completed')?.count).toBe(1);
    expect(buildLibraryStatusOptions(games).find((o) => o.name === 'Abandoned')?.count).toBe(1);
    expect(buildLibraryPrefixOptions(games).find((o) => o.name === 'VN')?.count).toBe(1);
    expect(buildLibraryTagOptions(games).map((t) => t.name)).toEqual(['Adventure']);
  });
});

describe('libraryTagSuggestions', () => {
  const options = [
    { name: 'Adventure', count: 5 },
    { name: 'RPG', count: 4 },
    { name: 'Horror', count: 2 },
  ];

  it('returns the top idle slice when query is empty', () => {
    expect(libraryTagSuggestions(options, '').map((o) => o.name)).toEqual([
      'Adventure',
      'RPG',
      'Horror',
    ]);
    expect(libraryTagSuggestions(options, '  ').map((o) => o.name)).toHaveLength(3);
  });

  it('filters by name when typing', () => {
    expect(libraryTagSuggestions(options, 'hor').map((o) => o.name)).toEqual(['Horror']);
  });
});

describe('parseLibraryMetaFilter', () => {
  it('reads engines and tags from search params', () => {
    const params = new URLSearchParams("engines=Ren'Py,Unity&tags=Adventure,RPG&tagMode=and");
    expect(parseLibraryMetaFilter(params)).toEqual({
      engines: ["Ren'Py", 'Unity'],
      statuses: [],
      prefixes: [],
      tags: ['Adventure', 'RPG'],
      tagMode: 'and',
    });
  });

  it('reads statuses and prefixes from search params', () => {
    const params = new URLSearchParams('statuses=Completed&prefixes=VN');
    expect(parseLibraryMetaFilter(params)).toEqual({
      engines: [],
      statuses: ['Completed'],
      prefixes: ['VN'],
      tags: [],
      tagMode: 'or',
    });
  });
});
