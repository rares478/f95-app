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
 * (skip `<br>` / whitespace). Returns normalized HTML (spoilers → x-spoiler),
 * or null when heading or spoiler is missing.
 */
export function extractChangelogHtml(
  $: cheerio.CheerioAPI,
  opBody: cheerio.Cheerio<Element>,
): string | null {
  let heading: Element | null = null;
  opBody.find('b').each((_, el) => {
    if (heading) return;
    if (isChangelogLabel($(el).text())) heading = el;
  });
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
      if ($n.is('.bbCodeSpoiler') || $n.hasClass('bbCodeSpoiler')) {
        spoiler = n;
        break;
      }
      // First meaningful sibling is not the changelog spoiler.
      break;
    }
    n = n.next ?? null;
  }
  if (!spoiler) return null;

  const $container = $('<div></div>');
  $container.append($(spoiler).clone());
  const html = normalizeOpHtml($, $container).trim();
  return html || null;
}
