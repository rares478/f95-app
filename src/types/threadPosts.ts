export interface ThreadPost {
  postId: string;
  author: string;
  authorUserId: string | null;
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
  /** Forum title when known (for store vs thread routing). */
  forum: string | null;
}

export interface ResolveF95UrlResult {
  threadId: string;
  postId: string | null;
  page: number | null;
  forum: string | null;
}

export interface ThreadReplyResult {
  threadId: string;
  postId: string | null;
  page: number | null;
}

export interface BbcodePreviewResult {
  html: string;
}
