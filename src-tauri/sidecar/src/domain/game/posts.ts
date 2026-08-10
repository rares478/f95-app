import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import { F95_BASE } from '../../shared/constants';
import { normalizeOpHtml } from './htmlNormalize';

export interface ThreadPost {
  postId: string;
  author: string;
  authorAvatarUrl: string | null;
  postedAt: string | null;
  html: string;
  /** Normalized XF profile signature HTML, when present. */
  signatureHtml: string | null;
  permalink: string | null;
}

export interface ThreadPostsPage {
  threadId: string;
  page: number;
  totalPages: number | null;
  hasMore: boolean;
  posts: ThreadPost[];
}

function absUrl(href: string | undefined | null): string | null {
  if (!href) return null;
  if (/^https?:\/\//i.test(href)) return href;
  if (href.startsWith('//')) return `https:${href}`;
  if (href.startsWith('/')) return `${F95_BASE}${href}`;
  return null;
}

function parsePostId($el: cheerio.Cheerio<Element>): string | null {
  const data = $el.attr('data-content'); // often "post-123"
  if (data) {
    const m = data.match(/(\d+)/);
    if (m) return m[1];
  }
  const id = $el.attr('id') ?? '';
  const m2 = id.match(/(\d+)/);
  if (m2) return m2[1];
  // Fallback: first permalink-style `/posts/{id}` href inside the message.
  const href = $el.find('a[href*="/posts/"]').first().attr('href') ?? '';
  const m3 = href.match(/\/posts\/(\d+)/);
  return m3 ? m3[1] : null;
}

/** Best-effort last page index from XF pagination chrome only (never post bodies). */
export function detectTotalPages($: cheerio.CheerioAPI): number | null {
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

  $('.pageNav-page a, .pageNav-page').each((_, el) => {
    pushPage($(el).text().trim());
  });
  // Scope href scraping to pageNav / jumps — whole-document `/page-` links
  // (quotes, signatures, sidebars) used to poison Math.max (e.g. 20899).
  $('.pageNav a[href], .pageNav-main a[href], a.pageNav-jump[href]').each(
    (_, el) => {
      pushFromHref($(el).attr('href') ?? '');
    },
  );
  const navText = $('.pageNav').first().text();
  const ofMatch =
    navText.match(/\bof\s+(\d+)\b/i) ||
    navText.match(/\bde\s+(\d+)\b/i) ||
    navText.match(/\bvon\s+(\d+)\b/i) ||
    navText.match(/\bиз\s+(\d+)\b/i);
  if (ofMatch) pushPage(ofMatch[1]);
  return nums.length ? Math.max(...nums) : null;
}

/** Post id from `/posts/{id}`, `#post-{id}`, or `/post-{id}` in a final/redirect URL. */
export function extractPostIdFromFinal(url: string): string | null {
  const posts = url.match(/\/posts\/(\d+)/);
  if (posts) return posts[1];
  const anchor = url.match(/(?:#post-|\/post-)(\d+)/i);
  return anchor ? anchor[1] : null;
}

/** Page number from `/page-N` or `?page=` in a thread URL. */
export function extractThreadPageFromFinal(url: string): number | null {
  const path = url.match(/\/page-(\d+)/i);
  if (path) {
    const n = parseInt(path[1]!, 10);
    return Number.isFinite(n) && n >= 1 ? n : null;
  }
  const query = url.match(/[?&]page=(\d+)/i);
  if (query) {
    const n = parseInt(query[1]!, 10);
    return Number.isFinite(n) && n >= 1 ? n : null;
  }
  return null;
}

/** Current page from XF pagination chrome (when the redirect URL omits `/page-N`). */
export function extractCurrentPageFromHtml(html: string): number | null {
  const $ = cheerio.load(html);
  const read = (raw: string): number | null => {
    const n = parseInt(raw.replace(/\s+/g, ' ').trim(), 10);
    return Number.isFinite(n) && n >= 1 ? n : null;
  };
  const fromCurrent =
    read($('.pageNav-page--current').first().text()) ??
    read($('.pageNav-page--current a').first().text());
  if (fromCurrent != null) return fromCurrent;
  // Single-page threads have messages but no page buttons.
  if ($('article.message').length > 0 && $('.pageNav-page').length === 0) {
    return 1;
  }
  return null;
}

export function parseThreadPostsPage(
  html: string,
  opts: { threadId: string; page: number },
): ThreadPostsPage {
  const $ = cheerio.load(html);
  const articles = $('article.message').toArray();
  const start = opts.page <= 1 ? 1 : 0; // skip OP on page 1
  const posts: ThreadPost[] = [];

  for (const node of articles.slice(start)) {
    const $el = $(node);
    const postId = parsePostId($el);
    if (!postId) continue;
    const author = $el.find('.message-name').first().text().trim() || 'Unknown';
    const avatar =
      absUrl($el.find('.message-avatar img, .avatar img').first().attr('src')) ??
      absUrl($el.find('.message-avatar img, .avatar img').first().attr('data-src'));
    const postedAt =
      $el.find('time.u-dt, time').first().attr('datetime')?.trim() || null;

    // Prefer the body wrapper; strip any nested signature nodes if a theme nests them.
    const $bodyRoot = $el.find('.message-body').first().clone();
    $bodyRoot.find('.message-signature, aside.message-signature').remove();
    const body = $bodyRoot.find('.bbWrapper').first();
    if (body.length === 0) continue;
    const htmlBody = normalizeOpHtml($, body, new Set());

    let signatureHtml: string | null = null;
    const $sig = $el.find('aside.message-signature, .message-signature').first();
    if ($sig.length) {
      const sigBody = $sig.find('.bbWrapper').first();
      const sigSource = sigBody.length ? sigBody : $sig;
      const normalized = normalizeOpHtml($, sigSource, new Set()).trim();
      if (normalized) signatureHtml = normalized;
    }

    const permalink =
      absUrl($el.find(`a[href*="/posts/${postId}"]`).first().attr('href')) ??
      `${F95_BASE}/posts/${postId}/`;
    posts.push({
      postId,
      author,
      authorAvatarUrl: avatar,
      postedAt,
      html: htmlBody,
      signatureHtml,
      permalink,
    });
  }

  const totalPages = detectTotalPages($);
  const hasNextJump = $('.pageNav-jump--next').length > 0;
  const hasMore =
    hasNextJump || (totalPages != null && opts.page < totalPages);

  return {
    threadId: opts.threadId,
    page: opts.page,
    totalPages,
    hasMore,
    posts,
  };
}
