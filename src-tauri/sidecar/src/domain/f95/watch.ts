import { BrowserClient } from 'browser-rest-api';
import * as cheerio from 'cheerio';
import { log } from '../../logger';
import { RPC_ERROR, RpcError } from '../../rpc';
import { assertNotCloudflareChallenge } from '../../shared/cloudflare';
import { F95_BASE } from '../../shared/constants';

const WATCHED_THREADS_PAGE = `${F95_BASE}/watched/threads`;

export interface WatchedThread {
  threadId: string;
  title: string;
  threadUrl: string;
  forumName: string | null;
  lastActivityAt: string | null;
  isUnreadOnF95: boolean;
}

export interface F95WatchedThreadsResult {
  threads: WatchedThread[];
  page: number;
  hasMore: boolean;
}

export interface ThreadWatchState {
  watched: boolean;
  watchUrl: string | null;
}

export class WatchClient {
  constructor(private readonly http: BrowserClient) {}

  async getWatchedThreads(page = 1): Promise<F95WatchedThreadsResult> {
    return fetchWatchedThreads(this.http, page);
  }

  async getThreadWatchState(threadId: string): Promise<{ watched: boolean }> {
    const state = await fetchThreadWatchState(this.http, threadId);
    return { watched: state.watched };
  }
}

export async function fetchWatchedThreads(
  http: BrowserClient,
  page = 1,
): Promise<F95WatchedThreadsResult> {
  const url = page > 1 ? `${WATCHED_THREADS_PAGE}?page=${page}` : WATCHED_THREADS_PAGE;
  log(`[watch] GET ${url}`);
  const res = await http.get(url, {
    headers: { accept: 'text/html', referer: `${F95_BASE}/` },
  });
  assertNotCloudflareChallenge(res.body, res.headers);
  if (res.url.includes('/login')) {
    throw new RpcError(RPC_ERROR.NOT_INITIALIZED, 'not logged in');
  }
  if (res.status >= 400) {
    throw new RpcError(RPC_ERROR.INTERNAL, `watched threads HTTP ${res.status}`);
  }

  const threads = parseWatchedThreads(res.body);
  const hasMore = detectHasMorePages(res.body, page);
  return { threads, page, hasMore };
}

export async function fetchThreadWatchState(
  http: BrowserClient,
  threadId: string,
): Promise<ThreadWatchState> {
  const id = String(threadId).trim();
  if (!/^\d+$/.test(id)) {
    throw new RpcError(RPC_ERROR.INVALID_PARAMS, 'threadId must be numeric');
  }
  const url = `${F95_BASE}/threads/${id}/`;
  log(`[watch] GET ${url}`);
  const res = await http.get(url, {
    headers: { accept: 'text/html', referer: `${F95_BASE}/` },
  });
  assertNotCloudflareChallenge(res.body, res.headers);
  if (res.url.includes('/login')) {
    throw new RpcError(RPC_ERROR.NOT_INITIALIZED, 'not logged in');
  }
  if (res.status >= 400) {
    throw new RpcError(RPC_ERROR.INTERNAL, `thread watch state HTTP ${res.status}`);
  }
  return parseThreadWatchState(res.body, id);
}

/** @internal Exported for unit tests. */
export function parseThreadWatchState(html: string, _threadId?: string): ThreadWatchState {
  if (!html.trim()) return { watched: false, watchUrl: null };
  const $ = cheerio.load(html);

  const $btn = $('a[data-sk-watch], a[data-sk-unwatch]')
    .filter((_, el) => {
      const href = $(el).attr('href') ?? '';
      return href.includes('/watch') || href.includes('/unwatch');
    })
    .first();

  if ($btn.length === 0) return { watched: false, watchUrl: null };

  const href = $btn.attr('href');
  const watchUrl = absoluteUrl(href);
  const text = cleanText($btn.find('.button-text').text() || $btn.text());
  const watched =
    /^unwatch$/i.test(text) || (href?.includes('/unwatch') ?? false);

  return { watched, watchUrl };
}

/** @internal Exported for unit tests. */
export function parseWatchedThreads(html: string): WatchedThread[] {
  if (!html.trim()) return [];
  const $ = cheerio.load(html);
  const threads: WatchedThread[] = [];

  $('.structItemContainer .structItem.structItem--thread').each((_, el) => {
    const $row = $(el);
    const threadId = extractThreadId($row);
    if (!threadId) return;

    const $titleLink = $row.find('.structItem-title a[data-tp-primary="on"]').first();
    const title = cleanText($titleLink.text());
    if (!title) return;

    const href = $titleLink.attr('href');
    const threadUrl = absoluteUrl(href);
    if (!threadUrl) return;

    const lastActivityAt =
      cleanText($row.find('time.structItem-latestDate').attr('datetime')) || null;

    const forumFromParts = cleanText(
      $row.find('.structItem-parts a.labelLink').first().text(),
    );
    const forumFromMobile = cleanText($row.find('.uix_mobileNodeTitle').first().text());
    const forumName = forumFromParts || forumFromMobile || null;

    threads.push({
      threadId,
      title,
      threadUrl,
      forumName,
      lastActivityAt,
      isUnreadOnF95: $row.hasClass('is-unread'),
    });
  });

  return threads;
}

/** @internal Exported for unit tests. */
export function detectHasMorePages(html: string, currentPage: number): boolean {
  const $ = cheerio.load(html);
  if ($('.pageNav').length === 0) return false;
  const nextLink = $('.pageNav-page--later, .pageNav-jump--next, a[rel="next"]');
  if (nextLink.length > 0) return true;
  const lastPage = $('.pageNav-page:last-child a').text().trim();
  const lastNum = parseInt(lastPage, 10);
  return Number.isFinite(lastNum) && lastNum > currentPage;
}

function extractThreadId($row: cheerio.Cheerio<cheerio.Element>): string | null {
  const classes = ($row.attr('class') ?? '').split(/\s+/);
  for (const cls of classes) {
    const match = cls.match(/^js-threadListItem-(\d+)$/);
    if (match) return match[1];
  }

  const href = $row.find('.structItem-title a[data-tp-primary="on"]').attr('href');
  const fromHref = href?.match(/\/threads\/[^.]+\.(\d+)/);
  return fromHref?.[1] ?? null;
}

function cleanText(s: string | null | undefined): string {
  if (!s) return '';
  return s.replace(/\s+/g, ' ').trim();
}

function absoluteUrl(href: string | null | undefined): string | null {
  if (!href) return null;
  if (href.startsWith('http://') || href.startsWith('https://')) return href;
  if (href.startsWith('//')) return `https:${href}`;
  if (href.startsWith('/')) return `${F95_BASE}${href}`;
  return `${F95_BASE}/${href}`;
}
