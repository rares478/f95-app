import type { Element } from 'domhandler';
import type * as cheerio from 'cheerio';
import { F95_BASE } from '../../shared/constants';

const BASE = F95_BASE;

function toF95FullUrl(url: string): string {
  return url.replace(/\/thumb\/(?=[^/]+$)/, '/');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function cleanText(s: string | null | undefined): string {
  if (!s) return '';
  return s.replace(/\s+/g, ' ').trim();
}

export function absoluteUrl(src: string): string {
  if (!src) return src;
  if (src.startsWith('http://') || src.startsWith('https://')) return src;
  if (src.startsWith('//')) return `https:${src}`;
  if (src.startsWith('/')) return `${BASE}${src}`;
  return `${BASE}/${src}`;
}

export function normalizeOpHtml(
  $: cheerio.CheerioAPI,
  opBody: cheerio.Cheerio<Element>,
  omitImageUrls?: Set<string>,
): string {
  // Work on a clone to avoid mutating selections used elsewhere.
  const clone = opBody.clone();

  // Lazy images: real URL is in data-src; src is an SVG placeholder.
  clone.find('img').each((_, el) => {
    const $el = $(el);
    const cls = $el.attr('class') ?? '';
    if (/smilie|smiley|emoji/i.test(cls)) {
      $el.remove();
      return;
    }
    const real = $el.attr('data-src');
    const raw = real ?? $el.attr('src') ?? '';
    if (!raw || raw.startsWith('data:')) {
      $el.remove();
      return;
    }
    const full = toF95FullUrl(absoluteUrl(raw));
    if (omitImageUrls?.has(full)) {
      $el.remove();
      return;
    }
    $el.attr('src', full);
    $el.removeAttr('data-src');
    $el.removeAttr('class');
    $el.removeAttr('data-url');
    $el.removeAttr('data-zoom-target');
    $el.removeAttr('style');
    $el.attr('loading', 'lazy');
  });

  // Rewrite XF spoiler containers into native <details> for collapsibility.
  clone.find('.bbCodeSpoiler').each((_, el) => {
    const $el = $(el);
    const title =
      cleanText($el.find('.bbCodeSpoiler-button-title').first().text()) ||
      'Spoiler';
    const content =
      $el.find('.bbCodeSpoiler-content').first().html() ?? $el.html() ?? '';
    $el.replaceWith(
      `<details class="x-spoiler"><summary>${escapeHtml(title)}</summary>${content}</details>`,
    );
  });

  // Strip <noscript> (we already use data-src) and inline lightbox containers.
  clone.find('noscript').remove();
  clone.find('.lbContainer-zoomer').remove();

  // Anchor cleanup: open external links in a new tab; strip XF tracker classes.
  clone.find('a[href]').each((_, el) => {
    const $el = $(el);
    const href = absoluteUrl($el.attr('href') ?? '');
    $el.attr('href', href);
    $el.attr('target', '_blank');
    $el.attr('rel', 'noreferrer noopener');
    $el.removeAttr('class');
    $el.removeAttr('data-xf-init');
    $el.removeAttr('data-xf-click');
  });

  return clone.html() ?? '';
}
