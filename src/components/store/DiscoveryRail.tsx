import { useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '../../lib/i18n';
import type { SamCategory, SamGameCard } from '../../types/sam';
import { Skeleton } from '../ui/Skeleton';
import { RailGameCard } from './RailGameCard';

const SKELETON_COUNT = 6;

interface Props {
  title: string;
  seeAllLabel?: string;
  onSeeAll?: () => void;
  items: SamGameCard[];
  category: SamCategory;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
}

export function DiscoveryRail({
  title,
  seeAllLabel,
  onSeeAll,
  items,
  category,
  loading = false,
  error = null,
  onRetry,
}: Props) {
  const { t } = useT();
  const trackRef = useRef<HTMLDivElement>(null);
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(false);

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
  }, [items.length, loading, updateScrollState]);

  const scrollByPage = (dir: -1 | 1) => {
    const el = trackRef.current;
    if (!el) return;
    const amount = Math.max(el.clientWidth * 0.85, 200);
    el.scrollBy({ left: dir * amount, behavior: 'smooth' });
  };

  if (!loading && !error && items.length === 0) {
    return null;
  }

  const showTrack = items.length > 0;
  const showSkeleton = loading && items.length === 0;

  return (
    <section className="discovery-rail">
      <header className="discovery-rail-header">
        <h2 className="discovery-rail-title">{title}</h2>
        {onSeeAll && (
          <button type="button" className="discovery-rail-see-all" onClick={onSeeAll}>
            {seeAllLabel}
          </button>
        )}
      </header>

      {error && (
        <div className="discovery-rail-error" role="alert">
          <span>{t('store.loadFailed', { error })}</span>
          {onRetry && (
            <button type="button" className="discovery-rail-retry" onClick={onRetry}>
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
              : items.map((g) => (
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
    </section>
  );
}
