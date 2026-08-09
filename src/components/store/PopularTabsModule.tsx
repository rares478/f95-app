import { useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '../../lib/i18n';
import type { SamCategory, SamGameCard } from '../../types/sam';
import { Skeleton } from '../ui/Skeleton';
import { RailGameCard } from './RailGameCard';

const SKELETON_COUNT = 6;

export interface PopularTab {
  id: string;
  label: string;
  items: SamGameCard[];
  loading: boolean;
  error: string | null;
  onRetry?: () => void;
  onSeeAll?: () => void;
}

interface Props {
  tabs: PopularTab[];
  title: string;
  seeAllLabel: string;
  category: SamCategory;
}

export function PopularTabsModule({ tabs, title, seeAllLabel, category }: Props) {
  const { t } = useT();
  const [activeIndex, setActiveIndex] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(false);

  const safeIndex = tabs.length === 0 ? 0 : Math.min(activeIndex, tabs.length - 1);
  const active = tabs[safeIndex];

  useEffect(() => {
    if (activeIndex !== safeIndex) setActiveIndex(safeIndex);
  }, [activeIndex, safeIndex]);

  const updateScrollState = useCallback(() => {
    const el = trackRef.current;
    if (!el) {
      setCanPrev(false);
      setCanNext(false);
      return;
    }
    const max = el.scrollWidth - el.clientWidth;
    setCanPrev(el.scrollLeft > 2);
    setCanNext(max > 2 && el.scrollLeft < max - 2);
  }, []);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;

    updateScrollState();
    el.addEventListener('scroll', updateScrollState, { passive: true });
    const ro = new ResizeObserver(() => updateScrollState());
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', updateScrollState);
      ro.disconnect();
    };
  }, [active?.items.length, active?.loading, active?.id, updateScrollState]);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    el.scrollLeft = 0;
    updateScrollState();
  }, [active?.id, updateScrollState]);

  const scrollByPage = (dir: -1 | 1) => {
    const el = trackRef.current;
    if (!el) return;
    const amount = Math.max(el.clientWidth * 0.85, 200);
    el.scrollBy({ left: dir * amount, behavior: 'smooth' });
  };

  if (!active || tabs.length === 0) return null;

  const showTrack = active.items.length > 0;
  const showSkeleton = active.loading && active.items.length === 0;

  return (
    <section className="popular-tabs">
      <header className="popular-tabs-header">
        <h2 className="popular-tabs-title">{title}</h2>
        {active.onSeeAll && (
          <button type="button" className="popular-tabs-see-all" onClick={active.onSeeAll}>
            {seeAllLabel}
          </button>
        )}
      </header>

      <div className="popular-tabs-tablist" role="tablist" aria-label={title}>
        {tabs.map((tab, i) => {
          const selected = i === safeIndex;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`popular-tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`popular-tabpanel-${tab.id}`}
              className={`popular-tabs-tab${selected ? ' is-active' : ''}`}
              onClick={() => setActiveIndex(i)}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={`popular-tabpanel-${active.id}`}
        aria-labelledby={`popular-tab-${active.id}`}
        className="popular-tabs-panel"
      >
        {active.error && (
          <div className="discovery-rail-error" role="alert">
            <span>{t('store.loadFailed', { error: active.error })}</span>
            {active.onRetry && (
              <button type="button" className="discovery-rail-retry" onClick={active.onRetry}>
                {t('common.retry')}
              </button>
            )}
          </div>
        )}

        {(showTrack || showSkeleton) && (
          <div className="discovery-rail-scroller">
            {showTrack && (
              <button
                type="button"
                className="discovery-rail-nav discovery-rail-nav--prev"
                aria-label={t('store.home.rail.prev')}
                disabled={!canPrev}
                onClick={() => scrollByPage(-1)}
              >
                ‹
              </button>
            )}

            <div
              ref={showTrack ? trackRef : undefined}
              className={
                showSkeleton
                  ? 'discovery-rail-skeleton discovery-rail-track'
                  : 'discovery-rail-track'
              }
              aria-busy={showSkeleton || undefined}
              aria-label={showSkeleton ? t('common.loading') : undefined}
            >
              {showSkeleton
                ? Array.from({ length: SKELETON_COUNT }, (_, i) => (
                    <div key={i} className="rail-game-card-skeleton" aria-hidden="true">
                      <Skeleton className="rail-game-card-skeleton-thumb" />
                      <Skeleton className="rail-game-card-skeleton-title" />
                      <Skeleton className="rail-game-card-skeleton-title rail-game-card-skeleton-title--short" />
                    </div>
                  ))
                : active.items.map((g) => (
                    <RailGameCard key={g.threadId} game={g} category={category} />
                  ))}
            </div>

            {showTrack && (
              <button
                type="button"
                className="discovery-rail-nav discovery-rail-nav--next"
                aria-label={t('store.home.rail.next')}
                disabled={!canNext}
                onClick={() => scrollByPage(1)}
              >
                ›
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
