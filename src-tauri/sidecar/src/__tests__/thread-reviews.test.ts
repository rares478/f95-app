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
  it('parses Bad Teacher sample stats and cards', () => {
    const page = parseThreadReviewsPage(fix('thread-reviews-bad-teacher.html'), {
      threadId: '46657',
      page: 1,
    });
    expect(page.threadId).toBe('46657');
    expect(page.stats?.average).toBe(4.5);
    expect(page.stats?.count).toBe(63);
    expect(page.stats?.starBars.find((b) => b.stars === 5)?.count).toBe(41);
    expect(page.stats?.parts.some((p) => /visuals/i.test(p.label))).toBe(true);
    expect(page.stats?.mentions.some((m) => m.key === 'story')).toBe(true);
    expect(page.stats?.monthlyAverage.length).toBeGreaterThan(0);
    expect(page.stats?.perMonth.length).toBeGreaterThan(0);
    expect(page.versions.length).toBeGreaterThanOrEqual(1);
    expect(page.reviews.length).toBeGreaterThanOrEqual(1);
    const first = page.reviews[0];
    expect(first.reviewId).toBe('359162');
    expect(first.author).toBe('Richard47687');
    expect(first.rating).toBe(4.5);
    expect(first.bodyHtml.length).toBeGreaterThan(20);
    expect(page.rangeLabel).toMatch(/1/);
    expect(page.reviewsUrl).toContain('/threads/46657/reviews');
  });

  it('derives hasMore/totalPages from rangeLabel when pageNav is absent', () => {
    const page = parseThreadReviewsPage(fix('thread-reviews-bad-teacher.html'), {
      threadId: '46657',
      page: 1,
    });
    expect(page.rangeLabel).toMatch(/1\s*[–—−-]\s*20\s+of\s+63/i);
    expect(page.reviews.length).toBe(20);
    // No .pageNav in fixture — must fall back to "1–20 of 63"
    expect(page.totalPages).toBe(Math.ceil(63 / 20));
    expect(page.hasMore).toBe(true);
  });

  it('returns empty cards without throwing on empty fixture', () => {
    const page = parseThreadReviewsPage(fix('thread-reviews-empty.html'), {
      threadId: '1',
      page: 1,
    });
    expect(page.reviews).toEqual([]);
    expect(page.stats).toBeNull();
  });
});
