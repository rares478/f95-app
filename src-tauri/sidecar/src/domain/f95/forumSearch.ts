import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import { RPC_ERROR, RpcError } from '../../rpc';
import { assertNotCloudflareChallenge } from '../../shared/cloudflare';
import { F95_BASE } from '../../shared/constants';
import { loadXfToken, type XfHttpGet, type XfHttpResponse } from './alerts';
import { log } from '../../logger';

/** F95 advanced thread search form (includes forum + prefix selects). */
export const FORUM_SEARCH_FORM_PATH = '/search/?type=post';
export const FORUM_SEARCH_FORM_URL = `${F95_BASE}${FORUM_SEARCH_FORM_PATH}`;

export type ForumSearchSort = 'relevance' | 'date';
export type ForumSearchIn = 'titles' | 'posts';

export interface ForumSearchParams {
  query: string;
  titleOnly?: boolean;
  containerOnly?: boolean;
  searchIn?: ForumSearchIn;
  sort?: ForumSearchSort;
  page?: number;
  threadId?: string;
  postedBy?: string;
  dateNewerThan?: string;
  dateOlderThan?: string;
  tags?: string;
  withoutTags?: string;
  minReplyCount?: number;
  prefixIds?: number[];
  forumNodeIds?: number[];
  searchSubforums?: boolean;
}

export interface ForumSearchNodeOption {
  id: number;
  label: string;
  /** XenForo search select indent level (each level = two nbsp). */
  depth: number;
}

export interface ForumSearchFormOptions {
  forums: ForumSearchNodeOption[];
}

export interface ForumSearchPrefix {
  name: string;
  cssClass: string | null;
}

