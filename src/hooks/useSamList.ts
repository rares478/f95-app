import { useCallback, useEffect, useRef, useState } from 'react';
import { samList } from '../lib/ipc';
import { execute } from '../lib/db';
import { formatIpcError } from '../lib/ipcError';
import type { SamFilters, SamGameCard, SamPage } from '../types/sam';

export interface SamListState {
  items: SamGameCard[];
  page: number;
  totalPages: number;
  totalRows: number;
  loading: boolean;
  error: string | null;
  hasMore: boolean;
}

const PAGE_SIZE = 15;
const SESSION_PREFIX = 'f95-app:sam-list:';

export function useSamList(filters: SamFilters): SamListState & {
  loadMore: () => void;
  goToPage: (target: number) => void;
  reload: () => void;
} {
  const [items, setItems] = useState<SamGameCard[]>([]);
  const [page, setPage] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [totalRows, setTotalRows] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep a stable key of filters that should trigger a reload. Excludes `page`
  // because we manage page internally.
  const filterKey = JSON.stringify({
    category: filters.category,
    prefixes: filters.prefixes,
    noprefixes: filters.noprefixes,
    tags: filters.tags,
    notags: filters.notags,
    tagtype: filters.tagtype,
    search: filters.search,
    sort: filters.sort,
    order: filters.order,
    rows: filters.rows ?? PAGE_SIZE,
  });
  const sessionKey = `${SESSION_PREFIX}${filterKey}`;

  const reqIdRef = useRef(0);
  /** Session key whose items are currently in React state (for safe persistence). */
  const itemsForKeyRef = useRef<string | null>(null);
  /** True after the first filterKey effect run for this hook instance. */
  const didInitRef = useRef(false);
  const prevFilterKeyRef = useRef(filterKey);

  const fetchPage = useCallback(
    async (target: number, append: boolean) => {
      const myId = ++reqIdRef.current;
      const keyAtStart = sessionKey;
      setLoading(true);
      setError(null);
      try {
        const result: SamPage = await samList({
          category: filters.category ?? 'games',
          prefixes: filters.prefixes,
          noprefixes: filters.noprefixes,
          tags: filters.tags,
          notags: filters.notags,
          tagtype: filters.tagtype,
          search: filters.search,
          sort: filters.sort ?? 'date',
          order: filters.order,
          rows: filters.rows ?? PAGE_SIZE,
          page: target,
        });
        if (reqIdRef.current !== myId) return; // stale response
        itemsForKeyRef.current = keyAtStart;
        setPage(result.page);
        setTotalPages(result.totalPages);
        setTotalRows(result.totalRows);
        setItems((prev) => (append ? dedup([...prev, ...result.items]) : result.items));
        // Best-effort cache write — never block the UI on cache errors.
        cacheItems(result.items).catch(() => undefined);
      } catch (err) {
        if (reqIdRef.current !== myId) return;
        setError(formatIpcError(err));
      } finally {
        if (reqIdRef.current === myId) setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filterKey, sessionKey],
  );

  // Persist only when `items` belong to the current filter key. Writing the
  // previous filter's rows under a new key made the reload effect skip fetch.
  useEffect(() => {
    if (itemsForKeyRef.current !== sessionKey) return;
    saveSessionSnapshot(sessionKey, {
      items,
      page,
      totalPages,
      totalRows,
    });
  }, [sessionKey, items, page, totalPages, totalRows]);

  // Load list when filters change. Session restore is only for remounting with
  // the same filters (e.g. back from a game page) — never when filters change
  // while this hook is already mounted.
  useEffect(() => {
    const filterChanged =
      didInitRef.current && prevFilterKeyRef.current !== filterKey;
    prevFilterKeyRef.current = filterKey;

    if (!didInitRef.current) {
      didInitRef.current = true;
      const snapshot = loadSessionSnapshot(sessionKey);
      if (snapshot && snapshot.items.length > 0) {
        itemsForKeyRef.current = sessionKey;
        setItems(snapshot.items);
        setPage(snapshot.page);
        setTotalPages(snapshot.totalPages);
        setTotalRows(snapshot.totalRows);
        return;
      }
    } else if (!filterChanged) {
      return;
    }

    itemsForKeyRef.current = null;
    const isSearch = (filters.search ?? '').length > 0;
    const t = setTimeout(
      () => {
        setItems([]);
        setPage(0);
        void fetchPage(1, false);
      },
      isSearch ? 350 : 0,
    );
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, fetchPage]);

  const loadMore = useCallback(() => {
    if (loading) return;
    if (page >= totalPages) return;
    void fetchPage(page + 1, true);
  }, [loading, page, totalPages, fetchPage]);

  const goToPage = useCallback(
    (target: number) => {
      if (loading) return;
      if (target < 1 || target > totalPages) return;
      if (target === page) return;
      void fetchPage(target, false);
    },
    [loading, page, totalPages, fetchPage],
  );

  const reload = useCallback(() => {
    clearSessionSnapshot(sessionKey);
    itemsForKeyRef.current = null;
    setItems([]);
    setPage(0);
    void fetchPage(1, false);
  }, [fetchPage, sessionKey]);

  return {
    items,
    page,
    totalPages,
    totalRows,
    loading,
    error,
    hasMore: page < totalPages,
    loadMore,
    goToPage,
    reload,
  };
}

function dedup(items: SamGameCard[]): SamGameCard[] {
  const seen = new Set<string>();
  const out: SamGameCard[] = [];
  for (const it of items) {
    if (seen.has(it.threadId)) continue;
    seen.add(it.threadId);
    out.push(it);
  }
  return out;
}

interface SessionSnapshot {
  items: SamGameCard[];
  page: number;
  totalPages: number;
  totalRows: number;
}

function loadSessionSnapshot(key: string): SessionSnapshot | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SessionSnapshot>;
    if (!Array.isArray(parsed.items)) return null;
    return {
      items: parsed.items,
      page: Math.max(0, Number(parsed.page ?? 0)),
      totalPages: Math.max(1, Number(parsed.totalPages ?? 1)),
      totalRows: Math.max(0, Number(parsed.totalRows ?? 0)),
    };
  } catch {
    return null;
  }
}

function saveSessionSnapshot(key: string, snapshot: SessionSnapshot): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(snapshot));
  } catch {
    // ignore quota errors
  }
}

function clearSessionSnapshot(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // ignore storage errors
  }
}

async function cacheItems(items: SamGameCard[]): Promise<void> {
  if (items.length === 0) return;
  for (const it of items) {
    await execute(
      `INSERT INTO games_cache (
         thread_id, title, version, thumbnail_url, thread_url,
         engine, status, rating, views, likes, updated_at,
         prefixes_json, tags_json, cached_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(thread_id) DO UPDATE SET
         title=excluded.title,
         version=excluded.version,
         thumbnail_url=excluded.thumbnail_url,
         thread_url=excluded.thread_url,
         engine=excluded.engine,
         status=excluded.status,
         rating=excluded.rating,
         views=excluded.views,
         likes=excluded.likes,
         updated_at=excluded.updated_at,
         prefixes_json=excluded.prefixes_json,
         tags_json=excluded.tags_json,
         cached_at=excluded.cached_at`,
      [
        it.threadId,
        it.title,
        it.version,
        it.thumbnailUrl,
        it.threadUrl,
        null,
        null,
        it.rating,
        it.views,
        it.likes,
        it.updatedAt,
        JSON.stringify(it.prefixIds),
        JSON.stringify(it.tagIds),
      ],
    );
  }
}
