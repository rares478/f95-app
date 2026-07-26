import { useCallback, useEffect, useMemo, useRef } from 'react';
import { FilterSidebar } from '../components/store/FilterSidebar';
import { GameCard } from '../components/store/GameCard';
import { FeaturedHero } from '../components/store/FeaturedHero';
import { StorePagination } from '../components/store/StorePagination';
import { LoadingState } from '../components/ui/LoadingState';
import { GameCardGridSkeleton } from '../components/ui/GameCardSkeleton';
import { useSamList } from '../hooks/useSamList';
import { useStoreSettings } from '../contexts/StoreSettings';
import { useStoreFilters } from '../contexts/StoreFilters';
import { OfflineGate } from '../components/OfflineGate';
import { useT } from '../lib/i18n';

const STORE_VIEW_STATE_KEY = 'f95-app:store-view-state';

function loadStoreViewState(): { page: number; scrollTop: number } {
  try {
    const raw = sessionStorage.getItem(STORE_VIEW_STATE_KEY);
    if (!raw) return { page: 1, scrollTop: 0 };
    const parsed = JSON.parse(raw) as { page?: number; scrollTop?: number };
    return {
      page: Math.max(1, Number(parsed.page ?? 1)),
      scrollTop: Math.max(0, Number(parsed.scrollTop ?? 0)),
    };
  } catch {
    return { page: 1, scrollTop: 0 };
  }
}

function saveStoreViewState(next: { page?: number; scrollTop?: number }) {
  const current = loadStoreViewState();
  const merged = {
    page: Math.max(1, Number(next.page ?? current.page)),
    scrollTop: Math.max(0, Number(next.scrollTop ?? current.scrollTop)),
  };
  sessionStorage.setItem(STORE_VIEW_STATE_KEY, JSON.stringify(merged));
}

function restoreScrollWhenReady(
  container: HTMLElement,
  targetTop: number,
  onDone: () => void,
): () => void {
  if (targetTop <= 0) {
    onDone();
    return () => undefined;
  }

  let cancelled = false;
  let rafId = 0;
  let attempts = 0;
  const maxAttempts = 30;

  const tryRestore = () => {
    if (cancelled) return;
    attempts += 1;
    container.scrollTop = targetTop;

    const reachedTarget = Math.abs(container.scrollTop - targetTop) <= 2;
    const hasEnoughHeight = container.scrollHeight - container.clientHeight >= targetTop;

    if (reachedTarget || attempts >= maxAttempts || (!hasEnoughHeight && attempts >= maxAttempts)) {
      onDone();
      return;
    }

    rafId = requestAnimationFrame(tryRestore);
  };

  rafId = requestAnimationFrame(tryRestore);
  return () => {
    cancelled = true;
    cancelAnimationFrame(rafId);
  };
}

