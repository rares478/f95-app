import { XMLParser } from 'fast-xml-parser';

export type RssItemKind = 'new' | 'update';

export interface RssFeedItem {
  guid: string;
  threadId: string;
  title: string;
  displayTitle: string;
  creator: string | null;
  thumbnailUrl: string | null;
  pubDate: string | null;
  link: string;
  kind: RssItemKind;
  version: string | null;
}

export interface RssFeed {
  items: RssFeedItem[];
}

const THREAD_ID_RE = /\/threads\/(\d+)/;

/** @internal Exported for unit tests. */
export function parseRssXml(xml: string): RssFeed {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    trimValues: true,
    parseTagValue: false,
  });
  const doc = parser.parse(xml) as Record<string, unknown>;
  const channel = (doc.rss as Record<string, unknown> | undefined)?.channel as
    | Record<string, unknown>
    | undefined;
  if (!channel) return { items: [] };

  const rawItems = channel.item;
  const list = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];

  const items: RssFeedItem[] = [];
  for (const raw of list) {
    const item = toRssItem(raw);
    if (item) items.push(item);
  }
  return { items };
}

function toRssItem(raw: unknown): RssFeedItem | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;

  const link = stringVal(r.link);
  const guid = stringVal(r.guid) ?? link;
  if (!link || !guid) return null;

  const threadId = extractThreadId(link) ?? extractThreadId(guid);
  if (!threadId) return null;

  const title = stringVal(r.title) ?? `Thread ${threadId}`;
  const { displayTitle, kind, version } = parseRssTitle(title);
  const description = stringVal(r.description) ?? '';
  const creator =
    stringVal(r['dc:creator']) ??
    stringVal((r.creator as Record<string, unknown> | undefined)?.['#text']) ??
    null;

  return {
    guid,
    threadId,
    title,
    displayTitle,
    creator,
    thumbnailUrl: extractThumbnail(description),
    pubDate: stringVal(r.pubDate),
    link,
    kind,
    version,
  };
}

/** @internal Exported for unit tests. */
export function parseRssTitle(title: string): {
  displayTitle: string;
  kind: RssItemKind;
  version: string | null;
} {
  const kind: RssItemKind = /^\[NEW\]/i.test(title) ? 'new' : 'update';
  const brackets = [...title.matchAll(/\[([^\]]+)\]/g)];
  const version =
    brackets.length >= 2 && !/^(NEW|UPDATE)$/i.test(brackets[brackets.length - 1][1])
      ? brackets[brackets.length - 1][1].trim()
      : null;
  const displayTitle = title.replace(/^\[(NEW|UPDATE)\]\s*/i, '').trim();
  return { displayTitle, kind, version };
}

function extractThreadId(url: string): string | null {
  const m = url.match(THREAD_ID_RE);
  return m ? m[1] : null;
}

function extractThumbnail(description: string): string | null {
  const m = description.match(/<img[^>]+src=["']([^"']+)["']/i);
  return m ? m[1].trim() : null;
}

function stringVal(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object' && !Array.isArray(v)) {
    const text = (v as Record<string, unknown>)['#text'];
    if (typeof text === 'string') return text.trim() || null;
  }
  const s = String(v).trim();
  return s.length ? s : null;
}
