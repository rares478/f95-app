import { BrowserClient } from 'browser-rest-api';
import * as cheerio from 'cheerio';
import type { AnyNode, Element, Text } from 'domhandler';
import { RPC_ERROR, RpcError } from '../../rpc';
import { log } from '../../logger';
import { classifyHost } from './hosts';
import { assertNotCloudflareChallenge } from '../../shared/cloudflare';
import { F95_BASE } from '../../shared/constants';
import { absoluteUrl, cleanText, normalizeOpHtml } from './htmlNormalize';
import {
  extractPostIdFromFinal,
  extractThreadPageFromFinal,
  parseThreadPostsPage,
  type ThreadPostsPage,
} from './posts';
import {
  buildBbcodePreviewForm,
  parseBbcodePreviewResponse,
  type BbcodePreviewResult,
} from './bbcodePreview';
import {
  buildThreadReplyForm,
  parseThreadReplyResponse,
  type ThreadReplyResult,
} from './reply';

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
  /** Composite display path, e.g. "Season 1-2 · Win/Linux · Part 1". */
  group: string | null;
  edition: string | null;
  platform: string | null;
  part: number | null;
  kindHint: 'full' | 'split' | 'patch' | 'extra' | 'other' | null;
  /** True when edition is Current (null) or a named heading outside spoilers. */
  topLevel?: boolean;
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
  private xfTokenCache: string | null = null;

  constructor(private readonly http: BrowserClient) {}

  threadPageUrl(threadId: string, page: number): string {
    const base = normalizeThreadUrl(threadId); // ends with /threads/{id}/
    if (page <= 1) return base;
    return `${base.replace(/\/$/, '')}/page-${page}`;
  }

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

  async getPosts(threadId: string, page = 1): Promise<ThreadPostsPage> {
    const id = String(threadId).trim();
    if (!/^\d+$/.test(id)) {
      throw new RpcError(RPC_ERROR.INVALID_PARAMS, 'threadId must be numeric');
    }
    const url = this.threadPageUrl(id, page);
    log(`[game] GET posts ${url}`);
    const res = await this.http.get(url);
    assertNotCloudflareChallenge(res.body, res.headers, {
      message: 'Cloudflare challenge encountered on thread posts fetch',
    });
    if (res.status >= 400) {
      throw new RpcError(
        RPC_ERROR.INTERNAL,
        `thread posts HTTP ${res.status} for ${url}`,
      );
    }
    return parseThreadPostsPage(res.body, { threadId: id, page });
  }

  async reply(threadId: string, message: string): Promise<ThreadReplyResult> {
    const id = String(threadId).trim();
    const text = String(message).trim();
    if (!/^\d+$/.test(id)) {
      throw new RpcError(RPC_ERROR.INVALID_PARAMS, 'threadId must be numeric');
    }
    if (!text) {
      throw new RpcError(RPC_ERROR.INVALID_PARAMS, 'message required');
    }

    const threadUrl = this.threadPageUrl(id, 1);
    log(`[game] GET thread for reply token ${threadUrl}`);
    const pageRes = await this.http.get(threadUrl);
    assertNotCloudflareChallenge(pageRes.body, pageRes.headers, {
      message: 'Cloudflare challenge encountered on thread reply',
    });
    if (pageRes.url.includes('/login')) {
      throw new RpcError(RPC_ERROR.NOT_INITIALIZED, 'not logged in');
    }
    if (pageRes.status >= 400) {
      throw new RpcError(RPC_ERROR.INTERNAL, `thread reply prep HTTP ${pageRes.status}`);
    }

    const $ = cheerio.load(pageRes.body);
    const xfToken =
      $('input[name="_xfToken"]').first().attr('value') ??
      $('html').attr('data-csrf') ??
      null;
    if (!xfToken) {
      throw new RpcError(RPC_ERROR.INTERNAL, 'could not extract _xfToken for reply');
    }

    const requestUri = `/threads/${id}/`;
    const form = buildThreadReplyForm({
      threadId: id,
      message: text,
      xfToken,
      requestUri,
    });
    log(`[game] POST reply ${form.url}`);
    const res = await this.http.post(form.url, {
      headers: form.headers,
      body: form.body,
    });
    assertNotCloudflareChallenge(res.body, res.headers, {
      message: 'Cloudflare challenge encountered on thread reply post',
    });
    if (res.url.includes('/login')) {
      throw new RpcError(RPC_ERROR.NOT_INITIALIZED, 'not logged in');
    }
    // XF may return 200 with error JSON; parser handles soft errors.
    // HTTP ≥400 must never return success — parse only to surface XF error text.
    if (res.status >= 400) {
      try {
        parseThreadReplyResponse({
          threadId: id,
          body: typeof res.body === 'string' ? res.body : '',
          finalUrl: res.url,
        });
      } catch (err) {
        if (err instanceof RpcError) throw err;
      }
      throw new RpcError(RPC_ERROR.INTERNAL, `thread reply HTTP ${res.status}`);
    }
    return parseThreadReplyResponse({
      threadId: id,
      body: typeof res.body === 'string' ? res.body : '',
      finalUrl: res.url,
    });
  }

  async previewBbcode(
    threadId: string,
    bbCode: string,
  ): Promise<BbcodePreviewResult> {
    const id = String(threadId).trim();
    const text = String(bbCode ?? '');
    if (!/^\d+$/.test(id)) {
      throw new RpcError(RPC_ERROR.INVALID_PARAMS, 'threadId must be numeric');
    }
    if (!text.trim()) {
      return { html: '' };
    }

    let xfToken = this.xfTokenCache;
    if (!xfToken) {
      const accountUrl = `${BASE}/account/`;
      log(`[game] GET account for bbcode preview token ${accountUrl}`);
      const pageRes = await this.http.get(accountUrl);
      assertNotCloudflareChallenge(pageRes.body, pageRes.headers, {
        message: 'Cloudflare challenge encountered on bbcode preview',
      });
      if (pageRes.url.includes('/login')) {
        this.xfTokenCache = null;
        throw new RpcError(RPC_ERROR.NOT_INITIALIZED, 'not logged in');
      }
      if (pageRes.status >= 400) {
        throw new RpcError(
          RPC_ERROR.INTERNAL,
          `bbcode preview prep HTTP ${pageRes.status}`,
        );
      }

      const $ = cheerio.load(pageRes.body);
      xfToken =
        $('input[name="_xfToken"]').first().attr('value') ??
        $('html').attr('data-csrf') ??
        null;
      if (!xfToken) {
        throw new RpcError(
          RPC_ERROR.INTERNAL,
          'could not extract _xfToken for bbcode preview',
        );
      }
      this.xfTokenCache = xfToken;
    }

    const form = buildBbcodePreviewForm({
      threadId: id,
      bbCode: text,
      xfToken,
    });
    log(`[game] POST bbcode preview ${form.url}`);
    const res = await this.http.post(form.url, {
      headers: form.headers,
      body: form.body,
    });
    assertNotCloudflareChallenge(res.body, res.headers, {
      message: 'Cloudflare challenge encountered on bbcode preview post',
    });
    if (res.url.includes('/login')) {
      this.xfTokenCache = null;
      throw new RpcError(RPC_ERROR.NOT_INITIALIZED, 'not logged in');
    }
    if (res.status >= 400) {
      try {
        parseBbcodePreviewResponse(typeof res.body === 'string' ? res.body : '');
      } catch (err) {
        if (err instanceof RpcError) throw err;
      }
      throw new RpcError(RPC_ERROR.INTERNAL, `bbcode preview HTTP ${res.status}`);
    }
    return {
      html: parseBbcodePreviewResponse(typeof res.body === 'string' ? res.body : ''),
    };
  }

  async resolvePost(
    postId: string,
  ): Promise<{ threadId: string; postId: string; page: number | null }> {
    const id = String(postId).trim();
    if (!/^\d+$/.test(id)) {
      throw new RpcError(RPC_ERROR.INVALID_PARAMS, 'postId must be numeric');
    }
    const url = `${BASE}/posts/${id}/`;
    log(`[game] GET resolve post ${url}`);
    const res = await this.http.get(url);
    assertNotCloudflareChallenge(res.body, res.headers, {
      message: 'Cloudflare challenge encountered on post resolve',
    });
    if (res.status >= 400) {
      throw new RpcError(
        RPC_ERROR.INTERNAL,
        `resolve post HTTP ${res.status} for ${url}`,
      );
    }
    const finalUrl = res.url || url;
    const threadId = extractThreadId(finalUrl);
    const resolvedPost = extractPostIdFromFinal(finalUrl) ?? id;
    const page = extractThreadPageFromFinal(finalUrl);
    if (threadId) return { threadId, postId: resolvedPost, page };

    // Fallback: scrape canonical thread link from HTML
    const $ = cheerio.load(res.body);
    const href =
      $('link[rel="canonical"]').attr('href') ||
      $('a[href*="/threads/"]').first().attr('href') ||
      '';
    const fromHtml = extractThreadId(href);
    if (!fromHtml) {
      throw new RpcError(
        RPC_ERROR.INTERNAL,
        `could not resolve thread for post ${id}`,
      );
    }
    return {
      threadId: fromHtml,
      postId: id,
      page: extractThreadPageFromFinal(href) ?? page,
    };
  }
}

