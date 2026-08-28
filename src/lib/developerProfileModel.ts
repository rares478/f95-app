import { isEngineStoreTag, knownPrefixMeta } from './storeTagsFromDetail';
import { dedupeSocialLinksByHost } from './socialLinks';
import type { GameDetail, SocialLink } from '../types/game';
import type { ForumSearchHit } from '../types/forumSearch';

export const DEVELOPER_GRID_THRESHOLD = 8;

export type DeveloperCatalogEntry = {
  hit: ForumSearchHit;
  detail: GameDetail | null;
};

export type DeveloperProfileStats = {
  gameCount: number;
  avgRating: number | null;
  latestDateLabel: string | null;
  enginePrefixes: string[];
  inLibraryCount: number;
};

export function developerCatalogLayout(count: number): 'timeline' | 'grid' {
  return count > DEVELOPER_GRID_THRESHOLD ? 'grid' : 'timeline';
}

export function buildDeveloperCatalogEntries(
  hits: ForumSearchHit[],
  detailsByThread: Map<string, GameDetail>,
): DeveloperCatalogEntry[] {
  return hits.map((hit) => ({
    hit,
    detail: hit.threadId ? detailsByThread.get(hit.threadId) ?? null : null,
  }));
}

export function sortDeveloperCatalog(
  entries: DeveloperCatalogEntry[],
): DeveloperCatalogEntry[] {
  return [...entries].sort((a, b) => {
    const aIso = a.hit.dateIso ?? '';
    const bIso = b.hit.dateIso ?? '';
    if (aIso && bIso && aIso !== bIso) return bIso.localeCompare(aIso);
    if (aIso && !bIso) return -1;
    if (!aIso && bIso) return 1;
    const aRating = a.detail?.rating ?? -1;
    const bRating = b.detail?.rating ?? -1;
    if (aRating !== bRating) return bRating - aRating;
    return (a.detail?.title ?? a.hit.title).localeCompare(
      b.detail?.title ?? b.hit.title,
    );
  });
}

export function pickHeroBannerUrl(entries: DeveloperCatalogEntry[]): string | null {
  const sorted = sortDeveloperCatalog(entries);
  for (const entry of sorted) {
    if (entry.detail?.bannerUrl) return entry.detail.bannerUrl;
  }
  return null;
}

export function collectDeveloperSocialLinks(
  entries: DeveloperCatalogEntry[],
): SocialLink[] {
  const links: SocialLink[] = [];
  for (const entry of entries) {
    if (entry.detail?.social?.length) {
      links.push(...entry.detail.social);
    }
  }
  return dedupeSocialLinksByHost(links);
}

export function buildDeveloperProfileStats(
  entries: DeveloperCatalogEntry[],
  libraryThreadIds: Set<string>,
): DeveloperProfileStats {
  const ratings: number[] = [];
  let latestDateLabel: string | null = null;
  let latestIso = '';
  const engines = new Set<string>();
  let inLibraryCount = 0;

  for (const { hit, detail } of entries) {
    if (hit.threadId && libraryThreadIds.has(hit.threadId)) {
      inLibraryCount += 1;
    }

    if (detail?.rating != null) ratings.push(detail.rating);

    const iso = hit.dateIso ?? '';
    if (iso && iso.localeCompare(latestIso) > 0) {
      latestIso = iso;
      latestDateLabel = hit.dateLabel;
    }

    if (detail) {
      for (const prefix of detail.prefixes) {
        const name = prefix.name.trim();
        if (!name) continue;
        const meta = knownPrefixMeta(name);
        if (isEngineStoreTag(name) || meta?.group === 'engine') {
          engines.add(meta?.name ?? name);
        }
      }
    }
  }

  const avgRating =
    ratings.length > 0
      ? ratings.reduce((sum, n) => sum + n, 0) / ratings.length
      : null;

  return {
    gameCount: entries.length,
    avgRating,
    latestDateLabel,
    enginePrefixes: [...engines].sort((a, b) => a.localeCompare(b)),
    inLibraryCount,
  };
}
