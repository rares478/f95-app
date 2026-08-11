import type { SamCategory } from '../types/sam';
import type { ForumSearchHit } from '../types/forumSearch';

const FORUM_TO_CAT: Record<string, SamCategory> = {
  games: 'games',
  mods: 'mods',
  'animations & loops': 'animations',
  'comics & stills': 'comics',
  'asset releases': 'assets',
};

export function normalizeForumLabel(forum: string): string {
  return forum.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function samCategoryForForum(forum: string): SamCategory | null {
  return FORUM_TO_CAT[normalizeForumLabel(forum)] ?? null;
}

export type ForumSearchHitPathInput = Pick<
  ForumSearchHit,
  'threadId' | 'forum' | 'postId'
> & {
  /** XF discussion page when known (from resolvePost). */
  page?: number | null;
};

export function pathForForumSearchHit(hit: ForumSearchHitPathInput): string {
  const cat = samCategoryForForum(hit.forum);
  const postId = hit.postId?.trim() || '';
  const page =
    hit.page != null && Number.isFinite(hit.page) && hit.page > 1
      ? Math.floor(hit.page)
      : null;

  if (cat) {
    const params = new URLSearchParams({ cat });
    if (postId) params.set('post', postId);
    if (page) params.set('page', String(page));
    return `/store/game/${hit.threadId}?${params.toString()}`;
  }

  const params = new URLSearchParams();
  if (postId) params.set('post', postId);
  if (page) params.set('page', String(page));
  const q = params.toString();
  return q ? `/thread/${hit.threadId}?${q}` : `/thread/${hit.threadId}`;
}
