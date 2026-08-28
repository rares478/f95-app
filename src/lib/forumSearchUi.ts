import type {
  ForumSearchFormOptions,
  ForumSearchIn,
  ForumSearchNodeOption,
  ForumSearchParams,
  ForumSearchSort,
} from '../types/forumSearch';

/** XenForo-style indent for forum `<option>` labels (`&nbsp;&nbsp;` per depth). */
export function formatForumNodeOptionLabel(f: ForumSearchNodeOption): string {
  const depth = Math.max(0, f.depth ?? 0);
  return `${'\u00a0'.repeat(depth * 2)}${f.label}`;
}

export type ForumSearchAdvancedSnapshot = {
  containerOnly: boolean;
  postedBy: string;
  dateNewerThan: string;
  dateOlderThan: string;
  tags: string;
  withoutTags: string;
  minReplyCount: number;
  prefixIds: number[];
  forumNodeIds: number[];
  searchSubforums: boolean;
};

export const EMPTY_FORUM_SEARCH_ADVANCED: ForumSearchAdvancedSnapshot = {
  containerOnly: false,
  postedBy: '',
  dateNewerThan: '',
  dateOlderThan: '',
  tags: '',
  withoutTags: '',
  minReplyCount: 0,
  prefixIds: [],
  forumNodeIds: [],
  searchSubforums: true,
};

export type ForumSearchFilterSnapshot = {
  titleOnly: boolean;
  searchIn: ForumSearchIn;
  sort: ForumSearchSort;
  threadId?: string;
} & ForumSearchAdvancedSnapshot;

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

function arraysEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort((x, y) => x - y);
  const sb = [...b].sort((x, y) => x - y);
  return sa.every((v, i) => v === sb[i]);
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
    (live.threadId ?? '') !== (active.threadId ?? '') ||
    live.containerOnly !== active.containerOnly ||
    live.postedBy.trim() !== active.postedBy.trim() ||
    live.dateNewerThan !== active.dateNewerThan ||
    live.dateOlderThan !== active.dateOlderThan ||
    live.tags.trim() !== active.tags.trim() ||
    live.withoutTags.trim() !== active.withoutTags.trim() ||
    live.minReplyCount !== active.minReplyCount ||
    !arraysEqual(live.prefixIds, active.prefixIds) ||
    !arraysEqual(live.forumNodeIds, active.forumNodeIds) ||
    live.searchSubforums !== active.searchSubforums
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

function parseIntList(raw: string | null): number[] {
  if (!raw?.trim()) return [];
  return raw
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0);
}

function parseMinReply(raw: string | null): number {
  if (!raw?.trim()) return 0;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Read optional `?thread=` scope without requiring `q`. */
export function parseForumSearchThreadParam(
  params: URLSearchParams,
): string | undefined {
  return parseThreadId(params.get('thread'));
}

function parseAdvancedFromParams(params: URLSearchParams): ForumSearchAdvancedSnapshot {
  return {
    containerOnly:
      params.get('container_only') === '1' || params.get('containerOnly') === '1',
    postedBy: (params.get('posted_by') ?? params.get('postedBy') ?? '').trim(),
    dateNewerThan: (params.get('newer') ?? params.get('date_newer') ?? '').trim(),
    dateOlderThan: (params.get('older') ?? params.get('date_older') ?? '').trim(),
    tags: (params.get('tags') ?? '').trim(),
    withoutTags: (params.get('without_tags') ?? params.get('withoutTags') ?? '').trim(),
    minReplyCount: parseMinReply(params.get('min_replies') ?? params.get('minReplies')),
    prefixIds: parseIntList(params.get('prefixes')),
    forumNodeIds: parseIntList(params.get('forums') ?? params.get('forum_nodes')),
    searchSubforums: params.get('subforums') !== '0',
  };
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
  return {
    query,
    titleOnly,
    searchIn,
    sort,
    page,
    threadId,
    ...parseAdvancedFromParams(params),
  };
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
  if (state.containerOnly) params.set('container_only', '1');
  const postedBy = state.postedBy.trim();
  if (postedBy) params.set('posted_by', postedBy);
  if (state.dateNewerThan) params.set('newer', state.dateNewerThan);
  if (state.dateOlderThan) params.set('older', state.dateOlderThan);
  if (state.tags.trim()) params.set('tags', state.tags.trim());
  if (state.withoutTags.trim()) params.set('without_tags', state.withoutTags.trim());
  if (state.minReplyCount > 0) params.set('min_replies', String(state.minReplyCount));
  if (state.prefixIds.length > 0) params.set('prefixes', state.prefixIds.join(','));
  if (state.forumNodeIds.length > 0) params.set('forums', state.forumNodeIds.join(','));
  if (!state.searchSubforums) params.set('subforums', '0');
  return params;
}

/** Map UI snapshot to sidecar IPC params (omit empty optional fields). */
export function forumSearchAttemptToIpc(
  attempt: ForumSearchAttemptSnapshot,
  page: number,
): ForumSearchParams {
  const postedBy = attempt.postedBy.trim();
  const tags = attempt.tags.trim();
  const withoutTags = attempt.withoutTags.trim();
  return {
    query: attempt.query.trim(),
    titleOnly: attempt.titleOnly,
    containerOnly: attempt.containerOnly || undefined,
    searchIn: attempt.searchIn,
    sort: attempt.sort,
    page,
    threadId: attempt.threadId,
    postedBy: postedBy || undefined,
    dateNewerThan: attempt.dateNewerThan || undefined,
    dateOlderThan: attempt.dateOlderThan || undefined,
    tags: tags || undefined,
    withoutTags: withoutTags || undefined,
    minReplyCount: attempt.minReplyCount > 0 ? attempt.minReplyCount : undefined,
    prefixIds: attempt.prefixIds.length > 0 ? attempt.prefixIds : undefined,
    forumNodeIds: attempt.forumNodeIds.length > 0 ? attempt.forumNodeIds : undefined,
    searchSubforums: attempt.searchSubforums,
  };
}

export type { ForumSearchFormOptions };
