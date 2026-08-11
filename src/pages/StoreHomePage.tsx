import { useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { OfflineGate } from '../components/OfflineGate';
import { DiscoveryRail } from '../components/store/DiscoveryRail';
import { PopularTabsModule } from '../components/store/PopularTabsModule';
import { SpotlightHero } from '../components/store/SpotlightHero';
import { TagPanelsSection } from '../components/store/TagPanelsSection';
import { SAM_CATEGORIES } from '../constants/samCategories';
import { useStoreFilters } from '../contexts/StoreFilters';
import { useStoreDiscovery, type StoreDiscoveryRail } from '../hooks/useStoreDiscovery';
import { BROWSE_PATH, buildBrowseHandoff } from '../lib/browseHandoff';
import { groupHomeBands } from '../lib/discoveryHomeBands';
import { useT } from '../lib/i18n';
import type { SamCategory } from '../types/sam';

export function StoreHomePage() {
  const { t } = useT();
  const navigate = useNavigate();
  const { seedFilters } = useStoreFilters();
  const { category, spotlight, rails, bootstrapping, fatalError, reload } = useStoreDiscovery();
  const [search, setSearch] = useState('');

  // Typed on StoreDiscoveryRail so required `retry` is preserved through banding.
  const bands = useMemo(() => groupHomeBands<StoreDiscoveryRail>(rails), [rails]);

  const goBrowse = (handoff: Parameters<typeof buildBrowseHandoff>[0]) => {
    seedFilters(buildBrowseHandoff(handoff));
    navigate(BROWSE_PATH);
  };

  const onSearchSubmit = (e: FormEvent) => {
    e.preventDefault();
    goBrowse({ search: search.trim() });
  };

  const onCategory = (next: SamCategory) => {
    if (next === 'games') return;
    goBrowse({ category: next });
  };

  const showFatal =
    Boolean(fatalError) &&
    !bootstrapping &&
    spotlight.length === 0 &&
    rails.every((r) => r.items.length === 0 && !r.loading);

  return (
    <OfflineGate allowReadOnly>
      <div className="store-home">
        <header className="store-home-header">
          <div className="store-home-header-row">
            <h1 className="store-home-title">{t('store.title')}</h1>
            <form className="store-home-search" onSubmit={onSearchSubmit}>
              <input
                type="search"
                className="store-home-search-input"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('store.home.searchPlaceholder')}
                aria-label={t('store.home.searchPlaceholder')}
              />
            </form>
            <button
              type="button"
              className="store-home-browse-all"
              onClick={() => goBrowse({})}
            >
              {t('store.home.browseAll')}
            </button>
          </div>

          <nav className="store-home-categories" aria-label={t('store.title')}>
            {SAM_CATEGORIES.map((c) => {
              const active = c.id === 'games';
              const label = c.literal ?? (c.labelKey ? t(c.labelKey) : c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  className={`store-home-category${active ? ' is-active' : ''}`}
                  aria-current={active ? 'page' : undefined}
                  onClick={() => onCategory(c.id)}
                >
                  {label}
                </button>
              );
            })}
          </nav>
        </header>

        {showFatal && (
          <div className="store-home-fatal" role="alert">
            <span>{t('store.home.loadFailed')}</span>
            {fatalError && <span className="store-home-fatal-detail">{fatalError}</span>}
            <button type="button" className="store-home-fatal-retry" onClick={reload}>
              {t('store.home.retry')}
            </button>
          </div>
        )}

        {spotlight.length > 0 && <SpotlightHero slides={spotlight} category={category} />}

        {bands.map((band) => {
          switch (band.type) {
            case 'forYou':
              return (
                <section
                  key="forYou"
                  className="store-home-for-you"
                  aria-label={t('store.home.section.forYou')}
                >
                  {band.rails.map((rail) => (
                    <DiscoveryRail
                      key={rail.id}
                      variant="compact"
                      title={t(rail.titleKey, rail.titleParams)}
                      items={rail.items}
                      category={category}
                      loading={rail.loading || (bootstrapping && rail.items.length === 0)}
                      error={rail.error}
                      onRetry={rail.retry}
                    />
                  ))}
                </section>
              );
            case 'recent':
              return (
                <DiscoveryRail
                  key={band.rail.id}
                  variant="capsule"
                  title={t(band.rail.titleKey, band.rail.titleParams)}
                  seeAllLabel={t('store.home.seeAll')}
                  onSeeAll={() => goBrowse({ sort: band.rail.seeAll.sort })}
                  items={band.rail.items}
                  category={category}
                  loading={band.rail.loading || (bootstrapping && band.rail.items.length === 0)}
                  error={band.rail.error}
                  onRetry={band.rail.retry}
                />
              );
            case 'popular':
              return (
                <PopularTabsModule
                  key="popular"
                  title={t('store.home.section.popular')}
                  seeAllLabel={t('store.home.seeAll')}
                  category={category}
                  tabs={band.tabs.map((rail) => ({
                    id: rail.id,
                    label: t(
                      rail.id === 'likes'
                        ? 'store.home.tab.likes'
                        : rail.id === 'views'
                          ? 'store.home.tab.views'
                          : 'store.home.tab.rated',
                    ),
                    items: rail.items,
                    loading: rail.loading || (bootstrapping && rail.items.length === 0),
                    error: rail.error,
                    onRetry: rail.retry,
                    onSeeAll: () => goBrowse({ sort: rail.seeAll.sort }),
                  }))}
                />
              );
            case 'tags':
              return (
                <TagPanelsSection
                  key="tags"
                  seeAllLabel={t('store.home.seeAll')}
                  category={category}
                  panels={band.panels.map((rail) => ({
                    id: rail.id,
                    title: t(rail.titleKey, rail.titleParams),
                    items: rail.items,
                    loading: rail.loading || (bootstrapping && rail.items.length === 0),
                    error: rail.error,
                    onRetry: rail.retry,
                    onSeeAll: () =>
                      goBrowse({
                        sort: rail.seeAll.sort,
                        includeTag: rail.seeAll.includeTag,
                      }),
                  }))}
                />
              );
            default:
              return null;
          }
        })}
      </div>
    </OfflineGate>
  );
}
