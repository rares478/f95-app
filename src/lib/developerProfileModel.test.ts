import { describe, expect, it } from 'vitest';
import {
  buildDeveloperProfileStats,
  collectDeveloperSocialLinks,
  developerCatalogLayout,
  pickHeroBannerUrl,
  sortDeveloperCatalog,
  type DeveloperCatalogEntry,
} from './developerProfileModel';
import type { GameDetail, SocialLink } from '../types/game';
import type { ForumSearchHit } from '../types/forumSearch';

function hit(over: Partial<ForumSearchHit> = {}): ForumSearchHit {
  return {
    threadId: '1',
    postId: null,
    resultLabel: 'Thread',
    title: 'Game A',
    prefixes: [],
    snippet: '',
    author: null,
    authorId: null,
    avatarUrl: null,
    forum: 'Games',
    dateLabel: 'Jan 1, 2024',
    dateIso: '2024-01-01',
    threadUrl: 'https://f95zone.to/threads/a.1/',
    ...over,
  };
}

function detail(over: Partial<GameDetail> = {}): GameDetail {
  return {
    threadId: '1',
    threadUrl: 'https://f95zone.to/threads/a.1/',
    title: 'Game A',
    rawTitle: 'Game A',
    version: '1.0',
    developer: 'Dev',
    author: null,
    authorUserId: null,
    authorAvatarUrl: null,
    bannerUrl: 'https://example.com/a.jpg',
    screenshots: [],
    descriptionHtml: '',
    changelogHtml: null,
    prefixes: [{ name: "Ren'Py", cssClass: null }],
    fields: {},
    tags: [{ slug: '3dcg', name: '3DCG' }],
    rating: 4.5,
    downloads: [],
    social: [],
    attachments: [],
    ...over,
  };
}

describe('developerProfileModel', () => {
  it('uses timeline layout for small catalogs', () => {
    expect(developerCatalogLayout(3)).toBe('timeline');
    expect(developerCatalogLayout(8)).toBe('timeline');
    expect(developerCatalogLayout(9)).toBe('grid');
  });

  it('sorts by date then rating', () => {
    const entries: DeveloperCatalogEntry[] = [
      { hit: hit({ threadId: '1', dateIso: '2024-01-01' }), detail: detail({ rating: 3 }) },
      { hit: hit({ threadId: '2', dateIso: '2025-01-01', title: 'B' }), detail: detail({ threadId: '2', rating: 2 }) },
    ];
    expect(sortDeveloperCatalog(entries).map((e) => e.hit.threadId)).toEqual(['2', '1']);
  });

  it('picks the newest banner for the hero cover', () => {
    const entries: DeveloperCatalogEntry[] = [
      {
        hit: hit({ threadId: '1', dateIso: '2024-01-01' }),
        detail: detail({ bannerUrl: 'https://example.com/old.jpg' }),
      },
      {
        hit: hit({ threadId: '2', dateIso: '2025-01-01' }),
        detail: detail({ threadId: '2', bannerUrl: 'https://example.com/new.jpg' }),
      },
    ];
    expect(pickHeroBannerUrl(entries)).toBe('https://example.com/new.jpg');
  });

  it('merges and dedupes social links from cached game details', () => {
    const patreonA: SocialLink = {
      host: 'patreon',
      url: 'https://www.patreon.com/x',
      text: 'Patreon',
    };
    const patreonB: SocialLink = {
      host: 'patreon',
      url: 'https://patreon.com/x/posts',
      text: 'Patreon',
    };
    const entries: DeveloperCatalogEntry[] = [
      {
        hit: hit({ threadId: '1' }),
        detail: detail({ social: [patreonA] }),
      },
      {
        hit: hit({ threadId: '2' }),
        detail: detail({
          threadId: '2',
          social: [
            patreonB,
            { host: 'discord', url: 'https://discord.gg/x', text: 'Discord' },
          ],
        }),
      },
    ];
    expect(collectDeveloperSocialLinks(entries)).toEqual([
      patreonA,
      { host: 'discord', url: 'https://discord.gg/x', text: 'Discord' },
    ]);
  });

  it('builds profile stats from entries', () => {
    const entries: DeveloperCatalogEntry[] = [
      { hit: hit({ threadId: '1', dateLabel: 'Jun 2024', dateIso: '2024-06-01' }), detail: detail({ rating: 4 }) },
      { hit: hit({ threadId: '2', dateLabel: 'Jan 2025', dateIso: '2025-01-01' }), detail: detail({ threadId: '2', rating: 5 }) },
    ];
    const stats = buildDeveloperProfileStats(entries, new Set(['2']));
    expect(stats.gameCount).toBe(2);
    expect(stats.avgRating).toBe(4.5);
    expect(stats.latestDateLabel).toBe('Jan 2025');
    expect(stats.inLibraryCount).toBe(1);
    expect(stats.enginePrefixes).toContain("Ren'Py");
  });
});
