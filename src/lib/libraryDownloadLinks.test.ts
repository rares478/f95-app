import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ensureLinks,
  linksAreStale,
  saveLinksFromDetail,
  targetLinksVersion,
} from './libraryDownloadLinks';
import * as ipc from './ipc';
import * as library from './library';
import type { LibraryGame } from '../types/library';
import type { GameDownload, GameDetail } from '../types/game';

const link: GameDownload = {
  host: 'mega',
  url: 'https://example.com/a',
  text: 'Mega',
  group: 'Win',
  edition: null,
  platform: null,
  part: null,
  kindHint: null,
};

const structuredLink: GameDownload = {
  ...link,
  platform: 'Win/Linux',
  kindHint: 'full',
  group: 'Win/Linux',
};

function detail(over: Partial<GameDetail> = {}): GameDetail {
  return {
    threadId: '1',
    threadUrl: 'https://f95zone.to/threads/1',
    title: 'T',
    rawTitle: 'T',
    version: '1.0',
    developer: null,
    author: null,
    authorAvatarUrl: null,
    bannerUrl: null,
    screenshots: [],
    descriptionHtml: '',
    prefixes: [],
    fields: {},
    tags: [],
    downloads: [],
    social: [],
    ...over,
  };
}

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
    storeTags: [],
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
          downloadLinks: [structuredLink],
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
          downloadLinks: [structuredLink],
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
          downloadLinks: [structuredLink],
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
          downloadLinks: [structuredLink],
          downloadLinksVersion: '0.9',
          currentVersion: '1.0',
        }),
        'install',
      ),
    ).toBe(true);
  });

  it('is stale when cached links all lack platform (pre-upgrade path)', () => {
    expect(
      linksAreStale(
        base({
          downloadLinks: [link],
          downloadLinksVersion: '1.0',
          currentVersion: '1.0',
        }),
        'install',
      ),
    ).toBe(true);
  });
});

vi.mock('./ipc');
vi.mock('./library');

describe('saveLinksFromDetail', () => {
  beforeEach(() => {
    vi.spyOn(library, 'setDownloadLinks').mockResolvedValue(undefined);
    vi.spyOn(library, 'setStoreTags').mockResolvedValue(undefined);
  });

  it('writes download links and store tags from detail', async () => {
    await saveLinksFromDetail(
      '1',
      detail({
        version: '2.0',
        downloads: [structuredLink],
        tags: [{ slug: 'adventure', name: 'Adventure' }],
        prefixes: [{ name: "Ren'Py", cssClass: null }],
      }),
    );

    expect(library.setDownloadLinks).toHaveBeenCalledWith(
      '1',
      [structuredLink],
      '2.0',
    );
    expect(library.setStoreTags).toHaveBeenCalledWith('1', [
      'Adventure',
      "Ren'Py",
    ]);
  });
});

describe('ensureLinks', () => {
  beforeEach(() => {
    vi.mocked(ipc.gameDetail).mockReset();
    vi.mocked(library.setDownloadLinks).mockReset();
    vi.mocked(library.setDownloadLinks).mockResolvedValue(undefined);
    vi.mocked(library.setStoreTags).mockReset();
    vi.mocked(library.setStoreTags).mockResolvedValue(undefined);
  });

  it('throws empty_links without saving when fetch returns no downloads', async () => {
    vi.mocked(ipc.gameDetail).mockResolvedValue(detail({ downloads: [] }));

    const game = base({
      downloadLinks: [link],
      downloadLinksVersion: '0.9',
      currentVersion: '1.0',
    });

    await expect(ensureLinks(game, 'install')).rejects.toMatchObject({
      code: 'empty_links',
    });
    expect(library.setDownloadLinks).not.toHaveBeenCalled();
  });

  it('saves and returns links when fetch returns downloads', async () => {
    vi.mocked(ipc.gameDetail).mockResolvedValue(detail({ downloads: [link] }));

    const game = base({
      downloadLinks: [],
      currentVersion: '1.0',
    });

    const links = await ensureLinks(game, 'install');
    expect(links).toEqual([link]);
    expect(library.setDownloadLinks).toHaveBeenCalledWith('1', [link], '1.0');
  });

  it('returns cached links without fetching when fresh and structured', async () => {
    const structured: GameDownload = {
      ...link,
      platform: 'Win/Linux',
      kindHint: 'full',
    };
    const game = base({
      downloadLinks: [structured],
      downloadLinksVersion: '1.0',
      currentVersion: '1.0',
    });

    const links = await ensureLinks(game, 'install');
    expect(links).toEqual([structured]);
    expect(ipc.gameDetail).not.toHaveBeenCalled();
    expect(library.setDownloadLinks).not.toHaveBeenCalled();
  });

  it('refetches when cached links exist but all lack platform', async () => {
    const refreshed: GameDownload = {
      ...link,
      platform: 'Win/Linux',
      kindHint: 'full',
    };
    vi.mocked(ipc.gameDetail).mockResolvedValue(
      detail({ downloads: [refreshed], version: '1.0' }),
    );

    const game = base({
      downloadLinks: [link],
      downloadLinksVersion: '1.0',
      currentVersion: '1.0',
    });

    const links = await ensureLinks(game, 'install');
    expect(links).toEqual([refreshed]);
    expect(ipc.gameDetail).toHaveBeenCalledWith('1');
    expect(library.setDownloadLinks).toHaveBeenCalledWith(
      '1',
      [refreshed],
      '1.0',
    );
  });
});
