import * as cheerio from 'cheerio';
import { F95_BASE } from '../../shared/constants';

export interface WatchedThread {
  threadId: string;
  title: string;
  threadUrl: string;
  forumName: string | null;
  lastActivityAt: string | null;
  isUnreadOnF95: boolean;
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
