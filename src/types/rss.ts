import type { SamCategory } from './sam';

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

export interface RssFeedOptions {
  category?: SamCategory;
}
