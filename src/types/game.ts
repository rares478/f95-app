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

export interface GameDetail {
  threadId: string;
  threadUrl: string;
  title: string;
  rawTitle: string;
  version: string | null;
  developer: string | null;
  author: string | null;
  authorAvatarUrl: string | null;
  bannerUrl: string | null;
  screenshots: string[];
  descriptionHtml: string;
  prefixes: GamePrefix[];
  fields: Record<string, string>;
  tags: GameTag[];
  downloads: GameDownload[];
  social: SocialLink[];
}
