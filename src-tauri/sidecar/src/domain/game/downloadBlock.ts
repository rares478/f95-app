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
  /\b(season|act\s*\d*|chapter|episode|volume|vol\.?|archive|before\s+remake|ost|soundtrack|splits?|patch(?:es)?|extras?|translations?|mods?)\b/i;
const QUALITY_LABEL_RE = /^(high|low)\s+quality$/i;
const AUX_KIND_RE = /^(patch(?:es)?|extras?|translations?|mods?|ost|soundtrack)\b/i;

type WalkCtx = {
  editionStack: string[];
  kindStack: Array<GameDownload['kindHint']>;
  platform: string | null;
  part: number | null;
  quality: string | null;
  splitSpoiler: boolean;
  spoilerDepth: number;
};

function classifyBoldLabel(raw: string): {
  type: 'download' | 'edition' | 'quality' | 'part' | 'row';
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
  if (QUALITY_LABEL_RE.test(text)) {
    return { type: 'quality', text };
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

function spoilerTitle(
  $: cheerio.CheerioAPI,
  spoilerEl: Element,
): string | null {
  const $sp = $(spoilerEl);
  const buttonText = cleanText(
    $sp.find('.bbCodeSpoiler-button, button').first().text(),
  );
  if (buttonText && !/^spoiler$/i.test(buttonText)) {
    return buttonText;
  }
  const prevs = $sp.prevAll().toArray();
  for (const p of prevs) {
    const t = cleanText($(p).text());
    if (!t) continue;
    if (DOWNLOAD_HEADING_RE.test(t.replace(/:\s*$/, ''))) continue;
    return t.replace(/:\s*$/, '');
  }
  return buttonText && !/^spoiler$/i.test(buttonText) ? buttonText : null;
}

/**
 * Label from b/strong, or from span/p whose first meaningful child is b/strong.
 */
function extractLabelFromElement(
  $: cheerio.CheerioAPI,
  el: Element,
): { text: string; boldEl: Element } | null {
  if (el.tagName === 'b' || el.tagName === 'strong') {
    return { text: cleanText($(el).text()), boldEl: el };
  }
  if (el.tagName !== 'span' && el.tagName !== 'p') return null;

  const $el = $(el);
  const bold = $el.find('b, strong').first();
  const boldNode = bold.get(0);
  if (!boldNode) return null;

  // Bold must be the first meaningful content under this node.
  for (const n of $el.contents().toArray()) {
    if (n === boldNode) break;
    if (
      n.type === 'text' &&
      !cleanText((n as unknown as { data?: string }).data ?? '')
    ) {
      continue;
    }
    return null;
  }

  const text = cleanText(bold.text());
  if (!text) return null;
  return { text, boldEl: boldNode as Element };
}

function composeEdition(ctx: WalkCtx): string | null {
  const base = ctx.editionStack.filter(Boolean).slice(-1)[0] ?? null;
  if (base && ctx.quality) return `${base} · ${ctx.quality}`;
  return base ?? ctx.quality;
}

function applyLabel(
  ctx: WalkCtx,
  classified: ReturnType<typeof classifyBoldLabel>,
): void {
  if (classified.type === 'download') return;
  if (classified.type === 'edition') {
    ctx.editionStack = [classified.text];
    ctx.kindStack = [classified.kind ?? null];
    ctx.platform = null;
    ctx.part = null;
    ctx.quality = null;
    return;
  }
  if (classified.type === 'quality') {
    ctx.quality = classified.text;
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
}

function activeAuxKind(ctx: WalkCtx): GameDownload['kindHint'] | null {
  const stacked = [...ctx.kindStack].reverse().find(Boolean);
  return stacked === 'patch' || stacked === 'extra' ? stacked : null;
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
    quality: null,
    splitSpoiler: false,
    spoilerDepth: 0,
  };

  const pushLink = (el: Element) => {
    const href = $(el).attr('href');
    if (!href || href.startsWith('#')) return;
    const url = absoluteUrl(href);
    const info = classifyHost(url);
    if (!info || info.category !== 'direct') return;
    if (seen.has(url)) return;
    seen.add(url);

    // Emit when a structural row exists, or when patch/extra heading has
    // host links with no platform row (Extras: exception).
    if (ctx.platform == null && ctx.part == null && !activeAuxKind(ctx)) {
      return;
    }

    const edition = composeEdition(ctx);
    const platform = ctx.platform;
    const part = ctx.part;
    const kindHint = inferKind(ctx, platform, part);
    // Root-level current builds stay topLevel even when labeled (e.g. Act2).
    const topLevel =
      kindHint !== 'patch' &&
      kindHint !== 'extra' &&
      ctx.spoilerDepth === 0;

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

  const walk = (node: Element, skipBold: Element | null = null) => {
    if (skipBold && node === skipBold) return;

    const $node = $(node);
    if ($node.is(SPOILER_SEL)) {
      const title = spoilerTitle($, node);
      const kind: GameDownload['kindHint'] =
        title && /\bsplits?\b/i.test(title)
          ? 'split'
          : title && /\bpatch(?:es)?\b/i.test(title)
            ? 'patch'
            : title &&
                /\b(extras?|translations?|mods?|ost|soundtrack)\b/i.test(title)
              ? 'extra'
              : null;
      // Preceding bold edition headings that a spoiler consumes as its title
      // must not remain as a permanent top-level edition after the spoiler.
      if (
        title &&
        ctx.editionStack.length === 1 &&
        ctx.editionStack[0] === title
      ) {
        ctx.editionStack = [];
        ctx.kindStack = [];
      }
      ctx.editionStack.push(title ?? '');
      ctx.kindStack.push(kind);
      const prevPlatform = ctx.platform;
      const prevPart = ctx.part;
      const prevQuality = ctx.quality;
      const prevSplit = ctx.splitSpoiler;
      ctx.platform = null;
      ctx.part = null;
      ctx.quality = null;
      ctx.spoilerDepth += 1;
      if (kind === 'split') ctx.splitSpoiler = true;

      const content = $node
        .find('> .bbCodeSpoiler-content, > .bbCodeBlock-content, > summary + *')
        .first();
      const walkTarget = content.length ? content : $node;
      for (const child of walkTarget.contents().toArray()) {
        if (child.type === 'tag') walk(child as Element);
      }

      ctx.editionStack.pop();
      ctx.kindStack.pop();
      ctx.platform = prevPlatform;
      ctx.part = prevPart;
      ctx.quality = prevQuality;
      ctx.splitSpoiler = prevSplit;
      ctx.spoilerDepth -= 1;
      return;
    }

    // span/p with leading b/strong: classify once, skip re-walking that bold.
    if (node.tagName === 'span' || node.tagName === 'p') {
      const extracted = extractLabelFromElement($, node);
      if (extracted) {
        applyLabel(ctx, classifyBoldLabel(extracted.text));
        for (const child of $node.contents().toArray()) {
          if (child.type === 'tag') {
            walk(child as Element, extracted.boldEl);
          }
        }
        return;
      }
    }

    if (node.tagName === 'b' || node.tagName === 'strong') {
      applyLabel(ctx, classifyBoldLabel($node.text()));
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
