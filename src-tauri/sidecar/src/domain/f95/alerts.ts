import { BrowserClient } from 'browser-rest-api';
import * as cheerio from 'cheerio';
import { RPC_ERROR, RpcError } from '../../rpc';
import { log } from '../../logger';
import { assertNotCloudflareChallenge } from '../../shared/cloudflare';
import { F95_BASE } from '../../shared/constants';

const BASE = F95_BASE;
const ACCOUNT_PAGE = `${BASE}/account/`;
const ALERTS_PAGE = `${BASE}/account/alerts`;

export interface F95Alert {
  alertId: string;
  text: string;
  url: string | null;
  avatarUrl: string | null;
  username: string | null;
  date: string | null;
  isUnread: boolean;
}

export interface F95AlertsPopupResult {
  alerts: F95Alert[];
  unreadCount: number;
}

export interface F95AlertsListResult {
  alerts: F95Alert[];
  hasMore: boolean;
  page: number;
}

export function buildXfAjaxUrl(path: string, xfToken: string, requestUri = '/'): string {
  const params = new URLSearchParams();
  params.set('_xfRequestUri', requestUri);
  params.set('_xfWithData', '1');
  params.set('_xfToken', xfToken);
  params.set('_xfResponseType', 'json');
  const sep = path.includes('?') ? '&' : '?';
  return `${BASE}${path}${sep}${params.toString()}`;
}

export async function fetchAlertsPopup(http: BrowserClient): Promise<F95AlertsPopupResult> {
  const xfToken = await loadXfToken(http);
  const url = buildXfAjaxUrl('/account/alerts-popup', xfToken);
  log(`[alerts] GET ${url.split('_xfToken=')[0]}_xfToken=…`);
  const res = await http.get(url, {
    headers: {
      accept: 'application/json, text/javascript, */*; q=0.01',
      'x-requested-with': 'XMLHttpRequest',
      referer: `${BASE}/`,
    },
  });
  assertNotCloudflareChallenge(res.body, res.headers);
  if (res.url.includes('/login')) {
    throw new RpcError(RPC_ERROR.NOT_INITIALIZED, 'not logged in');
  }
  if (res.status >= 400) {
    throw new RpcError(RPC_ERROR.INTERNAL, `alerts popup HTTP ${res.status}`);
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(res.body) as Record<string, unknown>;
  } catch {
    throw new RpcError(RPC_ERROR.INTERNAL, 'alerts popup did not return JSON');
  }
  if (parsed.status !== 'ok') {
    throw new RpcError(RPC_ERROR.INTERNAL, `alerts popup error: ${String(parsed.status)}`);
  }

  const html = (parsed.html as Record<string, unknown> | undefined)?.content;
  const content = typeof html === 'string' ? html : '';
  const alerts = parseAlertsHtml(content);
  const unreadCount = alerts.filter((a) => a.isUnread).length;
  return { alerts, unreadCount };
}

export async function fetchAlertsList(
  http: BrowserClient,
  page = 1,
): Promise<F95AlertsListResult> {
  const url = page > 1 ? `${ALERTS_PAGE}?page=${page}` : ALERTS_PAGE;
  log(`[alerts] GET ${url}`);
  const res = await http.get(url, {
    headers: { accept: 'text/html', referer: `${BASE}/` },
  });
  assertNotCloudflareChallenge(res.body, res.headers);
  if (res.url.includes('/login')) {
    throw new RpcError(RPC_ERROR.NOT_INITIALIZED, 'not logged in');
  }
  if (res.status >= 400) {
    throw new RpcError(RPC_ERROR.INTERNAL, `alerts list HTTP ${res.status}`);
  }

  const alerts = parseAlertsHtml(res.body);
  const hasMore = detectHasMorePages(res.body, page);
  return { alerts, hasMore, page };
}

async function loadXfToken(http: BrowserClient): Promise<string> {
  const pageRes = await http.get(ACCOUNT_PAGE);
  assertNotCloudflareChallenge(pageRes.body, pageRes.headers);
  if (pageRes.url.includes('/login')) {
    throw new RpcError(RPC_ERROR.NOT_INITIALIZED, 'not logged in');
  }
  const token = extractXfToken(pageRes.body);
  if (!token) {
    throw new RpcError(RPC_ERROR.INTERNAL, 'could not extract _xfToken from account page');
  }
  return token;
}

function extractXfToken(html: string): string | null {
  const $ = cheerio.load(html);
  return (
    $('input[name="_xfToken"]').first().attr('value') ??
    $('html').attr('data-csrf') ??
    null
  );
}

