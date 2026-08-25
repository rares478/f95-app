import type { AnyNode, Element, Text } from 'domhandler';
import type * as cheerio from 'cheerio';
import { cleanText, normalizeOpHtml } from './htmlNormalize';

function isElement(n: AnyNode): n is Element {
  return n.type === 'tag' || n.type === 'script' || n.type === 'style';
}

function isText(n: AnyNode): n is Text {
  return n.type === 'text';
}

function isChangelogLabel(raw: string): boolean {
  const key = cleanText(raw).toLowerCase().replace(/:\s*$/, '');
  return key === 'changelog';
}

/**
 * OP pattern: bold "Changelog" label, then the first following `.bbCodeSpoiler`
 * (skip `<br>`, whitespace, and a lone trailing `:`). Returns the spoiler's
 * *inner* content normalized (nested spoilers → x-spoiler) — the outer spoiler
 * shell is discarded so the UI can use its own "Show changelog" control.
 * Null when heading or spoiler is missing.
 */
export function extractChangelogHtml(
  $: cheerio.CheerioAPI,
  opBody: cheerio.Cheerio<Element>,
): string | null {
  const heading =
    opBody
      .find('b')
      .toArray()
      .find((el) => isChangelogLabel($(el).text())) ?? null;
  if (!heading) return null;

  let n: AnyNode | null = heading.next ?? null;
  let spoiler: Element | null = null;
  while (n) {
    if (isText(n)) {
      // Skip whitespace and the common trailing `:` outside `<b>Changelog</b>:`.
      const t = cleanText(n.data);
      if (!t || /^:+$/.test(t)) {
        n = n.next ?? null;
        continue;
      }
      break;
    }
    if (isElement(n)) {
      if (n.tagName === 'br') {
        n = n.next ?? null;
        continue;
      }
      const $n = $(n);
      if ($n.is('.bbCodeSpoiler')) {
        spoiler = n;
        break;
      }
      // First meaningful sibling is not the changelog spoiler.
      break;
    }
    n = n.next ?? null;
  }
  if (!spoiler) return null;

  // Unwrap: take .bbCodeSpoiler-content (or whole node as fallback), not the
  // outer button/summary — UI already has "Show changelog". Prefer the XF
  // block body when the content is a single bbCodeBlock--spoiler wrapper.
  const $spoiler = $(spoiler);
  let innerHtml =
    $spoiler.find('> .bbCodeSpoiler-content').first().html() ??
    $spoiler.find('.bbCodeSpoiler-content').first().html() ??
    $spoiler.html() ??
    '';
  const $probe = $(`<div>${innerHtml}</div>`);
  const $block = $probe.children('.bbCodeBlock--spoiler, .bbCodeBlock').first();
  if ($block.length === 1 && $probe.children().length === 1) {
    const blockBody =
      $block.find('> .bbCodeBlock-content').first().html() ?? $block.html();
    if (blockBody != null) innerHtml = blockBody;
  }
  if (!cleanText(innerHtml.replace(/<[^>]+>/g, ' '))) return null;

  const $container = $(`<div>${innerHtml}</div>`) as cheerio.Cheerio<Element>;
  const html = normalizeOpHtml($, $container).trim();
  return html || null;
}
