import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStoreContextMenu } from '../../hooks/useStoreContextMenu';
import { useTagCatalog } from '../../contexts/TagCatalogContext';
import { samList } from '../../lib/ipc';
import { formatIpcError } from '../../lib/ipcError';
import { useT } from '../../lib/i18n';
import { useIsInLibrary } from '../../lib/libraryMembership';
import { findSamTagByNameOrSlug } from '../../lib/tagCatalog';
import type { GameTag } from '../../types/game';
import type { SamCategory, SamGameCard, SamSort } from '../../types/sam';
import '../../styles/game-description.css';

/** AND this many tags per query — tighter than OR of common tags. */
const TAGS_PER_QUERY = 3;
const PARALLEL_QUERIES = 3;
const ROWS_PER_QUERY = 20;
/** Sample from the first N SAM pages so results are not stuck on page 1. */
const MAX_PAGE_JITTER = 8;
const RESULT_TOTAL = 12;
const CARD_WIDTH = 168;

const QUERY_SORTS: SamSort[] = ['date', 'rating', 'likes'];

interface Props {
  threadId: string;
  category: SamCategory;
  tags: GameTag[];
}

function pickRandom<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, max);
}

function resolveTagIds(catalog: Map<number, string>, tags: GameTag[]): number[] {
  const ids: number[] = [];
  const seen = new Set<number>();
  for (const tag of tags) {
    const sam = findSamTagByNameOrSlug(catalog, tag);
    if (!sam || seen.has(sam.id)) continue;
    seen.add(sam.id);
    ids.push(sam.id);
  }
  return ids;
}

function randomPage(totalPages: number): number {
  const max = Math.min(Math.max(1, totalPages), MAX_PAGE_JITTER);
  return 1 + Math.floor(Math.random() * max);
}

/**
 * Similar games via several random AND tag queries.
 * Avoids likes+OR+page1, which always returned the same mega-popular titles.
 */
async function fetchMoreLikeThis(args: {
  category: SamCategory;
  threadId: string;
  tagIds: number[];
}): Promise<SamGameCard[]> {
  const { category, threadId, tagIds } = args;
  if (tagIds.length === 0) return [];

  const tagCount = Math.min(TAGS_PER_QUERY, tagIds.length);
  const queryCount = tagIds.length <= 1 ? 1 : PARALLEL_QUERIES;
  const batches = Array.from({ length: queryCount }, (_, i) => ({
    tags: pickRandom(tagIds, tagCount),
    sort: QUERY_SORTS[i % QUERY_SORTS.length]!,
  }));

  const pools = await Promise.all(
    batches.map(async ({ tags, sort }) => {
      const base = {
        category,
        tags,
        tagtype: tags.length > 1 ? ('and' as const) : undefined,
        sort,
        rows: ROWS_PER_QUERY,
      };
      const first = await samList({ ...base, page: 1 });
      const items = [...first.items];

      const page = randomPage(first.totalPages);
      if (page > 1) {
        const deeper = await samList({ ...base, page });
        items.push(...deeper.items);
      }

      // AND of rare tags can be sparse — loosen once so the rail is not blank.
      if (items.length < 4 && tags.length > 1) {
        const loose = await samList({
          ...base,
          tagtype: 'or',
          sort: 'date',
          page: randomPage(Math.max(first.totalPages, 1)),
        });
        items.push(...loose.items);
      }

      return items;
    }),
  );

  const exclude = new Set<string>([threadId]);
  const out: SamGameCard[] = [];
  for (const items of pools) {
    for (const g of items) {
      if (exclude.has(g.threadId)) continue;
      exclude.add(g.threadId);
      out.push(g);
    }
  }

  return pickRandom(out, RESULT_TOTAL);
}

function IconChevron({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      {dir === 'left' ? <path d="M15 18l-6-6 6-6" /> : <path d="M9 18l6-6-6-6" />}
    </svg>
  );
}

