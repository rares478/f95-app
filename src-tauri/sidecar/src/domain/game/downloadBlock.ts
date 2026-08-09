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

const SPOILER_SEL =
  '.bbCodeSpoiler, details.x-spoiler, .bbCodeBlock--spoiler';
const OS_LABEL_RE =
  /\b(win(?:dows)?(?:32|64)?(?:\s*\/\s*linux)?|linux|mac(?:os)?|osx|android|ios|browser|all platforms?)\b/i;
const PART_LABEL_RE = /^part\s*(\d+)$/i;
const EDITION_HEADING_RE =
  /\b(season|act|chapter|episode|volume|vol\.?|archive|before\s+remake|ost|soundtrack|splits?|patch(?:es)?|extras?|translations?|mods?)\b/i;
const AUX_KIND_RE = /^(patch(?:es)?|extras?|translations?|mods?|ost|soundtrack)\b/i;

type WalkCtx = {
  editionStack: string[];
  kindStack: Array<GameDownload['kindHint']>;
  platform: string | null;
  part: number | null;
  splitSpoiler: boolean;
};

function classifyBoldLabel(raw: string): {
  type: 'download' | 'edition' | 'part' | 'row';
  text: string;
  part?: number;
  kind?: GameDownload['kindHint'];
} {
  const text = cleanText(raw).replace(/:\s*$/, '');
  if (DOWNLOAD_HEADING_RE.test(text)) return { type: 'download', text };
  const partMatch = text.match(PART_LABEL_RE);
  if (partMatch) {
    return { type: 'part', text, part: Number.parseInt(partMatch[1], 10) };
  }
  if (AUX_KIND_RE.test(text) || EDITION_HEADING_RE.test(text)) {
    let kind: GameDownload['kindHint'] = 'full';
    if (/\bpatch(?:es)?\b/i.test(text)) kind = 'patch';
    else if (/\b(extras?|translations?|mods?|ost|soundtrack)\b/i.test(text))
      kind = 'extra';
    else if (/\bsplits?\b/i.test(text)) kind = 'split';
    return { type: 'edition', text, kind };
  }
  return { type: 'row', text };
}

function emitGroup(
  edition: string | null,
  platform: string | null,
  part: number | null,
): string | null {
  const bits = [
    edition,
    platform,
    part != null ? `Part ${part}` : null,
  ].filter(Boolean) as string[];
  return bits.length ? bits.join(' · ') : null;
}

function inferKind(
  ctx: WalkCtx,
  platform: string | null,
  part: number | null,
): NonNullable<GameDownload['kindHint']> {
  const stacked = [...ctx.kindStack].reverse().find(Boolean);
  if (stacked === 'patch' || stacked === 'extra') return stacked;
  if (part != null || ctx.splitSpoiler) return 'split';
  if (stacked === 'split') return 'split';
  if (platform) return 'full';
  return 'other';
}

export function parseDownloadBlock(
  $: cheerio.CheerioAPI,
  root: cheerio.Cheerio<Element>,
): GameDownload[] {
  const downloads: GameDownload[] = [];
  const seen = new Set<string>();
  const ctx: WalkCtx = {
    editionStack: [],
    kindStack: [],
    platform: null,
    part: null,
    splitSpoiler: false,
  };

  const pushLink = (el: Element) => {
    const href = $(el).attr('href');
    if (!href || href.startsWith('#')) return;
    const url = absoluteUrl(href);
    const info = classifyHost(url);
    if (!info || info.category !== 'direct') return;
    if (seen.has(url)) return;
    seen.add(url);

    // Only emit when a structural row exists (platform or part set), or
    // edition/kind context alone with no row → still skip inventing from URL.
    if (ctx.platform == null && ctx.part == null) return;

    const edition =
      ctx.editionStack.filter(Boolean).slice(-1)[0] ?? null;
    const platform = ctx.platform;
    const part = ctx.part;
    const kindHint = inferKind(ctx, platform, part);
    const topLevel =
      kindHint !== 'patch' &&
      kindHint !== 'extra' &&
      ctx.editionStack.length === 0;

    downloads.push({
      host: info.host,
      url,
      text: cleanText($(el).text()) || info.host,
      edition,
      platform,
      part,
      kindHint,
      group: emitGroup(edition, platform, part),
      topLevel,
    });
  };

  const walk = (node: Element) => {
    const $node = $(node);
    if ($node.is(SPOILER_SEL)) {
      // Task 3 implements spoiler push/pop; for now skip entering spoilers
      // OR treat as opaque (Task 2 fixtures have none).
      return;
    }

    if (node.tagName === 'b' || node.tagName === 'strong') {
      const classified = classifyBoldLabel($node.text());
      if (classified.type === 'download') return;
      if (classified.type === 'edition') {
        ctx.editionStack = [classified.text];
        ctx.kindStack = [classified.kind ?? null];
        ctx.platform = null;
        ctx.part = null;
        return;
      }
      if (classified.type === 'part') {
        ctx.part = classified.part ?? null;
        return;
      }
      ctx.platform = classified.text;
      ctx.part = null;
      return;
    }

    if (node.tagName === 'a') {
      pushLink(node);
      return;
    }

    for (const child of $node.contents().toArray()) {
      if (child.type === 'tag') walk(child as Element);
    }
  };

  for (const child of root.contents().toArray()) {
    if (child.type === 'tag') walk(child as Element);
  }

  return downloads;
}
