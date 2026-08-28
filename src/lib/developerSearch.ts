import * as ipc from './ipc';
import type { ForumSearchPage } from '../types/forumSearch';

/**
 * Developer catalog search — forum thread titles, not SAM.
 *
 * SAM can list the same games by creator, e.g.
 * https://f95zone.to/sam/latest_alpha/#/cat=games/page=1/creator=Andrealphus
 *
 * We use XenForo forum search instead so each result maps to a thread page we can
 * open for download links, social URLs, and OP banner/screenshots (via gameDetail).
 */

const GAMES_FORUM_FALLBACK_ID = 2;

/** SAM creator URL for reference — not used for in-app developer profiles. */
export function samCreatorBrowseUrl(developerName: string): string {
  const creator = encodeURIComponent(developerName.trim());
  return `https://f95zone.to/sam/latest_alpha/#/cat=games/page=1/creator=${creator}`;
}
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

/** Title-only Games forum search for a developer name in thread titles. */
export async function searchDeveloperGames(
  developerName: string,
  page: number,
): Promise<ForumSearchPage> {  const query = developerName.trim();
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
