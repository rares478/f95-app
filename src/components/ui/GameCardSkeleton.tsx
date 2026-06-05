import { Skeleton } from './Skeleton';

/** Matches the store/library card grid tile (16:9 thumb + text lines). */
export function GameCardSkeleton() {
  return (
    <div className="game-card-skeleton" aria-hidden="true">
      <Skeleton className="game-card-skeleton-thumb" />
      <div className="game-card-skeleton-body">
        <Skeleton className="game-card-skeleton-title" />
        <Skeleton className="game-card-skeleton-title game-card-skeleton-title--short" />
        <Skeleton className="game-card-skeleton-creator" />
        <div className="game-card-skeleton-meta">
          <Skeleton className="game-card-skeleton-meta-item" />
          <Skeleton className="game-card-skeleton-meta-item" />
          <Skeleton className="game-card-skeleton-meta-item" />
        </div>
      </div>
    </div>
  );
}

interface GridProps {
  count?: number;
  className?: string;
}

export function GameCardGridSkeleton({ count = 8, className }: GridProps) {
  const cls = className ? `game-card-grid-skeleton ${className}` : 'game-card-grid-skeleton';
  return (
    <div className={cls} aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <GameCardSkeleton key={i} />
      ))}
    </div>
  );
}
