import { isStatusGroup, type PrefixMeta } from '../../lib/prefixCatalog';
import { getThreadPrefixNames } from '../../lib/prefixDisplayCache';
import { metaForDisplay, resolvePrefixByName } from '../../lib/prefixResolve';
import { usePrefixCatalog } from '../../contexts/PrefixCatalogContext';

interface Props {
  prefixIds: number[];
  threadId?: string;
  maxLeft?: number;
}

export function PrefixPills({ prefixIds, threadId, maxLeft = 3 }: Props) {
  const { catalog, resolve } = usePrefixCatalog();

  const cachedNames = threadId ? getThreadPrefixNames(threadId) : null;
  const resolved: PrefixMeta[] = cachedNames
    ? cachedNames
        .map((name) => resolvePrefixByName(catalog, name))
        .filter((p): p is PrefixMeta => p !== null)
    : prefixIds.map((id) => resolve(id)).filter((p): p is PrefixMeta => p !== null);

  if (resolved.length === 0) return null;

  const status = resolved.find(isStatusGroup);
  const left = resolved.filter((p) => !isStatusGroup(p)).slice(0, maxLeft);

  return (
    <div className="store-prefix-pills">
      {left.map((p, i) => {
        const d = metaForDisplay(p);
        return (
          <span
            key={`${p.id}-${i}`}
            className="store-prefix-pill"
            style={{ background: d.color }}
            title={d.name}
          >
            {d.name}
          </span>
        );
      })}
      {status && (
        <span
          key={status.id}
          className="store-prefix-pill store-prefix-pill-status"
          style={{ background: metaForDisplay(status).color }}
          title={status.name}
        >
          {status.name}
        </span>
      )}
    </div>
  );
}
