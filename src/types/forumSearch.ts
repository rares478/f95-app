export type ForumSearchSort = 'relevance' | 'date';
export type ForumSearchIn = 'titles' | 'posts';

export interface ForumSearchParams {
  query: string;
  titleOnly?: boolean;
  /** F95 `c[content]=thread` — titles and first posts only. */
  containerOnly?: boolean;
  searchIn?: ForumSearchIn;
  sort?: ForumSearchSort;
  page?: number;
  threadId?: string;
  /** Comma-separated XenForo usernames (`c[users]`). */
  postedBy?: string;
  /** ISO date `YYYY-MM-DD` — newer than (`c[newer_than]`). */
  dateNewerThan?: string;
  /** ISO date `YYYY-MM-DD` — older than (`c[older_than]`). */
  dateOlderThan?: string;
  tags?: string;
  withoutTags?: string;
  minReplyCount?: number;
  prefixIds?: number[];
  forumNodeIds?: number[];
  searchSubforums?: boolean;
}

export interface ForumSearchNodeOption {
  id: number;
  label: string;
  /** XenForo search select indent level (each level = two nbsp). */
  depth: number;
}

export interface ForumSearchFormOptions {
  forums: ForumSearchNodeOption[];
}

export interface ForumSearchPrefix {
  name: string;
  cssClass: string | null;
}

export interface ForumSearchHit {
  threadId: string;
  /** When the hit targets a reply, XF links as `/threads/…/post-{id}`. */
  postId: string | null;
  /** XF minor label such as `Thread` or `Post #2`. */
  resultLabel: string | null;
  title: string;
  prefixes: ForumSearchPrefix[];
  snippet: string;
  author: string | null;
  authorId: string | null;
  avatarUrl: string | null;
  forum: string;
  dateLabel: string | null;
  dateIso: string | null;
  threadUrl: string;
}

export interface ForumSearchPage {
  results: ForumSearchHit[];
  page: number;
  totalPages: number | null;
  hasMore: boolean;
}
