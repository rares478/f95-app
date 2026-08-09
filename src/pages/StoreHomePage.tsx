import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { OfflineGate } from '../components/OfflineGate';
import { DiscoveryRail } from '../components/store/DiscoveryRail';
import { SpotlightHero } from '../components/store/SpotlightHero';
import { SAM_CATEGORIES } from '../constants/samCategories';
import { useStoreFilters } from '../contexts/StoreFilters';
import { useStoreDiscovery } from '../hooks/useStoreDiscovery';
import { BROWSE_PATH, buildBrowseHandoff } from '../lib/browseHandoff';
import { useT } from '../lib/i18n';
import type { SamCategory } from '../types/sam';

export function StoreHomePage() {
  const { t } = useT();
  const navigate = useNavigate();
  const { seedFilters } = useStoreFilters();
  const { category, spotlight, rails, bootstrapping, fatalError, reload } = useStoreDiscovery();
  const [search, setSearch] = useState('');

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

        {rails.map((rail) => {
          const canSeeAll = Boolean(rail.seeAll.sort || rail.seeAll.includeTag);
          return (
            <DiscoveryRail
              key={rail.id}
              title={t(rail.titleKey, rail.titleParams)}
              seeAllLabel={canSeeAll ? t('store.home.seeAll') : undefined}
              onSeeAll={
                canSeeAll
                  ? () =>
                      goBrowse({
                        sort: rail.seeAll.sort,
                        includeTag: rail.seeAll.includeTag,
                      })
                  : undefined
              }
              items={rail.items}
              category={category}
              loading={rail.loading || (bootstrapping && rail.items.length === 0)}
              error={rail.error}
              onRetry={rail.retry}
            />
          );
        })}
      </div>
    </OfflineGate>
  );
}
