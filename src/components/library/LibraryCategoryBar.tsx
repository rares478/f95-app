import { SAM_CATEGORIES } from '../../constants/samCategories';
import { useT } from '../../lib/i18n';
import type { SamCategory } from '../../types/sam';

interface Props {
  category: SamCategory;
  onCategory: (c: SamCategory) => void;
}

export function LibraryCategoryBar({ category, onCategory }: Props) {
  const { t } = useT();
  return (
    <nav className="library-category-bar" aria-label={t('library.category.nav')}>
      {SAM_CATEGORIES.map((c) => {
        const active = c.id === category;
        const label = c.literal ?? (c.labelKey ? t(c.labelKey) : c.id);
        return (
          <button
            key={c.id}
            type="button"
            className={`library-category-tab${active ? ' library-category-tab--active' : ''}`}
            onClick={() => onCategory(c.id)}
            aria-current={active ? 'page' : undefined}
          >
            {label}
          </button>
        );
      })}
    </nav>
  );
}
