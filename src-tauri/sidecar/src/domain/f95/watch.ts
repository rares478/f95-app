import { BrowserClient } from 'browser-rest-api';
import * as cheerio from 'cheerio';
import { log } from '../../logger';
import { RPC_ERROR, RpcError } from '../../rpc';
import { assertNotCloudflareChallenge } from '../../shared/cloudflare';
import { F95_BASE } from '../../shared/constants';
import { buildXfAjaxUrl, loadXfToken } from './alerts';

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

export interface ThreadWatchPage {
  threadId: string;
  watchUrl: string;
  requestUri: string;
}

export interface WatchOverlayForm {
  actionUrl: string;
  isWatched: boolean;
  hiddenFields: Record<string, string>;
  emailSubscribeDefault: string | null;
}

export interface ThreadWatchMutationResult {
  ok: true;
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

  async watchThread(threadId: string): Promise<ThreadWatchMutationResult> {
    return watchThread(this.http, threadId);
  }

  async unwatchThread(threadId: string): Promise<ThreadWatchMutationResult> {
    return unwatchThread(this.http, threadId);
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

export async function fetchThreadWatchPage(
  http: BrowserClient,
  threadId: string,
): Promise<ThreadWatchPage> {
  const id = requireNumericThreadId(threadId);
  const url = `${F95_BASE}/threads/${id}/`;
  log(`[watch] GET thread for watch mutation ${url}`);
  const res = await http.get(url, {
    headers: { accept: 'text/html', referer: `${F95_BASE}/` },
  });
  assertNotCloudflareChallenge(res.body, res.headers);
  if (res.url.includes('/login')) {
    throw new RpcError(RPC_ERROR.NOT_INITIALIZED, 'not logged in');
  }
  if (res.status >= 400) {
    throw new RpcError(RPC_ERROR.INTERNAL, `thread watch page HTTP ${res.status}`);
  }

  const watchUrl = parseThreadWatchLink(res.body, id);
  if (!watchUrl) {
    throw new RpcError(RPC_ERROR.INTERNAL, 'could not find watch link on thread page');
  }

  return {
    threadId: id,
    watchUrl,
    requestUri: threadRequestUriFromFinalUrl(res.url, id),
  };
}

export async function watchThread(
  http: BrowserClient,
  threadId: string,
): Promise<ThreadWatchMutationResult> {
  return submitThreadWatchMutation(http, threadId, 'watch');
}

export async function unwatchThread(
  http: BrowserClient,
  threadId: string,
): Promise<ThreadWatchMutationResult> {
  return submitThreadWatchMutation(http, threadId, 'unwatch');
}

async function submitThreadWatchMutation(
  http: BrowserClient,
  threadId: string,
  mode: 'watch' | 'unwatch',
): Promise<ThreadWatchMutationResult> {
  const page = await fetchThreadWatchPage(http, threadId);
  const overlayHtml = await fetchWatchOverlayHtml(http, page.watchUrl, page.requestUri);
  const overlay = parseWatchOverlayForm(overlayHtml);

  if (mode === 'watch' && overlay.isWatched) {
    return { ok: true };
  }
  if (mode === 'unwatch' && !overlay.isWatched) {
    return { ok: true };
  }

  const xfToken = await loadXfToken(http);
  const emailSubscribe =
    mode === 'watch'
      ? parseEmailSubscribeDefault(overlay.emailSubscribeDefault)
      : undefined;
  const form = buildThreadWatchPostForm({
    actionUrl: overlay.actionUrl,
    xfToken,
    requestUri: page.requestUri,
    mode,
    emailSubscribe,
  });
  log(`[watch] POST ${form.url} (${mode})`);
  const res = await http.post(form.url, {
    headers: form.headers,
    body: form.body,
  });
  assertNotCloudflareChallenge(res.body, res.headers);
  if (res.url.includes('/login')) {
    throw new RpcError(RPC_ERROR.NOT_INITIALIZED, 'not logged in');
  }
  if (res.status >= 400) {
    try {
      parseThreadWatchMutationResponse({
        body: typeof res.body === 'string' ? res.body : '',
        finalUrl: res.url,
      });
    } catch (err) {
      if (err instanceof RpcError) throw err;
    }
    throw new RpcError(RPC_ERROR.INTERNAL, `thread ${mode} HTTP ${res.status}`);
  }
  return parseThreadWatchMutationResponse({
    body: typeof res.body === 'string' ? res.body : '',
    finalUrl: res.url,
  });
}

async function fetchWatchOverlayHtml(
  http: BrowserClient,
  watchUrl: string,
  requestUri: string,
): Promise<string> {
  const xfToken = await loadXfToken(http);
  const watchPath = watchPathFromUrl(watchUrl);
  const ajaxUrl = buildXfAjaxUrl(watchPath, xfToken, requestUri);
  log(`[watch] GET overlay ${watchPath}`);
  const res = await http.get(ajaxUrl, {
    headers: {
      accept: 'application/json, text/javascript, */*; q=0.01',
      'x-requested-with': 'XMLHttpRequest',
      referer: `${F95_BASE}${requestUri}`,
    },
  });
  assertNotCloudflareChallenge(res.body, res.headers);
  if (res.url.includes('/login')) {
    throw new RpcError(RPC_ERROR.NOT_INITIALIZED, 'not logged in');
  }
  if (res.status >= 400) {
    throw new RpcError(RPC_ERROR.INTERNAL, `watch overlay HTTP ${res.status}`);
  }

  const fromAjax = extractOverlayHtmlFromResponse(res.body);
  if (fromAjax) return fromAjax;

  if (res.body.includes('<form')) {
    return res.body;
  }

  log(`[watch] GET overlay plain ${watchUrl}`);
  const plainRes = await http.get(watchUrl, {
    headers: {
      accept: 'text/html',
      referer: `${F95_BASE}${requestUri}`,
    },
  });
  assertNotCloudflareChallenge(plainRes.body, plainRes.headers);
  if (plainRes.url.includes('/login')) {
    throw new RpcError(RPC_ERROR.NOT_INITIALIZED, 'not logged in');
  }
  if (plainRes.status >= 400) {
    throw new RpcError(RPC_ERROR.INTERNAL, `watch overlay plain HTTP ${plainRes.status}`);
  }
  return plainRes.body;
}

/** @internal Exported for unit tests. */
export function parseThreadWatchLink(html: string, threadId?: string): string | null {
  const state = parseThreadWatchState(html, threadId);
  return state.watchUrl;
}

/** @internal Exported for unit tests. */
export function parseWatchOverlayForm(html: string): WatchOverlayForm {
  if (!html.trim()) {
    throw new RpcError(RPC_ERROR.INTERNAL, 'watch overlay form not found');
  }
  const $ = cheerio.load(html);
  const $form = $('form[action*="/watch"]').first();
  if ($form.length === 0) {
    throw new RpcError(RPC_ERROR.INTERNAL, 'watch overlay form not found');
  }

  const actionUrl = absoluteUrl($form.attr('action'));
  if (!actionUrl) {
    throw new RpcError(RPC_ERROR.INTERNAL, 'watch overlay form action missing');
  }

  const hiddenFields: Record<string, string> = {};
  $form.find('input[type="hidden"]').each((_, el) => {
    const name = $(el).attr('name');
    if (!name) return;
    hiddenFields[name] = $(el).attr('value') ?? '';
  });

  const isWatched = Object.prototype.hasOwnProperty.call(hiddenFields, 'stop');
  const $checkedEmail = $form.find('input[name="email_subscribe"]:checked').first();
  const emailSubscribeDefault =
    $checkedEmail.attr('value') ??
    $form.find('input[name="email_subscribe"][value="0"]').attr('value') ??
    ($form.find('input[name="email_subscribe"]').first().attr('value') ?? null);

  return {
    actionUrl,
    isWatched,
    hiddenFields,
    emailSubscribeDefault,
  };
}

/** @internal Exported for unit tests. */
export function buildThreadWatchPostForm(args: {
  actionUrl: string;
  xfToken: string;
  requestUri: string;
  mode: 'watch' | 'unwatch';
  emailSubscribe?: 0 | 1;
}): { url: string; body: string; headers: Record<string, string> } {
  const fields = new URLSearchParams();
  if (args.mode === 'unwatch') {
    fields.set('stop', '1');
  } else {
    fields.set('email_subscribe', String(args.emailSubscribe ?? 0));
  }
  fields.set('_xfToken', args.xfToken);
  fields.set('_xfRequestUri', args.requestUri);
  fields.set('_xfWithData', '1');
  fields.set('_xfResponseType', 'json');

  return {
    url: args.actionUrl,
    body: fields.toString(),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-requested-with': 'XMLHttpRequest',
      accept: 'application/json, text/javascript, */*; q=0.01',
      referer: `${F95_BASE}${args.requestUri}`,
      origin: F95_BASE,
    },
  };
}

/** @internal Exported for unit tests. */
export function parseThreadWatchMutationResponse(args: {
  body: string;
  finalUrl?: string;
}): ThreadWatchMutationResult {
  const raw = args.body.trim();
  if (!raw) {
    if (args.finalUrl && !/login/i.test(args.finalUrl)) {
      return { ok: true };
    }
    throw new RpcError(RPC_ERROR.INTERNAL, 'empty watch mutation response from F95');
  }

  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    parsed = null;
  }

