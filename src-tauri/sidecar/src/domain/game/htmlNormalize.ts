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

function giphyEmbedUrl(src: string): string | null {
  const match = src.match(/giphy\.com\/embed\/([a-zA-Z0-9_-]+)/i);
  if (!match) return null;
  return `https://media.giphy.com/media/${match[1]}/giphy.gif`;
}

export function normalizeOpHtml(
  $: cheerio.CheerioAPI,
  opBody: cheerio.Cheerio<Element>,
  omitImageUrls?: Set<string>,
): string {
  // Work on a clone to avoid mutating selections used elsewhere.
  const clone = opBody.clone();

  // Embedded GIFs/videos (Giphy, etc.) use iframes that sanitizers strip — convert first.
  clone.find('iframe[src]').each((_, el) => {
    const $iframe = $(el);
    const src = $iframe.attr('src') ?? '';
    const gifUrl = giphyEmbedUrl(src);
    if (gifUrl) {
      $iframe.replaceWith(
        `<img src="${escapeHtml(gifUrl)}" loading="lazy" alt="" />`,
      );
      return;
    }
    const href = absoluteUrl(src);
    $iframe.replaceWith(
      `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer noopener">${escapeHtml(href)}</a>`,
    );
  });

  // XF lazy wrappers: empty ones carry the URL in data-src; others wrap a
  // placeholder <img>. Both often ship with inline height (e.g. 500px) that
  // leaves a huge blank gap once the placeholder is gone — materialize or
  // unwrap, then drop any leftover shell.
  clone.find('.bbImageWrapper[data-src], .js-lbImage[data-src]').each((_, el) => {
    const $el = $(el);
    if ($el.is('img')) return;
    if ($el.find('img').length) return;
    const raw = $el.attr('data-src') ?? '';
    if (!raw || raw.startsWith('data:')) {
      $el.remove();
      return;
    }
    const full = toF95FullUrl(absoluteUrl(raw));
    if (omitImageUrls?.has(full)) {
      $el.remove();
      return;
    }
    const alt = escapeHtml($el.attr('title') ?? $el.attr('alt') ?? '');
    $el.replaceWith(
      `<img src="${escapeHtml(full)}" alt="${alt}" loading="lazy" />`,
    );
  });

  // Lazy images: real URL is in data-src; src is an SVG placeholder.
  clone.find('img').each((_, el) => {
    const $el = $(el);
    const cls = $el.attr('class') ?? '';
    if (/smilie|smiley|emoji/i.test(cls)) {
      $el.remove();
      return;
    }
    const real =
      $el.attr('data-src') ||
      $el.attr('data-url') ||
      $el.attr('data-original') ||
      '';
    const raw = real || ($el.attr('src') ?? '');
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

  // Unwrap lightbox shells so their reserved height/width cannot survive.
  clone.find('.bbImageWrapper, .js-lbImage').each((_, el) => {
    const $el = $(el);
    if ($el.is('img')) return;
    const $img = $el.children('img').first();
    if ($img.length) {
      $el.replaceWith($img);
      return;
    }
    $el.remove();
  });

  // Rewrite XF spoiler containers into native <details> for collapsibility.
  // Deepest-first so nested spoilers (common in Changelog) convert before parents.
  const spoilerNodes = clone.find('.bbCodeSpoiler').toArray().reverse();
  for (const el of spoilerNodes) {
    const $el = $(el);
    if ($el.hasClass('x-spoiler') || $el.is('details')) continue;
    const title =
      cleanText($el.find('.bbCodeSpoiler-button-title').first().text()) ||
      'Spoiler';
    const content =
      $el.find('.bbCodeSpoiler-content').first().html() ?? $el.html() ?? '';
    $el.replaceWith(
      `<details class="x-spoiler"><summary>${escapeHtml(title)}</summary>${content}</details>`,
    );
  }

  // Rewrite XF quote blocks into a clean blockquote + expand control.
  // Deepest-first so nested quotes normalize before their parents.
  const quoteNodes = clone
    .find('blockquote.bbCodeBlock--quote, .bbCodeBlock--quote')
    .toArray()
    .reverse();
  for (const el of quoteNodes) {
    const $el = $(el);
    if ($el.hasClass('x-quote')) continue;
    const title =
      cleanText($el.find('.bbCodeBlock-title').first().text()) || 'Quote';
    const $expandContent = $el.find('.bbCodeBlock-expandContent').first();
    let content: string;
    if ($expandContent.length) {
      content = $expandContent.html() ?? '';
    } else {
      const $blockContent = $el.find('.bbCodeBlock-content').first().clone();
      $blockContent.find('.bbCodeBlock-expandLink').remove();
      content =
        ($blockContent.length ? $blockContent.html() : null) ?? $el.html() ?? '';
    }
    $el.replaceWith(
      `<blockquote class="x-quote">` +
        `<div class="x-quote-title">${escapeHtml(title)}</div>` +
        `<div class="x-quote-content">${content}</div>` +
        `<button type="button" class="x-quote-expand" hidden></button>` +
        `</blockquote>`,
    );
  }

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

  // Hero already shows the cover — drop OP banner images above Overview.
  stripImagesBeforeOverview($, clone);

  return clone.html() ?? '';
}

function isOverviewHeading($: cheerio.CheerioAPI, el: Element): boolean {
  const tag = el.tagName?.toLowerCase?.() ?? (el as { name?: string }).name?.toLowerCase() ?? '';
  if (tag !== 'b' && tag !== 'strong') return false;
  return /^overview\b/i.test(cleanText($(el).text()));
}

/**
 * Remove images that appear before the first Overview heading. Those are the
 * cover/banner shots already shown in the game detail hero.
 */
export function stripImagesBeforeOverview(
  $: cheerio.CheerioAPI,
  root: cheerio.Cheerio<Element>,
): void {
  const hasOverview =
    root.find('b, strong').toArray().some((el) => isOverviewHeading($, el as Element)) ||
    /\boverview\s*:/i.test(root.text());
  if (!hasOverview) return;

  let hitOverview = false;

  const visit = (nodes: Element[]): void => {
    for (const node of nodes) {
      if (hitOverview) return;
      // cheerio contents include text/comment nodes typed loosely
      const anyNode = node as unknown as {
        type?: string;
        data?: string;
        name?: string;
        tagName?: string;
        children?: Element[];
      };
      if (anyNode.type === 'text') {
        if (/^\s*overview\s*:/i.test(anyNode.data ?? '')) {
          hitOverview = true;
        }
        continue;
      }
      if (anyNode.type && anyNode.type !== 'tag') continue;

      const el = node as Element;
      if (isOverviewHeading($, el)) {
        hitOverview = true;
        return;
      }

      const tag =
        (el as { name?: string }).name?.toLowerCase() ??
        el.tagName?.toLowerCase() ??
        '';
      if (tag === 'img') {
        $(el).remove();
        continue;
      }

      const kids = $(el).contents().toArray() as Element[];
      if (kids.length) visit(kids);
    }
  };

  visit(root.contents().toArray() as Element[]);

  // Trim leftover leading <br> that only padded the removed banner.
  const stripLeadingBreaks = ($box: cheerio.Cheerio<Element>) => {
    for (const node of $box.contents().toArray()) {
      const anyNode = node as unknown as { type?: string; name?: string; data?: string };
      if (anyNode.type === 'text' && !cleanText(anyNode.data)) {
        $(node).remove();
        continue;
      }
      if (anyNode.type === 'tag' && anyNode.name === 'br') {
        $(node).remove();
        continue;
      }
      break;
    }
  };
  stripLeadingBreaks(root);
  root.children('div, p, span, center').each((_, el) => {
    stripLeadingBreaks($(el));
  });
}
