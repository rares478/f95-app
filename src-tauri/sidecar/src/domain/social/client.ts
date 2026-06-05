import { BrowserClient } from 'browser-rest-api';
import * as cheerio from 'cheerio';
import { RPC_ERROR, RpcError } from '../../rpc';
import { log } from '../../logger';

const BASE = 'https://f95zone.to';

export interface FollowedUser {
  userId: string;
  username: string;
  avatarUrl: string | null;
  profileUrl: string;
  customTitle: string | null;
}

export class SocialClient {
  constructor(private readonly http: BrowserClient) {}

  /**
   * Scrape `/account/following` for the list of users this account follows.
   * Returns `[]` when the user follows nobody. The page layout used here
   * matches the most common XenForo 2 patterns; if F95 changes it, run
   * __manual__/probe-following.ts again to update the selectors.
   */
  async getFollowing(): Promise<FollowedUser[]> {
    log('[social] GET /account/following');
    const res = await this.http.get(`${BASE}/account/following`);
    if (res.status >= 400) {
      throw new RpcError(
        RPC_ERROR.INTERNAL,
        `following fetch HTTP ${res.status}`,
      );
    }
    return parseFollowing(res.body);
  }
}

function parseFollowing(html: string): FollowedUser[] {
  const $ = cheerio.load(html);
  const main = $('.p-body-main, .p-body, body');

  // Empty state: "You are not currently following any members." or similar.
  const emptyText = main.find('.block-row, .blockMessage, .p-body-main').text();
  if (/not\s+currently\s+following/i.test(emptyText)) {
    return [];
  }

  const seen = new Map<string, FollowedUser>();

  // Try multiple XF2 patterns. Each yields zero rows if not present.
  const rowSelectors = [
    'ol.memberList li',
    '.memberList-row',
    '.contentRow',
    '.structItem--member',
    '.block-row',
  ];
  for (const sel of rowSelectors) {
    $(sel).each((_, el) => {
      const $row = $(el);
      const $link = $row
        .find('a[href*="/members/"]')
        .filter((_i, a) => !!extractUserIdFromHref($(a).attr('href') ?? ''))
        .first();
      if ($link.length === 0) return;
      const href = $link.attr('href') ?? '';
      const userId = extractUserIdFromHref(href);
      if (!userId || seen.has(userId)) return;

      const username = cleanText($link.text()) || extractUsernameFromHref(href);
      const $avatar = $row.find('img.avatar, .avatarWrapper img, .memberList-avatar img').first();
      const avatarUrl = absoluteUrl(
        $avatar.attr('src') ?? $avatar.attr('data-src') ?? '',
      );
      const customTitle =
        cleanText($row.find('.userTitle, .memberList-customTitle, .memberList-stats').first().text()) ||
        null;

      seen.set(userId, {
        userId,
        username: username || `User ${userId}`,
        avatarUrl: avatarUrl && !avatarUrl.startsWith('data:') ? avatarUrl : null,
        profileUrl: absoluteUrl(href) ?? `${BASE}/members/${userId}/`,
        customTitle: customTitle && customTitle.length < 120 ? customTitle : null,
      });
    });
    if (seen.size > 0) break;
  }

  return Array.from(seen.values());
}

function extractUserIdFromHref(href: string): string | null {
  // /members/<slug>.<id>/ or /members/<id>/
  const m = href.match(/\/members\/(?:[^/]*?\.)?(\d+)\/?(?:#.*)?$/);
  return m ? m[1] : null;
}

function extractUsernameFromHref(href: string): string {
  const m = href.match(/\/members\/([^/.]+)/);
  return m ? m[1].replace(/-/g, ' ') : '';
}

function absoluteUrl(src: string): string {
  if (!src) return '';
  if (/^https?:\/\//i.test(src)) return src;
  if (src.startsWith('//')) return `https:${src}`;
  if (src.startsWith('/')) return `${BASE}${src}`;
  return `${BASE}/${src}`;
}

function cleanText(s: string | null | undefined): string {
  if (!s) return '';
  return s.replace(/\s+/g, ' ').trim();
}
