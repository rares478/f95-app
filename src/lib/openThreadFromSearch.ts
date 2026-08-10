import type { NavigateFunction } from 'react-router-dom';
import type { ForumSearchHit } from '../types/forumSearch';
import { pathForForumSearchHit } from './catalogForums';

export function openThreadFromSearch(
  hit: ForumSearchHit,
  navigate: NavigateFunction,
): void {
  if (!hit.threadId) return;
  const path = pathForForumSearchHit(hit);
  if (path.startsWith('/thread/')) {
    navigate(path, { state: { forum: hit.forum, title: hit.title } });
    return;
  }
  navigate(path);
}
