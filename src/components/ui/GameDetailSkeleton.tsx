import { Skeleton } from './Skeleton';

/** Placeholder layout mirroring GameDetailHero + two-column body. */
export function GameDetailSkeleton() {
  return (
    <div className="game-detail-skeleton" aria-busy="true" aria-label="Loading">
      <div className="game-detail-skeleton-banner">
        <Skeleton className="game-detail-skeleton-banner-fill" />
      </div>

      <div className="game-detail-skeleton-hero-body">
        <Skeleton className="game-detail-skeleton-cover" />
        <div className="game-detail-skeleton-hero-text">
          <div className="game-detail-skeleton-badges">
            <Skeleton className="game-detail-skeleton-badge" />
            <Skeleton className="game-detail-skeleton-badge" />
          </div>
          <Skeleton className="game-detail-skeleton-title" />
          <Skeleton className="game-detail-skeleton-title game-detail-skeleton-title--short" />
          <div className="game-detail-skeleton-chips">
            <Skeleton className="game-detail-skeleton-chip" />
            <Skeleton className="game-detail-skeleton-chip" />
            <Skeleton className="game-detail-skeleton-chip" />
          </div>
        </div>
        <div className="game-detail-skeleton-actions">
          <Skeleton className="game-detail-skeleton-btn" />
          <Skeleton className="game-detail-skeleton-btn game-detail-skeleton-btn--secondary" />
        </div>
      </div>

      <div className="game-detail-skeleton-body">
        <div className="game-detail-skeleton-main">
          <Skeleton className="game-detail-skeleton-section-title" />
          <Skeleton className="game-detail-skeleton-line" />
          <Skeleton className="game-detail-skeleton-line" />
          <Skeleton className="game-detail-skeleton-line game-detail-skeleton-line--short" />
          <Skeleton className="game-detail-skeleton-section-title game-detail-skeleton-section-title--spaced" />
          <Skeleton className="game-detail-skeleton-block" />
        </div>
        <aside className="game-detail-skeleton-aside">
          <Skeleton className="game-detail-skeleton-section-title" />
          <Skeleton className="game-detail-skeleton-field" />
          <Skeleton className="game-detail-skeleton-field" />
          <Skeleton className="game-detail-skeleton-field" />
          <Skeleton className="game-detail-skeleton-field game-detail-skeleton-field--short" />
        </aside>
      </div>
    </div>
  );
}
