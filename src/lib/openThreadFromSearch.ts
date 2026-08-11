import type { NavigateFunction } from 'react-router-dom';
import type { ForumSearchHit } from '../types/forumSearch';
import { pathForForumSearchHit } from './catalogForums';
import { resolvePost } from './ipc';

export type OpenThreadFromSearchOptions = {
  /** Absolute in-app path back to the search results (includes query string). */
  searchReturnTo?: string;
};

/**
 * Open a search hit. Post hits resolve via XF `/posts/{id}/` so we land on the
 * correct discussion page (same as F95) instead of scanning pages.
 */
export async function openThreadFromSearch(
  hit: ForumSearchHit,
  navigate: NavigateFunction,
  opts?: OpenThreadFromSearchOptions,
): Promise<void> {
  if (!hit.threadId) return;

  const searchReturnTo =
    typeof opts?.searchReturnTo === 'string' &&
    opts.searchReturnTo.startsWith('/search')
      ? opts.searchReturnTo
      : undefined;

  let postId = hit.postId?.trim() || null;
  let page: number | null = null;
  if (postId) {
    try {
      const resolved = await resolvePost(postId);
      postId = resolved.postId || postId;
      page = resolved.page;
    } catch {
      // Still open with ?post=; ThreadDiscussion will try resolvePost again.
    }
  }

  const path = pathForForumSearchHit({
    threadId: hit.threadId,
    forum: hit.forum,
    postId,
    page,
  });

  if (path.startsWith('/thread/')) {
    navigate(path, {
      state: {
        forum: hit.forum,
        title: hit.title,
        ...(searchReturnTo ? { searchReturnTo } : {}),
      },
    });
    return;
  }

  navigate(path, {
    state: searchReturnTo ? { searchReturnTo } : undefined,
  });
}
