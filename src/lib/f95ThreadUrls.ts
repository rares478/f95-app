const THREAD_URL_RE = /\/threads\/(?:[^/?#]*\.)?(\d+)/;
const POSTS_PATH_RE = /\/posts\/(\d+)/;
const POST_ANCHOR_RE = /(?:#post-|\/post-)(\d+)/i;
const THREAD_PAGE_RE = /\/page-(\d+)/i;
const QUERY_PAGE_RE = /[?&]page=(\d+)/i;

export function extractThreadIdFromUrl(url: string | null): string | null {
  if (!url) return null;
  const m = url.match(THREAD_URL_RE);
  return m ? m[1] : null;
}

export function extractPostIdFromUrl(url: string | null): string | null {
  if (!url) return null;
  const posts = url.match(POSTS_PATH_RE);
  if (posts) return posts[1];
  const anchor = url.match(POST_ANCHOR_RE);
  return anchor ? anchor[1] : null;
}

export function extractThreadPageFromUrl(url: string | null): number | null {
  if (!url) return null;
  const path = url.match(THREAD_PAGE_RE);
  if (path) {
    const n = Number.parseInt(path[1]!, 10);
    return Number.isFinite(n) && n >= 1 ? n : null;
  }
  const query = url.match(QUERY_PAGE_RE);
  if (query) {
    const n = Number.parseInt(query[1]!, 10);
    return Number.isFinite(n) && n >= 1 ? n : null;
  }
  return null;
}

export type F95ContentTarget =
  | { kind: 'thread'; threadId: string; postId: string | null; page: number | null }
  | { kind: 'post'; postId: string }
  | { kind: 'external'; url: string }
  | { kind: 'none' };

export function parseF95ContentTarget(url: string | null): F95ContentTarget {
  if (!url) return { kind: 'none' };
  if (/\/conversations\//i.test(url) || /\/account\//i.test(url)) {
    return { kind: 'external', url };
  }
  const threadId = extractThreadIdFromUrl(url);
  if (threadId) {
    return {
      kind: 'thread',
      threadId,
      postId: extractPostIdFromUrl(url),
      page: extractThreadPageFromUrl(url),
    };
  }
  const postOnly = url.match(POSTS_PATH_RE);
  if (postOnly) return { kind: 'post', postId: postOnly[1]! };
  if (/^https?:\/\//i.test(url) || url.startsWith('/')) {
    return { kind: 'external', url };
  }
  return { kind: 'none' };
}
