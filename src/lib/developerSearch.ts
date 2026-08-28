import * as ipc from './ipc';
import type { ForumSearchPage } from '../types/forumSearch';

const GAMES_FORUM_FALLBACK_ID = 2;

let gamesForumNodeIdPromise: Promise<number> | null = null;

/** Resolve XenForo node id for the main "Games" forum from the live search form. */
export function resolveGamesForumNodeId(): Promise<number> {
  if (!gamesForumNodeIdPromise) {
    gamesForumNodeIdPromise = ipc
      .forumSearchFormOptions()
      .then((opts) => {
        const normalized = (label: string) => label.trim().toLowerCase();
        const games =
          opts.forums.find(
            (f) => normalized(f.label) === 'games' && f.depth === 1,
          ) ?? opts.forums.find((f) => normalized(f.label) === 'games');
        return games?.id ?? GAMES_FORUM_FALLBACK_ID;
      })
      .catch(() => GAMES_FORUM_FALLBACK_ID);
  }
  return gamesForumNodeIdPromise;
}

/** Title-only thread search in the Games forum for a developer name. */
export async function searchDeveloperGames(
  developerName: string,
  page: number,
): Promise<ForumSearchPage> {
  const query = developerName.trim();
  if (!query) {
    return { results: [], page: 1, totalPages: null, hasMore: false };
  }
  const forumNodeIds = [await resolveGamesForumNodeId()];
  return ipc.forumSearch({
    query,
    titleOnly: true,
    searchIn: 'titles',
    forumNodeIds,
    searchSubforums: false,
    sort: 'date',
    page,
  });
}
