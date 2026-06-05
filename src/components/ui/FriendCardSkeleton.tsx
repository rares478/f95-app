import { Skeleton } from './Skeleton';

function FriendCardSkeleton() {
  return (
    <div className="friend-card-skeleton" aria-hidden="true">
      <Skeleton round className="friend-card-skeleton-avatar" />
      <div className="friend-card-skeleton-text">
        <Skeleton className="friend-card-skeleton-name" />
        <Skeleton className="friend-card-skeleton-subtitle" />
      </div>
    </div>
  );
}

interface GridProps {
  count?: number;
}

export function FriendCardGridSkeleton({ count = 6 }: GridProps) {
  return (
    <div className="friend-card-grid-skeleton" aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <FriendCardSkeleton key={i} />
      ))}
    </div>
  );
}
