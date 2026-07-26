import { useEffect, useRef, useState } from 'react';
import { GameCard } from '../store/GameCard';
import { GameCardGridSkeleton } from '../ui/GameCardSkeleton';
import { useTagCatalog } from '../../contexts/TagCatalogContext';
import { samList } from '../../lib/ipc';
import { formatIpcError } from '../../lib/ipcError';
import { useT } from '../../lib/i18n';
import { findSamTagByNameOrSlug } from '../../lib/tagCatalog';
import type { GameTag } from '../../types/game';
import type { SamCategory, SamGameCard } from '../../types/sam';

const TAGS_PER_QUERY = 5;
const RESULT_TOTAL = 15;
/** When we have more than 5 tags: N random 5-tag queries × games each. */
const SHUFFLE_COUNT = 5;
const GAMES_PER_SHUFFLE = 3;

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

async function fetchMoreLikeThis(args: {
  category: SamCategory;
  threadId: string;
  tagIds: number[];
}): Promise<SamGameCard[]> {
  const { category, threadId, tagIds } = args;
  if (tagIds.length === 0) return [];

  const exclude = new Set<string>([threadId]);

  // Few tags: one search, take 15.
  if (tagIds.length <= TAGS_PER_QUERY) {
    const page = await samList({
      category,
      tags: tagIds,
      tagtype: tagIds.length > 1 ? 'or' : undefined,
      sort: 'likes',
      rows: RESULT_TOTAL + 4,
      page: 1,
    });
    const out: SamGameCard[] = [];
    for (const g of page.items) {
      if (exclude.has(g.threadId)) continue;
      exclude.add(g.threadId);
      out.push(g);
      if (out.length >= RESULT_TOTAL) break;
    }
    return out;
  }

  // Many tags: 5 random 5-tag shuffles, take 3 games from each (= 15).
  const batches = Array.from({ length: SHUFFLE_COUNT }, () =>
    pickRandom(tagIds, TAGS_PER_QUERY),
  );
  const pages = await Promise.all(
    batches.map((batchTags) =>
      samList({
        category,
        tags: batchTags,
        tagtype: 'or',
        sort: 'likes',
        rows: GAMES_PER_SHUFFLE + 6,
        page: 1,
      }),
    ),
  );

  const out: SamGameCard[] = [];
  for (const page of pages) {
    let taken = 0;
    for (const g of page.items) {
      if (exclude.has(g.threadId)) continue;
      exclude.add(g.threadId);
      out.push(g);
      taken += 1;
      if (taken >= GAMES_PER_SHUFFLE) break;
    }
  }

  // Top up from leftovers if a batch was thin.
  if (out.length < RESULT_TOTAL) {
    for (const page of pages) {
      for (const g of page.items) {
        if (exclude.has(g.threadId)) continue;
        exclude.add(g.threadId);
        out.push(g);
        if (out.length >= RESULT_TOTAL) return out;
      }
    }
  }

  return out.slice(0, RESULT_TOTAL);
}

/** Lazy “More like this” grid — fetches when scrolled into view. */
export function MoreLikeThis({ threadId, category, tags }: Props) {
  const { t } = useT();
  const { catalog } = useTagCatalog();
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<SamGameCard[]>([]);

  useEffect(() => {
    setVisible(false);
    setItems([]);
    setError(null);
    setLoading(false);
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

  if (tags.length === 0) return null;

  return (
    <section className="game-detail-more-like" aria-label={t('gamedetail.section.moreLikeThis')}>
      <div ref={sentinelRef} className="game-detail-more-like-sentinel" aria-hidden />

      {visible && (
        <>
          <h2 className="game-detail-section-title">{t('gamedetail.section.moreLikeThis')}</h2>

          {loading && <GameCardGridSkeleton count={8} />}

          {error && (
            <div className="game-detail-more-like-empty">
              {t('gamedetail.moreLikeThis.failed', { error })}
            </div>
          )}

          {!loading && !error && items.length === 0 && (
            <div className="game-detail-more-like-empty">{t('gamedetail.moreLikeThis.empty')}</div>
          )}

          {!loading && items.length > 0 && (
            <div className="store-grid">
              {items.map((game) => (
                <GameCard key={game.threadId} game={game} category={category} />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
