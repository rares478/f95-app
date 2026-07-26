export interface ThreadPost {
  postId: string;
  author: string;
  authorAvatarUrl: string | null;
  postedAt: string | null;
  html: string;
  permalink: string | null;
}

export interface ThreadPostsPage {
  threadId: string;
  page: number;
  /** From XF pagination if detectable; otherwise null */
  totalPages: number | null;
  hasMore: boolean;
  posts: ThreadPost[];
}

export interface ResolvePostResult {
  threadId: string;
  postId: string;
}
