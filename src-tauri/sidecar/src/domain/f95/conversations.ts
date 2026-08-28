import { BrowserClient } from 'browser-rest-api';
import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import { RPC_ERROR, RpcError } from '../../rpc';
import { log } from '../../logger';
import { assertNotCloudflareChallenge } from '../../shared/cloudflare';
import { F95_BASE } from '../../shared/constants';
import { extractMemberUserIdFromHref } from '../../shared/memberId';
import { normalizeOpHtml } from '../game/htmlNormalize';
import { parseMessageAttachments, type PostAttachment } from '../game/postAttachments';
import { detectTotalPages } from '../game/posts';
import {
  buildConversationBbcodePreviewForm,
  buildConversationReplyForm,
  parseConversationReplyResponse,
  type ConversationReplyResult,
} from './conversationReply';
import { parseBbcodePreviewResponse, type BbcodePreviewResult } from '../game/bbcodePreview';

const BASE = F95_BASE;
const CONVERSATIONS_PAGE = `${BASE}/conversations/`;

export interface F95ConversationListItem {
  conversationId: string;
  conversationPath: string;
  title: string;
  url: string;
  starterUsername: string | null;
  starterUserId: string | null;
  recipients: string[];
  lastMessagePreview: string | null;
  lastMessageDate: string | null;
  isUnread: boolean;
  avatarUrl: string | null;
}

export interface F95ConversationsListResult {
  conversations: F95ConversationListItem[];
  hasMore: boolean;
  page: number;
}

export interface ConversationMessage {
  messageId: string;
  author: string;
  authorUserId: string | null;
  authorAvatarUrl: string | null;
  postedAt: string | null;
  html: string;
  attachments: PostAttachment[];
}

export interface F95ConversationDetail {
  conversationId: string;
  conversationPath: string;
  title: string;
  url: string;
  recipients: string[];
  page: number;
  totalPages: number | null;
  hasMore: boolean;
  messages: ConversationMessage[];
}

export type { ConversationReplyResult };
export type { BbcodePreviewResult };