export interface ForumSearchHit {
  threadId: string;
  /** When the hit targets a reply, XF links as `/threads/…/post-{id}`. */
  postId: string | null;
  /** XF minor label such as `Thread` or `Post #2`. */
  resultLabel: string | null;
  title: string;
  prefixes: ForumSearchPrefix[];
  snippet: string;
  author: string | null;
  authorId: string | null;
  avatarUrl: string | null;
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

type ForumSearchHttp = XfHttpGet & {
  post: (
    url: string,
    init?: { body?: string; headers?: Record<string, string> },
  ) => Promise<XfHttpResponse>;
};

function absUrl(href: string | undefined | null): string | null {
  if (!href) return null;
  if (/^https?:\/\//i.test(href)) return href;
  if (href.startsWith('//')) return `https:${href}`;
  if (href.startsWith('/')) return `${F95_BASE}${href}`;
  return null;
}

/** Positive integer XenForo thread id, or null when invalid. */
function parseThreadIdParam(raw: string | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed || !/^\d+$/.test(trimmed)) return null;
  const n = parseInt(trimmed, 10);
  return n > 0 ? trimmed : null;
}

/**
 * XF quick search on thread pages POSTs `constraints` JSON (not bare `c[thread]`)
 * to scope results to one thread — see captured thread HTML search forms.
 */
function buildThreadSearchConstraints(threadId: string): string {
  const id = parseInt(threadId, 10);
  return JSON.stringify({ search_type: 'post', c: { thread: id } });
}

/** Shared XenForo `c[…]` constraint params for POST body and pagination GET. */
export function appendForumSearchConstraints(
  parts: string[],
  params: ForumSearchParams,
): void {
  if (params.titleOnly || params.searchIn === 'titles') {
    parts.push('c[title_only]=1');
  }
  if (params.containerOnly) {
    parts.push('c[content]=thread');
  }
  const postedBy = params.postedBy?.trim();
  if (postedBy) {
    parts.push(`c[users]=${encodeURIComponent(postedBy)}`);
  }
  const newer = params.dateNewerThan?.trim();
  if (newer) {
    parts.push(`c[newer_than]=${encodeURIComponent(newer)}`);
  }
  const older = params.dateOlderThan?.trim();
  if (older) {
    parts.push(`c[older_than]=${encodeURIComponent(older)}`);
  }
  const tags = params.tags?.trim();
  if (tags) {
    parts.push(`c[tags]=${encodeURIComponent(tags)}`);
  }
  const withoutTags = params.withoutTags?.trim();
  if (withoutTags) {
    parts.push(`c[excludeTags]=${encodeURIComponent(withoutTags)}`);
  }
  if (params.minReplyCount != null && params.minReplyCount > 0) {
    parts.push(`c[min_reply_count]=${Math.floor(params.minReplyCount)}`);
  }
  for (const id of params.prefixIds ?? []) {
    if (Number.isInteger(id) && id > 0) {
      parts.push(`c[prefixes][]=${id}`);
    }
  }
  for (const id of params.forumNodeIds ?? []) {
    if (Number.isInteger(id) && id > 0) {
      parts.push(`c[nodes][]=${id}`);
    }
  }
  if (
    params.searchSubforums !== false &&
    (params.forumNodeIds?.length ?? 0) > 0
  ) {
    parts.push('c[child_nodes]=1');
  }
}

const FORUM_NODE_HREF_RE = /\/forums\/[^/?#]+\.(\d+)\/?(?:\?|#|$)/i;

function normalizeForumNodeLabel(text: string): string {
  return text.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Count XenForo `&nbsp;&nbsp;` indent pairs from a search `<option>` inner HTML. */
export function parseForumSearchOptionDepth(optionInnerHtml: string): number {
  const leading = optionInnerHtml.match(/^((?:&nbsp;|\u00a0)+)/)?.[1] ?? '';
  if (!leading) return 0;
  const entityCount = (leading.match(/&nbsp;/g) ?? []).length;
  const unicodeCount = (leading.replace(/&nbsp;/g, '').match(/\u00a0/g) ?? [])
    .length;
  return Math.floor((entityCount + unicodeCount) / 2);
}

function pushForumNodeOption(
  forums: ForumSearchNodeOption[],
  seen: Set<number>,
  id: number,
  label: string,
  depth = 0,
): void {
  const clean = normalizeForumNodeLabel(label);
  if (!Number.isFinite(id) || id <= 0 || !clean || seen.has(id)) return;
  seen.add(id);
  forums.push({ id, label: clean, depth: Math.max(0, depth) });
}

function forumNodeIdFromHref(href: string | undefined): number | null {
  const raw = href?.match(FORUM_NODE_HREF_RE)?.[1];
  if (!raw) return null;
  const id = parseInt(raw, 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function xenforoListNodeDepth(className: string): number {
  const match = className.match(/\bnode--depth(\d+)\b/);
  if (!match) return 0;
  return Math.max(0, parseInt(match[1], 10) - 1);
}

function isForumNodeSelectName(name: string): boolean {
  return /^c\[nodes\]|^nodes\[\]$/.test(name);
}

/** Parse forum node options from XenForo advanced search HTML. */
export function parseForumSearchFormOptions(html: string): ForumSearchFormOptions {
  const $ = cheerio.load(html);
  const forums: ForumSearchNodeOption[] = [];
  const seen = new Set<number>();

  $('select').each((_, selectEl) => {
    const name = $(selectEl).attr('name') ?? '';
    if (!isForumNodeSelectName(name)) return;
    $(selectEl)
      .find('option')
      .each((_, el) => {
        const raw = $(el).attr('value')?.trim() ?? '';
        if (!raw || raw === '0') return;
        const id = parseInt(raw, 10);
        const depth = parseForumSearchOptionDepth($(el).html() ?? '');
        pushForumNodeOption(forums, seen, id, $(el).text(), depth);
      });
  });

  return { forums };
}

/** Parse searchable forum nodes from the F95 forums index page. */
export function parseForumNodesFromForumsIndex(html: string): ForumSearchNodeOption[] {
  const $ = cheerio.load(html);
  const forums: ForumSearchNodeOption[] = [];
  const seen = new Set<number>();

  $('.uix_nodeList .block--category').each((_, catEl) => {
    $(catEl)
      .find('.block-body > .node--forum')
      .each((_, nodeEl) => {
        const $node = $(nodeEl);
        const depth = xenforoListNodeDepth($node.attr('class') ?? '');
        const $link = $node.find('.node-title a[href*="/forums/"]').first();
        const label =
          $link.text() || $node.find('a[href*="/forums/"]').first().text();
        const idMatch = ($node.attr('class') ?? '').match(/\bnode--id(\d+)\b/);
        const id =
          (idMatch ? parseInt(idMatch[1], 10) : null) ??
          forumNodeIdFromHref($link.attr('href')) ??
          forumNodeIdFromHref(
            $node.find('a[href*="/forums/"]').first().attr('href'),
          );
        if (id) pushForumNodeOption(forums, seen, id, label, depth);

        $node
          .find('a.subNodeLink--forum[href*="/forums/"]')
          .each((_, subEl) => {
            const $sub = $(subEl);
            const subId = forumNodeIdFromHref($sub.attr('href'));
            if (subId) {
              pushForumNodeOption(forums, seen, subId, $sub.text(), depth + 1);
            }
          });
      });
  });

  return forums;
}

async function fetchForumNodesFromForumsIndex(
  http: XfHttpGet,
): Promise<ForumSearchFormOptions> {
  const res = await http.get(`${F95_BASE}/forums/`, {
    headers: { accept: 'text/html', referer: `${F95_BASE}/` },
  });
  assertNotCloudflareChallenge(res.body, res.headers);
  if (res.status >= 400) {
    throw new RpcError(
      RPC_ERROR.INTERNAL,
      `forums index HTTP ${res.status}`,
    );
  }
  return { forums: parseForumNodesFromForumsIndex(res.body) };
}

export async function fetchForumSearchFormOptions(
  http: XfHttpGet,
): Promise<ForumSearchFormOptions> {
  const res = await http.get(FORUM_SEARCH_FORM_URL, {
    headers: { accept: 'text/html', referer: `${F95_BASE}/` },
  });
  assertNotCloudflareChallenge(res.body, res.headers);
  if (res.url.includes('/login')) {
    return { forums: [] };
  }
  if (res.status >= 400) {
    throw new RpcError(
      RPC_ERROR.INTERNAL,
      `forum search form HTTP ${res.status}`,
    );
  }

  const fromForm = parseForumSearchFormOptions(res.body);
  if (fromForm.forums.length > 0) {
    return fromForm;
  }

  log(
    '[forumSearchFormOptions] no nodes in search form HTML; loading from /forums/',
  );
  return fetchForumNodesFromForumsIndex(http);
}

/** GET query parts for result URLs (`/search/{id}/?q=…`) — XF uses `q`/`o` here. */
export function buildForumSearchQueryParts(params: ForumSearchParams): string[] {
  // Keep `c[title_only]` brackets unencoded (URLSearchParams would use %5B/%5D).
  const parts: string[] = [`q=${encodeURIComponent(params.query)}`];
  appendForumSearchConstraints(parts, params);
  const threadId = parseThreadIdParam(params.threadId);
  if (threadId) {
    parts.push(`c[thread]=${encodeURIComponent(threadId)}`);
  }
  parts.push(`o=${params.sort === 'date' ? 'date' : 'relevance'}`);
  if (params.page != null && params.page > 1) {
    parts.push(`page=${params.page}`);
  }
  return parts;
}

/** XenForo search GET URL — kept for query-string semantics / unit tests. */
export function buildForumSearchUrl(params: ForumSearchParams): string {
  return `${F95_BASE}/search/?${buildForumSearchQueryParts(params).join('&')}`;
}

/**
 * Form body for POST `/search/search`.
 * Live XF expects `keywords` + `order` (not GET-style `q`/`o`/`t`) or it returns Oops/error.
 */
export function buildForumSearchPostBody(
  params: ForumSearchParams & { xfToken: string },
): string {
  const parts: string[] = [
    `_xfToken=${encodeURIComponent(params.xfToken)}`,
    'search_type=post',
    `keywords=${encodeURIComponent(params.query)}`,
    `order=${params.sort === 'date' ? 'date' : 'relevance'}`,
  ];
  appendForumSearchConstraints(parts, params);
  const threadId = parseThreadIdParam(params.threadId);
  if (threadId) {
    parts.push(`constraints=${encodeURIComponent(buildThreadSearchConstraints(threadId))}`);
  }
  return parts.join('&');
}

function filterResultsToThread(
  page: ForumSearchPage,
  threadId: string,
): ForumSearchPage {
  const filtered = page.results.filter((hit) => hit.threadId === threadId);
  if (filtered.length === page.results.length) return page;
  return { ...page, results: filtered };
}

/** Numeric search-result id from a final XF redirect URL (`/search/{id}/…`). */
export function extractForumSearchId(url: string): string | null {
  const m = url.match(/\/search\/(\d+)(?:\/|\?|#|$)/i);
  return m ? m[1] : null;
}

function assertForumSearchResponse(res: {
  status: number;
  url: string;
  body: string;
  headers: Record<string, string>;
}): void {
  assertNotCloudflareChallenge(res.body, res.headers);
  if (res.url.includes('/login')) {
    throw new RpcError(RPC_ERROR.NOT_INITIALIZED, 'not logged in');
  }
  if (res.status >= 400) {
    throw new RpcError(RPC_ERROR.INTERNAL, `forum search HTTP ${res.status}`);
  }
  // XF returns 200 + error template when the POST body is invalid (e.g. `q` instead of `keywords`).
  // Do NOT match the Oops string alone — phrase catalogs on success pages include that text.
  if (/data-template="error"/i.test(res.body)) {
    throw new RpcError(RPC_ERROR.INTERNAL, 'forum search rejected by XenForo');
  }
}

function extractThreadId(href: string): string | null {
  const dotted = href.match(/\/threads\/[^/?#]*\.(\d+)/);
  if (dotted) return dotted[1];
  const numeric = href.match(/\/threads\/(\d+)/);
  return numeric ? numeric[1] : null;
}

function extractPostId(href: string): string | null {
  const path = href.match(/\/post-(\d+)/i);
  if (path) return path[1];
  const hash = href.match(/#post-(\d+)/i);
  return hash ? hash[1] : null;
}

function parseResultLabel(
  $: cheerio.CheerioAPI,
  $row: cheerio.Cheerio<Element>,
): string | null {
  let label: string | null = null;
  $row.find('.contentRow-minor li').each((_, el) => {
    if (label) return;
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    if (/^(thread|post|message)\b/i.test(text)) label = text;
  });
  return label;
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

function parseAvatarUrl($row: cheerio.Cheerio<Element>): string | null {
  const $img = $row
    .find('.contentRow-figure img.avatar, .contentRow-figure img, .avatar img')
    .first();
  if (!$img.length) return null;
  return absUrl($img.attr('src'));
}

function parseTitleAndPrefixes(
  $: cheerio.CheerioAPI,
  $titleLink: cheerio.Cheerio<Element>,
): { title: string; prefixes: ForumSearchPrefix[] } {
  const prefixes: ForumSearchPrefix[] = [];
  $titleLink.find('span.label, span[class*="pre-"]').each((_, el) => {
    const $el = $(el);
    const name = $el.text().replace(/\u00a0/g, ' ').trim();
    if (!name) return;
    const cssClass = ($el.attr('class') ?? '').trim() || null;
    prefixes.push({ name, cssClass });
  });

  const $clone = $titleLink.clone();
  $clone
    .find('span.label, span.label-append, span[class*="pre-"]')
    .remove();
  const title = $clone
    .text()
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    title: title || $titleLink.text().replace(/\s+/g, ' ').trim(),
    prefixes,
  };
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
  const postId = extractPostId(href);
  const resultLabel = parseResultLabel($, $row);

  const threadUrl = absUrl(href) ?? `${F95_BASE}${href.startsWith('/') ? href : `/${href}`}`;
  const { title, prefixes } = parseTitleAndPrefixes($, $titleLink);
  const snippet = $row.find('.contentRow-snippet').first().text().trim();
  const { author, authorId } = parseAuthor($row);
  const avatarUrl = parseAvatarUrl($row);

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
    postId,
    resultLabel,
    title,
    prefixes,
    snippet,
    author,
    authorId,
    avatarUrl,
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

/**
 * Live XF search requires POST `/search/search` with CSRF; GET `/search/?q=…`
 * only returns the empty search form. Pagination uses GET `/search/{id}/?page=N`
 * after the POST redirect creates a search id.
 */
export async function fetchForumSearch(
  http: ForumSearchHttp,
  params: ForumSearchParams,
): Promise<ForumSearchPage> {
  const query = params.query.trim();
  if (!query) {
    return { results: [], page: 1, totalPages: null, hasMore: false };
  }

  const xfToken = await loadXfToken(http);
  const pageNum = params.page ?? 1;
  const scopedThreadId = parseThreadIdParam(params.threadId);
  const body = buildForumSearchPostBody({ ...params, query, xfToken });
  log(
    `[forumSearch] POST ${F95_BASE}/search/search q=${JSON.stringify(query)} page=${pageNum}` +
      (scopedThreadId ? ` thread=${scopedThreadId}` : ''),
  );
  const res = await http.post(`${F95_BASE}/search/search`, {
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      referer: FORUM_SEARCH_FORM_URL,
      origin: F95_BASE,
      accept: 'text/html',
    },
    body,
  });
  assertForumSearchResponse(res);
  log(`[forumSearch] POST done status=${res.status} url=${res.url}`);

  const searchId = extractForumSearchId(res.url);
  if (pageNum > 1) {
    if (!searchId) {
      throw new RpcError(
        RPC_ERROR.INTERNAL,
        'could not resolve forum search id for pagination',
      );
    }
    const getUrl = `${F95_BASE}/search/${searchId}/?${buildForumSearchQueryParts({
      ...params,
      query,
      page: pageNum,
    }).join('&')}`;
    log(`[forumSearch] GET ${getUrl}`);
    const pageRes = await http.get(getUrl, {
      headers: {
        referer: res.url,
        accept: 'text/html',
      },
    });
    assertForumSearchResponse(pageRes);
    const parsed = parseForumSearchPage(pageRes.body, { page: pageNum });
    return scopedThreadId
      ? filterResultsToThread(parsed, scopedThreadId)
      : parsed;
  }

  // If XF returns a search form / error page with zero rows, return empty (do not throw)
  const parsed = parseForumSearchPage(res.body, { page: pageNum });
  return scopedThreadId ? filterResultsToThread(parsed, scopedThreadId) : parsed;
}
