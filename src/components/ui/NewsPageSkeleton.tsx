import { Skeleton } from './Skeleton';

/** Three stacked section placeholders for the news feed. */
export function NewsPageSkeleton() {
  return (
    <div className="news-page-skeleton" aria-busy="true" aria-label="Loading">
      {[0, 1, 2].map((i) => (
        <section key={i} className="news-page-skeleton-section">
          <Skeleton className="news-page-skeleton-heading" />
          {i === 2 ? (
            <div className="news-page-skeleton-grid">
              {Array.from({ length: 4 }, (_, j) => (
                <Skeleton key={j} className="news-page-skeleton-card" />
              ))}
            </div>
          ) : (
            <div className="news-page-skeleton-list">
              {Array.from({ length: i === 0 ? 2 : 3 }, (_, j) => (
                <div key={j} className="news-page-skeleton-row">
                  <Skeleton round className="news-page-skeleton-avatar" />
                  <div className="news-page-skeleton-row-text">
                    <Skeleton className="news-page-skeleton-line" />
                    <Skeleton className="news-page-skeleton-line news-page-skeleton-line--short" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
