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

import type { PostAttachment } from './threadPosts';

export type { PostAttachment };

export type GameDetailLayout = 'classic' | 'gamePage';

export type GamePageWhatsNew = {
  title: string;
  items: string[];
  historyHref: string | null;
};

export type GamePageFold = {
  title: string;
  html: string;
};

export type GamePageTagGroup = {
  key: string;
  title: string;
  tags: GameTag[];
};

export type GamePageStats = {
  likesLabel: string | null;
  likesTitle: string | null;
  viewsLabel: string | null;
  viewsTitle: string | null;
  repliesLabel: string | null;
  repliesTitle: string | null;
};

export type GamePagePayload = {
  whatsNew: GamePageWhatsNew | null;
  folds: GamePageFold[];
  tagGroups: GamePageTagGroup[];
  stats: GamePageStats | null;
  coverPositionY: string | null;
};

export interface GameDetail {
  threadId: string;
  threadUrl: string;
  title: string;
  rawTitle: string;
  version: string | null;
  developer: string | null;
  author: string | null;
  authorUserId: string | null;
  authorAvatarUrl: string | null;
  bannerUrl: string | null;
  screenshots: string[];
  descriptionHtml: string;
  /** Normalized OP Changelog spoiler HTML; null when absent. */
  changelogHtml: string | null;
  prefixes: GamePrefix[];
  fields: Record<string, string>;
  tags: GameTag[];
  /** Thread BR rating (0–5), when present on the thread page. */
  rating: number | null;
  downloads: GameDownload[];
  social: SocialLink[];
  attachments: PostAttachment[];
  /** Presentation layout. Classic OP vs F95 game page. Defaults to classic. */
  layout: GameDetailLayout;
  /** Store-only structured sections when layout is gamePage. */
  gamePage?: GamePagePayload | null;
}
