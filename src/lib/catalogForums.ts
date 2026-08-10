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

export function pathForForumSearchHit(
  hit: Pick<ForumSearchHit, 'threadId' | 'forum'>,
): string {
  const cat = samCategoryForForum(hit.forum);
  if (cat) return `/store/game/${hit.threadId}?cat=${cat}`;
  return `/thread/${hit.threadId}`;
}
