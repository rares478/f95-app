import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildForumSearchUrl,
  fetchForumSearch,
  parseForumSearchPage,
} from '../domain/f95/forumSearch';
import { RPC_ERROR, RpcError } from '../rpc';

const fix = (name: string) =>
  readFileSync(join(__dirname, 'fixtures', name), 'utf8');

const ACCOUNT_HTML = `<html data-csrf="tok-abc"><body>
  <input type="hidden" name="_xfToken" value="tok-abc" />
</body></html>`;

type FakeRes = {
  status: number;
  url: string;
  body: string;
  headers: Record<string, string>;
};

function makeSearchHttp(opts: {
  account?: FakeRes | (() => FakeRes);
  post?: (url: string, init?: { body?: string; headers?: Record<string, string> }) => FakeRes;
  getExtra?: (
    url: string,
    init?: { headers?: Record<string, string> },
  ) => FakeRes | null;
}) {
  const posts: Array<{ url: string; body?: string; headers?: Record<string, string> }> = [];
  const gets: Array<{ url: string; headers?: Record<string, string> }> = [];
  const http = {
    posts,
    gets,
    get: async (
      url: string,
      init?: { headers?: Record<string, string> },
    ): Promise<FakeRes> => {
      if (url.includes('/account')) {
        return typeof opts.account === 'function'
          ? opts.account()
          : (opts.account ?? {
              status: 200,
              url: 'https://f95zone.to/account/',
              body: ACCOUNT_HTML,
              headers: { 'content-type': 'text/html' },
            });
      }
      gets.push({ url, headers: init?.headers });
      const extra = opts.getExtra?.(url, init);
      if (extra) return extra;
      return {
        status: 200,
        url,
        body: '<html></html>',
        headers: { 'content-type': 'text/html' },
      };
    },
    post: async (
      url: string,
      init?: { body?: string; headers?: Record<string, string> },
    ): Promise<FakeRes> => {
      posts.push({ url, body: init?.body, headers: init?.headers });
      if (opts.post) return opts.post(url, init);
      return {
        status: 200,
        url: 'https://f95zone.to/search/12345/?q=x',
        body: fix('forum-search-page-1.html'),
        headers: { 'content-type': 'text/html' },
      };
    },
  };
  return http;
}

