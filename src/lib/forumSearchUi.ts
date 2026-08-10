import type { ForumSearchIn, ForumSearchSort } from '../types/forumSearch';

export type ForumSearchFilterSnapshot = {
  titleOnly: boolean;
  searchIn: ForumSearchIn;
  sort: ForumSearchSort;
};

export type ForumSearchAttemptSnapshot = ForumSearchFilterSnapshot & {
  query: string;
};

/** Ignore stale IPC responses when a newer search superseded this one. */
export function shouldApplySearchResult(
  requestGeneration: number,
  latestGeneration: number,
): boolean {
  return requestGeneration === latestGeneration;
}

/** True when live filter controls differ from the last successful search snapshot. */
export function isSearchFiltersDirty(
  live: ForumSearchFilterSnapshot,
  active: ForumSearchFilterSnapshot | null,
): boolean {
  if (!active) return false;
  return (
    live.titleOnly !== active.titleOnly ||
    live.searchIn !== active.searchIn ||
    live.sort !== active.sort
  );
}
