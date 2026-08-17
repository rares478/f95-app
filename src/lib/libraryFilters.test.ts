import { describe, expect, it } from 'vitest';
import type { LibraryGame } from '../types/library';
import {
  applyLibraryMetaFilter,
  buildLibraryEngineOptions,
  buildLibraryTagOptions,
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
      matchesLibraryMetaFilter(g, { engines: ["Ren'Py"], tags: [], tagMode: 'or' }),
    ).toBe(true);
    expect(
      matchesLibraryMetaFilter(g, { engines: ['Unity'], tags: [], tagMode: 'or' }),
    ).toBe(false);
  });

  it('matches tag filters in OR and AND modes', () => {
    const g = game({ storeTags: ['Adventure', 'RPG'] });
    expect(
      matchesLibraryMetaFilter(g, {
        engines: [],
        tags: ['Adventure', 'Horror'],
        tagMode: 'or',
      }),
    ).toBe(true);
    expect(
      matchesLibraryMetaFilter(g, {
        engines: [],
        tags: ['Adventure', 'Horror'],
        tagMode: 'and',
      }),
    ).toBe(false);
    expect(
      matchesLibraryMetaFilter(g, {
        engines: [],
        tags: ['Adventure', 'RPG'],
        tagMode: 'and',
      }),
    ).toBe(true);
  });
});

describe('applyLibraryMetaFilter', () => {
  it('returns all games when no meta filter is active', () => {
    const games = [game({ threadId: '1' }), game({ threadId: '2' })];
    expect(applyLibraryMetaFilter(games, { engines: [], tags: [], tagMode: 'or' })).toHaveLength(
      2,
    );
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
});

describe('parseLibraryMetaFilter', () => {
  it('reads engines and tags from search params', () => {
    const params = new URLSearchParams("engines=Ren'Py,Unity&tags=Adventure,RPG&tagMode=and");
    expect(parseLibraryMetaFilter(params)).toEqual({
      engines: ["Ren'Py", 'Unity'],
      tags: ['Adventure', 'RPG'],
      tagMode: 'and',
    });
  });
});