describe('buildForumSearchUrl', () => {
  it('encodes query and default post search', () => {
    const url = buildForumSearchUrl({ query: 'Hard to Love' });
    expect(url).toContain('/search/');
    expect(url).toContain('q=Hard');
    expect(url).toMatch(/[?&]o=relevance\b/);
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
      avatarUrl: null,
      prefixes: [],
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

  it('parses live XF markup (avatar-first author, labels, pagination)', () => {
    const page = parseForumSearchPage(fix('forum-search-live-sample.html'), {
      page: 1,
    });
    expect(page.results.length).toBeGreaterThanOrEqual(2);
    expect(page.results[0]).toMatchObject({
      threadId: '3222',
      author: 'RedKing',
      authorId: '595',
      forum: 'Games',
    });
    expect(page.results[0].title).toBe("Parental Love [v1.1] [Luxee]");
    expect(page.results[0].prefixes.map((p) => p.name)).toEqual([
      'VN',
      "Ren'Py",
      'Completed',
    ]);
    expect(page.results[0].avatarUrl).toContain('/data/avatars/s/0/595.jpg');
    expect(page.results[0].threadUrl).toContain('/threads/');
    expect(page.results[0].dateIso).toBe('2017-06-13T00:03:49+0300');
    expect(page.results[1]).toMatchObject({
      threadId: '25146',
      author: 'UncleVT',
      authorId: '93691',
      forum: 'Games',
    });
    expect(page.results[1].prefixes.map((p) => p.name)).toEqual(['VN', "Ren'Py"]);
    expect(page.results[1].avatarUrl).toContain('/data/avatars/s/93/93691.jpg');
    expect(page.totalPages).toBe(48);
    expect(page.hasMore).toBe(true);
  });
});

describe('fetchForumSearch', () => {
  const okHeaders = { 'content-type': 'text/html' };

  it('POSTs /search/search with CSRF and parses redirected results', async () => {
    const http = makeSearchHttp({
      post: () => ({
        status: 200,
        url: 'https://f95zone.to/search/999/?q=Hard%20to%20Love',
        body: fix('forum-search-live-sample.html'),
        headers: okHeaders,
      }),
    });
    const page = await fetchForumSearch(http, {
      query: 'Hard to Love',
      titleOnly: true,
      searchIn: 'titles',
      sort: 'date',
    });
    expect(http.posts).toHaveLength(1);
    expect(http.posts[0].url).toContain('/search/search');
    expect(http.posts[0].body).toMatch(/_xfToken=tok-abc/);
    expect(http.posts[0].body).toMatch(/(?:^|&)keywords=Hard/);
    expect(http.posts[0].body).toMatch(/c(?:\[|%5B)title_only(?:\]|%5D)=1/);
    expect(http.posts[0].body).toMatch(/(?:^|&)order=date(?:&|$)/);
    expect(http.posts[0].body).not.toMatch(/(?:^|&)q=/);
    expect(http.posts[0].body).not.toMatch(/(?:^|&)page=/);
    expect(http.posts[0].headers?.['content-type']).toMatch(
      /application\/x-www-form-urlencoded/,
    );
    expect(http.gets).toHaveLength(0);
    expect(page.results.length).toBeGreaterThanOrEqual(2);
    expect(page.results[0].threadId).toBe('3222');
    expect(page.page).toBe(1);
  });

  it('GETs /search/{id}/?page=N after POST redirect when page > 1', async () => {
    const http = makeSearchHttp({
      post: () => ({
        status: 200,
        url: 'https://f95zone.to/search/12345/?q=x',
        body: fix('forum-search-page-1.html'),
        headers: okHeaders,
      }),
      getExtra: (url) => {
        if (!url.includes('/search/12345/')) return null;
        return {
          status: 200,
          url,
          body: fix('forum-search-live-sample.html'),
          headers: okHeaders,
        };
      },
    });
    const page = await fetchForumSearch(http, {
      query: 'x',
      page: 2,
      sort: 'relevance',
    });
    expect(http.posts).toHaveLength(1);
    expect(http.posts[0].body).not.toMatch(/(?:^|&)page=/);
    expect(http.gets).toHaveLength(1);
    expect(http.gets[0].url).toMatch(/\/search\/12345\/\?/);
    expect(http.gets[0].url).toMatch(/[?&]page=2\b/);
    expect(http.gets[0].url).toMatch(/[?&]q=x\b/);
    expect(page.page).toBe(2);
    expect(page.results[0].threadId).toBe('3222');
    expect(page.results.length).toBeGreaterThanOrEqual(2);
  });

  it('throws INTERNAL when page > 1 and POST URL has no search id', async () => {
    const http = makeSearchHttp({
      post: () => ({
        status: 200,
        url: 'https://f95zone.to/search/?q=x',
        body: fix('forum-search-page-1.html'),
        headers: okHeaders,
      }),
    });
    await expect(
      fetchForumSearch(http, { query: 'x', page: 2 }),
    ).rejects.toMatchObject({
      code: RPC_ERROR.INTERNAL,
      message: 'could not resolve forum search id for pagination',
    });
    await expect(
      fetchForumSearch(http, { query: 'x', page: 2 }),
    ).rejects.toBeInstanceOf(RpcError);
    expect(http.gets).toHaveLength(0);
  });

  it('throws NOT_INITIALIZED on login redirect', async () => {
    const http = makeSearchHttp({
      account: {
        status: 200,
        url: 'https://f95zone.to/login/',
        body: '<html></html>',
        headers: okHeaders,
      },
    });
    await expect(fetchForumSearch(http, { query: 'x' })).rejects.toMatchObject({
      code: RPC_ERROR.NOT_INITIALIZED,
      message: 'not logged in',
    });
    await expect(fetchForumSearch(http, { query: 'x' })).rejects.toBeInstanceOf(RpcError);
  });

  it('throws INTERNAL on HTTP >= 400', async () => {
    const http = makeSearchHttp({
      post: () => ({
        status: 503,
        url: 'https://f95zone.to/search/search',
        body: '<html>error</html>',
        headers: okHeaders,
      }),
    });
    await expect(fetchForumSearch(http, { query: 'x' })).rejects.toMatchObject({
      code: RPC_ERROR.INTERNAL,
      message: 'forum search HTTP 503',
    });
  });

  it('throws INTERNAL on XenForo Oops error page', async () => {
    const http = makeSearchHttp({
      post: () => ({
        status: 200,
        url: 'https://f95zone.to/search/search',
        body: '<html data-template="error"><title>Oops! We ran into some problems.</title></html>',
        headers: okHeaders,
      }),
    });
    await expect(fetchForumSearch(http, { query: 'x' })).rejects.toMatchObject({
      code: RPC_ERROR.INTERNAL,
      message: 'forum search rejected by XenForo',
    });
  });

  it('does not treat phrase-catalog Oops text on result pages as an error', async () => {
    const http = makeSearchHttp({
      post: () => ({
        status: 200,
        url: 'https://f95zone.to/search/999/?q=x',
        body: `${fix('forum-search-live-sample.html')}\n<script>oops_we_ran_into_some_problems: "Oops! We ran into some problems."</script>`,
        headers: okHeaders,
      }),
    });
    const page = await fetchForumSearch(http, { query: 'x' });
    expect(page.results.length).toBeGreaterThanOrEqual(2);
  });
});
