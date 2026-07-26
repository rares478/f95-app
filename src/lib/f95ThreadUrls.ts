const THREAD_URL_RE = /\/threads\/(?:[^/?#]*\.)?(\d+)/;
const POSTS_PATH_RE = /\/posts\/(\d+)/;
const POST_ANCHOR_RE = /(?:#post-|\/post-)(\d+)/i;

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

export type F95ContentTarget =
  | { kind: 'thread'; threadId: string; postId: string | null }
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
    return { kind: 'thread', threadId, postId: extractPostIdFromUrl(url) };
  }
  const postOnly = url.match(POSTS_PATH_RE);
  if (postOnly) return { kind: 'post', postId: postOnly[1] };
  if (/^https?:\/\//i.test(url) || url.startsWith('/')) {
    return { kind: 'external', url };
  }
  return { kind: 'none' };
}
