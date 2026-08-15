import { describe, expect, it } from 'vitest';
import {
  pickPersonalizationSeeds,
  personalizationFingerprint,
  truncateRailTitle,
} from './personalizationSeeds';
import type { LibraryGame } from '../types/library';

function game(partial: Partial<LibraryGame> & Pick<LibraryGame, 'threadId' | 'title'>): LibraryGame {
  return {
    category: 'games',
    threadUrl: 'https://x',
    thumbnailUrl: null,
    currentVersion: null,
    availableVersion: null,
    installStatus: 'installed',
    installPath: null,
    exePath: null,
    addedAt: '2026-01-01T00:00:00.000Z',
    lastPlayedAt: null,
    totalPlaytimeSeconds: 0,
    customTags: [],
    storeTags: [],
    notes: '',
    downloadLinks: [],
    downloadLinksVersion: null,
    downloadLinksFetchedAt: null,
    ...partial,
  };
}

describe('pickPersonalizationSeeds', () => {
  it('returns empty when nothing played', () => {
    expect(pickPersonalizationSeeds([game({ threadId: '1', title: 'A' })])).toEqual([]);
  });

  it('prefers >=5min playtime then ranks by lastPlayedAt', () => {
    const seeds = pickPersonalizationSeeds([
      game({
        threadId: 'short-recent',
        title: 'Short',
        totalPlaytimeSeconds: 60,
        lastPlayedAt: '2026-08-09T20:00:00.000Z',
      }),
      game({
        threadId: 'long-older',
        title: 'Long',
        totalPlaytimeSeconds: 600,
        lastPlayedAt: '2026-08-08T20:00:00.000Z',
      }),
      game({
        threadId: 'long-newest',
        title: 'Newest',
        totalPlaytimeSeconds: 900,
        lastPlayedAt: '2026-08-09T18:00:00.000Z',
      }),
    ]);
    expect(seeds.map((s) => s.threadId)).toEqual(['long-newest', 'long-older']);
  });

  it('falls back to any playtime > 0 when none meet threshold', () => {
    const seeds = pickPersonalizationSeeds([
      game({
        threadId: 'a',
        title: 'A',
        totalPlaytimeSeconds: 30,
        lastPlayedAt: '2026-08-09T10:00:00.000Z',
      }),
    ]);
    expect(seeds).toHaveLength(1);
    expect(seeds[0]!.threadId).toBe('a');
  });
});

describe('personalizationFingerprint', () => {
  it('joins id and lastPlayedAt', () => {
    expect(
      personalizationFingerprint([
        {
          threadId: '1',
          title: 'A',
          lastPlayedAt: 't1',
          totalPlaytimeSeconds: 400,
        },
        {
          threadId: '2',
          title: 'B',
          lastPlayedAt: 't2',
          totalPlaytimeSeconds: 500,
        },
      ]),
    ).toBe('1@t1|2@t2');
  });
});

describe('truncateRailTitle', () => {
  it('truncates with ellipsis', () => {
    expect(truncateRailTitle('abcdefghij', 8)).toBe('abcdefg…');
  });
});
