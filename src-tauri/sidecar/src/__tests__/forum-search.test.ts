import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildForumSearchUrl, parseForumSearchPage } from '../domain/f95/forumSearch';

const fix = (name: string) =>
  readFileSync(join(__dirname, 'fixtures', name), 'utf8');

describe('buildForumSearchUrl', () => {
  it('encodes query and default post search', () => {
    const url = buildForumSearchUrl({ query: 'Hard to Love' });
    expect(url).toContain('/search/');
    expect(url).toContain('q=Hard');
    expect(url).toMatch(/[?&]t=post\b/);
  });

  it('applies titleOnly, titles-only type, date sort, and page', () => {
    const url = buildForumSearchUrl({
      query: 'x',
      titleOnly: true,
      searchIn: 'titles',
      sort: 'date',
      page: 2,
    });
    expect(url).toMatch(/c\[title_only\]=1|c%5Btitle_only%5D=1|title_only=1/);
    expect(url).toMatch(/[?&]t=thread\b/);
    expect(url).toMatch(/[?&]o=date\b/);
    expect(url).toMatch(/[?&]page=2\b/);
  });
});

describe('parseForumSearchPage', () => {
  it('parses hits, forum, author, dates, and pagination', () => {
    const page = parseForumSearchPage(fix('forum-search-page-1.html'), { page: 1 });
    expect(page.results).toHaveLength(2);
    expect(page.results[0]).toMatchObject({
      threadId: '207960',
      title: 'Hard to Love [v0.28]',
      forum: 'Games',
      author: 'Qori',
      authorId: '123',
    });
    expect(page.results[0].threadUrl).toContain('/threads/');
    expect(page.results[1].forum).toBe('Requests');
    expect(page.totalPages).toBe(3);
    expect(page.hasMore).toBe(true);
    expect(page.page).toBe(1);
  });

  it('returns empty results without throwing', () => {
    const page = parseForumSearchPage(fix('forum-search-empty.html'), { page: 1 });
    expect(page.results).toEqual([]);
    expect(page.hasMore).toBe(false);
  });
});