/** Slug.id segment from a conversation URL, e.g. `hello-world.12345`. */
export function extractConversationPathFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/\/conversations\/([^/?#]+?\.\d+)(?:\/|$|\?|#)/i);
  return m ? decodeURIComponent(m[1]!) : null;
}

export function extractConversationIdFromPath(conversationPath: string): string {
  const m = conversationPath.match(/\.(\d+)$/);
  return m ? m[1]! : conversationPath.replace(/\D/g, '') || conversationPath;
}

function cleanText(s: string | null | undefined): string {
  if (!s) return '';
  return s.replace(/\s+/g, ' ').trim();
}

function absoluteUrl(href: string | null | undefined): string | null {
  if (!href) return null;
  if (href.startsWith('http://') || href.startsWith('https://')) return href;
  if (href.startsWith('//')) return `https:${href}`;
  if (href.startsWith('/')) return `${BASE}${href}`;
  return `${BASE}/${href}`;
}

function conversationPageUrl(conversationPath: string, page: number): string {
  const path = conversationPath.trim().replace(/^\/+|\/+$/g, '');
  if (page <= 1) return `${BASE}/conversations/${path}/`;
  return `${BASE}/conversations/${path}/page-${page}`;
}

function detectHasMorePages(html: string, currentPage: number): boolean {
  const $ = cheerio.load(html);
  if ($('.pageNav-page--later, .pageNav-jump--next, a[rel="next"]').length > 0) {
    return true;
  }
  const lastPage = $('.pageNav-page:last-child a').text().trim();
  const lastNum = parseInt(lastPage, 10);
  return Number.isFinite(lastNum) && lastNum > currentPage;
}

/** @internal Exported for unit tests. */
export function parseConversationsListHtml(html: string): F95ConversationListItem[] {
  if (!html.trim()) return [];
  const $ = cheerio.load(html);
  const items: F95ConversationListItem[] = [];
  const seen = new Set<string>();

  const rowSelectors = [
    '.structItem--conversation',
    '.block-row--conversation',
    'li[data-conversation-id]',
  ];

  for (const sel of rowSelectors) {
    $(sel).each((idx, el) => {
      const parsed = parseConversationListRow($, $(el), idx);
      if (!parsed || seen.has(parsed.conversationId)) return;
      seen.add(parsed.conversationId);
      items.push(parsed);
    });
    if (items.length > 0) break;
  }

  if (items.length === 0) {
    $('a[href*="/conversations/"]').each((idx, el) => {
      const href = $(el).attr('href') ?? '';
      const conversationPath = extractConversationPathFromUrl(href);
      if (!conversationPath || seen.has(conversationPath)) return;
      const title = cleanText($(el).text());
      if (!title || title.length < 2) return;
      const conversationId = extractConversationIdFromPath(conversationPath);
      seen.add(conversationId);
      items.push({
        conversationId,
        conversationPath,
        title,
        url: absoluteUrl(href) ?? `${BASE}/conversations/${conversationPath}/`,
        starterUsername: null,
        starterUserId: null,
        recipients: [],
        lastMessagePreview: null,
        lastMessageDate: null,
        isUnread: false,
        avatarUrl: null,
      });
    });
  }

  return items;
}

function parseConversationListRow(
  $: cheerio.CheerioAPI,
  $row: cheerio.Cheerio<any>,
  fallbackIdx: number,
): F95ConversationListItem | null {
  const dataId = $row.attr('data-conversation-id');
  const $titleLink = $row
    .find('.structItem-title a[href*="/conversations/"], a[href*="/conversations/"]')
    .first();
  const href = $titleLink.attr('href') ?? '';
  const conversationPath =
    extractConversationPathFromUrl(href) ??
    (dataId ? `conversation.${dataId}` : null);
  if (!conversationPath) return null;

  const conversationId =
    dataId ?? extractConversationIdFromPath(conversationPath) ?? `conv-${fallbackIdx}`;
  const title =
    cleanText($titleLink.text()) ||
    cleanText($row.find('.structItem-title').text()) ||
    cleanText($row.attr('data-title'));
  if (!title) return null;

  const isUnread =
    $row.hasClass('structItem--unread') ||
    $row.hasClass('is-unread') ||
    $row.find('.structItem--unread, .is-unread').length > 0;

  const $avatar = $row.find('img.avatar, .avatar img, .structItem-iconCell img').first();
  const avatarUrl = absoluteUrl($avatar.attr('data-src') ?? $avatar.attr('src') ?? null);

  const $userLink = $row.find('a[href*="/members/"]').first();
  const starterUsername = cleanText($userLink.text()) || null;
  const starterUserId =
    extractMemberUserIdFromHref($userLink.attr('href')) ??
    ($userLink.attr('data-user-id')?.match(/^\d+$/) ? $userLink.attr('data-user-id')! : null);

  const recipients: string[] = [];
  $row.find('.structItem-parts li, .structItem-minor li').each((_, part) => {
    const name = cleanText($(part).text());
    if (name && !recipients.includes(name)) recipients.push(name);
  });

  const $latest = $row.find('.structItem-cell--latest, .structItem-latest').first();
  const lastMessagePreview =
    cleanText($latest.find('a').first().text()) ||
    cleanText($row.find('.structItem-snippet').text()) ||
    null;
  const lastMessageDate =
    cleanText($latest.find('time').attr('datetime')) ||
    cleanText($latest.find('time').attr('title')) ||
    cleanText($latest.find('time').text()) ||
    cleanText($row.find('time').first().attr('datetime')) ||
    cleanText($row.find('time').first().text()) ||
    null;

  return {
    conversationId,
    conversationPath,
    title,
    url: absoluteUrl(href) ?? `${BASE}/conversations/${conversationPath}/`,
    starterUsername,
    starterUserId,
    recipients,
    lastMessagePreview,
    lastMessageDate,
    isUnread,
    avatarUrl,
  };
}

function detectConversationTotalPages($: cheerio.CheerioAPI): number | null {
  const $nav = $('.block--messages .pageNav, .block-body .pageNav').first();
  if ($nav.length === 0) return detectTotalPages($);

  const nums: number[] = [];
  const pushPage = (raw: string | undefined) => {
    if (!raw) return;
    const n = parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) nums.push(n);
  };
  const pushFromHref = (href: string) => {
    const path = href.match(/\/page-(\d+)/i);
    const query = href.match(/[?&]page=(\d+)/i);
    if (path) pushPage(path[1]);
    if (query) pushPage(query[1]);
  };

  $nav.find('.pageNav-page a, .pageNav-page').each((_, el) => {
    pushPage($(el).text().trim());
  });
  $nav.find('a.pageNav-jump[href], .pageNav-main a[href]').each((_, el) => {
    pushFromHref($(el).attr('href') ?? '');
  });
  const navText = $nav.text();
  const ofMatch =
    navText.match(/\bof\s+(\d+)\b/i) ||
    navText.match(/\bde\s+(\d+)\b/i) ||
    navText.match(/\bvon\s+(\d+)\b/i) ||
    navText.match(/\bиз\s+(\d+)\b/i);
  if (ofMatch) pushPage(ofMatch[1]);
  return nums.length ? Math.max(...nums) : null;
}

