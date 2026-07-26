import { BrowserClient } from 'browser-rest-api';
import * as cheerio from 'cheerio';
import type { AnyNode, Element, Text } from 'domhandler';
import { RPC_ERROR, RpcError } from '../../rpc';
import { log } from '../../logger';
import { classifyHost } from './hosts';
import { assertNotCloudflareChallenge } from '../../shared/cloudflare';
import { F95_BASE } from '../../shared/constants';
import { absoluteUrl, cleanText, normalizeOpHtml } from './htmlNormalize';

const BASE = F95_BASE;

export interface GameDetail {
  threadId: string;
  threadUrl: string;
  /** Cleaned title with bracketed version/dev suffixes stripped. */
  title: string;
  /** Original title text as F95 shows it (`Name [vX] [Dev]`). */
  rawTitle: string;
  version: string | null;
  developer: string | null;
  bannerUrl: string | null;
  screenshots: string[];
  /** OP body HTML, normalized: lazy `data-src` → `src`, spoilers → <details>. */
  descriptionHtml: string;
  prefixes: GamePrefix[];
  fields: Record<string, string>;
  tags: GameTag[];
  downloads: GameDownload[];
  social: SocialLink[];
}
export interface GamePrefix {
  name: string;
  cssClass: string | null;
}
export interface GameTag {
  slug: string;
  name: string;
}
export interface GameDownload {
  host: string;
  url: string;
  /** Inner text of the anchor (often the host name in caps). */
  text: string;
  /** Nearest preceding section label (e.g. "Win/Linux", "Collection", "08-10"). */
  group: string | null;
}
export interface SocialLink {
  host: string;
  url: string;
  text: string;
}

const FIELD_LABELS = new Set([
  'overview',
  'thread updated',
  'release date',
  'developer',
  'publisher',
  'censored',
  'censorship',
  'version',
  'os',
  'language',
  'genre',
  'installation',
  'changelog',
  'tags',
]);

export class GameClient {
  constructor(private readonly http: BrowserClient) {}

  async getDetail(threadIdOrUrl: string): Promise<GameDetail> {
    const url = normalizeThreadUrl(threadIdOrUrl);
    log(`[game] GET ${url}`);
    const res = await this.http.get(url);
    assertNotCloudflareChallenge(res.body, res.headers, {
      message: 'Cloudflare challenge encountered on thread fetch',
    });
    if (res.status >= 400) {
      throw new RpcError(
        RPC_ERROR.INTERNAL,
        `thread fetch HTTP ${res.status} for ${url}`,
      );
    }
    return parseThread(res.body, res.url || url);
  }
}

function normalizeThreadUrl(input: string): string {
  const s = String(input).trim();
  if (/^https?:\/\//i.test(s)) return s;
  if (!/^\d+$/.test(s)) {
    throw new RpcError(
      RPC_ERROR.INVALID_PARAMS,
      `expected numeric thread id or full URL, got "${s}"`,
    );
  }
  return `${BASE}/threads/${s}/`;
}

function parseThread(html: string, finalUrl: string): GameDetail {
  const $ = cheerio.load(html);
  const threadId = extractThreadId(finalUrl);

  // -- Title + prefixes --
  const titleNode = $('.p-title-value').first();
  const prefixes: GamePrefix[] = [];
  titleNode.find('.label').not('.label-append').each((_, el) => {
    const $el = $(el);
    const name = cleanText($el.text());
    if (!name) return;
    prefixes.push({
      name,
      cssClass: $el.attr('class') ?? null,
    });
  });
  // Clone, remove prefix labels and the &nbsp; spacer to get raw title text.
  const titleClone = titleNode.clone();
  titleClone.find('.labelLink, .label, .label-append').remove();
  const rawTitle = cleanText(titleClone.text());
  const { title, version: versionFromTitle, developer: devFromTitle } =
    splitBracketedTitle(rawTitle);

  // -- OP --
  const op = $('article.message').first();
  if (op.length === 0) {
    throw new RpcError(RPC_ERROR.INTERNAL, 'OP article not found in thread');
  }
  const opBody = op.find('.message-body .bbWrapper').first();
  if (opBody.length === 0) {
    throw new RpcError(RPC_ERROR.INTERNAL, 'OP body (bbWrapper) not found');
  }

  // -- Banner + screenshots --
  const images = collectOpImages($, opBody);
  const bannerUrl = images[0] ?? null;
  const screenshots = images.slice(1, 31); // cap at 30 to keep payload small

  // -- Fields (Developer/Version/OS/...) --
  const fields = collectFields($, opBody);
  const version =
    nonEmpty(fields['Version']) ??
    versionFromTitle ??
    null;
  const developer =
    nonEmpty(fields['Developer']) ??
    nonEmpty(fields['Publisher']) ??
    devFromTitle ??
    null;

  // -- Tags --
  const tags = collectTags($);
  // F95 sometimes also lists a Tags field inline in OP; merge unique by slug.
  const tagSlugs = new Set(tags.map((t) => t.slug));
  if (fields['Tags']) {
    for (const t of fields['Tags'].split(/[,;]/)) {
      const name = cleanText(t);
      if (!name) continue;
      const slug = slugify(name);
      if (!tagSlugs.has(slug)) {
        tags.push({ slug, name });
        tagSlugs.add(slug);
      }
    }
  }

  // -- Links: split into downloads vs social --
  const { downloads, social } = collectLinks($, opBody);

  // -- Description: normalized HTML (sem repetir imagens já na galeria/banner) --
  const descriptionHtml = normalizeOpHtml($, opBody, new Set(images));

  return {
    threadId,
    threadUrl: finalUrl,
    title: title || rawTitle,
    rawTitle,
    version,
    developer,
    bannerUrl,
    screenshots,
    descriptionHtml,
    prefixes,
    fields,
    tags,
    downloads,
    social,
  };
}

function extractThreadId(url: string): string {
  const m = url.match(/\/threads\/(?:[^/]*?\.)?(\d+)\/?/);
  if (!m) {
    throw new RpcError(RPC_ERROR.INTERNAL, `cannot extract thread id from ${url}`);
  }
  return m[1];
}

function splitBracketedTitle(raw: string): {
  title: string;
  version: string | null;
  developer: string | null;
} {
  // Pattern: "Title [bracket1] [bracket2] [bracketN]". The version is the
  // bracket starting with v/V or a digit; the developer is the last bracket
  // that's clearly not a status/engine word.
  const stripped = raw.replace(/&nbsp;/g, ' ').trim();
  const brackets: string[] = [];
  const bareTitle = stripped.replace(/\[([^\]]+)\]/g, (_, b) => {
    brackets.push(cleanText(b));
    return '';
  });
  let version: string | null = null;
  let developer: string | null = null;
  for (const b of brackets) {
    if (!version && /^v?\d/i.test(b)) version = b;
    else if (!developer) developer = b;
  }
  return { title: cleanText(bareTitle), version, developer };
}

