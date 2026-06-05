import { useT } from '../../lib/i18n';

interface Props {
  page: number;
  totalPages: number;
  loading: boolean;
  onPage: (page: number) => void;
}

export function StorePagination({ page, totalPages, loading, onPage }: Props) {
  const { t } = useT();

  if (totalPages <= 1) return null;

  const pages = buildPageWindow(page, totalPages);

  return (
    <nav className="store-pagination" aria-label={t('store.pagination.label')}>
      <button
        type="button"
        className="store-pagination-btn"
        disabled={page <= 1 || loading}
        onClick={() => onPage(page - 1)}
      >
        {t('store.pagination.prev')}
      </button>

      <div className="store-pagination-pages">
        {pages.map((p, i) =>
          p === '…' ? (
            <span key={`gap-${i}`} className="store-pagination-gap" aria-hidden>
              …
            </span>
          ) : (
            <button
              key={p}
              type="button"
              className={`store-pagination-page${p === page ? ' store-pagination-page--active' : ''}`}
              disabled={loading || p === page}
              onClick={() => onPage(p)}
              aria-current={p === page ? 'page' : undefined}
            >
              {p}
            </button>
          ),
        )}
      </div>

      <button
        type="button"
        className="store-pagination-btn"
        disabled={page >= totalPages || loading}
        onClick={() => onPage(page + 1)}
      >
        {t('store.pagination.next')}
      </button>
    </nav>
  );
}

function buildPageWindow(current: number, total: number): Array<number | '…'> {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  const pages = new Set<number>([1, total, current, current - 1, current + 1]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
  const out: Array<number | '…'> = [];

  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i];
    const prev = sorted[i - 1];
    if (i > 0 && prev !== undefined && p - prev > 1) out.push('…');
    out.push(p);
  }

  return out;
}
