import { describe, expect, it } from 'vitest';
import {
  buildInstallCatalog,
  defaultPackageKind,
  defaultPlatformId,
  defaultSeasonId,
} from './installCatalog';
import type { GameDownload } from '../types/game';

const link = (over: Partial<GameDownload> & Pick<GameDownload, 'host' | 'url'>): GameDownload => ({
  text: over.host,
  group: null,
  edition: null,
  platform: null,
  part: null,
  kindHint: null,
  ...over,
});

/** Eternum-like: top-level full + splits, a nested season, Mac, patches/extras. */
function eternumLikeLinks(): GameDownload[] {
  return [
    link({
      host: 'mega',
      url: 'https://mega.nz/full-wl',
      platform: 'Win/Linux',
      part: null,
      kindHint: 'full',
      group: 'Win/Linux',
    }),
    link({
      host: 'pixeldrain',
      url: 'https://pixeldrain.com/full-wl',
      platform: 'Win/Linux',
      part: null,
      kindHint: 'full',
      group: 'Win/Linux',
    }),
    link({
      host: 'mega',
      url: 'https://mega.nz/p1',
      platform: 'Win/Linux',
      part: 1,
      kindHint: 'split',
      group: 'Win/Linux · Part 1',
    }),
    link({
      host: 'mega',
      url: 'https://mega.nz/p2',
      platform: 'Win/Linux',
      part: 2,
      kindHint: 'split',
      group: 'Win/Linux · Part 2',
    }),
    link({
      host: 'mega',
      url: 'https://mega.nz/p3',
      platform: 'Win/Linux',
      part: 3,
      kindHint: 'split',
      group: 'Win/Linux · Part 3',
    }),
    link({
      host: 'mega',
      url: 'https://mega.nz/s12',
      edition: 'Season 1-2',
      platform: 'Win/Linux',
      part: null,
      kindHint: 'full',
      group: 'Season 1-2 · Win/Linux',
    }),
    link({
      host: 'mega',
      url: 'https://mega.nz/mac',
      platform: 'Mac',
      part: null,
      kindHint: 'full',
      group: 'Mac',
    }),
    link({
      host: 'mega',
      url: 'https://mega.nz/patch',
      platform: 'Win/Linux',
      kindHint: 'patch',
      group: 'Patches',
    }),
    link({
      host: 'mega',
      url: 'https://mega.nz/extra',
      platform: 'Win/Linux',
      kindHint: 'extra',
      group: 'Extras',
    }),
    // Null platform is ignored by catalog
    link({
      host: 'mega',
      url: 'https://mega.nz/orphan',
      platform: null,
      group: null,
    }),
  ];
}

describe('buildInstallCatalog', () => {
  it('groups platforms → seasons → full/splits and skips patch/extra/null platform', () => {
    const catalog = buildInstallCatalog(eternumLikeLinks());

    expect(catalog.map((p) => p.label)).toEqual(['Win/Linux', 'Mac']);

    const win = catalog[0]!;
    expect(win.seasons.map((s) => [s.id, s.label, s.isTopLevel])).toEqual([
      ['__current__', 'Current', true],
      ['Season 1-2', 'Season 1-2', false],
    ]);

    const current = win.seasons[0]!;
    expect(current.packages.map((p) => [p.kind, p.label])).toEqual([
      ['full', 'Full'],
      ['splits', 'Splits (3 parts)'],
    ]);
    expect(current.packages[0]!.parts).toEqual([
      {
        part: null,
        links: expect.arrayContaining([
          expect.objectContaining({ url: 'https://mega.nz/full-wl' }),
          expect.objectContaining({ url: 'https://pixeldrain.com/full-wl' }),
        ]),
      },
    ]);
    expect(current.packages[1]!.parts.map((p) => p.part)).toEqual([1, 2, 3]);

    const season = win.seasons[1]!;
    expect(season.packages.map((p) => p.kind)).toEqual(['full']);

    expect(catalog[1]!.seasons).toHaveLength(1);
    expect(catalog[1]!.seasons[0]!.packages.map((p) => p.kind)).toEqual(['full']);

    const allUrls = catalog.flatMap((p) =>
      p.seasons.flatMap((s) =>
        s.packages.flatMap((pkg) => pkg.parts.flatMap((part) => part.links.map((l) => l.url))),
      ),
    );
    expect(allUrls).not.toContain('https://mega.nz/patch');
    expect(allUrls).not.toContain('https://mega.nz/extra');
    expect(allUrls).not.toContain('https://mega.nz/orphan');
  });

  it('normalizes omitted edition/platform/part/kindHint from older cached JSON', () => {
    const legacy = {
      host: 'mega',
      url: 'https://mega.nz/legacy',
      text: 'mega',
      group: 'Win/Linux',
    } as GameDownload;

    const catalog = buildInstallCatalog([legacy]);
    expect(catalog).toEqual([]);
  });

  it('treats missing part as full and missing edition as top-level current', () => {
    const partial = {
      host: 'mega',
      url: 'https://mega.nz/a',
      text: 'mega',
      group: 'Windows',
      platform: 'Windows',
    } as GameDownload;

    const catalog = buildInstallCatalog([partial]);
    expect(catalog).toHaveLength(1);
    expect(catalog[0]!.seasons[0]).toMatchObject({
      id: '__current__',
      isTopLevel: true,
      packages: [{ kind: 'full', label: 'Full' }],
    });
  });
});