  if (parsed) {
    const errMsg = firstWatchErrorMessage(parsed);
    const status = typeof parsed.status === 'string' ? parsed.status : null;
    if (status === 'captcha' || /captcha/i.test(errMsg ?? '')) {
      throw new RpcError(
        RPC_ERROR.CLOUDFLARE_CHALLENGE,
        errMsg ?? 'F95 requires a captcha to watch threads; open the thread in your browser',
        { variant: 'recaptcha' },
      );
    }
    if (status === 'error' || (errMsg && status !== 'ok')) {
      throw new RpcError(RPC_ERROR.INTERNAL, errMsg ?? 'thread watch mutation failed');
    }
    return { ok: true };
  }

  if (/login/i.test(args.finalUrl ?? '')) {
    throw new RpcError(RPC_ERROR.NOT_INITIALIZED, 'not logged in');
  }
  return { ok: true };
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

function extractThreadId($row: cheerio.Cheerio<any>): string | null {
  const classes = ($row.attr('class') ?? '').split(/\s+/);
  for (const cls of classes) {
    const match = cls.match(/^js-threadListItem-(\d+)$/);
    if (match) return match[1];
  }

  const href = $row.find('.structItem-title a[data-tp-primary="on"]').attr('href');
  const fromHref = href?.match(/\/threads\/[^.]+\.(\d+)/);
  return fromHref?.[1] ?? null;
}

function requireNumericThreadId(threadId: string): string {
  const id = String(threadId).trim();
  if (!/^\d+$/.test(id)) {
    throw new RpcError(RPC_ERROR.INVALID_PARAMS, 'threadId must be numeric');
  }
  return id;
}

function threadRequestUriFromFinalUrl(finalUrl: string, threadId: string): string {
  try {
    const path = new URL(finalUrl).pathname;
    if (path.startsWith('/threads/')) {
      return path.endsWith('/') ? path : `${path}/`;
    }
  } catch {
    // fall through
  }
  return `/threads/${threadId}/`;
}

function watchPathFromUrl(watchUrl: string): string {
  if (watchUrl.startsWith(F95_BASE)) return watchUrl.slice(F95_BASE.length);
  if (watchUrl.startsWith('/')) return watchUrl;
  return `/${watchUrl}`;
}

function extractOverlayHtmlFromResponse(body: string): string | null {
  const raw = body.trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const status = typeof parsed.status === 'string' ? parsed.status : null;
    if (status === 'error') {
      const errMsg = firstWatchErrorMessage(parsed);
      throw new RpcError(RPC_ERROR.INTERNAL, errMsg ?? 'watch overlay request failed');
    }
    const html = parsed.html;
    if (html && typeof html === 'object') {
      const content = (html as Record<string, unknown>).content;
      if (typeof content === 'string' && content.trim()) return content;
    }
    if (typeof parsed.html === 'string' && parsed.html.trim()) {
      return parsed.html;
    }
  } catch (err) {
    if (err instanceof RpcError) throw err;
  }
  return null;
}

function parseEmailSubscribeDefault(value: string | null): 0 | 1 {
  return value === '1' ? 1 : 0;
}

function firstStringFromErrors(errors: unknown): string | null {
  if (Array.isArray(errors)) {
    for (const item of errors) {
      if (typeof item === 'string' && item.trim()) return item.trim();
    }
    return null;
  }
  if (errors && typeof errors === 'object') {
    for (const value of Object.values(errors as Record<string, unknown>)) {
      if (typeof value === 'string' && value.trim()) return value.trim();
      if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item === 'string' && item.trim()) return item.trim();
        }
      }
    }
  }
  return null;
}

function firstWatchErrorMessage(parsed: Record<string, unknown>): string | null {
  const fromErrors = firstStringFromErrors(parsed.errors);
  if (fromErrors) return fromErrors;
  if (typeof parsed.message === 'string' && parsed.message.trim()) {
    return parsed.message.trim();
  }
  if (typeof parsed.error === 'string' && parsed.error.trim()) {
    return parsed.error.trim();
  }
  return null;
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
