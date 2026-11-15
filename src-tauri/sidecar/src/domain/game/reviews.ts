import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import { F95_BASE } from '../../shared/constants';
import { detectTotalPages } from './posts';

export type ReviewSort =
  | 'latest'
  | 'helpful'
  | 'newest'
  | 'oldest'
  | 'highest'
  | 'lowest';

export type ThreadReviewsQuery = {
  page?: number;
  sort?: ReviewSort;
  stars?: 1 | 2 | 3 | 4 | 5;
  mention?: string;
  version?: string;
  recent?: boolean;
};

export type ReviewStats = {
  average: number | null;
  count: number | null;
  countLabel: string | null;
  starBars: { stars: number; count: number; percent: number }[];
  parts: { label: string; average: number; countHint: string | null }[];
  mentions: { key: string; label: string; count: number }[];
  monthlyAverage: {
    label: string;
    average: number;
    reviewCount: number;
    leftPct: number;
    widthPct: number;
  }[];
  perMonth: {
    label: string;
    positive: number;
    negative: number;
    inBetween: number;
  }[];
};

export type ReviewHighlight = {
  kind: 'positive' | 'critical' | 'other';
  reviewId: string | null;
  page: number | null;
  href: string | null;
  snippetHtml: string;
  author: string | null;
  rating: number | null;
};

export type ReviewVersionOption = {
  id: string | null;
  name: string;
  dateLabel: string | null;
  statLabel: string | null;
  isCurrent: boolean;
  selected: boolean;
};

export type ReviewCard = {
  reviewId: string;
  author: string;
  authorUserId: string | null;
  authorAvatarUrl: string | null;
  rating: number | null;
  platformLabel: string | null;
  postedAt: string | null;
  edited: boolean;
  parts: { label: string; score: number }[];
  bodyHtml: string;
  helpfulYes: number | null;
  helpfulNo: number | null;
  permalink: string | null;
  authorRecordLabel: string | null;
};

export type ThreadReviewsPage = {
  threadId: string;
  page: number;
  totalPages: number | null;
  hasMore: boolean;
  rangeLabel: string | null;
  sort: string;
  filters: {
    stars: number | null;
    mention: string | null;
    version: string | null;
    recent: boolean;
  };
  stats: ReviewStats | null;
  highlights: ReviewHighlight[];
  versions: ReviewVersionOption[];
  reviews: ReviewCard[];
  reviewsUrl: string;
};

