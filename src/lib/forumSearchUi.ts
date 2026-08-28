import type { ForumSearchIn, ForumSearchSort } from '../types/forumSearch';

export type ForumSearchFilterSnapshot = {
  titleOnly: boolean;
  searchIn: ForumSearchIn;
  sort: ForumSearchSort;
  threadId?: string;
};

export type ForumSearchAttemptSnapshot = ForumSearchFilterSnapshot & {
  query: string;
};

export type ForumSearchUrlState = ForumSearchAttemptSnapshot & {
  page: number;
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
    live.sort !== active.sort ||
    (live.threadId ?? '') !== (active.threadId ?? '')
  );
}

function parseSearchIn(raw: string | null): ForumSearchIn {
  return raw === 'titles' ? 'titles' : 'posts';
}

function parseSort(raw: string | null): ForumSearchSort {
  return raw === 'date' ? 'date' : 'relevance';
}

function parseThreadId(raw: string | null): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return undefined;
  const n = parseInt(trimmed, 10);
  return n > 0 ? trimmed : undefined;
}

/** Read optional `?thread=` scope without requiring `q`. */
export function parseForumSearchThreadParam(
  params: URLSearchParams,
): string | undefined {
  return parseThreadId(params.get('thread'));
}

/** Restore an active search from `/search?...` when remounting (e.g. after Back). */
export function parseForumSearchSearchParams(
  params: URLSearchParams,
): ForumSearchUrlState | null {
  const query = (params.get('q') ?? '').trim();
  if (!query) return null;
  const titleOnly =
    params.get('title_only') === '1' || params.get('titleOnly') === '1';
  const searchIn = parseSearchIn(
    params.get('search_in') ?? params.get('searchIn'),
  );
  const sort = parseSort(params.get('sort'));
  const pageRaw = parseInt(params.get('page') ?? '1', 10);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
  const threadId = parseForumSearchThreadParam(params);
  return { query, titleOnly, searchIn, sort, page, threadId };
}

/** Serialize search state into URL query params (omit defaults). */
export function forumSearchToSearchParams(
  state: ForumSearchUrlState,
): URLSearchParams {
  const params = new URLSearchParams();
  params.set('q', state.query.trim());
  if (state.titleOnly) params.set('title_only', '1');
  if (state.searchIn !== 'posts') params.set('search_in', state.searchIn);
  if (state.sort !== 'relevance') params.set('sort', state.sort);
  if (state.page > 1) params.set('page', String(state.page));
  if (state.threadId) params.set('thread', state.threadId);
  return params;
}
