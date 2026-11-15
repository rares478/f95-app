import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import {
  parseDownloadBlock,
  type GameDownload,
} from './downloadBlock';
import { absoluteUrl, cleanText, normalizeOpHtml } from './htmlNormalize';
import type { PostAttachment } from './postAttachments';

export type GameDetailLayout = 'classic' | 'gamePage';

export type GamePageWhatsNew = {
  title: string;
  items: string[];
  historyHref: string | null;
};

export type GamePageFold = {
  title: string;
  html: string;
};

export type GamePageTagGroup = {
  key: string;
  title: string;
  tags: GameTag[];
};

export type GamePageStats = {
  likesLabel: string | null;
  likesTitle: string | null;
  viewsLabel: string | null;
  viewsTitle: string | null;
  repliesLabel: string | null;
  repliesTitle: string | null;
};

export type GamePagePayload = {
  whatsNew: GamePageWhatsNew | null;
  folds: GamePageFold[];
  tagGroups: GamePageTagGroup[];
  stats: GamePageStats | null;
  coverPositionY: string | null;
};

export interface GamePrefix {
  name: string;
  cssClass: string | null;
}

export interface GameTag {
  slug: string;
  name: string;
}

export interface SocialLink {
  host: string;
  url: string;
  text: string;
}

/** Sidecar GameDetail shape for f95gp parses (mirrors client GameDetail). */
export interface GameDetail {
  threadId: string;
  threadUrl: string;
  title: string;
  rawTitle: string;
  version: string | null;
  developer: string | null;
  author: string | null;
  authorUserId: string | null;
  authorAvatarUrl: string | null;
  bannerUrl: string | null;
  screenshots: string[];
  descriptionHtml: string;
  changelogHtml: string | null;
  prefixes: GamePrefix[];
  fields: Record<string, string>;
  tags: GameTag[];
  rating: number | null;
  downloads: GameDownload[];
  social: SocialLink[];
  attachments: PostAttachment[];
  layout: GameDetailLayout;
  gamePage?: GamePagePayload | null;
}