function collectOpImages(
  $: cheerio.CheerioAPI,
  opBody: cheerio.Cheerio<Element>,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  opBody.find('img').each((_, el) => {
    const $el = $(el);
    const cls = $el.attr('class') ?? '';
    // Skip smileys and tiny icons.
    if (/smilie|smiley|emoji/i.test(cls)) return;
    const src = pickImageSrc($el);
    if (!src) return;
    // Skip placeholder SVGs (already filtered by pickImageSrc, but be safe).
    if (src.startsWith('data:')) return;
    // Skip F95 'thumb/' variants — we want the full image. Prefer to swap
    // /thumb/<id>_name to /<id>_name if it's a known attachments URL.
    const full = src.replace(/\/thumb\/(?=[^/]+$)/, '/');
    if (seen.has(full)) return;
    seen.add(full);
    out.push(full);
  });
  return out;
}

function pickImageSrc($el: cheerio.Cheerio<Element>): string | null {
  const candidates = [$el.attr('data-src'), $el.attr('src'), $el.attr('data-original')];
  for (const c of candidates) {
    if (c && !isPlaceholder(c)) return absoluteUrl(c);
  }
  return null;
}

function isPlaceholder(src: string): boolean {
  return (
    src.startsWith('data:image/svg') ||
    src.startsWith('data:image/gif') ||
    src.includes('blank.gif') ||
    src.endsWith('/blank.png')
  );
}

function collectFields(
  $: cheerio.CheerioAPI,
  opBody: cheerio.Cheerio<Element>,
): Record<string, string> {
  const fields: Record<string, string> = {};
  opBody.find('b').each((_, el) => {
    const $b = $(el);
    const label = cleanText($b.text());
    if (!label || label.length > 40) return;
    const key = label.toLowerCase().replace(/:\s*$/, '');
    if (!FIELD_LABELS.has(key)) return;
    const value = readSiblingsUntilBreak($, el);
    if (!value) return;
    const cleaned = cleanText(value).replace(/^:\s*/, '');
    if (!cleaned) return;
    // Use original-case label key for display.
    const displayLabel = label.replace(/:\s*$/, '');
    if (!fields[displayLabel] || fields[displayLabel].length < cleaned.length) {
      fields[displayLabel] = cleaned;
    }
  });
  return fields;
}

function readSiblingsUntilBreak(
  $: cheerio.CheerioAPI,
  startEl: Element,
): string {
  // Read the value text following a label `<b>` until we hit a line break,
  // another label `<b>`, or an `<a>` element. Stopping at `<a>` is what keeps
  // social-link suffixes (Patreon / Discord / X buttons after "Developer:")
  // from being absorbed into the value.
  const parts: string[] = [];
  let n: AnyNode | null = startEl.next ?? null;
  while (n) {
    if (isElement(n)) {
      if (n.tagName === 'br' || n.tagName === 'b' || n.tagName === 'a') break;
      parts.push($(n).text());
    } else if (isText(n)) {
      parts.push(n.data);
    }
    n = n.next ?? null;
  }
  return parts.join('');
}