export function normalizeThreadUrl(input: string): string {
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
  if (!threadId) {
    throw new RpcError(
      RPC_ERROR.INTERNAL,
      `cannot extract thread id from ${finalUrl}`,
    );
  }

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

export function extractThreadId(url: string): string | null {
  const m = url.match(/\/threads\/(?:[^/]*?\.)?(\d+)\/?/);
  return m ? m[1] : null;
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
      const path = resolveDownloadPath($, el);
      downloads.push({
        host: info.host,
        url,
        text: text || info.host,
        group: path.group,
        edition: path.edition,
        platform: path.platform,
        part: path.part,
        kindHint: path.kindHint,
        topLevel: path.topLevel,
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

const PART_LABEL_RE = /Part\s*(\d+)/i;

const SPOILER_SEL =
  '.bbCodeSpoiler, details.x-spoiler, .bbCodeBlock--spoiler';

/** Section headers that are not download editions (games + animations/comics/assets). */
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

export type DownloadPath = {
  edition: string | null;
  platform: string | null;
  part: number | null;
  kindHint: NonNullable<GameDownload['kindHint']>;
  group: string | null;
  /** True when edition is null (Current) or discovered outside spoilers. */
  topLevel: boolean;
};

/**
 * Resolve structured download path (edition / platform / part) from the OP
 * DOM around a host link, including XF spoiler context.
 */
export function resolveDownloadPath(
  $: cheerio.CheerioAPI,
  el: Element,
): DownloadPath {
  const { platform, part, labels: nearLabels } = nearestPlatformAndPart($, el);
  const {
    edition: spoilerEdition,
    splitSpoiler,
    titles: spoilerTitles,
  } = resolveSpoilerEdition($, el);

  let edition = spoilerEdition;
  let topLevel = false;
  // Prefer edition from nearby bold labels (Season 3 + Win/Linux combined,
  // or Patch (…) heading) before walking further up the OP.
  if (!edition) {
    edition = editionFromNearLabels(nearLabels);
    if (edition && !isAuxRowLabel(edition)) topLevel = true;
  }
  if (!edition && !$(el).closest(SPOILER_SEL).length) {
    edition = nearestTopLevelEdition($, el);
    if (edition) topLevel = true;
  }
  // Unnamed Current (no edition) is always a top-level bucket.
  if (!edition) topLevel = true;

  const labels = [...spoilerTitles, ...nearLabels];
  if (edition) labels.push(edition);

  const kindHint = inferKindHint({
    labels,
    part,
    splitSpoiler,
    platform,
  });

  // Patches/extras are not top-level "Current" installs.
  if (kindHint === 'patch' || kindHint === 'extra') topLevel = false;

  const groupBits = [
    edition,
    platform,
    part != null ? `Part ${part}` : null,
  ].filter(Boolean) as string[];
  const group = groupBits.length ? groupBits.join(' · ') : null;

  return { edition, platform, part, kindHint, group, topLevel };
}

function normalizeGroupLabel(raw: string): string | null {
  const t = cleanText(raw).replace(/:\s*$/, '').trim();
  if (!t) return null;
  if (GROUP_LABEL_EXCLUDE.has(t.toLowerCase())) return null;
  return t;
}

function platformFromText(raw: string): string | null {
  const m = cleanText(raw).match(OS_LABEL_RE);
  if (!m) return null;
  return normalizeGroupLabel(m[0]) ?? cleanText(m[0]);
}

function partFromText(raw: string): number | null {
  const m = cleanText(raw).match(PART_LABEL_RE);
  if (!m) return null;
  return Number.parseInt(m[1], 10);
}

const AUX_ROW_RE =
  /^(patch(?:es)?|extras?|translations?|mods?)\b/i;

function isAuxRowLabel(raw: string): boolean {
  return AUX_ROW_RE.test(cleanText(raw).replace(/:\s*$/, ''));
}

function sameSpoilerOrNone(
  $: cheerio.CheerioAPI,
  linkEl: Element,
  candidate: cheerio.Cheerio<Element>,
): boolean {
  const linkSpoiler = $(linkEl).closest(SPOILER_SEL).get(0) ?? null;
  const candSpoiler = candidate.closest(SPOILER_SEL).get(0) ?? null;
  // Allow labels in the same spoiler (or both outside). Block prior/other spoilers.
  return candSpoiler === linkSpoiler;
}

function stripOsFromLabel(raw: string): string {
  return cleanText(raw)
    .replace(OS_LABEL_RE, ' ')
    .replace(/[/|,]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/:\s*$/, '')
    .trim();
}

function editionFromNearLabels(labels: string[]): string | null {
  // Prefer explicit Patch/Extra headings over season-like fragments in OS rows
  // (e.g. "(Ep.11 …) Win/Linux/Mac" must not win over a preceding "Patch").
  for (const raw of labels) {
    const t = cleanText(raw);
    if (t && isAuxRowLabel(t)) {
      const stripped = stripOsFromLabel(t);
      return cleanEditionLabel(stripped || t);
    }
  }
  // Split "Patch" + "(Ep.11...)<br> Win/Linux/Mac" across adjacent bolds
  for (let i = 0; i < labels.length - 1; i++) {
    const a = cleanText(labels[i]!);
    const b = cleanText(labels[i + 1]!);
    if (/^patch(?:es)?$/i.test(a.replace(/:\s*$/, '')) && /\(.*\)/.test(b)) {
      return cleanEditionLabel(`${a} ${stripOsFromLabel(b)}`.trim());
    }
    if (/^patch(?:es)?$/i.test(b.replace(/:\s*$/, '')) && /\(.*\)/.test(a)) {
      return cleanEditionLabel(`${b} ${stripOsFromLabel(a)}`.trim());
    }
  }
  for (const raw of labels) {
    const t = cleanText(raw);
    if (!t || isAuxRowLabel(t)) continue;
    if (looksLikeSeasonHeading(t) || looksLikeEditionName(t)) {
      const stripped = stripOsFromLabel(t);
      if (stripped && (looksLikeSeasonHeading(stripped) || looksLikeEditionName(stripped))) {
        return cleanEditionLabel(stripped);
      }
      if (!platformFromText(t)) {
        return cleanEditionLabel(t);
      }
    }
  }
  return null;
}

function nearestPlatformAndPart(
  $: cheerio.CheerioAPI,
  el: Element,
): { platform: string | null; part: number | null; labels: string[] } {
  let platform: string | null = null;
  let part: number | null = null;
  const labels: string[] = [];

  const considerLabel = (raw: string) => {
    const t = cleanText(raw);
    if (!t) return false;
    labels.push(t);
    if (part == null) {
      const p = partFromText(t);
      if (p != null) part = p;
    }
    if (platform == null) {
      const os = platformFromText(t);
      if (os) platform = os;
    }
    // Download section boundary
    if (/^downloads?$/i.test(t.replace(/:\s*$/, ''))) return true;
    // Patch/Extra owns the block (may share the bold with Win/Linux).
    if (isAuxRowLabel(t)) return true;
    // "Season 3 … Win/Linux" combined heading — stop once platform captured.
    // Do NOT stop on patch version bumps like "(Ep.11 → Ep.11) Win/Linux/Mac".
    if (platform != null && looksLikeSeasonHeading(t)) return true;
    // Pure season/split heading above the OS row.
    if (looksLikeSeasonHeading(t) && !platformFromText(t)) return true;
    // Different OS row above the current one — stop (don't bleed across platforms).
    if (platform != null) {
      const os = platformFromText(t);
      if (os && normalizeGroupLabel(os) !== normalizeGroupLabel(platform)) {
        return true;
      }
    }
    // Plain OS-only row: keep walking so a preceding "Patch" / "Season …" is seen.
    return false;
  };

  let node: AnyNode | null = el;
  let hops = 0;
  while (node && hops < 80) {
    let prev: AnyNode | null = (node as AnyNode).prev ?? null;
    while (prev) {
      if (isElement(prev)) {
        // Never pull Part/OS labels out of a prior spoiler block.
        if ($(prev).is(SPOILER_SEL)) {
          prev = prev.prev ?? null;
          hops++;
          continue;
        }
        const tag = prev.tagName?.toLowerCase();
        if (tag === 'b' || tag === 'strong') {
          if (sameSpoilerOrNone($, el, $(prev)) && considerLabel($(prev).text())) {
            return { platform, part, labels };
          }
        } else {
          const inner = $(prev).find('b, strong').last();
          // Same-spoiler labels are OK (XF wraps Win/Linux in spans inside the
          // splits spoiler). Only reject bold text that lives in a *different*
          // spoiler than the link.
          if (inner.length && sameSpoilerOrNone($, el, inner)) {
            if (considerLabel(inner.text())) {
              return { platform, part, labels };
            }
          }
        }
      } else if (isText(prev)) {
        if (considerLabel(prev.data)) {
          return { platform, part, labels };
        }
      }
      prev = prev.prev ?? null;
      hops++;
    }
    node = (node as AnyNode).parent ?? null;
    hops++;
  }
  return { platform, part, labels };
}

function spoilerButtonTitle(
  $: cheerio.CheerioAPI,
  spoiler: Element,
): string {
  const $spoiler = $(spoiler);
  if (
    spoiler.tagName?.toLowerCase() === 'details' ||
    $spoiler.hasClass('x-spoiler')
  ) {
    return cleanText($spoiler.children('summary').first().text());
  }
  return (
    cleanText(
      $spoiler
        .find('.bbCodeSpoiler-button-title, .bbCodeBlock-title')
        .first()
        .text(),
    ) || cleanText($spoiler.find('button').first().text())
  );
}

/** Headings that can name an edition (season/version/splits). Plain UI labels like
 * "Fan Signatures" must not become top-level editions for Win/Linux rows. */
const EDITION_NAME_RE =
  /\b(season|episode|ep\.?\s*\d|chapter|ch\.?\s*\d|act\b|interlude|archive|collection|volume|vol\.?\b|splits?|v\d)/i;

/** Strong season/bundle headings (not patch version bumps like "(Ep.11 → Ep.11)"). */
function looksLikeSeasonHeading(raw: string): boolean {
  const t = cleanText(raw).replace(/^\*+\s*/, '');
  if (!t || t.length > 120) return false;
  if (/^downloads?$/i.test(t)) return false;
  if (isAuxRowLabel(t)) return false;
  const stripped = stripOsFromLabel(t);
  if (!stripped) return false;
  if (/\b(season|interlude|splits?|archive|collection|volume|vol\.?\b)\b/i.test(stripped)) {
    return true;
  }
  // Soundtrack / version packs: "v0.8.5 (Original Soundtrack)"
  if (/^v\d/i.test(stripped) && !/\(.*->.*\)/.test(stripped)) return true;
  return false;
}

function looksLikeEditionName(raw: string): boolean {
  const t = cleanText(raw).replace(/^\*+\s*/, '');
  if (!t || t.length > 120) return false;
  if (/^downloads?$/i.test(t)) return false;
  if (OS_LABEL_RE.test(t) && !EDITION_NAME_RE.test(t)) return false;
  if (isAuxRowLabel(t)) return false;
  return EDITION_NAME_RE.test(t) || looksLikeSeasonHeading(t);
}

function cleanEditionLabel(raw: string): string | null {
  const t = cleanText(raw)
    .replace(/^\*+\s*/, '')
    .replace(/:\s*$/, '')
    .trim();
  if (!t) return null;
  return normalizeGroupLabel(t) ?? t;
}

function previousSignificantSiblingText(
  $: cheerio.CheerioAPI,
  spoiler: Element,
): string | null {
  // Prefer a short bold/strong edition label (e.g. <b>Splits</b> before a
  // generic "Spoiler" button) over long intro paragraphs.
  let prev: AnyNode | null = (spoiler as AnyNode).prev ?? null;
  let fallback: string | null = null;
  while (prev) {
    if (isElement(prev)) {
      if ($(prev).is(SPOILER_SEL)) {
        prev = prev.prev ?? null;
        continue;
      }
      const tag = prev.tagName?.toLowerCase();
      if (tag === 'br') {
        prev = prev.prev ?? null;
        continue;
      }

      const bold = $(prev).is('b, strong')
        ? $(prev)
        : $(prev).find('b, strong').last();
      if (bold.length) {
        const bt = cleanText(bold.text());
        if (looksLikeEditionName(bt)) {
          return cleanEditionLabel(bt);
        }
      }

      const t = cleanText($(prev).text());
      if (!t) {
        prev = prev.prev ?? null;
        continue;
      }
      if (looksLikeEditionName(t) && t.length <= 120) {
        return cleanEditionLabel(t);
      }
      if (
        !fallback &&
        (tag === 'b' ||
          tag === 'strong' ||
          tag === 'p' ||
          /^h[1-6]$/.test(tag)) &&
        t.length <= 80
      ) {
        fallback = cleanEditionLabel(t);
      }
    } else if (isText(prev)) {
      const t = cleanText(prev.data);
      if (t && looksLikeEditionName(t)) return cleanEditionLabel(t);
    }
    prev = prev.prev ?? null;
  }
  return fallback;
}

function resolveSpoilerEdition(
  $: cheerio.CheerioAPI,
  el: Element,
): {
  edition: string | null;
  splitSpoiler: boolean;
  titles: string[];
} {
  // Outermost → innermost so a season edition wins over nested split titles.
  const spoilers = $(el).parents(SPOILER_SEL).toArray().reverse();
  let edition: string | null = null;
  let outerSplitEdition: string | null = null;
  let splitSpoiler = false;
  const titles: string[] = [];

  for (let i = 0; i < spoilers.length; i++) {
    const spoiler = spoilers[i]!;
    const isOutermost = i === 0;
    const buttonTitle = spoilerButtonTitle($, spoiler);
    let title = buttonTitle;
    let fromFallback = false;
    if (!title || /^spoiler$/i.test(title)) {
      const prev = previousSignificantSiblingText($, spoiler);
      if (prev) {
        title = prev;
        fromFallback = true;
      }
    }
    if (buttonTitle) titles.push(buttonTitle);
    if (title && title !== buttonTitle) titles.push(title);

    if (buttonTitle && /split/i.test(buttonTitle)) {
      splitSpoiler = true;
    }
    if (!title || /^spoiler$/i.test(title)) continue;
    // Inner split titles must not replace an outer season. Outer-only
    // /split/i titles become edition when no non-split edition is found
    // (fromFallback titles like "Season 3 splits" already qualify above).
    if (!fromFallback && /split/i.test(title)) {
      if (isOutermost && !outerSplitEdition) {
        outerSplitEdition = cleanEditionLabel(title);
      }
      continue;
    }
    if (!edition) edition = cleanEditionLabel(title);
  }

  if (!edition && outerSplitEdition) edition = outerSplitEdition;

  return { edition, splitSpoiler, titles };
}

function nearestTopLevelEdition(
  $: cheerio.CheerioAPI,
  el: Element,
): string | null {
  let node: AnyNode | null = el;
  let hops = 0;
  while (node && hops < 80) {
    let prev: AnyNode | null = (node as AnyNode).prev ?? null;
    while (prev) {
      if (isElement(prev)) {
        if ($(prev).is(SPOILER_SEL)) {
          // Skip prior spoiler blocks; keep walking for an earlier heading.
          prev = prev.prev ?? null;
          hops++;
          continue;
        }
        const tag = prev.tagName?.toLowerCase();
        if (tag === 'b' || tag === 'strong' || /^h[1-6]$/.test(tag)) {
          const raw = cleanText($(prev).text());
          if (raw) {
            // Hit the Download section header — stop; OS rows above it have no edition.
            if (/^downloads?$/i.test(raw.replace(/:\s*$/, ''))) return null;
            if (isAuxRowLabel(raw)) return cleanEditionLabel(raw);
            if (!OS_LABEL_RE.test(raw) && looksLikeEditionName(raw)) {
              const label = cleanEditionLabel(raw);
              if (label) return label;
            }
            if (OS_LABEL_RE.test(raw) && looksLikeEditionName(raw)) {
              const stripped = stripOsFromLabel(raw);
              if (stripped && looksLikeEditionName(stripped)) {
                return cleanEditionLabel(stripped);
              }
            }
          }
        } else {
          const inner = $(prev).find('b, strong').last();
          if (inner.length && sameSpoilerOrNone($, el, inner)) {
            const raw = cleanText(inner.text());
            if (raw) {
              if (/^downloads?$/i.test(raw.replace(/:\s*$/, ''))) return null;
              if (isAuxRowLabel(raw)) return cleanEditionLabel(raw);
              if (!OS_LABEL_RE.test(raw) && looksLikeEditionName(raw)) {
                const label = cleanEditionLabel(raw);
                if (label) return label;
              }
              if (OS_LABEL_RE.test(raw) && looksLikeEditionName(raw)) {
                const stripped = stripOsFromLabel(raw);
                if (stripped && looksLikeEditionName(stripped)) {
                  return cleanEditionLabel(stripped);
                }
              }
            }
          }
        }
      } else if (isText(prev)) {
        const colon = prev.data.match(
          /(?:^|[\s])((?:[\w][\w /_.+-]{0,40}))\s*:\s*$/,
        );
        if (colon && !OS_LABEL_RE.test(colon[1])) {
          if (/^downloads?$/i.test(colon[1])) return null;
          if (isAuxRowLabel(colon[1])) return cleanEditionLabel(colon[1]);
          if (looksLikeEditionName(colon[1])) {
            const label = cleanEditionLabel(colon[1]);
            if (label) return label;
          }
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

function inferKindHint(opts: {
  labels: string[];
  part: number | null;
  splitSpoiler: boolean;
  platform: string | null;
}): NonNullable<GameDownload['kindHint']> {
  const blob = opts.labels.join(' ');
  // Word-bounded, aligned with AUX_ROW_RE / isAuxRowLabel.
  if (/\bpatch(?:es)?\b/i.test(blob)) return 'patch';
  if (/\b(extras?|translations?|mods?)\b/i.test(blob)) return 'extra';
  if (opts.part != null || opts.splitSpoiler) return 'split';
  if (opts.platform != null) return 'full';
  return 'other';
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