/** Same regex as client.extractThreadId — local copy to avoid circular imports. */
function extractThreadId(url: string): string | null {
  const m = url.match(/\/threads\/(?:[^/]*?\.)?(\d+)\/?/);
  return m ? m[1] : null;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function isF95GamePageHtml(html: string): boolean {
  if (/data-template\s*=\s*["']f95gp_game["']/i.test(html)) return true;
  if (/class\s*=\s*["'][^"']*\bf95gp-page\b/i.test(html)) return true;
  // Classic threads never mention f95gp — skip expensive cheerio parse.
  if (!/f95gp/i.test(html)) return false;
  // Cheerio fallback for oddly quoted / late attributes
  const $ = cheerio.load(html);
  if ($('[data-template="f95gp_game"]').length > 0) return true;
  if ($('.f95gp-page').length > 0) return true;
  return false;
}

/** Append `/game-history` to a thread URL (with or without trailing slash). */
export function buildGameHistoryUrl(threadUrl: string): string {
  // https://f95zone.to/threads/68105/ → .../threads/68105/game-history
  // https://f95zone.to/threads/slug.68105/ → .../game-history
  const base = threadUrl.replace(/\/?$/, '/');
  return `${base}game-history`;
}

export type GameHistoryRow = {
  version: string;
  date: string | null;
  lines: string[];
};

function escapeChangelogHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Parse f95gp `/game-history` rows into structured changelog entries. */
export function parseGameHistoryHtml(html: string): GameHistoryRow[] {
  const $ = cheerio.load(html);
  const rows: GameHistoryRow[] = [];
  $('details.f95gp-vrow').each((_, el) => {
    const $el = $(el);
    const version = cleanText($el.find('.f95gp-vrow-name').first().text());
    if (!version) return;
    const datetime =
      cleanText($el.find('.f95gp-vrow-date time').first().attr('datetime') ?? '') ||
      null;
    const date = datetime ? datetime.slice(0, 10) : null;
    const lines: string[] = [];
    $el.find('.f95gp-vrow-lines li').each((__, li) => {
      const text = cleanText($(li).text());
      if (text) lines.push(text);
    });
    rows.push({ version, date, lines });
  });
  return rows;
}

/** Build frontend-parseable changelogHtml from history rows. */
export function synthesizeChangelogHtml(rows: GameHistoryRow[]): string {
  return rows
    .map((row) => {
      const lis = row.lines
        .map((line) => `<li>${escapeChangelogHtml(line)}</li>`)
        .join('');
      return `<b>${escapeChangelogHtml(row.version)}</b><br><ul>${lis}</ul>`;
    })
    .join('');
}

export function parseGamePage(html: string, finalUrl: string): GameDetail {
  const $ = cheerio.load(html);
  const threadId =
    extractThreadId(finalUrl) ??
    extractThreadId(
      $('link[rel="canonical"]').attr('href') ??
        $('meta[property="og:url"]').attr('content') ??
        '',
    );
  if (!threadId) {
    throw new Error(`cannot extract thread id from ${finalUrl}`);
  }

  const titleNode = $('.f95gp-title').first();
  const titleClone = titleNode.clone();
  titleClone.find('.f95gp-version').remove();
  const title = cleanText(titleClone.text()) || cleanText(titleNode.text());
  const version =
    cleanText(titleNode.find('.f95gp-version').first().text()) || null;
  const rawTitle = cleanText(titleNode.text()) || title;

  const prefixes: GamePrefix[] = [];
  $('.f95gp-prefixes .label')
    .not('.label-append')
    .each((_, el) => {
      const $el = $(el);
      const name = cleanText($el.text());
      if (!name) return;
      prefixes.push({
        name,
        cssClass: $el.attr('class') ?? null,
      });
    });

  const fields = collectFacts($);
  const developerFromMeta = cleanText($('.f95gp-meta-dev').first().text()) || null;
  const developer =
    nonEmpty(fields['Developer']) ?? developerFromMeta ?? null;
  const author = developer;

  const { bannerUrl, coverPositionY } = parseHeroCover($);
  const rating = parseGamePageRating($);
  const descriptionHtml = parsePlotHtml($);
  const screenshots = collectScreenshots($);
  const tags = collectGamePageTags($);
  const downloads = collectDownloads($);
  const whatsNew = parseWhatsNew($);
  const folds = parseFolds($);
  const tagGroups = parseTagGroups($);
  const stats = parseStats($);

  return {
    threadId,
    threadUrl: finalUrl,
    title,
    rawTitle,
    version: version ?? nonEmpty(fields['Version']) ?? null,
    developer,
    author,
    authorUserId: null,
    authorAvatarUrl: null,
    bannerUrl,
    screenshots,
    descriptionHtml,
    changelogHtml: null,
    prefixes,
    fields,
    tags,
    rating,
    downloads,
    social: [],
    attachments: [],
    layout: 'gamePage',
    gamePage: {
      whatsNew,
      folds,
      tagGroups,
      stats,
      coverPositionY,
    },
  };
}

function nonEmpty(v: string | undefined | null): string | null {
  if (!v) return null;
  const t = v.trim();
  return t.length ? t : null;
}

function parseHeroCover($: cheerio.CheerioAPI): {
  bannerUrl: string | null;
  coverPositionY: string | null;
} {
  const style = $('.f95gp-hero').first().attr('style') ?? '';
  const coverMatch = style.match(
    /--f95gp-cover\s*:\s*url\(\s*['"]?([^'")]+)['"]?\s*\)/i,
  );
  const yMatch = style.match(/--f95gp-cover-y\s*:\s*([^;]+)/i);
  const bannerUrl = coverMatch ? absoluteUrl(coverMatch[1].trim()) : null;
  const coverPositionY = yMatch ? cleanText(yMatch[1]) || null : null;
  return { bannerUrl, coverPositionY };
}

function parseGamePageRating($: cheerio.CheerioAPI): number | null {
  const ring = cleanText($('.f95rv-banner-ringValue').first().text());
  if (ring) {
    const n = Number.parseFloat(ring);
    if (Number.isFinite(n) && n > 0) return n;
  }

  const labels = [
    $('.f95rv-banner-ring').attr('aria-label'),
    $('.f95rv-stars').attr('aria-label'),
    $('.f95gp-score').attr('aria-label'),
  ];
  for (const label of labels) {
    if (!label) continue;
    const m = label.match(/([\d.]+)\s*(?:out of\s*5|stars?)/i);
    if (m) {
      const n = Number.parseFloat(m[1]);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return null;
}

function parsePlotHtml($: cheerio.CheerioAPI): string {
  const plot = $('.f95gp-section .f95gp-text').first();
  if (!plot.length) return '';
  return normalizeOpHtml($, plot as cheerio.Cheerio<Element>);
}

function collectScreenshots($: cheerio.CheerioAPI): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  $('.f95gp-slide img').each((_, el) => {
    const $el = $(el);
    if ($el.closest('.messageHide').length) return;
    const raw =
      $el.attr('data-src') || $el.attr('src') || $el.attr('data-original');
    if (!raw || raw.startsWith('data:')) return;
    if (/blank\.(gif|png)|placeholder/i.test(raw)) return;
    const full = absoluteUrl(raw).replace(/\/thumb\/(?=[^/]+$)/, '/');
    if (seen.has(full)) return;
    seen.add(full);
    out.push(full);
  });
  return out;
}

function collectFacts($: cheerio.CheerioAPI): Record<string, string> {
  const fields: Record<string, string> = {};
  $('dl.f95gp-facts').each((_, dl) => {
    const $dl = $(dl);
    $dl.children('dt').each((_, dt) => {
      const $dt = $(dt);
      const label = cleanText($dt.text());
      if (!label) return;
      const $dd = $dt.next('dd');
      if (!$dd.length) return;
      let value = '';
      if ($dd.find('.f95gp-platform').length) {
        const platforms: string[] = [];
        $dd.find('.f95gp-platform').each((__, p) => {
          const name =
            cleanText($(p).find('.u-srOnly').text()) ||
            cleanText($(p).attr('data-original-title') ?? '') ||
            cleanText($(p).attr('title') ?? '');
          if (name) platforms.push(name);
        });
        value = platforms.join(', ');
      } else {
        const time = $dd.find('time').first();
        if (time.length) {
          value =
            cleanText(time.attr('data-date') ?? '') ||
            cleanText(time.text()) ||
            cleanText(time.attr('datetime') ?? '');
        } else {
          value = cleanText($dd.text());
        }
      }
      if (value) fields[label] = value;
    });
  });
  return fields;
}

function collectGamePageTags($: cheerio.CheerioAPI): GameTag[] {
  const out: GameTag[] = [];
  const seen = new Set<string>();
  $('.f95gp-tags a.tagItem').each((_, el) => {
    const $el = $(el);
    const name = cleanText($el.text());
    if (!name) return;
    const href = $el.attr('href') ?? '';
    const slugMatch = href.match(/\/tags\/([^/]+)\/?/);
    const slug = slugMatch ? slugMatch[1] : slugify(name);
    if (seen.has(slug)) return;
    seen.add(slug);
    out.push({ slug, name });
  });
  return out;
}

function collectDownloads($: cheerio.CheerioAPI): GameDownload[] {
  const root = $('#f95gp-download').first();
  if (!root.length) return [];
  if (root.find('.f95gp-guest').length && root.find('a[href]').filter((_, a) => {
    const href = $(a).attr('href') ?? '';
    return Boolean(href) && !href.startsWith('#') && !/\/login/i.test(href);
  }).length === 0) {
    return [];
  }
  const hasHostLink = root.find('a[href]').toArray().some((el) => {
    const href = $(el).attr('href');
    return Boolean(href) && !href!.startsWith('#') && !/\/login/i.test(href!);
  });
  if (!hasHostLink) return [];
  return parseDownloadBlock($, root as cheerio.Cheerio<Element>);
}

function parseWhatsNew($: cheerio.CheerioAPI): GamePageWhatsNew | null {
  const list = $('ul.f95gp-whatsNew').first();
  if (!list.length) return null;
  const section = list.closest('.f95gp-section');
  const title =
    cleanText(section.find('.f95gp-section-title').first().text()) ||
    "What's new";
  const items: string[] = [];
  list.children('li').each((_, li) => {
    const text = cleanText($(li).text());
    if (text) items.push(text);
  });
  const moreHref = section.find('a.f95gp-more').first().attr('href') ?? null;
  const historyHref = moreHref ? absoluteUrl(moreHref) : null;
  return { title, items, historyHref };
}

function parseFolds($: cheerio.CheerioAPI): GamePageFold[] {
  const folds: GamePageFold[] = [];
  $('details.f95gp-fold').each((_, el) => {
    const $el = $(el);
    const title =
      cleanText($el.children('summary').first().text()) ||
      cleanText($el.find('summary').first().text());
    if (!title) return;
    const body = $el.find('.f95gp-text, .bbWrapper').first();
    const html = body.length
      ? normalizeOpHtml($, body as cheerio.Cheerio<Element>)
      : '';
    folds.push({ title, html });
  });
  return folds;
}

function parseTagGroups($: cheerio.CheerioAPI): GamePageTagGroup[] {
  const groups: GamePageTagGroup[] = [];
  $('.f95gp-tagGroup').each((_, el) => {
    const $el = $(el);
    const cls = $el.attr('class') ?? '';
    const keyMatch = cls.match(/f95gp-tagGroup--([a-z0-9_-]+)/i);
    const title =
      cleanText($el.find('.f95gp-tagTitle-text').first().text()) ||
      cleanText($el.find('.f95gp-tagTitle').first().text());
    const key = keyMatch ? keyMatch[1] : slugify(title) || 'tags';
    const tags: GameTag[] = [];
    const seen = new Set<string>();
    $el.find('.f95gp-tags a.tagItem').each((__, a) => {
      const $a = $(a);
      const name = cleanText($a.text());
      if (!name) return;
      const href = $a.attr('href') ?? '';
      const slugMatch = href.match(/\/tags\/([^/]+)\/?/);
      const slug = slugMatch ? slugMatch[1] : slugify(name);
      if (seen.has(slug)) return;
      seen.add(slug);
      tags.push({ slug, name });
    });
    groups.push({ key, title, tags });
  });
  return groups;
}

function parseStats($: cheerio.CheerioAPI): GamePageStats | null {
  const meta = $('.f95gp-meta').first();
  if (!meta.length) return null;

  const pick = (labelRe: RegExp): { label: string | null; title: string | null } => {
    let label: string | null = null;
    let title: string | null = null;
    meta.children('li').each((_, li) => {
      if (label != null) return;
      const $li = $(li);
      if ($li.hasClass('f95gp-meta-dev')) return;
      const numLabel = cleanText($li.find('.f95gp-numLabel').text());
      if (!labelRe.test(numLabel)) return;
      label = cleanText($li.find('.f95gp-num').text()) || null;
      title = cleanText($li.attr('title') ?? '') || null;
    });
    return { label, title };
  };

  const likes = pick(/likes?/i);
  const views = pick(/views?/i);
  const replies = pick(/replies?/i);

  if (!likes.label && !views.label && !replies.label) return null;

  return {
    likesLabel: likes.label,
    likesTitle: likes.title,
    viewsLabel: views.label,
    viewsTitle: views.title,
    repliesLabel: replies.label,
    repliesTitle: replies.title,
  };
}
