import { useCallback, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ForumSearchResultRow } from '../components/search/ForumSearchResultRow';
import { Spinner } from '../components/ui/Spinner';
import { useOffline } from '../contexts/Offline';
import * as ipc from '../lib/ipc';
import {
  isSearchFiltersDirty,
  shouldApplySearchResult,
  type ForumSearchAttemptSnapshot,
  type ForumSearchFilterSnapshot,
} from '../lib/forumSearchUi';
import { useT } from '../lib/i18n';
import { formatIpcError } from '../lib/ipcError';
import { openThreadFromSearch } from '../lib/openThreadFromSearch';
import type { ForumSearchHit, ForumSearchIn, ForumSearchSort } from '../types/forumSearch';

type SearchStatus = 'idle' | 'loading' | 'ready' | 'error';

export function ForumSearchPage() {
  const { t } = useT();
  const navigate = useNavigate();
  const { isOffline } = useOffline();

  const [query, setQuery] = useState('');
  const [titleOnly, setTitleOnly] = useState(false);
  const [searchIn, setSearchIn] = useState<ForumSearchIn>('posts');
  const [sort, setSort] = useState<ForumSearchSort>('relevance');
  const [page, setPage] = useState(1);
  const [requestedPage, setRequestedPage] = useState(1);
  const [results, setResults] = useState<ForumSearchHit[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [totalPages, setTotalPages] = useState<number | null>(null);
  const [status, setStatus] = useState<SearchStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeAttempt, setActiveAttempt] = useState<ForumSearchAttemptSnapshot | null>(null);
  const [lastAttempt, setLastAttempt] = useState<ForumSearchAttemptSnapshot | null>(null);
  const searchGenRef = useRef(0);

  const liveFilters: ForumSearchFilterSnapshot = { titleOnly, searchIn, sort };
  const filtersDirty = isSearchFiltersDirty(liveFilters, activeAttempt);

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
        query: trimmed,
        titleOnly: attempt.titleOnly,
        searchIn: attempt.searchIn,
        sort: attempt.sort,
      };
      const generation = ++searchGenRef.current;
      setRequestedPage(pageNum);
      setLastAttempt(snapshot);
      setStatus('loading');
      setErrorMessage(null);

      try {
        const res = await ipc.forumSearch({
          query: snapshot.query,
          titleOnly: snapshot.titleOnly,
          searchIn: snapshot.searchIn,
          sort: snapshot.sort,
          page: pageNum,
        });
        if (!shouldApplySearchResult(generation, searchGenRef.current)) return;
        setResults(res.results);
        setHasMore(res.hasMore);
        setTotalPages(res.totalPages);
        setPage(res.page);
        setRequestedPage(res.page);
        setActiveAttempt(snapshot);
        setStatus('ready');
      } catch (err) {
        if (!shouldApplySearchResult(generation, searchGenRef.current)) return;
        setResults([]);
        setHasMore(false);
        setTotalPages(null);
        setErrorMessage(formatIpcError(err));
        setStatus('error');
      }
    },
    [isOffline],
  );

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (status === 'loading') return;
    void runSearch(1, { query, titleOnly, searchIn, sort });
  };

  const retryAttempt =
    lastAttempt ??
    ({
      query: activeAttempt?.query || query,
      titleOnly: activeAttempt?.titleOnly ?? titleOnly,
      searchIn: activeAttempt?.searchIn ?? searchIn,
      sort: activeAttempt?.sort ?? sort,
    } satisfies ForumSearchAttemptSnapshot);

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
            type="submit"
            className="forum-search-btn forum-search-btn--primary"
            disabled={isOffline || !query.trim() || status === 'loading'}
          >
            {t('search.submit')}
          </button>
        </div>

        <div className="forum-search-filter-bar">
          <label className="forum-search-check">
            <input
              type="checkbox"
              checked={titleOnly}
              onChange={(e) => setTitleOnly(e.target.checked)}
              disabled={isOffline}
            />
            {t('search.filter.titleOnly')}
          </label>

          <label className="forum-search-field">
            <span>{t('search.filter.searchIn')}</span>
            <select
              value={searchIn}
              onChange={(e) => setSearchIn(e.target.value as ForumSearchIn)}
              disabled={isOffline}
            >
              <option value="titles">{t('search.filter.titles')}</option>
              <option value="posts">{t('search.filter.posts')}</option>
            </select>
          </label>

          <label className="forum-search-field">
            <span>{t('search.filter.sort')}</span>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as ForumSearchSort)}
              disabled={isOffline}
            >
              <option value="relevance">{t('search.filter.relevance')}</option>
              <option value="date">{t('search.filter.date')}</option>
            </select>
          </label>
        </div>
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
            <p>{t('search.empty.none')}</p>
          </div>
        </div>
      )}

      {status === 'ready' && results.length > 0 && (
        <div className="forum-search-list-panel">
          <ul className="forum-search-list">
            {results.map((hit, index) => (
              <ForumSearchResultRow
                key={`${index}-${hit.threadId}`}
                hit={hit}
                onOpen={() => openThreadFromSearch(hit, navigate)}
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
