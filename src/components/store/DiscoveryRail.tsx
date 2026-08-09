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

  if (!loading && !error && items.length === 0) {
    return null;
  }

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

      {loading && items.length === 0 && (
        <div className="discovery-rail-skeleton discovery-rail-track" aria-busy="true" aria-label={t('common.loading')}>
          {Array.from({ length: SKELETON_COUNT }, (_, i) => (
            <div key={i} className="rail-game-card-skeleton" aria-hidden="true">
              <Skeleton className="rail-game-card-skeleton-thumb" />
              <Skeleton className="rail-game-card-skeleton-title" />
              <Skeleton className="rail-game-card-skeleton-title rail-game-card-skeleton-title--short" />
            </div>
          ))}
        </div>
      )}

      {items.length > 0 && (
        <div className="discovery-rail-track">
          {items.map((g) => (
            <RailGameCard key={g.threadId} game={g} category={category} />
          ))}
        </div>
      )}
    </section>
  );
}
