export type ForumSearchSort = 'relevance' | 'date';
export type ForumSearchIn = 'titles' | 'posts';

export interface ForumSearchParams {
  query: string;
  titleOnly?: boolean;
  searchIn?: ForumSearchIn;
  sort?: ForumSearchSort;
  page?: number;
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
