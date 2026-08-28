import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ForumSearchAdvancedForm } from '../components/search/ForumSearchAdvancedForm';
import { ForumSearchResultRow } from '../components/search/ForumSearchResultRow';
import { Spinner } from '../components/ui/Spinner';
import { useOffline } from '../contexts/Offline';
import * as ipc from '../lib/ipc';
import {
  EMPTY_FORUM_SEARCH_ADVANCED,
  forumSearchAttemptToIpc,
  forumSearchToSearchParams,
  isSearchFiltersDirty,
  parseForumSearchSearchParams,
  parseForumSearchThreadParam,
  shouldApplySearchResult,
  type ForumSearchAttemptSnapshot,
  type ForumSearchFilterSnapshot,
} from '../lib/forumSearchUi';
import { useT } from '../lib/i18n';
import { formatIpcError } from '../lib/ipcError';
import { openThreadFromSearch } from '../lib/openThreadFromSearch';
import type { ForumSearchHit, ForumSearchNodeOption, ForumSearchSort } from '../types/forumSearch';

type SearchStatus = 'idle' | 'loading' | 'ready' | 'error';

function attemptFromControls(
  query: string,
  titleOnly: boolean,
  searchIn: ForumSearchFilterSnapshot['searchIn'],
  sort: ForumSearchSort,
  advanced: typeof EMPTY_FORUM_SEARCH_ADVANCED,
  threadId?: string,
): ForumSearchAttemptSnapshot {
  return {
    query,
    titleOnly,
    searchIn,
    sort,
    threadId,
    ...advanced,
  };
}

