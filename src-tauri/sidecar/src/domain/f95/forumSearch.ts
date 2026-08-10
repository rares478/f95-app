import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import { RPC_ERROR, RpcError } from '../../rpc';
import { assertNotCloudflareChallenge } from '../../shared/cloudflare';
import { F95_BASE } from '../../shared/constants';

export type ForumSearchSort = 'relevance' | 'date';
export type ForumSearchIn = 'titles' | 'posts';

export interface ForumSearchParams {
  query: string;
  titleOnly?: boolean;
  searchIn?: ForumSearchIn;
  sort?: ForumSearchSort;
  page?: number;
}

export interface ForumSearchHit {
  threadId: string;
  title: string;
  snippet: string;
  author: string | null;
  authorId: string | null;
  forum: string;
  dateLabel: string | null;
  dateIso: string | null;
  threadUrl: string;
}

export interface ForumSearchPage {
  results: ForumSearchHit[];
  page: number;
  totalPages: number | null;
  hasMore: boolean;
}

function absUrl(href: string | undefined | null): string | null {
  if (!href) return null;
  if (/^https?:\/\//i.test(href)) return href;
  if (href.startsWith('//')) return `https:${href}`;
  if (href.startsWith('/')) return `${F95_BASE}${href}`;
  return null;
}

/** XenForo search GET — prefer `/search/?q=…` (not broken `/search/search`). */
export function buildForumSearchUrl(params: ForumSearchParams): string {
  // Keep `c[title_only]` brackets unencoded (URLSearchParams would use %5B/%5D).
  const parts: string[] = [
    `q=${encodeURIComponent(params.query)}`,
    `t=${params.searchIn === 'titles' ? 'thread' : 'post'}`,
  ];
  if (params.titleOnly) {
    parts.push('c[title_only]=1');
  }
  parts.push(`o=${params.sort === 'date' ? 'date' : 'relevance'}`);
  if (params.page != null && params.page > 1) {
    parts.push(`page=${params.page}`);
  }
  return `${F95_BASE}/search/?${parts.join('&')}`;
}

function extractThreadId(href: string): string | null {
  const dotted = href.match(/\/threads\/[^/?#]*\.(\d+)/);
  if (dotted) return dotted[1];
  const numeric = href.match(/\/threads\/(\d+)/);
  return numeric ? numeric[1] : null;
}

function parseAuthor($row: cheerio.Cheerio<Element>): {
  author: string | null;
  authorId: string | null;
} {
  // Live XF rows put an empty-text avatar link before `a.username`.
  const $username = $row.find('a.username[href*="/members/"]').first();
  const $link = $username.length
    ? $username
    : $row.find('a[href*="/members/"]').first();
  if (!$link.length) {
    const dataAuthor = $row.attr('data-author')?.trim() || null;
    return { author: dataAuthor, authorId: null };
  }
  const href = $link.attr('href') ?? '';
  const idMatch = href.match(/\/members\/[^/]*\.(\d+)/);
  const author =
    $link.text().trim() || $row.attr('data-author')?.trim() || null;
  return { author, authorId: idMatch ? idMatch[1] : null };
}

function detectTotalPages($: cheerio.CheerioAPI): number | null {
  const nums: number[] = [];
  const pushPage = (raw: string | undefined) => {
    if (!raw) return;
    const n = parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) nums.push(n);
  };
  $('.pageNav-page a, .pageNav-page').each((_, el) => {
    pushPage($(el).text().trim());
  });
  $('.pageNav a[href], .pageNav-main a[href], a.pageNav-jump[href]').each(
    (_, el) => {
      const href = $(el).attr('href') ?? '';
      const path = href.match(/\/page-(\d+)/i);
      const query = href.match(/[?&]page=(\d+)/i);
      if (path) pushPage(path[1]);
      if (query) pushPage(query[1]);
    },
  );
  return nums.length ? Math.max(...nums) : null;
}

function parseHit(
  $: cheerio.CheerioAPI,
  row: Element,
): ForumSearchHit | null {
  const $row = $(row);
  const $titleLink = $row
    .find('.contentRow-title a[href*="/threads/"], h3 a[href*="/threads/"]')
    .first();
  if (!$titleLink.length) return null;

  const href = $titleLink.attr('href') ?? '';
  const threadId = extractThreadId(href);
  if (!threadId) return null;

  const threadUrl = absUrl(href) ?? `${F95_BASE}${href.startsWith('/') ? href : `/${href}`}`;
  const title = $titleLink.text().trim();
  const snippet = $row.find('.contentRow-snippet').first().text().trim();
  const { author, authorId } = parseAuthor($row);

  const forumLinks = $row.find('.contentRow-minor a[href*="/forums/"]');
  const forum =
    forumLinks.last().text().trim() ||
    $row.find('a[href*="/forums/"]').last().text().trim() ||
    '';

  const $time = $row.find('time').first();
  const dateIso = $time.attr('datetime')?.trim() || null;
  const dateLabel = $time.text().trim() || null;

  return {
    threadId,
    title,
    snippet,
    author,
    authorId,
    forum,
    dateLabel,
    dateIso,
    threadUrl,
  };
}

export function parseForumSearchPage(
  html: string,
  opts?: { page?: number },
): ForumSearchPage {
  const $ = cheerio.load(html);
  const page = opts?.page ?? 1;

  let rows = $('.block-row.block-row--separated').toArray();
  if (rows.length === 0) {
    rows = $('.contentRow')
      .filter((_, el) => {
        const href =
          $(el).find('a[href*="/threads/"]').first().attr('href') ?? '';
        return /\/threads\//.test(href);
      })
      .toArray();
  }

  const results: ForumSearchHit[] = [];
  for (const row of rows) {
    const hit = parseHit($, row);
    if (hit) results.push(hit);
  }

  const totalPages = detectTotalPages($);
  const hasNextJump = $('.pageNav-jump--next').length > 0;
  const hasMore =
    (totalPages != null && page < totalPages) ||
    (totalPages == null && hasNextJump);

  return { results, page, totalPages, hasMore };
}

export async function fetchForumSearch(
  http: {
    get: (
      url: string,
    ) => Promise<{ status: number; url: string; body: string; headers: Record<string, string> }>;
  },
  params: ForumSearchParams,
): Promise<ForumSearchPage> {
  const query = params.query.trim();
  if (!query) {
    return { results: [], page: 1, totalPages: null, hasMore: false };
  }
  const url = buildForumSearchUrl({ ...params, query });
  const res = await http.get(url);
  assertNotCloudflareChallenge(res.body, res.headers);
  if (res.url.includes('/login')) {
    throw new RpcError(RPC_ERROR.NOT_INITIALIZED, 'not logged in');
  }
  if (res.status >= 400) {
    throw new RpcError(RPC_ERROR.INTERNAL, `forum search HTTP ${res.status}`);
  }
  // If XF returns a search form / error page with zero rows, return empty (do not throw)
  return parseForumSearchPage(res.body, { page: params.page ?? 1 });
}