/** @internal Exported for unit tests. */
export function parseAlertsHtml(html: string): F95Alert[] {
  if (!html.trim()) return [];
  const $ = cheerio.load(html);
  const alerts: F95Alert[] = [];
  const seen = new Set<string>();

  const rowSelectors = [
    '.alert',
    '.contentRow--alert',
    '.listItem--alert',
    '.block-row.alert',
    'li.alert',
  ];

  for (const sel of rowSelectors) {
    $(sel).each((idx, el) => {
      const parsed = parseAlertRow($, $(el), idx);
      if (!parsed || seen.has(parsed.alertId)) return;
      seen.add(parsed.alertId);
      alerts.push(parsed);
    });
    if (alerts.length > 0) break;
  }

  if (alerts.length === 0) {
    $('.contentRow').each((idx, el) => {
      const $row = $(el);
      if (!$row.find('a[href]').length && !$row.text().trim()) return;
      const parsed = parseAlertRow($, $row, idx);
      if (!parsed || seen.has(parsed.alertId)) return;
      seen.add(parsed.alertId);
      alerts.push(parsed);
    });
  }

  return alerts;
}

function parseAlertRow(
  $: cheerio.CheerioAPI,
  $row: cheerio.Cheerio<any>,
  fallbackIdx: number,
): F95Alert | null {
  const alertId =
    $row.attr('data-alert-id') ??
    $row.find('[data-alert-id]').first().attr('data-alert-id') ??
    $row.attr('id')?.replace(/^alert-/, '') ??
    `alert-${fallbackIdx}`;

  const isUnread =
    $row.hasClass('is-unread') ||
    $row.hasClass('alert--new') ||
    $row.find('.is-unread, .alert--new').length > 0;

  const $avatar = $row.find('img.avatar, .avatar img, .contentRow-figure img').first();
  const avatarUrl = absoluteUrl(
    $avatar.attr('data-src') ?? $avatar.attr('src') ?? null,
  );

  const $main = $row.find('.contentRow-main').first();
  const $scope = $main.length ? $main : $row;

  const $userLink = $scope.find('a[href*="/members/"]').first();
  const username = cleanText($userLink.text()) || null;

  const $mainLink = $scope
    .find(
      'a[href*="/threads/"], a[href*="/posts/"], a[href*="/conversations/"], a[href*="/account/"], a[href*="/sam/"]',
    )
    .not('[href*="/members/"]')
    .first();
  const url = absoluteUrl($mainLink.attr('href') ?? null);

  const $header = $scope.find('.contentRow-header').first();
  const $snippet = $scope.find('.contentRow-snippet, .alertText').first();
  let text =
    cleanText($header.text()) ||
    cleanText($snippet.text()) ||
    cleanText($scope.find('.fauxBlockLink-blockLink').text());

  if (!text) {
    const clone = $scope.clone();
    clone.find('.contentRow-figure, .contentRow-minor, time, .contentRow-extra').remove();
    text = cleanText(clone.text());
  }

  text = text.replace(/\s+/g, ' ').trim();
  if (!text || text.length < 3) return null;

  const date =
    cleanText($scope.find('time').attr('datetime')) ||
    cleanText($scope.find('time').attr('title')) ||
    cleanText($scope.find('time').text()) ||
    cleanText($row.find('.contentRow-minor time').text()) ||
    null;

  return {
    alertId,
    text,
    url,
    avatarUrl,
    username: username && username.length > 2 ? username : null,
    date,
    isUnread,
  };
}

function detectHasMorePages(html: string, currentPage: number): boolean {
  const $ = cheerio.load(html);
  const nextLink = $('.pageNav-page--later, .pageNav-jump--next, a[rel="next"]');
  if (nextLink.length > 0) return true;
  const lastPage = $('.pageNav-page:last-child a').text().trim();
  const lastNum = parseInt(lastPage, 10);
  return Number.isFinite(lastNum) && lastNum > currentPage;
}

function cleanText(s: string | null | undefined): string {
  if (!s) return '';
  return s.replace(/\s+/g, ' ').trim();
}

function absoluteUrl(href: string | null): string | null {
  if (!href) return null;
  if (href.startsWith('http://') || href.startsWith('https://')) return href;
  if (href.startsWith('//')) return `https:${href}`;
  if (href.startsWith('/')) return `${BASE}${href}`;
  return `${BASE}/${href}`;
}
