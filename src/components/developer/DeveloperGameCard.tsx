import { ContentTagPills } from '../store/ContentTagPills';
import { usePrefixCatalog } from '../../contexts/PrefixCatalogContext';
import { useTagCatalog } from '../../contexts/TagCatalogContext';
import { prefixPillColor } from '../../lib/prefixCatalog';
import { resolvePrefixByName } from '../../lib/prefixResolve';
import { contentTagIdsFromDetail } from '../../lib/tagCatalog';
import { useT } from '../../lib/i18n';
import type { GameDetail } from '../../types/game';
import type { ForumSearchHit, ForumSearchPrefix } from '../../types/forumSearch';

type Props = {
  hit: ForumSearchHit;
  detail?: GameDetail | null;
  onOpen: () => void;
};

export function DeveloperGameCard({ hit, detail, onOpen }: Props) {
  const { t } = useT();
  const { catalog: tagCatalog } = useTagCatalog();
  const title = detail?.title || hit.title || t('search.result.untitled');
  const initial = title.trim().slice(0, 1).toUpperCase() || '?';
  const bannerUrl = detail?.bannerUrl ?? null;
  const version = detail?.version ?? null;
  const rating = detail?.rating ?? null;
  const tagIds = detail ? contentTagIdsFromDetail(tagCatalog, detail.tags) : [];
  const prefixes = detail?.prefixes?.length
    ? detail.prefixes.map((p) => ({ name: p.name, cssClass: p.cssClass }))
    : hit.prefixes;

  return (
    <button
      type="button"
      className="developer-game-card"
      onClick={onOpen}
    >
      <div className="developer-game-card-thumb">
        {bannerUrl ? (
          <img
            src={bannerUrl}
            alt=""
            className="developer-game-card-img"
            loading="lazy"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <div className="developer-game-card-fallback" aria-hidden>
            {initial}
          </div>
        )}
        {version && <span className="developer-game-card-version">{version}</span>}
        {rating !== null && (
          <span className="developer-game-card-rating" title={t('filter.sort.rating')}>
            ★ {rating.toFixed(1)}
          </span>
        )}
      </div>
      <div className="developer-game-card-body">
        <div className="developer-game-card-title" title={title}>
          {title}
        </div>
        {prefixes.length > 0 && <DeveloperHitPrefixPills prefixes={prefixes} />}
        {tagIds.length > 0 && <ContentTagPills tagIds={tagIds} max={3} />}
        <div className="developer-game-card-meta">
          {hit.forum && <span>{hit.forum}</span>}
          {hit.dateLabel && <span>{hit.dateLabel}</span>}
        </div>
      </div>
    </button>
  );
}

function DeveloperHitPrefixPills({ prefixes }: { prefixes: ForumSearchPrefix[] }) {
  const { catalog } = usePrefixCatalog();
  if (prefixes.length === 0) return null;

  return (
    <div className="developer-game-card-prefixes">
      {prefixes.slice(0, 3).map((p, i) => {
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
            className="developer-game-card-prefix"
            style={{ background: color }}
          >
            {p.name}
          </span>
        );
      })}
    </div>
  );
}
