import { describe, expect, it } from 'vitest';
import { linksAreStale, targetLinksVersion } from './libraryDownloadLinks';
import type { LibraryGame } from '../types/library';
import type { GameDownload } from '../types/game';

const link: GameDownload = {
  host: 'mega',
  url: 'https://example.com/a',
  text: 'Mega',
  group: 'Win',
};

function base(over: Partial<LibraryGame> = {}): LibraryGame {
  return {
    threadId: '1',
    category: 'games',
    title: 'T',
    threadUrl: 'https://f95zone.to/threads/1',
    thumbnailUrl: null,
    currentVersion: null,
    availableVersion: null,
    installStatus: 'not_installed',
    installPath: null,
    exePath: null,
    addedAt: '2026-01-01',
    lastPlayedAt: null,
    totalPlaytimeSeconds: 0,
    customTags: [],
    notes: '',
    downloadLinks: [],
    downloadLinksVersion: null,
    downloadLinksFetchedAt: null,
    ...over,
  };
}

describe('targetLinksVersion', () => {
  it('prefers availableVersion for update', () => {
    expect(
      targetLinksVersion(
        base({ availableVersion: '1.1', currentVersion: '1.0' }),
        'update',
      ),
    ).toBe('1.1');
  });

  it('uses currentVersion for install when no available', () => {
    expect(
      targetLinksVersion(base({ currentVersion: '1.0' }), 'install'),
    ).toBe('1.0');
  });
});

describe('linksAreStale', () => {
  it('is stale when links empty', () => {
    expect(linksAreStale(base({ downloadLinks: [] }), 'install')).toBe(true);
  });

  it('is fresh when install has links and no known target version', () => {
    expect(
      linksAreStale(
        base({
          downloadLinks: [link],
          downloadLinksVersion: '1.0',
          currentVersion: null,
          availableVersion: null,
        }),
        'install',
      ),
    ).toBe(false);
  });

  it('is stale for update when version stamp mismatches availableVersion', () => {
    expect(
      linksAreStale(
        base({
          downloadLinks: [link],
          downloadLinksVersion: '1.0',
          availableVersion: '1.1',
          installStatus: 'update_available',
        }),
        'update',
      ),
    ).toBe(true);
  });

  it('is fresh for update when stamp matches availableVersion', () => {
    expect(
      linksAreStale(
        base({
          downloadLinks: [link],
          downloadLinksVersion: '1.1',
          availableVersion: '1.1',
        }),
        'update',
      ),
    ).toBe(false);
  });

  it('is stale for install when stamp mismatches currentVersion', () => {
    expect(
      linksAreStale(
        base({
          downloadLinks: [link],
          downloadLinksVersion: '0.9',
          currentVersion: '1.0',
        }),
        'install',
      ),
    ).toBe(true);
  });
});
