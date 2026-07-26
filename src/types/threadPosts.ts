export interface ThreadPost {
  postId: string;
  author: string;
  authorAvatarUrl: string | null;
  postedAt: string | null;
  html: string;
  /** Normalized XF profile signature HTML, when present. */
  signatureHtml: string | null;
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
  /** XF page when known from the redirect/canonical URL. */
  page: number | null;
}
