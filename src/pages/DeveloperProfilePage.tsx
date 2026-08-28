import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { DeveloperGameCard } from '../components/developer/DeveloperGameCard';
import { OfflineGate } from '../components/OfflineGate';
import { Spinner } from '../components/ui/Spinner';
import { useOffline } from '../contexts/Offline';
import { searchDeveloperGames } from '../lib/developerSearch';
import { parseDeveloperProfileParam } from '../lib/developerProfilePath';
import { useT } from '../lib/i18n';
import { formatIpcError } from '../lib/ipcError';
import { openThreadFromSearch } from '../lib/openThreadFromSearch';
import type { ForumSearchHit } from '../types/forumSearch';

type Status = 'idle' | 'loading' | 'ready' | 'error';

export function DeveloperProfilePage() {
  const { developerName: developerParam } = useParams<{ developerName: string }>();
  const developerName = useMemo(
    () => parseDeveloperProfileParam(developerParam),
    [developerParam],
  );
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useT();
  const { isOffline } = useOffline();

  const [page, setPage] = useState(1);
  const [results, setResults] = useState<ForumSearchHit[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [totalPages, setTotalPages] = useState<number | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const loadGenRef = useRef(0);

  const searchReturnTo = `${location.pathname}${location.search}`;

  const loadPage = useCallback(
    async (pageNum: number) => {
      if (!developerName) {
        setStatus('error');
        setErrorMessage(t('developer.invalid'));
        return;
      }
      if (isOffline) {
        setStatus('idle');
        setResults([]);
        return;
      }

      const generation = ++loadGenRef.current;
      setStatus('loading');
      setErrorMessage(null);
      setPage(pageNum);

      try {
        const searchPage = await searchDeveloperGames(developerName, pageNum);
        if (generation !== loadGenRef.current) return;

        setResults(searchPage.results);
        setHasMore(searchPage.hasMore);
        setTotalPages(searchPage.totalPages);
        setPage(searchPage.page);
        setStatus('ready');
      } catch (err) {
        if (generation !== loadGenRef.current) return;
        setResults([]);
        setHasMore(false);
        setTotalPages(null);
        setErrorMessage(formatIpcError(err));
        setStatus('error');
      }
    },
    [developerName, isOffline, t],
  );

  useEffect(() => {
    void loadPage(1);
  }, [loadPage]);

  const pageLabel =
    totalPages && totalPages > 0
      ? t('search.pagination.page', { page: `${page} / ${totalPages}` })
      : t('search.pagination.page', { page });

  const gameCountLabel =
    status === 'ready'
      ? t('developer.gameCount', { count: results.length })
      : null;

  return (
    <OfflineGate>
      <div className="developer-profile-page">
        <header className="developer-profile-hero">
          <button
            type="button"
            className="developer-profile-back"
            onClick={() => navigate(-1)}
          >
            {t('common.back')}
          </button>
          <div className="developer-profile-hero-main">
            <p className="developer-profile-kicker">{t('developer.kicker')}</p>
            <h1 className="developer-profile-name">{developerName || '—'}</h1>
            <p className="developer-profile-blurb">{t('developer.blurb')}</p>
            {gameCountLabel && (
              <p className="developer-profile-stat">{gameCountLabel}</p>
            )}
          </div>
        </header>

        {isOffline && (
          <div className="offline-banner" role="status">
            {t('developer.offline')}
          </div>
        )}

        {status === 'loading' && (
          <div className="developer-profile-loading">
            <Spinner />
          </div>
        )}

        {status === 'error' && errorMessage && (
          <div className="developer-profile-error">
            <p>{errorMessage}</p>
            <button
              type="button"
              className="forum-search-btn"
              onClick={() => void loadPage(page)}
              disabled={isOffline}
            >
              {t('search.error.retry')}
            </button>
          </div>
        )}

        {status === 'ready' && results.length === 0 && (
          <div className="developer-profile-empty">
            <p>{t('developer.empty')}</p>
          </div>
        )}

        {status === 'ready' && results.length > 0 && (
          <>
            <div className="developer-profile-grid">
              {results.map((hit, index) => (
                <DeveloperGameCard
                  key={`${index}-${hit.threadId}-${hit.postId ?? 'thread'}`}
                  hit={hit}
                  onOpen={() =>
                    void openThreadFromSearch(hit, navigate, { searchReturnTo })
                  }
                />
              ))}
            </div>

            {(page > 1 || hasMore) && (
              <div className="developer-profile-pagination">
                <button
                  type="button"
                  className="forum-search-btn"
                  disabled={page <= 1 || isOffline}
                  onClick={() => void loadPage(page - 1)}
                >
                  {t('search.pagination.prev')}
                </button>
                <span className="forum-search-page-label">{pageLabel}</span>
                <button
                  type="button"
                  className="forum-search-btn forum-search-btn--primary"
                  disabled={!hasMore || isOffline}
                  onClick={() => void loadPage(page + 1)}
                >
                  {t('search.pagination.next')}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </OfflineGate>
  );
}
