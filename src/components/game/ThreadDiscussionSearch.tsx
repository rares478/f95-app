import { useCallback, useRef, useState, type FormEvent } from 'react';
import { ForumSearchResultRow } from '../search/ForumSearchResultRow';
import { Spinner } from '../ui/Spinner';
import * as ipc from '../../lib/ipc';
import { shouldApplySearchResult } from '../../lib/forumSearchUi';
import { useT } from '../../lib/i18n';
import { formatIpcError } from '../../lib/ipcError';
import type { ForumSearchHit, ForumSearchSort } from '../../types/forumSearch';

type SearchStatus = 'idle' | 'loading' | 'ready' | 'error';

type AttemptSnapshot = {
  query: string;
  titleOnly: boolean;
  sort: ForumSearchSort;
};

interface Props {
  threadId: string;
  onFocusPost: (postId: string | null) => void;
}

export function ThreadDiscussionSearch({ threadId, onFocusPost }: Props) {
  const { t } = useT();
  const [query, setQuery] = useState('');
  const [titleOnly, setTitleOnly] = useState(false);
  const [sort, setSort] = useState<ForumSearchSort>('relevance');
  const [status, setStatus] = useState<SearchStatus>('idle');
  const [loadingMore, setLoadingMore] = useState(false);
  const [results, setResults] = useState<ForumSearchHit[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeAttempt, setActiveAttempt] = useState<AttemptSnapshot | null>(null);
  const searchGenRef = useRef(0);

  const runSearch = useCallback(
    async (pageNum: number, attempt: AttemptSnapshot, append: boolean) => {
      const trimmed = attempt.query.trim();
      if (!trimmed) {
        searchGenRef.current += 1;
        setStatus('idle');
        setResults([]);
        setHasMore(false);
        setPage(0);
        setActiveAttempt(null);
        setErrorMessage(null);
        setLoadingMore(false);
        return;
      }

      const snapshot: AttemptSnapshot = {
        query: trimmed,
        titleOnly: attempt.titleOnly,
        sort: attempt.sort,
      };
      const generation = ++searchGenRef.current;
      if (append) {
        setLoadingMore(true);
      } else {
        setStatus('loading');
        setErrorMessage(null);
      }

      try {
        const res = await ipc.forumSearch({
          query: snapshot.query,
          titleOnly: snapshot.titleOnly,
          searchIn: 'posts',
          sort: snapshot.sort,
          page: pageNum,
          threadId,
        });
        if (!shouldApplySearchResult(generation, searchGenRef.current)) return;
        setResults((prev) => (append ? [...prev, ...res.results] : res.results));
        setHasMore(res.hasMore);
        setPage(res.page);
        setActiveAttempt(snapshot);
        setStatus('ready');
      } catch (err) {
        if (!shouldApplySearchResult(generation, searchGenRef.current)) return;
        if (!append) {
          setResults([]);
          setHasMore(false);
          setPage(0);
          setActiveAttempt(null);
        }
        setErrorMessage(formatIpcError(err));
        setStatus('error');
      } finally {
        if (shouldApplySearchResult(generation, searchGenRef.current)) {
          setLoadingMore(false);
        }
      }
    },
    [threadId],
  );

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (status === 'loading') return;
    void runSearch(1, { query, titleOnly, sort }, false);
  };

  const onLoadMore = () => {
    if (!activeAttempt || loadingMore || !hasMore) return;
    void runSearch(page + 1, activeAttempt, true);
  };

  const onHitOpen = (hit: ForumSearchHit) => {
    onFocusPost(hit.postId ?? null);
  };

  return (
    <div className="thread-discussion-search">
      <form className="thread-discussion-search-form" onSubmit={onSubmit}>
        <div className="thread-discussion-search-query-row">
          <input
            type="search"
            className="thread-discussion-search-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('gamedetail.discussion.search.placeholder')}
            autoComplete="off"
          />
          <button
            type="submit"
            className="thread-discussion-search-btn thread-discussion-search-btn--primary"
            disabled={!query.trim() || status === 'loading'}
          >
            {t('gamedetail.discussion.search.submit')}
          </button>
        </div>

        <div className="thread-discussion-search-filters">
          <label className="thread-discussion-search-check">
            <input
              type="checkbox"
              checked={titleOnly}
              onChange={(e) => setTitleOnly(e.target.checked)}
            />
            {t('search.filter.titleOnly')}
          </label>

          <label className="thread-discussion-search-field">
            <span>{t('search.filter.sort')}</span>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as ForumSearchSort)}
            >
              <option value="relevance">{t('search.filter.relevance')}</option>
              <option value="date">{t('search.filter.date')}</option>
            </select>
          </label>
        </div>
      </form>

      {status === 'error' && errorMessage && (
        <div className="thread-discussion-search-status thread-discussion-search-status--error">
          {t('gamedetail.discussion.search.error')} {errorMessage}
        </div>
      )}

      {status === 'loading' && (
        <div className="thread-discussion-search-status">
          <Spinner />
          <span>{t('gamedetail.discussion.search.loading')}</span>
        </div>
      )}

      {status === 'ready' && results.length === 0 && (
        <div className="thread-discussion-search-status thread-discussion-search-status--muted">
          {t('gamedetail.discussion.search.empty')}
        </div>
      )}

      {status === 'ready' && results.length > 0 && (
        <div className="thread-discussion-search-results">
          <ul className="forum-search-list">
            {results.map((hit, index) => (
              <ForumSearchResultRow
                key={`${index}-${hit.threadId}-${hit.postId ?? 'thread'}`}
                hit={hit}
                onOpen={() => onHitOpen(hit)}
              />
            ))}
          </ul>

          {hasMore && (
            <button
              type="button"
              className="thread-discussion-search-load-more"
              disabled={loadingMore}
              onClick={onLoadMore}
            >
              {loadingMore
                ? t('gamedetail.discussion.search.loading')
                : t('gamedetail.discussion.search.loadMore')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
