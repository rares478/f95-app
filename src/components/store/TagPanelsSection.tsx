import { useT } from '../../lib/i18n';
import type { SamCategory, SamGameCard } from '../../types/sam';
import { Skeleton } from '../ui/Skeleton';
import { TagPanelTile } from './TagPanelTile';

const TILE_SKELETON_COUNT = 4;

export interface TagPanelProps {
  id: string;
  title: string;
  items: SamGameCard[];
  loading: boolean;
  error: string | null;
  onRetry?: () => void;
  onSeeAll?: () => void;
}

interface Props {
  title?: string;
  panels: TagPanelProps[];
  category: SamCategory;
  seeAllLabel: string;
}

export function TagPanelsSection({ title, panels, category, seeAllLabel }: Props) {
  const { t } = useT();

  const visible = panels.filter((p) => p.loading || p.error || p.items.length > 0);
  if (visible.length === 0) return null;

  return (
    <section className="tag-panels" aria-label={title}>
      {title && <h2 className="tag-panels-title">{title}</h2>}
      <div className="tag-panels-grid">
        {visible.map((panel) => {
          const showSkeleton = panel.loading && panel.items.length === 0;
          const showTiles = panel.items.length > 0;

          return (
            <article key={panel.id} className="tag-panel">
              <header className="tag-panel-header">
                <h3 className="tag-panel-title">{panel.title}</h3>
                {panel.onSeeAll && (
                  <button type="button" className="tag-panel-see-all" onClick={panel.onSeeAll}>
                    {seeAllLabel}
                  </button>
                )}
              </header>

              {panel.error && (
                <div className="tag-panel-error" role="alert">
                  <span>{t('store.loadFailed', { error: panel.error })}</span>
                  {panel.onRetry && (
                    <button type="button" className="tag-panel-retry" onClick={panel.onRetry}>
                      {t('common.retry')}
                    </button>
                  )}
                </div>
              )}

              {(showTiles || showSkeleton) && (
                <div
                  className="tag-panel-tiles"
                  aria-busy={showSkeleton || undefined}
                  aria-label={showSkeleton ? t('common.loading') : undefined}
                >
                  {showSkeleton
                    ? Array.from({ length: TILE_SKELETON_COUNT }, (_, i) => (
                        <div key={i} className="tag-panel-tile-skeleton" aria-hidden="true">
                          <Skeleton className="tag-panel-tile-skeleton-thumb" />
                          <Skeleton className="tag-panel-tile-skeleton-title" />
                        </div>
                      ))
                    : panel.items.slice(0, 4).map((g) => (
                        <TagPanelTile key={g.threadId} game={g} category={category} />
                      ))}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