function collectTags($: cheerio.CheerioAPI): GameTag[] {
  const out: GameTag[] = [];
  const seen = new Set<string>();
  $('.tagList a, dl.tagList dd a, .js-tagList a').each((_, el) => {
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

function collectLinks(
  $: cheerio.CheerioAPI,
  opBody: cheerio.Cheerio<Element>,
): { downloads: GameDownload[]; social: SocialLink[] } {
  const downloads: GameDownload[] = [];
  const social: SocialLink[] = [];
  const seenDownload = new Set<string>();
  const seenSocial = new Set<string>();

  opBody.find('a[href]').each((_, el) => {
    const $el = $(el);
    const href = $el.attr('href');
    if (!href || href.startsWith('#')) return;
    const url = absoluteUrl(href);
    const info = classifyHost(url);
    if (!info) return;

    const text = cleanText($el.text());
    if (info.category === 'direct') {
      if (seenDownload.has(url)) return;
      seenDownload.add(url);
      downloads.push({
        host: info.host,
        url,
        text: text || info.host,
        group: nearestDownloadGroupLabel($, el),
      });
    } else if (info.category === 'social') {
      if (seenSocial.has(url)) return;
      seenSocial.add(url);
      social.push({ host: info.host, url, text: text || info.host });
    }
  });

  return { downloads, social };
}

const OS_LABEL_RE =
  /\b(win(?:dows)?(?:\s*\/\s*linux)?|linux|mac(?:os)?|android|ios|browser|all platforms?)\b/i;

/** Section headers that are not download groups (games + animations/comics/assets). */
const GROUP_LABEL_EXCLUDE = new Set([
  'download',
  'downloads',
  'update',
  'updates',
  'installation',
  'changelog',
  'mod',
  'mods',
  'patch',
  'language',
  'genre',
  'overview',
  'thread updated',
  'release date',
  'censorship',
  'censored',
  'developer',
  'publisher',
  'tags',
  'support',
  'social',
  'credits',
]);

function normalizeGroupLabel(raw: string): string | null {
  const t = cleanText(raw).replace(/:\s*$/, '').trim();
  if (!t) return null;
  if (GROUP_LABEL_EXCLUDE.has(t.toLowerCase())) return null;
  return t;
}

function labelFromBoldText(raw: string): string | null {
  const t = cleanText(raw);
  if (!t) return null;
  if (OS_LABEL_RE.test(t)) {
    return normalizeGroupLabel(t.endsWith(':') ? t : `${t}:`);
  }
  if (t.endsWith(':')) {
    return normalizeGroupLabel(t);
  }
  return null;
}

function nearestDownloadGroupLabel(
  $: cheerio.CheerioAPI,
  el: Element,
): string | null {
  // Walk backward through siblings/parents for the nearest <b>/<strong> label
  // (Win/Linux, Collection, 08-10, etc.). Games use OS rows; animations/comics
  // use episode/chapter ranges on the same line as the host links.
  let node: AnyNode | null = el;
  let hops = 0;
  while (node && hops < 80) {
    let prev: AnyNode | null = (node as AnyNode).prev ?? null;
    while (prev) {
      if (isElement(prev)) {
        const tag = prev.tagName?.toLowerCase();
        if (tag === 'b' || tag === 'strong') {
          const label = labelFromBoldText($(prev).text());
          if (label) return label;
        }
        const inner = $(prev).find('b, strong').last();
        if (inner.length) {
          const label = labelFromBoldText(inner.text());
          if (label) return label;
        }
      } else if (isText(prev)) {
        const os = prev.data.match(OS_LABEL_RE);
        if (os) {
          const label = normalizeGroupLabel(os[0]);
          if (label) return label;
        }
        // Plain-text labels: "Collection: GOFILE - …"
        const colon = prev.data.match(
          /(?:^|[\s])((?:[\w][\w /_.+-]{0,40}))\s*:\s*$/,
        );
        if (colon) {
          const label = normalizeGroupLabel(`${colon[1]}:`);
          if (label) return label;
        }
      }
      prev = prev.prev ?? null;
      hops++;
    }
    node = (node as AnyNode).parent ?? null;
    hops++;
  }
  return null;
}

function nonEmpty(v: string | undefined | null): string | null {
  if (!v) return null;
  const t = v.trim();
  return t.length ? t : null;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function isElement(n: AnyNode): n is Element {
  return n.type === 'tag' || n.type === 'script' || n.type === 'style';
}

function isText(n: AnyNode): n is Text {
  return n.type === 'text';
}
