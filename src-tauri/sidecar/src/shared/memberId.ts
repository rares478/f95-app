import type * as cheerio from 'cheerio';
import type { Element } from 'domhandler';

export function extractMemberUserIdFromHref(
  href: string | null | undefined,
): string | null {
  if (!href) return null;
  const m = href.match(/\/members\/(?:[^/]*?\.)?(\d+)\/?(?:[?#].*)?$/i);
  return m ? m[1]! : null;
}

export function parseMessageAuthorUserId(
  $: cheerio.CheerioAPI,
  $message: cheerio.Cheerio<Element>,
): string | null {
  const $headerLink = $message
    .find(
      '.message-name a[href*="/members/"], .message-userDetails a.username[href*="/members/"], .message-avatar a[href*="/members/"], a.avatar[href*="/members/"]',
    )
    .first();
  const fromHref = extractMemberUserIdFromHref($headerLink.attr('href'));
  if (fromHref) return fromHref;

  const dataAttr =
    $headerLink.attr('data-user-id') ??
    $message.attr('data-user-id') ??
    $message.find('[data-user-id]').first().attr('data-user-id');
  if (dataAttr && /^\d+$/.test(dataAttr)) return dataAttr;

  return null;
}
