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
  extractCurrentPageFromHtml,
  extractForumLabelFromHtml,
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
import {
  parseDownloadBlock,
  resolveDownloadRoot,
  type GameDownload,
} from './downloadBlock';

export type { GameDownload } from './downloadBlock';

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
  /** Thread OP author display name. */
  author: string | null;
  /** Absolute URL for the OP author's avatar, when present. */
  authorAvatarUrl: string | null;
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
  ): Promise<{
    threadId: string;
    postId: string;
    page: number | null;
    forum: string | null;
  }> {
    const id = String(postId).trim();
    if (!/^\d+$/.test(id)) {
      throw new RpcError(RPC_ERROR.INVALID_PARAMS, 'postId must be numeric');
    }
    const resolved = await this.resolveF95Url(`${BASE}/posts/${id}/`);
    return {
      threadId: resolved.threadId,
      postId: resolved.postId ?? id,
      page: resolved.page,
      forum: resolved.forum,
    };
  }

  /**
   * Follow an F95 thread/post URL (same as the site) and return thread id,
   * optional post/page, and forum label for in-app store vs thread routing.
   */
  async resolveF95Url(url: string): Promise<{
    threadId: string;
    postId: string | null;
    page: number | null;
    forum: string | null;
  }> {
    const raw = String(url).trim();
    if (!raw) {
      throw new RpcError(RPC_ERROR.INVALID_PARAMS, 'url required');
    }
    let absolute = raw;
    if (raw.startsWith('//')) absolute = `https:${raw}`;
    else if (raw.startsWith('/')) absolute = `${BASE}${raw}`;
    else if (!/^https?:\/\//i.test(raw)) {
      throw new RpcError(RPC_ERROR.INVALID_PARAMS, 'url must be absolute or site-relative');
    }

    log(`[game] GET resolve url ${absolute}`);
    const res = await this.http.get(absolute);
    assertNotCloudflareChallenge(res.body, res.headers, {
      message: 'Cloudflare challenge encountered on F95 URL resolve',
    });
    if (res.status >= 400) {
      throw new RpcError(
        RPC_ERROR.INTERNAL,
        `resolve url HTTP ${res.status} for ${absolute}`,
      );
    }

    const finalUrl = res.url || absolute;
    const forum = extractForumLabelFromHtml(res.body);
    const page =
      extractThreadPageFromFinal(finalUrl) ??
      extractCurrentPageFromHtml(res.body);
    const postId = extractPostIdFromFinal(finalUrl);
    const threadId = extractThreadId(finalUrl);
    if (threadId) {
      return { threadId, postId, page, forum };
    }

    const $ = cheerio.load(res.body);
    const href =
      $('link[rel="canonical"]').attr('href') ||
      $('a[href*="/threads/"]').first().attr('href') ||
      '';
    const fromHtml = extractThreadId(href);
    if (!fromHtml) {
      throw new RpcError(
        RPC_ERROR.INTERNAL,
        `could not resolve thread for url ${absolute}`,
      );
    }
    return {
      threadId: fromHtml,
      postId: extractPostIdFromFinal(href) ?? postId,
      page: extractThreadPageFromFinal(href) ?? page,
      forum,
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

  const author =
    cleanText(op.find('.message-name').first().text()) ||
    cleanText(op.attr('data-author') ?? '') ||
    null;
  const avatarSrc =
    op.find('.message-avatar img, .avatar img').first().attr('src') ??
    op.find('.message-avatar img, .avatar img').first().attr('data-src');
  const authorAvatarUrl = avatarSrc ? absoluteUrl(avatarSrc) : null;

  // -- Links first so screenshot gallery can be scoped to the download div --
  const { downloads, social } = collectLinks($, opBody);
  const downloadRoot = resolveDownloadRoot($, opBody);
  const { bannerUrl, screenshots } = resolveBannerAndScreenshots(
    $,
    opBody,
    downloadRoot,
  );

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

  // -- Description: keep inline story images; strip banner + gallery only --
  const galleryUrls = new Set<string>([
    ...(bannerUrl ? [bannerUrl] : []),
    ...screenshots,
  ]);
  const descriptionHtml = normalizeOpHtml($, opBody, galleryUrls);

  return {
    threadId,
    threadUrl: finalUrl,
    title: title || rawTitle,
    rawTitle,
    version,
    developer,
    author,
    authorAvatarUrl,
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

/**
 * Banner = first OP image outside the download block.
 * Screenshots = images in the same div as DOWNLOAD links (after them), never
 * description/changelog embeds elsewhere in the OP.
 */
export function resolveBannerAndScreenshots(
  $: cheerio.CheerioAPI,
  opBody: cheerio.Cheerio<Element>,
  downloadRoot: cheerio.Cheerio<Element> | null,
): { bannerUrl: string | null; screenshots: string[] } {
  const fromDownload = downloadRoot ? collectOpImages($, downloadRoot) : [];
  const screenshotSet = new Set(fromDownload);
  const all = collectOpImages($, opBody);
  const bannerUrl = all.find((u) => !screenshotSet.has(u)) ?? null;
  const screenshots = fromDownload
    .filter((u) => u !== bannerUrl)
    .slice(0, 30);
  return { bannerUrl, screenshots };
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

/** Exported for unit tests of Developer/field sibling parsing. */
export function collectFields(
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
    const cleaned = cleanFieldValue(value);
    if (!cleaned) return;
    // Use original-case label key for display.
    const displayLabel = label.replace(/:\s*$/, '');
    if (!fields[displayLabel] || fields[displayLabel].length < cleaned.length) {
      fields[displayLabel] = cleaned;
    }
  });
  return fields;
}

function isGenericDevLinkLabel(text: string): boolean {
  return /^(website|site|homepage|home|link|steam|gog|bluesky|bsky)$/i.test(
    text.trim(),
  );
}

function isSocialPlatformLabel(text: string): boolean {
  return /^(patreon|discord|itch\.?io|subscribestar|subscribe\s*star|twitter|x|ko-?fi|youtube)$/i.test(
    text.trim(),
  );
}

/** Strip leading colon and trailing " - " / "|" separators left by skipped links. */
function cleanFieldValue(raw: string): string {
  return cleanText(raw)
    .replace(/^:\s*/, '')
    .replace(/(\s*[-–—|/]\s*)+$/u, '');
}

function readSiblingsUntilBreak(
  $: cheerio.CheerioAPI,
  startEl: Element,
): string {
  // Read the value text following a label `<b>` until a line break or another
  // label. Social anchors (Patreon/Discord/…) mark the end of the value so
  // their button labels are not absorbed — unless the value is empty and the
  // social link text is the developer name itself (not "Patreon").
  const parts: string[] = [];
  let n: AnyNode | null = startEl.next ?? null;
  while (n) {
    if (isElement(n)) {
      if (n.tagName === 'br' || n.tagName === 'b') break;
      if (n.tagName === 'a') {
        const hrefRaw = $(n).attr('href') ?? '';
        const href = hrefRaw ? absoluteUrl(hrefRaw) : '';
        const info = href ? classifyHost(href) : null;
        const linkText = cleanText($(n).text());
        if (info?.category === 'social') {
          const haveName = cleanFieldValue(parts.join('')).length > 0;
          if (!haveName && linkText && !isSocialPlatformLabel(linkText)) {
            parts.push(linkText);
          }
          break;
        }
        if (linkText && !isGenericDevLinkLabel(linkText)) {
          parts.push(linkText);
        }
        n = n.next ?? null;
        continue;
      }
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
  const social: SocialLink[] = [];
  const seenSocial = new Set<string>();

  opBody.find('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href || href.startsWith('#')) return;
    const url = absoluteUrl(href);
    const info = classifyHost(url);
    if (!info || info.category !== 'social') return;
    if (seenSocial.has(url)) return;
    seenSocial.add(url);
    social.push({
      host: info.host,
      url,
      text: cleanText($(el).text()) || info.host,
    });
  });

  const root = resolveDownloadRoot($, opBody);
  const downloads = root ? parseDownloadBlock($, root) : [];

  return { downloads, social };
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