export function ForumSearchPage() {
  const { t } = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { isOffline } = useOffline();

  const initialFromUrl = useMemo(
    () => parseForumSearchSearchParams(searchParams),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const urlThreadId = useMemo(
    () => parseForumSearchThreadParam(searchParams),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [scope, setScope] = useState<'all' | 'thread'>(urlThreadId ? 'thread' : 'all');

  const [query, setQuery] = useState(initialFromUrl?.query ?? '');
  const [titleOnly, setTitleOnly] = useState(initialFromUrl?.titleOnly ?? false);
  const [searchIn] = useState(initialFromUrl?.searchIn ?? 'posts');
  const [sort, setSort] = useState<ForumSearchSort>(initialFromUrl?.sort ?? 'relevance');
  const [advanced, setAdvanced] = useState(() =>
    initialFromUrl
      ? {
          containerOnly: initialFromUrl.containerOnly,
          postedBy: initialFromUrl.postedBy,
          dateNewerThan: initialFromUrl.dateNewerThan,
          dateOlderThan: initialFromUrl.dateOlderThan,
          tags: initialFromUrl.tags,
          withoutTags: initialFromUrl.withoutTags,
          minReplyCount: initialFromUrl.minReplyCount,
          prefixIds: initialFromUrl.prefixIds,
          forumNodeIds: initialFromUrl.forumNodeIds,
          searchSubforums: initialFromUrl.searchSubforums,
        }
      : { ...EMPTY_FORUM_SEARCH_ADVANCED },
  );
  const [forumOptions, setForumOptions] = useState<ForumSearchNodeOption[]>([]);
  const [advancedExpanded, setAdvancedExpanded] = useState(
    () => !(initialFromUrl?.query.trim()),
  );

  const [page, setPage] = useState(initialFromUrl?.page ?? 1);
  const [requestedPage, setRequestedPage] = useState(initialFromUrl?.page ?? 1);
  const [results, setResults] = useState<ForumSearchHit[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [totalPages, setTotalPages] = useState<number | null>(null);
  const [status, setStatus] = useState<SearchStatus>(
    initialFromUrl ? 'loading' : 'idle',
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeAttempt, setActiveAttempt] = useState<ForumSearchAttemptSnapshot | null>(null);
  const [lastAttempt, setLastAttempt] = useState<ForumSearchAttemptSnapshot | null>(null);
  const searchGenRef = useRef(0);
  const didRestoreRef = useRef(false);

  const effectiveThreadId = scope === 'thread' ? urlThreadId : undefined;
  const liveFilters: ForumSearchFilterSnapshot = {
    titleOnly,
    searchIn,
    sort,
    threadId: effectiveThreadId,
    ...advanced,
  };
  const filtersDirty = isSearchFiltersDirty(liveFilters, activeAttempt);

  useEffect(() => {
    if (scope === 'thread' && !urlThreadId) {
      setScope('all');
    }
  }, [scope, urlThreadId]);

  useEffect(() => {
    if (isOffline) {
      setForumOptions([]);
      return;
    }
    let cancelled = false;
    void ipc
      .forumSearchFormOptions()
      .then((opts) => {
        if (!cancelled) setForumOptions(opts.forums ?? []);
      })
      .catch(() => {
        if (!cancelled) setForumOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [isOffline]);

  const syncUrl = useCallback(
    (attempt: ForumSearchAttemptSnapshot, pageNum: number) => {
      setSearchParams(
        forumSearchToSearchParams({ ...attempt, page: pageNum }),
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const clearUrl = useCallback(() => {
    if ([...searchParams.keys()].length === 0) return;
    setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams]);

  const runSearch = useCallback(
    async (pageNum: number, attempt: ForumSearchAttemptSnapshot) => {
      const trimmed = attempt.query.trim();
      if (!trimmed) {
        searchGenRef.current += 1;
        setStatus('idle');
        setResults([]);
        setHasMore(false);
        setTotalPages(null);
        setPage(1);
        setRequestedPage(1);
        setActiveAttempt(null);
        setLastAttempt(null);
        setErrorMessage(null);
        setAdvancedExpanded(true);
        clearUrl();
        return;
      }
      if (isOffline) {
        searchGenRef.current += 1;
        setStatus('idle');
        setResults([]);
        setHasMore(false);
        setTotalPages(null);
        setErrorMessage(null);
        return;
      }

      const snapshot: ForumSearchAttemptSnapshot = {
        ...attempt,
        query: trimmed,
      };
      const generation = ++searchGenRef.current;
      setRequestedPage(pageNum);
      setLastAttempt(snapshot);
      setStatus('loading');
      setErrorMessage(null);
      syncUrl(snapshot, pageNum);

      try {
        const res = await ipc.forumSearch(forumSearchAttemptToIpc(snapshot, pageNum));
        if (!shouldApplySearchResult(generation, searchGenRef.current)) return;
        setResults(res.results);
        setHasMore(res.hasMore);
        setTotalPages(res.totalPages);
        setPage(res.page);
        setRequestedPage(res.page);
        setActiveAttempt(snapshot);
        setStatus('ready');
        syncUrl(snapshot, res.page);
      } catch (err) {
        if (!shouldApplySearchResult(generation, searchGenRef.current)) return;
        setResults([]);
        setHasMore(false);
        setTotalPages(null);
        setErrorMessage(formatIpcError(err));
        setStatus('error');
      }
    },
    [clearUrl, isOffline, syncUrl],
  );

  useEffect(() => {
    if (didRestoreRef.current) return;
    didRestoreRef.current = true;
    if (!initialFromUrl) return;
    void runSearch(initialFromUrl.page, initialFromUrl);
  }, [initialFromUrl, runSearch]);

  const buildAttempt = (): ForumSearchAttemptSnapshot =>
    attemptFromControls(query, titleOnly, searchIn, sort, advanced, effectiveThreadId);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (status === 'loading') return;
    const trimmed = query.trim();
    if (trimmed) setAdvancedExpanded(false);
    else setAdvancedExpanded(true);
    void runSearch(1, buildAttempt());
  };

  const searchReturnTo = `${location.pathname}${location.search}`;

  const retryAttempt =
    lastAttempt ??
    buildAttempt();

  const showPagination =
    status === 'ready' && !filtersDirty && (page > 1 || hasMore);
  const pageLabel =
    totalPages && totalPages > 0
      ? t('search.pagination.page', { page: `${page} / ${totalPages}` })
      : t('search.pagination.page', { page });

  return (
    <div className="forum-search-page">
      <header className="forum-search-header">
        <h1 className="forum-search-title">{t('search.title')}</h1>
      </header>

      {isOffline && (
        <div className="offline-banner" role="status">
          {t('search.offline')}
        </div>
      )}

      <form className="forum-search-form" onSubmit={onSubmit}>
        <div className="forum-search-query-row">
          <input
            type="search"
            className="forum-search-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('search.placeholder')}
            disabled={isOffline}
            autoComplete="off"
          />
          <button
            type="button"
            className={`forum-search-btn forum-search-advanced-toggle${
              advancedExpanded ? ' forum-search-advanced-toggle--open' : ''
            }`}
            onClick={() => setAdvancedExpanded((open) => !open)}
            disabled={isOffline}
            aria-expanded={advancedExpanded}
            aria-controls="forum-search-advanced-panel"
          >
            {t('search.advanced.toggle')}
            <span className="forum-search-advanced-chevron" aria-hidden />
          </button>
          <button
            type="submit"
            className="forum-search-btn forum-search-btn--primary"
            disabled={isOffline || !query.trim() || status === 'loading'}
          >
            {t('search.submit')}
          </button>
        </div>

        {advancedExpanded && (
          <div
            id="forum-search-advanced-panel"
            className="forum-search-advanced-panel"
          >
        <div className="forum-search-keyword-options">
          <label className="forum-search-check">
            <input
              type="checkbox"
              checked={advanced.containerOnly}
              onChange={(e) =>
                setAdvanced((a) => ({ ...a, containerOnly: e.target.checked }))
              }
              disabled={isOffline}
            />
            {t('search.filter.containerOnly')}
          </label>
          <label className="forum-search-check">
            <input
              type="checkbox"
              checked={titleOnly}
              onChange={(e) => setTitleOnly(e.target.checked)}
              disabled={isOffline}
            />
            {t('search.filter.titleOnly')}
          </label>
        </div>

        <ForumSearchAdvancedForm
          value={advanced}
          onChange={setAdvanced}
          forums={forumOptions}
          disabled={isOffline}
        />

        <div className="forum-search-filter-bar forum-search-filter-bar--footer">
          <fieldset className="forum-search-order">
            <legend>{t('search.filter.sort')}</legend>
            <label className="forum-search-check">
              <input
                type="radio"
                name="forum-search-sort"
                checked={sort === 'relevance'}
                onChange={() => setSort('relevance')}
                disabled={isOffline}
              />
              {t('search.filter.relevance')}
            </label>
            <label className="forum-search-check">
              <input
                type="radio"
                name="forum-search-sort"
                checked={sort === 'date'}
                onChange={() => setSort('date')}
                disabled={isOffline}
              />
              {t('search.filter.date')}
            </label>
          </fieldset>

          {urlThreadId && (
            <fieldset className="forum-search-scope">
              <legend>{t('search.scope.label')}</legend>
              <label className="forum-search-check">
                <input
                  type="radio"
                  name="forum-search-scope"
                  checked={scope === 'all'}
                  onChange={() => setScope('all')}
                  disabled={isOffline}
                />
                {t('search.scope.all')}
              </label>
              <label className="forum-search-check">
                <input
                  type="radio"
                  name="forum-search-scope"
                  checked={scope === 'thread'}
                  onChange={() => setScope('thread')}
                  disabled={isOffline}
                />
                {t('search.scope.thread')}
              </label>
            </fieldset>
          )}
        </div>
          </div>
        )}
      </form>

      {status === 'error' && errorMessage && (
        <div className="forum-search-error">
          <span>{errorMessage}</span>
          <button
            type="button"
            className="forum-search-btn"
            onClick={() => void runSearch(requestedPage || 1, retryAttempt)}
            disabled={isOffline}
          >
            {t('search.error.retry')}
          </button>
        </div>
      )}

      {status === 'loading' && (
        <div className="forum-search-loading">
          <Spinner />
        </div>
      )}

      {status === 'idle' && !isOffline && (
        <div className="forum-search-list-panel">
          <div className="forum-search-empty">
            <p>{t('search.empty.idle')}</p>
          </div>
        </div>
      )}

      {status === 'ready' && results.length === 0 && (
        <div className="forum-search-list-panel">
          <div className="forum-search-empty">
            <p>
              {activeAttempt?.threadId
                ? t('search.empty.noneInThread')
                : t('search.empty.none')}
            </p>
          </div>
        </div>
      )}

      {status === 'ready' && results.length > 0 && (
        <div className="forum-search-list-panel">
          <ul className="forum-search-list">
            {results.map((hit, index) => (
              <ForumSearchResultRow
                key={`${index}-${hit.threadId}-${hit.postId ?? 'thread'}`}
                hit={hit}
                onOpen={() =>
                  void openThreadFromSearch(hit, navigate, { searchReturnTo })
                }
              />
            ))}
          </ul>
        </div>
      )}

      {showPagination && activeAttempt && (
        <div className="forum-search-pagination">
          <button
            type="button"
            className="forum-search-btn"
            disabled={page <= 1 || isOffline}
            onClick={() => void runSearch(page - 1, activeAttempt)}
          >
            {t('search.pagination.prev')}
          </button>
          <span className="forum-search-page-label">{pageLabel}</span>
          <button
            type="button"
            className="forum-search-btn forum-search-btn--primary"
            disabled={!hasMore || isOffline}
            onClick={() => void runSearch(page + 1, activeAttempt)}
          >
            {t('search.pagination.next')}
          </button>
        </div>
      )}
    </div>
  );
}