function absUrl(href: string | undefined | null): string | null {
  if (!href) return null;
  if (/^https?:\/\//i.test(href)) return href;
  if (href.startsWith('//')) return `https:${href}`;
  if (href.startsWith('/')) return `${F95_BASE}${href}`;
  return null;
}

function parseNumber(raw: string | undefined | null): number | null {
  if (!raw) return null;
  const m = raw.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

function parsePercentFromStyle(style: string | undefined | null): number {
  if (!style) return 0;
  const m = style.match(/width\s*:\s*([\d.]+)\s*%/i);
  if (!m) return 0;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : 0;
}

function parseLeftFromStyle(style: string | undefined | null): number {
  if (!style) return 0;
  const m = style.match(/left\s*:\s*([\d.]+)\s*%/i);
  if (!m) return 0;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : 0;
}

function queryParam(href: string, key: string): string | null {
  try {
    const u = new URL(href, F95_BASE);
    return u.searchParams.get(key);
  } catch {
    const re = new RegExp(`[?&]${key}=([^&#]*)`, 'i');
    const m = href.match(re);
    return m ? decodeURIComponent(m[1]) : null;
  }
}

function sortFromActive(
  $: cheerio.CheerioAPI,
  fallback?: ReviewSort,
): string {
  const $active = $('.f95rv-sortButton.is-active').first();
  if ($active.length) {
    const href = $active.attr('href') ?? '';
    const fromHref = queryParam(href, 'sort');
    if (fromHref) return fromHref;
    const text = $active.text().replace(/\s+/g, ' ').trim().toLowerCase();
    if (text.includes('helpful')) return 'helpful';
    if (text.includes('newest')) return 'newest';
    if (text.includes('oldest')) return 'oldest';
    if (text.includes('highest')) return 'highest';
    if (text.includes('lowest')) return 'lowest';
    if (text.includes('latest')) return 'latest';
  }
  return fallback && fallback !== 'latest' ? fallback : 'latest';
}

export function buildThreadReviewsUrl(
  threadId: string,
  query?: ThreadReviewsQuery,
): string {
  const page = query?.page ?? 1;
  const base =
    page > 1
      ? `${F95_BASE}/threads/${threadId}/reviews/page-${page}`
      : `${F95_BASE}/threads/${threadId}/reviews/`;

  const params = new URLSearchParams();
  if (query?.sort && query.sort !== 'latest') {
    params.set('sort', query.sort);
  }
  if (query?.stars != null) params.set('stars', String(query.stars));
  if (query?.mention) params.set('mention', query.mention);
  if (query?.version) params.set('version', query.version);
  if (query?.recent) params.set('recent', '1');

  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

function parseStats($: cheerio.CheerioAPI): ReviewStats | null {
  const $stats = $('.f95rv-stats').first();
  if ($stats.length === 0) return null;

  const averageText = $stats.find('.f95rv-stats-average').first().text();
  const average = parseNumber(averageText);

  const countLabelRaw = $stats
    .find('.f95rv-stats-count')
    .first()
    .text()
    .replace(/\s+/g, ' ')
    .trim();
  const countLabel = countLabelRaw || null;
  const count = parseNumber(countLabelRaw);

  const starBars: ReviewStats['starBars'] = [];
  $stats.find('.f95rv-stats-dist .f95rv-bar').each((_, el) => {
    const $bar = $(el);
    if ($bar.hasClass('f95rv-bar--part')) return;
    const label = $bar.find('.f95rv-bar-label').first().text().trim();
    const stars = parseNumber(label);
    if (stars == null) return;
    const countVal = parseNumber($bar.find('.f95rv-bar-value').first().text()) ?? 0;
    const percent = parsePercentFromStyle(
      $bar.find('.f95rv-bar-fill').first().attr('style'),
    );
    starBars.push({ stars, count: countVal, percent });
  });

  const parts: ReviewStats['parts'] = [];
  $stats.find('.f95rv-bar--part').each((_, el) => {
    const $bar = $(el);
    const label = $bar.find('.f95rv-bar-label').first().text().replace(/\s+/g, ' ').trim();
    const avg = parseNumber($bar.find('.f95rv-bar-value').first().text());
    if (!label || avg == null) return;
    const hint = $bar.attr('title')?.trim() || null;
    parts.push({ label, average: avg, countHint: hint });
  });

  const mentions: ReviewStats['mentions'] = [];
  $stats.find('a.f95rv-pill[href*="mention="]').each((_, el) => {
    const $pill = $(el);
    const href = $pill.attr('href') ?? '';
    const key = queryParam(href, 'mention');
    if (!key) return;
    const countEl = $pill.find('.f95rv-pill-count').first();
    const countVal = parseNumber(countEl.text()) ?? 0;
    const label = $pill
      .clone()
      .children()
      .remove()
      .end()
      .text()
      .replace(/\s+/g, ' ')
      .trim() || key;
    mentions.push({ key, label, count: countVal });
  });

  const monthlyAverage: ReviewStats['monthlyAverage'] = [];
  $stats.find('.f95rv-chart-col').each((_, el) => {
    const $col = $(el);
    const aria = $col.attr('aria-label') || $col.attr('data-original-title') || '';
    const m = aria.match(
      /^(.+?):\s*([\d.]+)★\s+from\s+(\d+)\s+reviews/i,
    );
    if (!m) return;
    const style = $col.attr('style') ?? '';
    monthlyAverage.push({
      label: m[1].trim(),
      average: Number(m[2]),
      reviewCount: Number(m[3]),
      leftPct: parseLeftFromStyle(style),
      widthPct: parsePercentFromStyle(style),
    });
  });

  const perMonth: ReviewStats['perMonth'] = [];
  $stats.find('.f95rv-pm').each((_, el) => {
    const $pm = $(el);
    const aria = $pm.attr('aria-label') || $pm.attr('data-original-title') || '';
    const m = aria.match(
      /^(.+?):\s*(\d+)\s+positive,\s*(\d+)\s+negative,\s*(\d+)\s+in between/i,
    );
    if (!m) return;
    perMonth.push({
      label: m[1].trim(),
      positive: Number(m[2]),
      negative: Number(m[3]),
      inBetween: Number(m[4]),
    });
  });

  return {
    average,
    count,
    countLabel,
    starBars,
    parts,
    mentions,
    monthlyAverage,
    perMonth,
  };
}

function parseHighlights($: cheerio.CheerioAPI): ReviewHighlight[] {
  const out: ReviewHighlight[] = [];
  $('.f95rv-highlight').each((_, el) => {
    const $el = $(el);
    const cls = $el.attr('class') ?? '';
    let kind: ReviewHighlight['kind'] = 'other';
    if (/\bf95rv-highlight--positive\b/.test(cls)) kind = 'positive';
    else if (/\bf95rv-highlight--critical\b/.test(cls)) kind = 'critical';

    const hrefRaw = $el.attr('href') ?? ($el.is('a') ? null : $el.find('a').first().attr('href'));
    const href = absUrl(hrefRaw);
    const reviewIdMatch = (hrefRaw ?? '').match(/#review-(\d+)/i);
    const pageMatch = (hrefRaw ?? '').match(/\/page-(\d+)/i);
    const ratingAria = $el.find('.f95rv-stars').first().attr('aria-label') ?? '';
    const rating = parseNumber(ratingAria);

    out.push({
      kind,
      reviewId: reviewIdMatch ? reviewIdMatch[1] : null,
      page: pageMatch ? Number(pageMatch[1]) : null,
      href,
      snippetHtml: ($el.find('.f95rv-highlight-text').first().html() ?? '').trim(),
      author:
        $el.find('.f95rv-highlight-name').first().text().replace(/\s+/g, ' ').trim() ||
        null,
      rating,
    });
  });
  return out;
}

function parseVersions($: cheerio.CheerioAPI): ReviewVersionOption[] {
  const out: ReviewVersionOption[] = [];
  $('.f95rv-versionRow').each((_, el) => {
    const $row = $(el);
    const href = $row.attr('href') ?? '';
    const versionId = queryParam(href, 'version');
    const $name = $row.find('.f95rv-versionRow-name').first().clone();
    $name.find('.f95rv-versionRow-current').remove();
    const name = $name.text().replace(/\s+/g, ' ').trim();
    const dateRaw = $row.find('.f95rv-versionRow-date').first().text().replace(/\s+/g, ' ').trim();
    const statRaw = $row.find('.f95rv-versionRow-stat').first().text().replace(/\s+/g, ' ').trim();
    out.push({
      id: versionId,
      name: name || 'All versions',
      dateLabel: dateRaw || null,
      statLabel: statRaw || null,
      isCurrent: $row.find('.f95rv-versionRow-current').length > 0,
      selected: $row.hasClass('is-selected'),
    });
  });
  return out;
}

function parseReviewId($el: cheerio.Cheerio<Element>): string | null {
  const data = $el.attr('data-content');
  if (data) {
    const m = data.match(/review-(\d+)/i);
    if (m) return m[1];
  }
  const id = $el.attr('id') ?? '';
  const m2 = id.match(/review-(\d+)/i);
  if (m2) return m2[1];
  const anchor = $el.find('.u-anchorTarget[id^="review-"]').first().attr('id') ?? '';
  const m3 = anchor.match(/review-(\d+)/i);
  return m3 ? m3[1] : null;
}

function parseCardParts(
  $: cheerio.CheerioAPI,
  $card: cheerio.Cheerio<Element>,
): { label: string; score: number }[] {
  const parts: { label: string; score: number }[] = [];
  $card.find('.f95rv-card-parts > span').each((_, el) => {
    const $span = $(el);
    const strong = $span.find('strong').first();
    const score = parseNumber(strong.text());
    if (score == null) return;
    const label = $span
      .clone()
      .children('strong')
      .remove()
      .end()
      .text()
      .replace(/\s+/g, ' ')
      .trim();
    if (!label) return;
    parts.push({ label, score });
  });
  return parts;
}

function parseReviews($: cheerio.CheerioAPI): ReviewCard[] {
  const out: ReviewCard[] = [];
  $('article.js-f95rvReview, article.f95rv-card').each((_, el) => {
    const $card = $(el);
    const reviewId = parseReviewId($card);
    if (!reviewId) return;

    const author =
      $card.find('.username').first().text().replace(/\s+/g, ' ').trim() ||
      $card.attr('data-author')?.trim() ||
      'Unknown';

    const authorUserId =
      $card.find('[data-user-id]').first().attr('data-user-id')?.trim() || null;

    const $img = $card.find('.avatar img').first();
    const avatarSrc = $img.attr('src') || $img.attr('data-src');
    const authorAvatarUrl = absUrl(avatarSrc);

    const rating = parseNumber($card.find('.f95rv-card-rating').first().text());

    const $platform = $card.find('.f95rv-card-platform').first();
    let platformLabel: string | null = null;
    if ($platform.length) {
      const text = $platform.text().replace(/\s+/g, ' ').trim();
      platformLabel = text || $platform.attr('title')?.trim() || null;
    }

    const postedAt =
      $card.find('time[datetime]').first().attr('datetime')?.trim() || null;
    const edited = $card.find('.f95rv-card-edited').length > 0;

    const $body = $card.find('.f95rv-card-body').first();
    const bodyHtml = ($body.html() ?? '').trim();

    let helpfulYes: number | null = null;
    let helpfulNo: number | null = null;
    $card.find('.f95rv-vote').each((__, voteEl) => {
      const text = $(voteEl).text().replace(/\s+/g, ' ').trim();
      const m = text.match(/^(Yes|No)\s*[·•.\-–—]\s*(\d+)/i);
      if (!m) return;
      const n = Number(m[2]);
      if (!Number.isFinite(n)) return;
      if (/^yes$/i.test(m[1])) helpfulYes = n;
      else helpfulNo = n;
    });

    const permalink = absUrl(
      $card.find('a.f95rv-card-date[href*="thread-reviews"]').first().attr('href'),
    );
    const authorRecordLabel =
      $card.find('.f95rv-record').first().text().replace(/\s+/g, ' ').trim() ||
      null;

    out.push({
      reviewId,
      author,
      authorUserId,
      authorAvatarUrl,
      rating,
      platformLabel,
      postedAt,
      edited,
      parts: parseCardParts($, $card),
      bodyHtml,
      helpfulYes,
      helpfulNo,
      permalink,
      authorRecordLabel,
    });
  });
  return out;
}

export function parseThreadReviewsPage(
  html: string,
  opts: { threadId: string; page: number; query?: ThreadReviewsQuery },
): ThreadReviewsPage {
  const $ = cheerio.load(html);
  const query = opts.query;
  const reviewsUrl = buildThreadReviewsUrl(opts.threadId, {
    ...query,
    page: opts.page,
  });

  const rangeLabel =
    $('.f95rv-sortBar-count').first().text().replace(/\s+/g, ' ').trim() || null;

  const totalPages = detectTotalPages($);
  const hasNextJump = $('.pageNav-jump--next').length > 0;
  const hasMore =
    hasNextJump || (totalPages != null ? opts.page < totalPages : false);

  return {
    threadId: opts.threadId,
    page: opts.page,
    totalPages,
    hasMore,
    rangeLabel,
    sort: sortFromActive($, query?.sort),
    filters: {
      stars: query?.stars ?? null,
      mention: query?.mention ?? null,
      version: query?.version ?? null,
      recent: query?.recent ?? false,
    },
    stats: parseStats($),
    highlights: parseHighlights($),
    versions: parseVersions($),
    reviews: parseReviews($),
    reviewsUrl,
  };
}