export function StorePage() {
  const { t } = useT();
  const { settings: storeSettings } = useStoreSettings();
  const {
    category,
    search,
    sort,
    prefixFilter,
    includeTags,
    excludeTags,
    tagMode,
    setSearch,
    setSort,
    setPrefixFilter,
    setIncludeTags,
    setExcludeTags,
    setTagMode,
    changeCategory,
    clearAll,
  } = useStoreFilters();
  const infiniteScroll = storeSettings.scrollMode === 'infinite';
  const initialViewRef = useRef(loadStoreViewState());

  const includePrefixes = useMemo(
    () =>
      Object.entries(prefixFilter)
        .filter(([, mode]) => mode === 'include')
        .map(([id]) => Number(id)),
    [prefixFilter],
  );
  const excludePrefixes = useMemo(
    () =>
      Object.entries(prefixFilter)
        .filter(([, mode]) => mode === 'exclude')
        .map(([id]) => Number(id)),
    [prefixFilter],
  );

  const hasActiveFilters =
    search.trim().length > 0 ||
    includePrefixes.length > 0 ||
    excludePrefixes.length > 0 ||
    includeTags.length > 0 ||
    excludeTags.length > 0;

  const { items, page, totalPages, totalRows, loading, error, hasMore, loadMore, goToPage, reload } =
    useSamList({
      category,
      sort,
      search: search.trim() || undefined,
      prefixes: includePrefixes.length ? includePrefixes : undefined,
      noprefixes: excludePrefixes.length ? excludePrefixes : undefined,
      tags: includeTags.length ? includeTags.map((tg) => tg.id) : undefined,
      notags: excludeTags.length ? excludeTags.map((tg) => tg.id) : undefined,
      tagtype: includeTags.length > 1 ? tagMode : undefined,
    });

  const scrollModeRef = useRef(storeSettings.scrollMode);
  useEffect(() => {
    if (scrollModeRef.current === storeSettings.scrollMode) return;
    scrollModeRef.current = storeSettings.scrollMode;
    reload();
  }, [storeSettings.scrollMode, reload]);

  useEffect(() => {
    if (page > 0) saveStoreViewState({ page });
  }, [page]);

  const restoredRef = useRef(false);
  useEffect(() => {
    const main = document.querySelector('.store-main');
    if (!(main instanceof HTMLElement)) return;
    const onScroll = () => {
      if (!restoredRef.current) return;
      saveStoreViewState({ scrollTop: main.scrollTop });
    };
    main.addEventListener('scroll', onScroll, { passive: true });
    return () => main.removeEventListener('scroll', onScroll);
  }, []);

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!infiniteScroll) return;
    const el = sentinelRef.current;
    if (!el) return;
    const root = document.querySelector('.store-main');
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) loadMore();
        }
      },
      {
        root: root instanceof Element ? root : null,
        rootMargin: '300px',
      },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [infiniteScroll, loadMore]);

  useEffect(() => {
    if (restoredRef.current) return;
    if (loading) return;
    if (items.length === 0) return;
    const main = document.querySelector('.store-main');
    if (!(main instanceof HTMLElement)) return;
    return restoreScrollWhenReady(main, initialViewRef.current.scrollTop, () => {
      restoredRef.current = true;
      saveStoreViewState({ scrollTop: main.scrollTop, page });
    });
  }, [loading, items.length, page]);

  const showFeatured = useMemo(() => {
    if (sort !== 'date' || search || includeTags.length > 0 || excludeTags.length > 0) return false;
    if (includePrefixes.length > 0 || excludePrefixes.length > 0) return false;
    if (!infiniteScroll && page > 1) return false;
    return items.length > 0;
  }, [
    sort,
    search,
    includeTags.length,
    excludeTags.length,
    includePrefixes.length,
    excludePrefixes.length,
    infiniteScroll,
    page,
    items.length,
  ]);

  const gridItems = useMemo(() => (showFeatured ? items.slice(1) : items), [items, showFeatured]);

  const handlePageChange = useCallback(
    (target: number) => {
      goToPage(target);
      document.querySelector('.store-main')?.scrollTo({ top: 0, behavior: 'smooth' });
    },
    [goToPage],
  );

  function clearAllFilters() {
    clearAll();
  }

  return (
    <OfflineGate>
      <div className="store-page">
        <FilterSidebar
          category={category}
          onCategory={changeCategory}
          search={search}
          onSearch={setSearch}
          sort={sort}
          onSort={setSort}
          prefixFilter={prefixFilter}
          onPrefixFilter={setPrefixFilter}
          includeTags={includeTags}
          onIncludeTags={setIncludeTags}
          excludeTags={excludeTags}
          onExcludeTags={setExcludeTags}
          tagMode={tagMode}
          onTagMode={setTagMode}
          onClearAll={clearAllFilters}
          hasActiveFilters={hasActiveFilters}
        />

        <section className="store-main">
          <header className="store-main-head">
            <h1 className="store-main-title">{t('store.title')}</h1>
            <div className="store-main-stats">
              {totalRows > 0 && (
                <span>{t('store.results', { count: totalRows.toLocaleString() })}</span>
              )}
              {!infiniteScroll && totalPages > 1 && (
                <span className="store-main-page-hint">
                  {t('store.pagination.page', { page, total: totalPages })}
                </span>
              )}
            </div>
          </header>

          {error && <div className="store-error">{t('store.loadFailed', { error })}</div>}

          {loading && items.length === 0 && !error && <GameCardGridSkeleton count={10} />}

          {items.length === 0 && !loading && !error && (
            <div className="store-empty">{t('store.noResults')}</div>
          )}

          {showFeatured && <FeaturedHero game={items[0]} category={category} />}

          {showFeatured && <h2 className="store-section-title">{t('store.section.more')}</h2>}

          <div className="store-grid">
            {gridItems.map((game) => (
              <GameCard key={game.threadId} game={game} category={category} />
            ))}
          </div>

          {infiniteScroll && <div ref={sentinelRef} className="store-sentinel" />}

          {infiniteScroll && loading && items.length > 0 && (
            <LoadingState label={t('common.loading')} variant="inline" />
          )}
          {infiniteScroll && !loading && !hasMore && items.length > 0 && (
            <div className="store-end">—</div>
          )}

          {!infiniteScroll && (
            <StorePagination
              page={page}
              totalPages={totalPages}
              loading={loading}
              onPage={handlePageChange}
            />
          )}
        </section>
      </div>
    </OfflineGate>
  );
}
