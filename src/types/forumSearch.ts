export type ForumSearchSort = 'relevance' | 'date';
export type ForumSearchIn = 'titles' | 'posts';

export interface ForumSearchParams {
  query: string;
  titleOnly?: boolean;
  searchIn?: ForumSearchIn;
  sort?: ForumSearchSort;
  page?: number;
}

export interface ForumSearchHit {
  threadId: string;
  title: string;
  snippet: string;
  author: string | null;
  authorId: string | null;
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
