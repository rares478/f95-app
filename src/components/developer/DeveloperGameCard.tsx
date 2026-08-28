import { usePrefixCatalog } from '../../contexts/PrefixCatalogContext';
import { prefixPillColor } from '../../lib/prefixCatalog';
import { resolvePrefixByName } from '../../lib/prefixResolve';
import { useT } from '../../lib/i18n';
import type { ForumSearchHit, ForumSearchPrefix } from '../../types/forumSearch';

type Props = {
  hit: ForumSearchHit;
  onOpen: () => void;
};

export function DeveloperGameCard({ hit, onOpen }: Props) {
  const { t } = useT();
  const title = hit.title || t('search.result.untitled');
  const initial = title.trim().slice(0, 1).toUpperCase() || '?';

  return (
    <button
      type="button"
      className="developer-game-card"
      onClick={onOpen}
    >
      <div className="developer-game-card-thumb">
        <div className="developer-game-card-fallback" aria-hidden>
          {initial}
        </div>
      </div>
      <div className="developer-game-card-body">
        <div className="developer-game-card-title" title={title}>
          {title}
        </div>
        {hit.prefixes.length > 0 && (
          <DeveloperHitPrefixPills prefixes={hit.prefixes} />
        )}
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
