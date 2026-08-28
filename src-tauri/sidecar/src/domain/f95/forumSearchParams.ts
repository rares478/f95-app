import type { ForumSearchIn, ForumSearchParams, ForumSearchSort } from './forumSearch';

function optString(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed || undefined;
}

function optPositiveInt(raw: unknown): number | undefined {
  const n = typeof raw === 'number' ? raw : parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.floor(n);
}

function optIntArray(raw: unknown): number[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const ids = raw
    .map((v) => optPositiveInt(v))
    .filter((v): v is number => v != null);
  return ids.length > 0 ? ids : undefined;
}

function optBool(raw: unknown): boolean | undefined {
  if (raw === true || raw === 1 || raw === '1') return true;
  if (raw === false || raw === 0 || raw === '0') return false;
  return undefined;
}

/** Normalize RPC/IPC payload into `ForumSearchParams`. */
export function parseForumSearchRpcParams(p: Record<string, unknown>): ForumSearchParams {
  const query = String(p?.query ?? '').trim();
  const pageRaw = Number(p?.page ?? 1);
  const page =
    Number.isInteger(pageRaw) && pageRaw >= 1 ? pageRaw : 1;
  const searchIn = (p?.searchIn === 'titles' ? 'titles' : 'posts') as ForumSearchIn;
  const sort = (p?.sort === 'date' ? 'date' : 'relevance') as ForumSearchSort;

  return {
    query,
    titleOnly: Boolean(p?.titleOnly),
    containerOnly: Boolean(p?.containerOnly),
    searchIn,
    sort,
    page,
    threadId: optString(p?.threadId),
    postedBy: optString(p?.postedBy),
    dateNewerThan: optString(p?.dateNewerThan),
    dateOlderThan: optString(p?.dateOlderThan),
    tags: optString(p?.tags),
    withoutTags: optString(p?.withoutTags),
    minReplyCount: optPositiveInt(p?.minReplyCount),
    prefixIds: optIntArray(p?.prefixIds),
    forumNodeIds: optIntArray(p?.forumNodeIds),
    searchSubforums: optBool(p?.searchSubforums),
  };
}
