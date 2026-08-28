import { useRef } from 'react';
import { useElementWidth } from '../../hooks/useElementWidth';
import { useStoreCardHoverImages } from '../../hooks/useStoreCardHoverImages';
import { useIsInLibrary } from '../../lib/libraryMembership';
import { useT } from '../../lib/i18n';
import { contentTagIdsFromDetail } from '../../lib/tagCatalog';
import { usePrefixCatalog } from '../../contexts/PrefixCatalogContext';
import { useTagCatalog } from '../../contexts/TagCatalogContext';
import { prefixPillColor } from '../../lib/prefixCatalog';
import { resolvePrefixByName } from '../../lib/prefixResolve';
import type { DeveloperCatalogEntry } from '../../lib/developerProfileModel';
import type { ForumSearchPrefix } from '../../types/forumSearch';
import { ContentTagPills } from '../store/ContentTagPills';
import { StoreCardThumbDots } from '../store/StoreCardThumbDots';

type Props = {
  entry: DeveloperCatalogEntry;
  featured?: boolean;
  onOpen: () => void;
};

export function DeveloperCatalogCapsule({ entry, featured = false, onOpen }: Props) {
  const { t } = useT();
  const { hit, detail } = entry;
  const { catalog: tagCatalog } = useTagCatalog();
  const inLibrary = useIsInLibrary(hit.threadId);
  const cardRef = useRef<HTMLButtonElement>(null);
  const widthPx = useElementWidth(cardRef);
  const title = detail?.title || hit.title || t('search.result.untitled');
  const initial = title.trim().slice(0, 1).toUpperCase() || '?';
  const loading = Boolean(hit.threadId && !detail);
  const tagIds = detail ? contentTagIdsFromDetail(tagCatalog, detail.tags) : [];
  const prefixes = detail?.prefixes?.length
    ? detail.prefixes.map((p) => ({ name: p.name, cssClass: p.cssClass }))
    : hit.prefixes;

  const { images, hovered, slide, activeSrc, onEnter, onLeave } = useStoreCardHoverImages(
    {
      thumbnailUrl: detail?.bannerUrl ?? null,
      screens: detail?.screenshots ?? [],
    },
    widthPx,
  );

  return (
    <button
      ref={cardRef}
      type="button"
      className={`developer-catalog-capsule${featured ? ' developer-catalog-capsule--featured' : ''}${loading ? ' is-loading' : ''}${hovered ? ' is-hovered' : ''}`}
      onClick={onOpen}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onFocus={onEnter}
      onBlur={onLeave}
    >
      <div className="developer-catalog-capsule-thumb">
        {activeSrc ? (
          <img
            key={activeSrc}
            src={activeSrc}
            alt=""
            loading="lazy"
            decoding="async"
            className="developer-catalog-capsule-img"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <div className="developer-catalog-capsule-fallback" aria-hidden>
            {initial}
          </div>
        )}
        {inLibrary && (
          <span className="developer-catalog-capsule-library" title={t('store.badge.inLibrary')}>
            {t('store.badge.inLibrary')}
          </span>
        )}
        {detail?.rating != null && (
          <span className="developer-catalog-capsule-rating">★ {detail.rating.toFixed(1)}</span>
        )}
        {detail?.version && (
          <span className="developer-catalog-capsule-version">{detail.version}</span>
        )}
        {hovered && <StoreCardThumbDots images={images} slide={slide} />}
      </div>

      <div className="developer-catalog-capsule-body">
        <div className="developer-catalog-capsule-title" title={title}>
          {title}
        </div>

        {(prefixes.length > 0 || tagIds.length > 0) && (
          <div className="developer-catalog-capsule-tags">
            {prefixes.length > 0 && (
              <DeveloperCatalogPrefixPills prefixes={prefixes} />
            )}
            {tagIds.length > 0 && (
              <ContentTagPills tagIds={tagIds} max={featured ? 8 : 6} />
            )}
          </div>
        )}

        {hit.dateLabel && (
          <div className="developer-catalog-capsule-meta">
            <span>{hit.dateLabel}</span>
          </div>
        )}
      </div>
    </button>
  );
}

function DeveloperCatalogPrefixPills({ prefixes }: { prefixes: ForumSearchPrefix[] }) {
  const { catalog } = usePrefixCatalog();
  if (prefixes.length === 0) return null;

  return (
    <div className="developer-catalog-capsule-prefixes">
      {prefixes.map((p, i) => {
        const fromCatalog = resolvePrefixByName(catalog, p.name);
        const color = fromCatalog
          ? prefixPillColor({
              ...fromCatalog,
              cssClass: fromCatalog.cssClass ?? p.cssClass,
            })
          : prefixPillColor({
              id: -1,
              name: p.name,
              groupId: 0,
              groupName: 'Other',
              cssClass: p.cssClass,
            });
        return (
          <span
            key={`${p.name}-${i}`}
            className="developer-catalog-capsule-prefix"
            style={{ background: color }}
          >
            {p.name}
          </span>
        );
      })}
    </div>
  );
}
