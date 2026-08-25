import { createHash } from 'node:crypto';
import type * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import { isAllowedAttachmentUrl } from '../f95/attachmentUrl';
import { F95_BASE } from '../../shared/constants';

export interface PostAttachment {
  id: string;
  fileName: string;
  fileSize: number | null;
  url: string;
  isImage: boolean;
}

const IMAGE_EXTS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
  'avif',
]);

/** XF path form: /attachments/name.123/ */
const ATTACHMENT_ID_RE = /\/attachments\/(?:[^/]*\.)?(\d+)\//i;
/** CDN form: attachments.f95zone.to/YYYY/MM/12345_filename.ext */
const CDN_ATTACHMENT_ID_RE =
  /attachments\.f95zone\.to\/\d{4}\/\d{2}\/(\d+)_/i;

const SIZE_RE =
  /([\d]+(?:[.,]\d+)?)\s*(B|KB|MB|GB|TB|KiB|MiB|GiB|TiB)\b/i;

const UNIT_BYTES: Record<string, number> = {
  B: 1,
  KB: 1000,
  MB: 1000 ** 2,
  GB: 1000 ** 3,
  TB: 1000 ** 4,
  KIB: 1024,
  MIB: 1024 ** 2,
  GIB: 1024 ** 3,
  TIB: 1024 ** 4,
};

function absUrl(href: string | undefined | null): string | null {
  if (!href) return null;
  if (/^https?:\/\//i.test(href)) return href;
  if (href.startsWith('//')) return `https:${href}`;
  if (href.startsWith('/')) return `${F95_BASE}${href}`;
  return null;
}

function stableIdFromUrl(url: string): string {
  return createHash('sha1').update(url).digest('hex').slice(0, 16);
}

export function isAttachmentImageFileName(fileName: string): boolean {
  const m = fileName.match(/\.([a-z0-9]+)$/i);
  if (!m) return false;
  return IMAGE_EXTS.has(m[1]!.toLowerCase());
}

export function parseHumanFileSize(text: string): number | null {
  const m = text.match(SIZE_RE);
  if (!m) return null;
  const raw = m[1]!.replace(',', '.');
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n)) return null;
  const unit = m[2]!.toUpperCase();
  const mul = UNIT_BYTES[unit];
  if (mul == null) return null;
  return Math.round(n * mul);
}

function attachmentIdFromUrl(url: string): string {
  const pathId = url.match(ATTACHMENT_ID_RE)?.[1];
  if (pathId) return pathId;
  const cdnId = url.match(CDN_ATTACHMENT_ID_RE)?.[1];
  if (cdnId) return cdnId;
  return stableIdFromUrl(url);
}

function isOutsideBbWrapper(
  $: cheerio.CheerioAPI,
  el: Element,
): boolean {
  return $(el).closest('.bbWrapper').length === 0;
}

function findAttachmentAnchor(
  $: cheerio.CheerioAPI,
  $row: cheerio.Cheerio<Element>,
): cheerio.Cheerio<Element> | null {
  const candidates = [
    ...$row.find('.attachment-name a[href]').toArray(),
    ...$row.find('a[href]').toArray(),
  ];
  for (const el of candidates) {
    const $a = $(el);
    const url = absUrl($a.attr('href'));
    if (url && isAllowedAttachmentUrl(url)) return $a;
  }
  return null;
}

function parseOneAttachment(
  $: cheerio.CheerioAPI,
  $row: cheerio.Cheerio<Element>,
): PostAttachment | null {
  const $link = findAttachmentAnchor($, $row);
  if (!$link) return null;

  const href = $link.attr('href') ?? '';
  const url = absUrl(href);
  if (!url || !isAllowedAttachmentUrl(url)) return null;

  const title = ($link.attr('title') || '').replace(/\s+/g, ' ').trim();
  const text = ($link.text() || '').replace(/\s+/g, ' ').trim();
  const fileName =
    text ||
    title ||
    href.split('/').filter(Boolean).pop() ||
    'attachment';

  const classAttr = `${$row.attr('class') ?? ''} ${$link.attr('class') ?? ''}`;
  const markedImage =
    /\battachment--image\b/i.test(classAttr) ||
    /\bfile--image\b/i.test(classAttr) ||
    $row.find('.attachment-thumbnail').length > 0;

  const detailsText = $row.find('.attachment-details').text();
  const fileSize = parseHumanFileSize(detailsText) ?? parseHumanFileSize($row.text());

  return {
    id: attachmentIdFromUrl(url),
    fileName,
    fileSize,
    url,
    isImage: markedImage || isAttachmentImageFileName(fileName),
  };
}

/**
 * Parse XF message file attachments from chrome outside `.bbWrapper`.
 * Never scrapes body / bbWrapper links for the list.
 */
export function parseMessageAttachments(
  $: cheerio.CheerioAPI,
  $message: cheerio.Cheerio<Element>,
): PostAttachment[] {
  const out: PostAttachment[] = [];
  const seenIds = new Set<string>();
  const seenUrls = new Set<string>();

  const push = (att: PostAttachment) => {
    if (seenIds.has(att.id) || seenUrls.has(att.url)) return;
    seenIds.add(att.id);
    seenUrls.add(att.url);
    out.push(att);
  };

  const $chrome = $message
    .find('.message-attachments')
    .filter((_, el) => isOutsideBbWrapper($, el));

  const roots =
    $chrome.length > 0
      ? $chrome
      : $message
          .find('ul.attachmentList')
          .filter((_, el) => isOutsideBbWrapper($, el));

  roots.each((_, rootEl) => {
    const $root = $(rootEl);
    const $rows = $root.find('li.attachment');

    if ($rows.length > 0) {
      $rows.each((_, rowEl) => {
        const att = parseOneAttachment($, $(rowEl));
        if (att) push(att);
      });
      return;
    }

    $root.find('a[href]').each((_, linkEl) => {
      const url = absUrl($(linkEl).attr('href'));
      if (!url || !isAllowedAttachmentUrl(url)) return;
      const att = parseOneAttachment($, $(linkEl).parent());
      if (att) push(att);
    });
  });

  return out;
}
