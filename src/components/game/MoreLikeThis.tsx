import { useEffect, useRef, useState } from 'react';
import { useTagCatalog } from '../../contexts/TagCatalogContext';
import { DiscoveryRail } from '../store/DiscoveryRail';
import { formatIpcError } from '../../lib/ipcError';
import { useT } from '../../lib/i18n';
import { fetchMoreLikeThis } from '../../lib/moreLikeThisFetch';
import { findSamTagByNameOrSlug } from '../../lib/tagCatalog';
import type { GameTag } from '../../types/game';
import type { SamCategory, SamGameCard } from '../../types/sam';
import '../../styles/game-description.css';

interface Props {
  threadId: string;
  category: SamCategory;
  tags: GameTag[];
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

/** Lazy “More like this” rail — same carousel as store discovery. */
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
    fetchMoreLikeThis({
      category,
      excludeThreadIds: [threadId],
      tagIds,
    })
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

  const showEmpty = visible && !loading && !error && items.length === 0;
  const showRail = visible && (loading || error != null || items.length > 0);

  return (
    <section className="game-detail-more-like" aria-label={t('gamedetail.section.moreLikeThis')}>
      <div ref={sentinelRef} className="game-detail-more-like-sentinel" aria-hidden />

      {showEmpty && (
        <>
          <h2 className="game-detail-section-title">{t('gamedetail.section.moreLikeThis')}</h2>
          <div className="game-detail-more-like-empty">{t('gamedetail.moreLikeThis.empty')}</div>
        </>
      )}

      {showRail && (
        <DiscoveryRail
          title={t('gamedetail.section.moreLikeThis')}
          items={items}
          category={category}
          loading={loading}
          error={error}
          variant="compact"
        />
      )}
    </section>
  );
}
