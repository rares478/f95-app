import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import { classifyHost } from './hosts';
import { absoluteUrl, cleanText } from './htmlNormalize';

export interface GameDownload {
  host: string;
  url: string;
  text: string;
  group: string | null;
  edition: string | null;
  platform: string | null;
  part: number | null;
  kindHint: 'full' | 'split' | 'patch' | 'extra' | 'other' | null;
  topLevel?: boolean;
}

const DOWNLOAD_HEADING_RE = /^downloads?$/i;

export function rootHasDirectHost(
  $: cheerio.CheerioAPI,
  root: cheerio.Cheerio<Element>,
): boolean {
  let found = false;
  root.find('a[href]').each((_, el) => {
    if (found) return;
    const href = $(el).attr('href');
    if (!href || href.startsWith('#')) return;
    const info = classifyHost(absoluteUrl(href));
    if (info?.category === 'direct') found = true;
  });
  return found;
}

/**
 * Prefer last element-child div of .bbWrapper with direct hosts;
 * else DOWNLOAD heading through end of opBody; else null.
 */
export function resolveDownloadRoot(
  $: cheerio.CheerioAPI,
  opBody: cheerio.Cheerio<Element>,
): cheerio.Cheerio<Element> | null {
  const lastDiv = opBody.children('div').last();
  if (lastDiv.length && rootHasDirectHost($, lastDiv)) {
    return lastDiv;
  }

  let heading: Element | null = null;
  opBody.find('b, strong').each((_, el) => {
    if (heading) return;
    const label = cleanText($(el).text()).replace(/:\s*$/, '');
    if (DOWNLOAD_HEADING_RE.test(label)) heading = el;
  });
  if (!heading) return null;

  // Build a synthetic root covering heading → end by wrapping siblings in a
  // detached container via cheerio load of collected HTML, OR return a range
  // cheerio set. Prefer: mark from heading's parent chain if heading is inside
  // lastDiv already handled; for flat markup, collect nodes from heading onward.
  const nodes: Element[] = [];
  let started = false;
  for (const child of opBody.contents().toArray()) {
    if (!started) {
      if (child === heading || (child.type === 'tag' && $(child).find(heading).length)) {
        started = true;
      } else {
        continue;
      }
    }
    if (child.type === 'tag') nodes.push(child as Element);
  }
  if (!nodes.length) return null;

  const wrap = $('<div></div>');
  for (const n of nodes) wrap.append($(n).clone());
  if (!rootHasDirectHost($, wrap)) return null;
  return wrap;
}

// parseDownloadBlock stub — Task 2 fills this in
export function parseDownloadBlock(
  _$: cheerio.CheerioAPI,
  _root: cheerio.Cheerio<Element>,
): GameDownload[] {
  return [];
}
