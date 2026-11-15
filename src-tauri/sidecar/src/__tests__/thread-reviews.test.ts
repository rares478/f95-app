import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildThreadReviewsUrl,
  parseThreadReviewsPage,
} from '../domain/game/reviews';

const fix = (name: string) =>
  readFileSync(join(__dirname, 'fixtures', name), 'utf8');

describe('buildThreadReviewsUrl', () => {
  it('builds page 1 without /page-N', () => {
    expect(buildThreadReviewsUrl('46657')).toBe(
      'https://f95zone.to/threads/46657/reviews/',
    );
  });

  it('appends /page-N and query params', () => {
    const url = buildThreadReviewsUrl('46657', {
      page: 3,
      sort: 'helpful',
      stars: 5,
      mention: 'story',
      version: '1',
      recent: true,
    });
    expect(url).toContain('/threads/46657/reviews/page-3/');
    expect(url).toContain('sort=helpful');
    expect(url).toContain('stars=5');
    expect(url).toContain('mention=story');
    expect(url).toContain('version=1');
    expect(url).toContain('recent=1');
  });

  it('omits sort query for latest', () => {
    const url = buildThreadReviewsUrl('46657', { sort: 'latest' });
    expect(url).not.toContain('sort=');
  });
});

describe('parseThreadReviewsPage', () => {
  it('parses Desert Stalker sample stats, score lines, and cards', () => {
    const page = parseThreadReviewsPage(fix('thread-reviews-desert-stalker.html'), {
      threadId: '68105',
      page: 1,
    });
    expect(page.threadId).toBe('68105');
    expect(page.stats?.average).toBe(4.8);
    expect(page.stats?.count).toBe(862);
    expect(page.stats?.starBars.find((b) => b.stars === 5)?.count).toBe(749);
    expect(page.stats?.parts.some((p) => /visuals/i.test(p.label))).toBe(true);
    expect(page.stats?.mentions.length).toBeGreaterThan(0);
    expect(page.stats?.monthlyAverage.length).toBeGreaterThan(0);
    expect(page.stats?.perMonth.length).toBeGreaterThan(0);
    expect(page.stats?.releases.length).toBeGreaterThanOrEqual(2);
    expect(page.stats?.releases[0]?.label).toMatch(/v0\.21\.4/i);
    expect(page.stats?.releases[1]?.label).toMatch(/v0\.22\.0/i);
    expect(page.stats?.scoreLines.some((l) => l.recent)).toBe(true);
    expect(page.stats?.scoreLines.some((l) => l.versionId === '3')).toBe(true);
    expect(page.pendingNote).toMatch(/pending approval/i);
    expect(page.currentGroup?.kind).toMatch(/this version/i);
    expect(page.currentGroup?.name).toMatch(/v0\.22\.0/i);
    expect(page.olderFolds.length).toBeGreaterThanOrEqual(2);
    expect(page.olderFolds.some((f) => f.versionId === 'none')).toBe(true);
    expect(page.versions.some((v) => v.id === 'none')).toBe(true);
    expect(page.versions.length).toBeGreaterThanOrEqual(1);
    expect(page.reviews.length).toBe(5);
    const first = page.reviews[0];
    expect(first.reviewId).toBe('386394');
    expect(first.author).toBe('Gari Fuze');
    expect(first.versionLabel).toMatch(/v0\.22\.0/i);
    expect(first.isOlderVersion).toBe(false);
    expect(page.reviews.some((r) => /mods/i.test(r.modsLabel ?? ''))).toBe(true);
    expect(first.bodyHtml.length).toBeGreaterThan(20);
    expect(page.rangeLabel).toMatch(/862\s+reviews/i);
    expect(page.reviewsUrl).toContain('/threads/68105/reviews');
  });

  it('does not invent classic paging from a Latest-style range label', () => {
    const page = parseThreadReviewsPage(fix('thread-reviews-desert-stalker.html'), {
      threadId: '68105',
      page: 1,
    });
    // Latest chrome is `862 reviews`, not `1–20 of N` — no fake pageNav.
    expect(page.rangeLabel).not.toMatch(/\d+\s*[–—−-]\s*\d+\s+of\s+\d+/i);
    expect(page.totalPages).toBeNull();
    expect(page.hasMore).toBe(false);
  });

  it('returns empty cards without throwing on empty fixture', () => {
    const page = parseThreadReviewsPage(fix('thread-reviews-empty.html'), {
      threadId: '1',
      page: 1,
    });
    expect(page.reviews).toEqual([]);
    expect(page.stats).toBeNull();
    expect(page.olderFolds).toEqual([]);
    expect(page.currentGroup).toBeNull();
    expect(page.pendingNote).toBeNull();
  });
});