function conversationMessageNodes($: cheerio.CheerioAPI): Element[] {
  const scoped = $(
    '.block--messages article.message, .block-body article.message--conversationMessage, article.message--conversationMessage',
  );
  if (scoped.length > 0) {
    return scoped.toArray();
  }
  return $('article.message, article.message--conversationMessage').toArray();
}

function parseMessageId($el: cheerio.Cheerio<any>, fallbackIdx: number): string {
  const dataContent = $el.attr('data-content');
  if (dataContent) {
    const m = dataContent.match(/(\d+)\s*$/);
    if (m) return m[1]!;
  }
  const dataMessageId = $el.attr('data-message-id');
  if (dataMessageId?.match(/^\d+$/)) return dataMessageId;

  const id = $el.attr('id') ?? '';
  const fromId =
    id.match(/(?:message|convMessage|js-message)-(\d+)/i)?.[1] ??
    id.match(/(\d+)\s*$/)?.[1];
  if (fromId) return fromId;

  const href = $el.find('a[href*="/posts/"]').first().attr('href') ?? '';
  const fromHref = href.match(/\/posts\/(\d+)/)?.[1];
  if (fromHref) return fromHref;

  return `msg-${fallbackIdx}`;
}

function extractConversationMessageHtml(
  $: cheerio.CheerioAPI,
  $el: cheerio.Cheerio<any>,
): string | null {
  const $contentRoot = $el.find('.message-content, .message-main').first().clone();
  if ($contentRoot.length) {
    $contentRoot
      .find(
        'header.message-attribution, .message-attribution, .message-minor, .message-editLink, .js-selectToQuoteEnd, .message-actionBar, footer',
      )
      .remove();
    let $bodySource = $contentRoot.find('.bbWrapper').first();
    if ($bodySource.length === 0) {
      $bodySource = $contentRoot.find('article.message-body, .message-body').first();
    }
    if ($bodySource.length > 0) {
      const html = normalizeOpHtml($, $bodySource, new Set()).trim();
      if (html) return html;
      const text = cleanText($bodySource.text());
      if (text) return text;
    }
  }

  const $bodyRoot = $el.find('.message-body').first().clone();
  $bodyRoot.find('.message-signature, aside.message-signature').remove();
  let $bodySource = $bodyRoot.find('.bbWrapper').first();
  if ($bodySource.length === 0 && $bodyRoot.length > 0) {
    $bodySource = $bodyRoot;
  }
  if ($bodySource.length === 0) return null;

  const html = normalizeOpHtml($, $bodySource, new Set()).trim();
  if (html) return html;
  return cleanText($bodySource.text()) || null;
}

function parseMessageAuthorUserId(
  $: cheerio.CheerioAPI,
  $el: cheerio.Cheerio<any>,
): string | null {
  const $link = $el.find('.message-name a[href*="/members/"], a.username[href*="/members/"]').first();
  return (
    extractMemberUserIdFromHref($link.attr('href')) ??
    ($link.attr('data-user-id')?.match(/^\d+$/) ? $link.attr('data-user-id')! : null)
  );
}

