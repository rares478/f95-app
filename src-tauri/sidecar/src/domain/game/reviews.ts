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

export type ReviewScoreLine = {
  key: string;
  label: string;
  score: number | null;
  href: string | null;
  versionId: string | null;
  recent: boolean;
  active: boolean;
};

export type ReviewStats = {
  average: number | null;
  count: number | null;
  countLabel: string | null;
  scoreLines: ReviewScoreLine[];
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
  /** New-version markers on the monthly chart (diamond + dotted line). */
  releases: { leftPct: number; label: string }[];
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

export type ReviewCurrentGroup = {
  kind: string;
  name: string | null;
  line: string | null;
};

export type ReviewOlderFold = {
  versionId: string | null;
  name: string;
  dateLabel: string | null;
  statLabel: string | null;
};

export type ReviewCard = {
  reviewId: string;
  author: string;
  authorUserId: string | null;
  authorAvatarUrl: string | null;
  rating: number | null;
  platformLabel: string | null;
  versionLabel: string | null;
  /** e.g. "No mods" / "With mods" from `.f95rv-card-mods`. */
  modsLabel: string | null;
  /** True when the card marks this review as for an older game version. */
  isOlderVersion: boolean;
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
  currentGroup: ReviewCurrentGroup | null;
  olderFolds: ReviewOlderFold[];
  pendingNote: string | null;
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
      ? `${F95_BASE}/threads/${threadId}/reviews/page-${page}/`
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

/** Parse F95 Reviews range chrome like `1–20 of 63` (en-dash / hyphen / em-dash). */
function parseRangeLabel(
  label: string | null | undefined,
): { start: number; end: number; total: number } | null {
  if (!label) return null;
  const m = label.match(/(\d+)\s*[–—−-]\s*(\d+)\s+of\s+(\d+)/i);
  if (!m) return null;
  const start = Number(m[1]);
  const end = Number(m[2]);
  const total = Number(m[3]);
  if (![start, end, total].every((n) => Number.isFinite(n) && n > 0)) return null;
  if (end < start || total < end) return null;
  return { start, end, total };
}

function totalPagesFromRange(
  range: { start: number; end: number; total: number },
): number {
  const pageSize = Math.max(1, range.end - range.start + 1);
  return Math.ceil(range.total / pageSize);
}

function scoreLineKey(label: string, versionId: string | null, recent: boolean): string {
  if (recent) return 'recent';
  if (versionId) return `version:${versionId}`;
  const slug = label.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  return slug || 'score';
}

function parseScoreLines(
  $: cheerio.CheerioAPI,
  $root: cheerio.Cheerio<Element>,
): ReviewScoreLine[] {
  const out: ReviewScoreLine[] = [];
  $root.find('a.f95rv-scoreLine').each((_, el) => {
    const $line = $(el);
    const hrefRaw = $line.attr('href') ?? '';
    const href = absUrl(hrefRaw);
    const versionId = queryParam(hrefRaw, 'version');
    const recent = queryParam(hrefRaw, 'recent') === '1';
    const label =
      $line.find('span').first().text().replace(/\s+/g, ' ').trim() ||
      $line.attr('title')?.trim() ||
      '';
    const score = parseNumber($line.find('strong').first().text());
    const active =
      $line.attr('aria-pressed') === 'true' || $line.hasClass('is-active');
    if (!label && score == null) return;
    out.push({
      key: scoreLineKey(label, versionId, recent),
      label: label || (recent ? 'Recent' : 'This version'),
      score,
      href,
      versionId,
      recent,
      active,
    });
  });
  return out;
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
  const scoreLines = parseScoreLines($, $stats);

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

  const releases: ReviewStats['releases'] = [];
  $stats.find('.f95rv-chart-release').each((_, el) => {
    const $rel = $(el);
    const left = parseLeftFromStyle($rel.attr('style'));
    if (!Number.isFinite(left)) return;
    const label =
      ($rel.attr('aria-label') || $rel.attr('data-original-title') || '')
        .replace(/\s+/g, ' ')
        .trim() || 'New version';
    releases.push({ leftPct: left, label });
  });
  // Fallback: dotted lines alone (no diamond / tooltip markup).
  if (releases.length === 0) {
    $stats.find('.f95rv-chart-releaseLine').each((_, el) => {
      const left = parseLeftFromStyle($(el).attr('style'));
      if (!Number.isFinite(left)) return;
      releases.push({ leftPct: left, label: 'New version' });
    });
  }

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
    scoreLines,
    starBars,
    parts,
    mentions,
    monthlyAverage,
    releases,
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
  const seen = new Set<string>();
  $('.f95rv-versionRow').each((_, el) => {
    const $row = $(el);
    const href = $row.attr('href') ?? '';
    const versionId = queryParam(href, 'version');
    const $name = $row.find('.f95rv-versionRow-name').first().clone();
    $name.find('.f95rv-versionRow-current').remove();
    const name = $name.text().replace(/\s+/g, ' ').trim();
    const dateRaw = $row.find('.f95rv-versionRow-date').first().text().replace(/\s+/g, ' ').trim();
    const statRaw = $row.find('.f95rv-versionRow-stat').first().text().replace(/\s+/g, ' ').trim();
    const key = versionId ?? `__all__:${name}`;
    if (seen.has(key)) return;
    seen.add(key);
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

function parseCurrentGroup($: cheerio.CheerioAPI): ReviewCurrentGroup | null {
  // Prefer the first "This version" / current group head; skip "Older versions".
  let found: ReviewCurrentGroup | null = null;
  $('.f95rv-groupHead').each((_, el) => {
    if (found) return;
    const $head = $(el);
    const kind = $head
      .find('.f95rv-groupHead-kind')
      .first()
      .text()
      .replace(/\s+/g, ' ')
      .trim();
    if (/older/i.test(kind)) return;
    const name =
      $head.find('.f95rv-groupHead-name').first().text().replace(/\s+/g, ' ').trim() ||
      null;
    const line =
      $head.find('.f95rv-groupHead-line').first().text().replace(/\s+/g, ' ').trim() ||
      null;
    if (!kind && !name) return;
    found = { kind: kind || 'This version', name, line };
  });
  return found;
}

function parseOlderFolds($: cheerio.CheerioAPI): ReviewOlderFold[] {
  const out: ReviewOlderFold[] = [];
  $('.f95rv-foldRow').each((_, el) => {
    const $row = $(el);
    const href = $row.attr('href') ?? '';
    const versionId = queryParam(href, 'version');
    const name =
      $row.find('.f95rv-foldRow-name').first().text().replace(/\s+/g, ' ').trim() ||
      'Version';
    const dateLabel =
      $row.find('.f95rv-foldRow-date').first().text().replace(/\s+/g, ' ').trim() ||
      null;
    const statLabel =
      $row.find('.f95rv-foldRow-stat').first().text().replace(/\s+/g, ' ').trim() ||
      null;
    out.push({ versionId, name, dateLabel, statLabel });
  });
  return out;
}

function parsePendingNote($: cheerio.CheerioAPI): string | null {
  const $note = $('.f95rv-pending').first();
  if (!$note.length) return null;
  const text = $note
    .clone()
    .children('i, svg')
    .remove()
    .end()
    .text()
    .replace(/\s+/g, ' ')
    .trim();
  return text || null;
}

function parseRangeLabelText($: cheerio.CheerioAPI): string | null {
  const $count = $('.f95rv-sortBar-count').first();
  if (!$count.length) return null;
  const spanText = $count
    .children('span')
    .first()
    .text()
    .replace(/\s+/g, ' ')
    .trim();
  if (spanText) return spanText;
  const clone = $count.clone();
  clone.find('a').remove();
  return clone.text().replace(/\s+/g, ' ').trim() || null;
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

    const versionLabel =
      $card.find('.f95rv-versionPill').first().text().replace(/\s+/g, ' ').trim() ||
      null;

    const $mods = $card.find('.f95rv-card-mods').first();
    let modsLabel: string | null = null;
    if ($mods.length) {
      const text = $mods.text().replace(/\s+/g, ' ').trim();
      modsLabel = text || $mods.attr('title')?.trim() || null;
    }

    const $meta = $card.find('.f95rv-card-meta').first();
    const metaText = $meta.text().replace(/\s+/g, ' ');
    const isOlderVersion =
      $meta.find('.f95rv-olderVersion, .f95rv-card-older').length > 0 ||
      /\bolder version\b/i.test(metaText);

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
      versionLabel,
      modsLabel,
      isOlderVersion,
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

  const rangeLabel = parseRangeLabelText($);
  const range = parseRangeLabel(rangeLabel);

  // Prefer XF pageNav when present; F95 Reviews often omit it and only show
  // `.f95rv-sortBar-count` (`1–20 of 63`). Latest view may only show
  // `862 reviews` with older-version folds instead of classic paging.
  let totalPages = detectTotalPages($);
  if (totalPages == null && range) {
    totalPages = totalPagesFromRange(range);
  }
  const hasNextJump = $('.pageNav-jump--next').length > 0;
  const hasMore =
    hasNextJump ||
    (totalPages != null ? opts.page < totalPages : false) ||
    (range != null && range.end < range.total);

  const versions = parseVersions($);
  const olderFolds = parseOlderFolds($);
  // Ensure fold-only versions (e.g. version=none) appear in the selector.
  const versionIds = new Set(versions.map((v) => v.id).filter(Boolean));
  for (const fold of olderFolds) {
    if (!fold.versionId || versionIds.has(fold.versionId)) continue;
    versionIds.add(fold.versionId);
    versions.push({
      id: fold.versionId,
      name: fold.name,
      dateLabel: fold.dateLabel,
      statLabel: fold.statLabel,
      isCurrent: false,
      selected: query?.version === fold.versionId,
    });
  }

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
    versions,
    currentGroup: parseCurrentGroup($),
    olderFolds,
    pendingNote: parsePendingNote($),
    reviews: parseReviews($),
    reviewsUrl,
  };
}