function RailCard({ game, category }: { game: SamGameCard; category: SamCategory }) {
  const { t } = useT();
  const { openStoreContextMenu } = useStoreContextMenu(category);
  const inLibrary = useIsInLibrary(game.threadId);

  return (
    <Link
      to={`/store/game/${game.threadId}?cat=${category}`}
      className="more-like-rail-card"
      onContextMenu={(e) => void openStoreContextMenu(e, game)}
    >
      <div className="more-like-rail-poster">
        {game.thumbnailUrl ? (
          <img
            src={game.thumbnailUrl}
            alt=""
            className="more-like-rail-poster-img"
            loading="lazy"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <div className="more-like-rail-poster-fallback">
            {game.title.slice(0, 1).toUpperCase()}
          </div>
        )}
        <div className="more-like-rail-poster-shade" />
        {inLibrary && (
          <span className="more-like-rail-library" title={t('store.badge.inLibrary')}>
            {t('store.badge.inLibrary')}
          </span>
        )}
        {game.version && <span className="more-like-rail-version">{game.version}</span>}
        <div className="more-like-rail-info">
          <div className="more-like-rail-title" title={game.title}>
            {game.title}
          </div>
          {(game.creator || game.rating != null) && (
            <div className="more-like-rail-meta">
              {game.creator && <span className="more-like-rail-creator">{game.creator}</span>}
              {game.rating != null && (
                <span className="more-like-rail-rating">★ {game.rating.toFixed(1)}</span>
              )}
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}

/** Lazy “More like this” horizontal rail — fetches when scrolled into view. */
export function MoreLikeThis({ threadId, category, tags }: Props) {
  const { t } = useT();
  const { catalog } = useTagCatalog();
  const sentinelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<SamGameCard[]>([]);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateArrows = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  const scrollByDir = (dir: -1 | 1) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * (CARD_WIDTH * 2 + 28), behavior: 'smooth' });
  };

  useEffect(() => {
    setVisible(false);
    setItems([]);
    setError(null);
    setLoading(false);
    setCanScrollLeft(false);
    setCanScrollRight(false);
  }, [threadId]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || visible) return;
    const root = document.querySelector('.app-main');
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
        }
      },
      {
        root: root instanceof Element ? root : null,
        rootMargin: '280px 0px',
        threshold: 0,
      },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible, threadId]);

  useEffect(() => {
    if (!visible) return;

    const tagIds = resolveTagIds(catalog, tags);
    if (tagIds.length === 0) {
      setItems([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchMoreLikeThis({ category, threadId, tagIds })
      .then((next) => {
        if (!cancelled) setItems(next);
      })
      .catch((err) => {
        if (!cancelled) setError(formatIpcError(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [visible, tags, catalog, category, threadId]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || loading || items.length === 0) return;
    updateArrows();
    el.addEventListener('scroll', updateArrows, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateArrows) : null;
    ro?.observe(el);
    return () => {
      el.removeEventListener('scroll', updateArrows);
      ro?.disconnect();
    };
  }, [loading, items, updateArrows]);

  if (tags.length === 0) return null;

  return (
    <section className="game-detail-more-like" aria-label={t('gamedetail.section.moreLikeThis')}>
      <div ref={sentinelRef} className="game-detail-more-like-sentinel" aria-hidden />

      {visible && (
        <>
          <h2 className="game-detail-section-title">{t('gamedetail.section.moreLikeThis')}</h2>

          {loading && (
            <div className="more-like-rail-section">
              <div className="more-like-rail-scroll more-like-rail-scroll--loading">
                {Array.from({ length: 6 }, (_, i) => (
                  <div key={i} className="more-like-rail-card more-like-rail-card--skeleton" aria-hidden />
                ))}
              </div>
            </div>
          )}

          {error && (
            <div className="game-detail-more-like-empty">
              {t('gamedetail.moreLikeThis.failed', { error })}
            </div>
          )}

          {!loading && !error && items.length === 0 && (
            <div className="game-detail-more-like-empty">{t('gamedetail.moreLikeThis.empty')}</div>
          )}

          {!loading && items.length > 0 && (
            <div
              className={`more-like-rail-section${canScrollLeft ? ' more-like-rail-section--fade-left' : ''}${canScrollRight ? ' more-like-rail-section--fade-right' : ''}`}
            >
              <button
                type="button"
                className={`more-like-rail-arrow more-like-rail-arrow--left${canScrollLeft ? '' : ' more-like-rail-arrow--hidden'}`}
                aria-label={t('news.rss.scrollLeft')}
                onClick={() => scrollByDir(-1)}
              >
                <IconChevron dir="left" />
              </button>

              <div ref={scrollRef} className="more-like-rail-scroll">
                {items.map((game) => (
                  <RailCard key={game.threadId} game={game} category={category} />
                ))}
              </div>

              <button
                type="button"
                className={`more-like-rail-arrow more-like-rail-arrow--right${canScrollRight ? '' : ' more-like-rail-arrow--hidden'}`}
                aria-label={t('news.rss.scrollRight')}
                onClick={() => scrollByDir(1)}
              >
                <IconChevron dir="right" />
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
