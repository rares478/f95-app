import type { GameDownload } from '../types/game';

export type InstallPackageKind = 'full' | 'splits';

export type InstallPackage = {
  kind: InstallPackageKind;
  /** part → mirrors (full uses partKey 0 or a single bucket) */
  parts: { part: number | null; links: GameDownload[] }[];
  label: string; // "Full" / "Splits (3 parts)"
};

export type InstallSeason = {
  id: string; // stable key: edition ?? '__current__'
  label: string; // display
  isTopLevel: boolean; // edition null or from top-level heading
  packages: InstallPackage[];
};

export type InstallPlatform = {
  id: string; // normalized platform key
  label: string; // "Win/Linux"
  seasons: InstallSeason[];
};

type NormalizedLink = GameDownload & {
  edition: string | null;
  platform: string | null;
  part: number | null;
  kindHint: GameDownload['kindHint'];
};

function normalizeLink(link: GameDownload): NormalizedLink {
  return {
    ...link,
    edition: link.edition ?? null,
    platform: link.platform ?? null,
    part: link.part ?? null,
    kindHint: link.kindHint ?? null,
  };
}

function normalizePlatformId(platform: string): string {
  return platform.trim().toLowerCase();
}

function seasonId(edition: string | null): string {
  return edition ?? '__current__';
}

function seasonLabel(edition: string | null): string {
  return edition ?? 'Current';
}

function hasPackage(season: InstallSeason, kind: InstallPackageKind): boolean {
  return season.packages.some((p) => p.kind === kind);
}

function buildPackages(links: NormalizedLink[]): InstallPackage[] {
  const fullLinks = links.filter((l) => l.part == null);
  const splitLinks = links.filter((l) => l.part != null);

  const packages: InstallPackage[] = [];

  if (fullLinks.length > 0) {
    packages.push({
      kind: 'full',
      label: 'Full',
      parts: [{ part: null, links: fullLinks }],
    });
  }

  if (splitLinks.length > 0) {
    const byPart = new Map<number, GameDownload[]>();
    for (const l of splitLinks) {
      const part = l.part!;
      const bucket = byPart.get(part);
      if (bucket) bucket.push(l);
      else byPart.set(part, [l]);
    }
    const parts = [...byPart.entries()]
      .sort(([a], [b]) => a - b)
      .map(([part, partLinks]) => ({ part, links: partLinks }));
    packages.push({
      kind: 'splits',
      label: `Splits (${parts.length} parts)`,
      parts,
    });
  }

  return packages;
}

export function buildInstallCatalog(links: GameDownload[]): InstallPlatform[] {
  const usable = links
    .map(normalizeLink)
    .filter((l) => l.platform != null)
    .filter((l) => l.kindHint !== 'patch' && l.kindHint !== 'extra');

  const platforms: InstallPlatform[] = [];
  const platformIndex = new Map<string, InstallPlatform>();

  for (const link of usable) {
    const platformLabel = link.platform!;
    const id = normalizePlatformId(platformLabel);
    let platform = platformIndex.get(id);
    if (!platform) {
      platform = { id, label: platformLabel, seasons: [] };
      platformIndex.set(id, platform);
      platforms.push(platform);
    }

    const ed = link.edition;
    const sid = seasonId(ed);
    let season = platform.seasons.find((s) => s.id === sid);
    if (!season) {
      season = {
        id: sid,
        label: seasonLabel(ed),
        isTopLevel: ed == null,
        packages: [],
      };
      platform.seasons.push(season);
    }
  }

  for (const platform of platforms) {
    for (const season of platform.seasons) {
      const seasonLinks = usable.filter(
        (l) =>
          normalizePlatformId(l.platform!) === platform.id &&
          seasonId(l.edition) === season.id,
      );
      season.packages = buildPackages(seasonLinks);
    }
  }

  return platforms;
}

function labelMatchesOs(
  label: string,
  os: 'windows' | 'macos' | 'linux',
): boolean {
  if (os === 'macos') return /mac|osx|darwin/i.test(label);
  return /win|windows|pc|linux/i.test(label);
}

export function defaultPlatformId(
  catalog: InstallPlatform[],
  os: 'windows' | 'macos' | 'linux',
): string | null {
  if (catalog.length === 0) return null;
  const match = catalog.find((p) => labelMatchesOs(p.label, os));
  return match?.id ?? catalog[0]!.id;
}

export function defaultSeasonId(platform: InstallPlatform): string | null {
  if (platform.seasons.length === 0) return null;

  const topWithFull = platform.seasons.find(
    (s) => s.isTopLevel && hasPackage(s, 'full'),
  );
  if (topWithFull) return topWithFull.id;

  const anyFull = platform.seasons.find((s) => hasPackage(s, 'full'));
  if (anyFull) return anyFull.id;

  return platform.seasons[0]!.id;
}

export function defaultPackageKind(season: InstallSeason): InstallPackageKind | null {
  if (hasPackage(season, 'full')) return 'full';
  if (hasPackage(season, 'splits')) return 'splits';
  return null;
}
