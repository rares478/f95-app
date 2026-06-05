import { useTagCatalog } from '../../contexts/TagCatalogContext';

interface Props {
  tagIds: number[];
  max?: number;
}

/** Genre/content tags from SAM (`tags[]` IDs), distinct from XenForo prefixes. */
export function ContentTagPills({ tagIds, max = 4 }: Props) {
  const { resolve } = useTagCatalog();
  if (tagIds.length === 0) return null;

  const visible = tagIds.slice(0, max);
  const extra = tagIds.length - visible.length;

  return (
    <div className="store-content-tags" title={tagIds.map((id) => resolve(id)).join(', ')}>
      {visible.map((id) => (
        <span key={id} className="store-content-tag">
          {resolve(id)}
        </span>
      ))}
      {extra > 0 && <span className="store-content-tag store-content-tag-more">+{extra}</span>}
    </div>
  );
}
