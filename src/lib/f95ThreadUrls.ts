const THREAD_URL_RE = /\/threads\/(?:[^/?#]*\.)?(\d+)/;
const POSTS_PATH_RE = /\/posts\/(\d+)/;
const POST_ANCHOR_RE = /(?:#post-|\/post-)(\d+)/i;
const THREAD_PAGE_RE = /\/page-(\d+)/i;
const QUERY_PAGE_RE = /[?&]page=(\d+)/i;
const CONVERSATION_PATH_RE = /\/conversations\/([^/?#]+?\.\d+)(?:\/|$|\?|#)/i;

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

/** Slug.id segment from a conversation URL, e.g. `hello-world.12345`. */
export function extractConversationPathFromUrl(url: string | null): string | null {
  if (!url) return null;
  const m = url.match(CONVERSATION_PATH_RE);
  return m ? decodeURIComponent(m[1]!) : null;
}

export function extractConversationIdFromPath(conversationPath: string): string {
  const m = conversationPath.match(/\.(\d+)$/);
  return m ? m[1]! : conversationPath.replace(/\D/g, '') || conversationPath;
}

export function conversationAppPath(conversationPath: string): string {
  return `/conversations/${encodeURIComponent(conversationPath)}`;
}

export type F95ContentTarget =
  | { kind: 'thread'; threadId: string; postId: string | null; page: number | null }
  | { kind: 'post'; postId: string }
  | { kind: 'conversation'; conversationPath: string; conversationId: string }
  | { kind: 'external'; url: string }
  | { kind: 'none' };

export function parseF95ContentTarget(url: string | null): F95ContentTarget {
  if (!url) return { kind: 'none' };

  const conversationPath = extractConversationPathFromUrl(url);
  if (conversationPath) {
    return {
      kind: 'conversation',
      conversationPath,
      conversationId: extractConversationIdFromPath(conversationPath),
    };
  }

  if (/\/account\//i.test(url)) {
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