/** @internal Exported for unit tests. */
export function parseConversationDetailHtml(
  html: string,
  opts: { conversationPath: string; page: number },
): F95ConversationDetail {
  const $ = cheerio.load(html);
  const conversationPath = opts.conversationPath.trim().replace(/^\/+|\/+$/g, '');
  const conversationId = extractConversationIdFromPath(conversationPath);

  const title =
    cleanText($('.p-title-value').first().text()) ||
    cleanText($('h1').first().text()) ||
    cleanText($('.block-title').first().text()) ||
    'Conversation';

  const recipients: string[] = [];
  $('.block-row--separated a[href*="/members/"], .pairs dd a[href*="/members/"]').each(
    (_, el) => {
      const name = cleanText($(el).text());
      if (name && !recipients.includes(name)) recipients.push(name);
    },
  );

  const messages: ConversationMessage[] = [];
  conversationMessageNodes($).forEach((node, idx) => {
    const $el = $(node);
    const messageId = parseMessageId($el, idx);

    const author =
      cleanText($el.find('.message-name').first().text()) ||
      cleanText($el.find('.message-userDetails .username').first().text()) ||
      cleanText($el.attr('data-author')) ||
      'Unknown';
    const avatar =
      absoluteUrl($el.find('.message-avatar img, .avatar img').first().attr('src')) ??
      absoluteUrl($el.find('.message-avatar img, .avatar img').first().attr('data-src'));
    const postedAt =
      $el.find('time.u-dt, time').first().attr('datetime')?.trim() ||
      cleanText($el.find('time.u-dt, time').first().attr('title')) ||
      cleanText($el.find('header.message-attribution time').first().attr('datetime')) ||
      cleanText($el.find('header.message-attribution time').first().text()) ||
      null;

    const htmlBody = extractConversationMessageHtml($, $el);
    if (!htmlBody) return;

    messages.push({
      messageId,
      author,
      authorUserId: parseMessageAuthorUserId($, $el),
      authorAvatarUrl: avatar,
      postedAt,
      html: htmlBody,
      attachments: parseMessageAttachments($, $el),
    });
  });

  const totalPages = detectConversationTotalPages($);
  const hasNextJump = $('.pageNav-jump--next').length > 0;
  const hasMore = hasNextJump || (totalPages != null && opts.page < totalPages);

  return {
    conversationId,
    conversationPath,
    title,
    url: conversationPageUrl(conversationPath, opts.page),
    recipients,
    page: opts.page,
    totalPages,
    hasMore,
    messages,
  };
}

export async function fetchConversationsList(
  http: BrowserClient,
  page = 1,
): Promise<F95ConversationsListResult> {
  const url = page > 1 ? `${CONVERSATIONS_PAGE}?page=${page}` : CONVERSATIONS_PAGE;
  log(`[conversations] GET ${url}`);
  const res = await http.get(url, {
    headers: { accept: 'text/html', referer: `${BASE}/` },
  });
  assertNotCloudflareChallenge(res.body, res.headers);
  if (res.url.includes('/login')) {
    throw new RpcError(RPC_ERROR.NOT_INITIALIZED, 'not logged in');
  }
  if (res.status >= 400) {
    throw new RpcError(RPC_ERROR.INTERNAL, `conversations list HTTP ${res.status}`);
  }

  const conversations = parseConversationsListHtml(res.body);
  const hasMore = detectHasMorePages(res.body, page);
  return { conversations, hasMore, page };
}

export async function fetchConversationDetail(
  http: BrowserClient,
  conversationPath: string,
  page = 1,
): Promise<F95ConversationDetail> {
  const path = conversationPath.trim().replace(/^\/+|\/+$/g, '');
  if (!path) {
    throw new RpcError(RPC_ERROR.INVALID_PARAMS, 'conversationPath required');
  }
  const url = conversationPageUrl(path, page);
  log(`[conversations] GET ${url}`);
  const res = await http.get(url, {
    headers: { accept: 'text/html', referer: CONVERSATIONS_PAGE },
  });
  assertNotCloudflareChallenge(res.body, res.headers);
  if (res.url.includes('/login')) {
    throw new RpcError(RPC_ERROR.NOT_INITIALIZED, 'not logged in');
  }
  if (res.status >= 400) {
    throw new RpcError(RPC_ERROR.INTERNAL, `conversation detail HTTP ${res.status}`);
  }

  const resolvedPath = extractConversationPathFromUrl(res.url) ?? path;
  const parsed = parseConversationDetailHtml(res.body, { conversationPath: resolvedPath, page });

  if (page === 1 && parsed.totalPages && parsed.totalPages > 1) {
    const lastUrl = conversationPageUrl(resolvedPath, parsed.totalPages);
    log(`[conversations] GET ${lastUrl} (latest page)`);
    const lastRes = await http.get(lastUrl, {
      headers: { accept: 'text/html', referer: CONVERSATIONS_PAGE },
    });
    assertNotCloudflareChallenge(lastRes.body, lastRes.headers);
    if (!lastRes.url.includes('/login') && lastRes.status < 400) {
      const lastPath = extractConversationPathFromUrl(lastRes.url) ?? resolvedPath;
      const lastParsed = parseConversationDetailHtml(lastRes.body, {
        conversationPath: lastPath,
        page: parsed.totalPages,
      });
      if (lastParsed.messages.length > 0) return lastParsed;
    }
  }

  return parsed;
}

