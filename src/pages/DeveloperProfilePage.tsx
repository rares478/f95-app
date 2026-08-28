import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { DeveloperDossierHero } from '../components/developer/DeveloperDossierHero';
import { DeveloperGameCard } from '../components/developer/DeveloperGameCard';
import { DeveloperCatalogCapsule } from '../components/developer/DeveloperCatalogCapsule';
import { OfflineGate } from '../components/OfflineGate';
import { Spinner } from '../components/ui/Spinner';
import { useOffline } from '../contexts/Offline';
import { searchDeveloperGames } from '../lib/developerSearch';
import {
  buildDeveloperCatalogEntries,
  buildDeveloperProfileStats,
  collectDeveloperSocialLinks,
  developerCatalogLayout,
  pickHeroBannerUrl,
  sortDeveloperCatalog,
} from '../lib/developerProfileModel';
import { parseDeveloperProfileParam } from '../lib/developerProfilePath';
import { prefetchGameDetails, peekGameDetail } from '../lib/gameDetailCache';
import { useT } from '../lib/i18n';
import { formatIpcError } from '../lib/ipcError';
import {
  getLibraryMembershipRevision,
  getLibraryThreadIds,
  loadLibraryMembership,
  subscribeLibraryMembership,
} from '../lib/libraryMembership';
import { openThreadFromSearch } from '../lib/openThreadFromSearch';
import type { GameDetail } from '../types/game';
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
  const [detailsByThread, setDetailsByThread] = useState<Map<string, GameDetail>>(
    () => new Map(),
  );
  const loadGenRef = useRef(0);

  const libraryRevision = useSyncExternalStore(
    subscribeLibraryMembership,
    getLibraryMembershipRevision,
  );
  useEffect(() => {
    void loadLibraryMembership();
  }, []);

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

  useEffect(() => {
    if (status !== 'ready' || results.length === 0) {
      setDetailsByThread(new Map());
      return;
    }

    const threadIds = results
      .map((hit) => hit.threadId)
      .filter((id): id is string => Boolean(id));
    if (threadIds.length === 0) return;

    let cancelled = false;
    const seed = new Map<string, GameDetail>();
    for (const id of threadIds) {
      const cached = peekGameDetail(id);
      if (cached) seed.set(id, cached);
    }
    setDetailsByThread(seed);

    void prefetchGameDetails(threadIds, {
      concurrency: 4,
      onLoaded: (detail) => {
        if (cancelled) return;
        setDetailsByThread((prev) => {
          const next = new Map(prev);
          next.set(detail.threadId, detail);
          return next;
        });
      },
    });

    return () => {
      cancelled = true;
    };
  }, [status, results]);

  const catalogEntries = useMemo(
    () => sortDeveloperCatalog(buildDeveloperCatalogEntries(results, detailsByThread)),
    [results, detailsByThread],
  );

  const stats = useMemo(
    () =>
      status === 'ready' && catalogEntries.length > 0
        ? buildDeveloperProfileStats(catalogEntries, getLibraryThreadIds())
        : null,
    [catalogEntries, status, libraryRevision],
  );

  const heroBannerUrl = useMemo(
    () => pickHeroBannerUrl(catalogEntries),
    [catalogEntries],
  );

  const socialLinks = useMemo(
    () => collectDeveloperSocialLinks(catalogEntries),
    [catalogEntries],
  );

  const layout = developerCatalogLayout(catalogEntries.length);

  const pageLabel =
    totalPages && totalPages > 0
      ? t('search.pagination.page', { page: `${page} / ${totalPages}` })
      : t('search.pagination.page', { page });

  const openHit = useCallback(
    (hit: ForumSearchHit) => {
      void openThreadFromSearch(hit, navigate, { searchReturnTo });
    },
    [navigate, searchReturnTo],
  );

  return (
    <OfflineGate>
      <div className="developer-dossier-page">
        <DeveloperDossierHero
          developerName={developerName}
          stats={stats}
          socialLinks={socialLinks}
          heroBannerUrl={heroBannerUrl}
          onBack={() => navigate(-1)}
        />

        {isOffline && (
          <div className="offline-banner" role="status">
            {t('developer.offline')}
          </div>
        )}

        {status === 'loading' && (
          <div className="developer-dossier-loading">
            <Spinner />
          </div>
        )}

        {status === 'error' && errorMessage && (
          <div className="developer-dossier-empty">
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
          <div className="developer-dossier-empty">
            <p>{t('developer.empty')}</p>
          </div>
        )}

        {status === 'ready' && results.length > 0 && (
          <div className="developer-dossier-body">
            <section className="developer-dossier-section developer-dossier-catalog">
              <div className="developer-dossier-section-head">
                <h2 className="developer-dossier-section-title">
                  {t('developer.catalogHeading')}
                </h2>
                {stats && (
                  <span className="developer-dossier-section-meta">
                    {t('developer.gameCount', { count: stats.gameCount })}
                  </span>
                )}
              </div>

              {layout === 'timeline' ? (
                <div
                  className={`developer-catalog-stack${catalogEntries.length === 1 ? ' developer-catalog-stack--solo' : ''}`}
                >
                  {catalogEntries.map((entry, index) => (
                    <DeveloperCatalogCapsule
                      key={`${index}-${entry.hit.threadId}-${entry.hit.postId ?? 'thread'}`}
                      entry={entry}
                      featured={catalogEntries.length === 1}
                      onOpen={() => openHit(entry.hit)}
                    />
                  ))}
                </div>
              ) : (
                <div className="developer-profile-grid">
                  {catalogEntries.map((entry, index) => (
                    <DeveloperGameCard
                      key={`${index}-${entry.hit.threadId}-${entry.hit.postId ?? 'thread'}`}
                      hit={entry.hit}
                      detail={entry.detail}
                      onOpen={() => openHit(entry.hit)}
                    />
                  ))}
                </div>
              )}

              {(page > 1 || hasMore) && (
                <div className="developer-dossier-pagination">
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
            </section>
          </div>
        )}
      </div>
    </OfflineGate>
  );
}