describe('defaultPlatformId', () => {
  it('prefers Win/Linux for windows and linux', () => {
    const catalog = buildInstallCatalog(eternumLikeLinks());
    expect(defaultPlatformId(catalog, 'windows')).toBe(catalog[0]!.id);
    expect(defaultPlatformId(catalog, 'linux')).toBe(catalog[0]!.id);
  });

  it('prefers Mac for macos', () => {
    const catalog = buildInstallCatalog(eternumLikeLinks());
    expect(defaultPlatformId(catalog, 'macos')).toBe(catalog[1]!.id);
  });

  it('returns null for empty catalog', () => {
    expect(defaultPlatformId([], 'windows')).toBeNull();
  });
});

describe('defaultSeasonId', () => {
  it('picks first top-level season that has a full package', () => {
    const catalog = buildInstallCatalog(eternumLikeLinks());
    expect(defaultSeasonId(catalog[0]!)).toBe('__current__');
  });

  it('falls back to first season with full, then first season', () => {
    const onlyNestedFull: GameDownload[] = [
      link({
        host: 'mega',
        url: 'https://mega.nz/s1',
        edition: 'Season 1',
        platform: 'Win/Linux',
        part: null,
      }),
      link({
        host: 'mega',
        url: 'https://mega.nz/s2-split',
        edition: 'Season 2',
        platform: 'Win/Linux',
        part: 1,
      }),
    ];
    const platform = buildInstallCatalog(onlyNestedFull)[0]!;
    expect(defaultSeasonId(platform)).toBe('Season 1');

    const splitsOnly: GameDownload[] = [
      link({
        host: 'mega',
        url: 'https://mega.nz/p1',
        platform: 'Win/Linux',
        part: 1,
      }),
    ];
    const splitsPlatform = buildInstallCatalog(splitsOnly)[0]!;
    expect(defaultSeasonId(splitsPlatform)).toBe('__current__');
  });
});

describe('defaultPackageKind', () => {
  it('prefers full when both exist', () => {
    const season = buildInstallCatalog(eternumLikeLinks())[0]!.seasons[0]!;
    expect(defaultPackageKind(season)).toBe('full');
  });

  it('returns splits when only splits exist', () => {
    const splitsOnly: GameDownload[] = [
      link({
        host: 'mega',
        url: 'https://mega.nz/p1',
        platform: 'Win/Linux',
        part: 1,
      }),
    ];
    const season = buildInstallCatalog(splitsOnly)[0]!.seasons[0]!;
    expect(defaultPackageKind(season)).toBe('splits');
  });

  it('returns null when season has no packages', () => {
    expect(
      defaultPackageKind({
        id: '__current__',
        label: 'Current',
        isTopLevel: true,
        packages: [],
      }),
    ).toBeNull();
  });
});