export async function sendConversationReply(
  http: BrowserClient,
  conversationPath: string,
  message: string,
): Promise<ConversationReplyResult> {
  const path = conversationPath.trim().replace(/^\/+|\/+$/g, '');
  const text = String(message).trim();
  if (!path) {
    throw new RpcError(RPC_ERROR.INVALID_PARAMS, 'conversationPath required');
  }
  if (!text) {
    throw new RpcError(RPC_ERROR.INVALID_PARAMS, 'message required');
  }

  const detailUrl = conversationPageUrl(path, 1);
  log(`[conversations] GET ${detailUrl} (reply token)`);
  const pageRes = await http.get(detailUrl, {
    headers: { accept: 'text/html', referer: CONVERSATIONS_PAGE },
  });
  assertNotCloudflareChallenge(pageRes.body, pageRes.headers);
  if (pageRes.url.includes('/login')) {
    throw new RpcError(RPC_ERROR.NOT_INITIALIZED, 'not logged in');
  }
  if (pageRes.status >= 400) {
    throw new RpcError(RPC_ERROR.INTERNAL, `conversation reply prep HTTP ${pageRes.status}`);
  }

  const $ = cheerio.load(pageRes.body);
  const xfToken =
    $('input[name="_xfToken"]').first().attr('value') ??
    $('html').attr('data-csrf') ??
    null;
  if (!xfToken) {
    throw new RpcError(RPC_ERROR.INTERNAL, 'could not extract _xfToken for conversation reply');
  }

  const resolvedPath = extractConversationPathFromUrl(pageRes.url) ?? path;
  const requestUri = `/conversations/${resolvedPath}/`;
  const form = buildConversationReplyForm({
    conversationPath: resolvedPath,
    message: text,
    xfToken,
    requestUri,
  });
  log(`[conversations] POST ${form.url}`);
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
      parseConversationReplyResponse({
        conversationPath: resolvedPath,
        body: typeof res.body === 'string' ? res.body : '',
        finalUrl: res.url,
      });
    } catch (err) {
      if (err instanceof RpcError) throw err;
    }
    throw new RpcError(RPC_ERROR.INTERNAL, `conversation reply HTTP ${res.status}`);
  }
  return parseConversationReplyResponse({
    conversationPath: resolvedPath,
    body: typeof res.body === 'string' ? res.body : '',
    finalUrl: res.url,
  });
}

export async function previewConversationBbcode(
  http: BrowserClient,
  conversationPath: string,
  bbCode: string,
): Promise<BbcodePreviewResult> {
  const path = conversationPath.trim().replace(/^\/+|\/+$/g, '');
  const text = String(bbCode ?? '');
  if (!path) {
    throw new RpcError(RPC_ERROR.INVALID_PARAMS, 'conversationPath required');
  }
  if (!text.trim()) {
    return { html: '' };
  }

  const detailUrl = conversationPageUrl(path, 1);
  log(`[conversations] GET ${detailUrl} (bbcode preview token)`);
  const pageRes = await http.get(detailUrl, {
    headers: { accept: 'text/html', referer: CONVERSATIONS_PAGE },
  });
  assertNotCloudflareChallenge(pageRes.body, pageRes.headers);
  if (pageRes.url.includes('/login')) {
    throw new RpcError(RPC_ERROR.NOT_INITIALIZED, 'not logged in');
  }
  if (pageRes.status >= 400) {
    throw new RpcError(RPC_ERROR.INTERNAL, `conversation preview prep HTTP ${pageRes.status}`);
  }

  const $ = cheerio.load(pageRes.body);
  const xfToken =
    $('input[name="_xfToken"]').first().attr('value') ??
    $('html').attr('data-csrf') ??
    null;
  if (!xfToken) {
    throw new RpcError(RPC_ERROR.INTERNAL, 'could not extract _xfToken for conversation preview');
  }

  const resolvedPath = extractConversationPathFromUrl(pageRes.url) ?? path;
  const requestUri = `/conversations/${resolvedPath}/`;
  const form = buildConversationBbcodePreviewForm({
    conversationPath: resolvedPath,
    bbCode: text,
    xfToken,
    requestUri,
  });
  log(`[conversations] POST ${form.url}`);
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
      parseBbcodePreviewResponse(typeof res.body === 'string' ? res.body : '');
    } catch (err) {
      if (err instanceof RpcError) throw err;
    }
    throw new RpcError(RPC_ERROR.INTERNAL, `conversation bbcode preview HTTP ${res.status}`);
  }
  return {
    html: parseBbcodePreviewResponse(typeof res.body === 'string' ? res.body : ''),
  };
}
