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
  return m2 ? m2[1] : null;
}

/** Post id from `/posts/{id}`, `#post-{id}`, or `/post-{id}` in a final/redirect URL. */
export function extractPostIdFromFinal(url: string): string | null {
  const posts = url.match(/\/posts\/(\d+)/);
  if (posts) return posts[1];
  const anchor = url.match(/(?:#post-|\/post-)(\d+)/i);
  return anchor ? anchor[1] : null;
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
    const body = $el.find('.message-body .bbWrapper').first();
    if (body.length === 0) continue;
    const htmlBody = normalizeOpHtml($, body, new Set());
    const permalink =
      absUrl($el.find(`a[href*="/posts/${postId}"]`).first().attr('href')) ??
      `${F95_BASE}/posts/${postId}/`;
    posts.push({
      postId,
      author,
      authorAvatarUrl: avatar,
      postedAt,
      html: htmlBody,
      permalink,
    });
  }

  const pageNums = $('.pageNav-page a, .pageNav-page')
    .toArray()
    .map((el) => parseInt($(el).text().trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0);
  const totalPages = pageNums.length ? Math.max(...pageNums) : null;
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
