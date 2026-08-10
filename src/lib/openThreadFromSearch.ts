import type { NavigateFunction } from 'react-router-dom';
import type { ForumSearchHit } from '../types/forumSearch';
import { pathForForumSearchHit } from './catalogForums';

export type OpenThreadFromSearchOptions = {
  /** Absolute in-app path back to the search results (includes query string). */
  searchReturnTo?: string;
};

export function openThreadFromSearch(
  hit: ForumSearchHit,
  navigate: NavigateFunction,
  opts?: OpenThreadFromSearchOptions,
): void {
  if (!hit.threadId) return;
  const path = pathForForumSearchHit(hit);
  const searchReturnTo =
    typeof opts?.searchReturnTo === 'string' &&
    opts.searchReturnTo.startsWith('/search')
      ? opts.searchReturnTo
      : undefined;

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
