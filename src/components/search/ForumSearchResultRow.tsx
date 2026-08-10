import { usePrefixCatalog } from '../../contexts/PrefixCatalogContext';
import { useT } from '../../lib/i18n';
import { prefixPillColor, type PrefixMeta } from '../../lib/prefixCatalog';
import { resolvePrefixByName } from '../../lib/prefixResolve';
import type { ForumSearchHit, ForumSearchPrefix } from '../../types/forumSearch';

interface Props {
  hit: ForumSearchHit;
  onOpen: () => void;
}

export function ForumSearchResultRow({ hit, onOpen }: Props) {
  const { t } = useT();
  const canOpen = Boolean(hit.threadId);
  const metaBits = [hit.author, hit.dateLabel].filter(Boolean);
  const letter = (hit.author?.trim()?.[0] ?? '?').toUpperCase();
  const prefixes = hit.prefixes ?? [];

  return (
    <li className="forum-search-item">
      <button
        type="button"
        className={`forum-search-row${!canOpen ? ' forum-search-row--disabled' : ''}`}
        onClick={() => {
          if (!canOpen) return;
          onOpen();
        }}
        disabled={!canOpen}
      >
        {hit.avatarUrl ? (
          <img
            src={hit.avatarUrl}
            alt=""
            className="forum-search-row-avatar"
            loading="lazy"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="forum-search-row-avatar forum-search-row-avatar--fallback" aria-hidden>
            {letter}
          </div>
        )}
        <div className="forum-search-row-content">
          <div className="forum-search-row-title">
            <SearchPrefixPills prefixes={prefixes} />
            <span className="forum-search-row-title-text">
              {hit.title || t('search.result.untitled')}
            </span>
          </div>
          <div className="forum-search-row-meta">
            {hit.forum && (
              <span className="forum-search-row-forum">{hit.forum}</span>
            )}
            {metaBits.map((bit) => (
              <span key={bit} className="forum-search-row-meta-bit">
                {bit}
              </span>
            ))}
          </div>
          {hit.snippet && <div className="forum-search-row-snippet">{hit.snippet}</div>}
        </div>
        {canOpen && <IconChevronSmall />}
      </button>
    </li>
  );
}

function SearchPrefixPills({ prefixes }: { prefixes: ForumSearchPrefix[] }) {
  const { catalog } = usePrefixCatalog();
  if (prefixes.length === 0) return null;

  return (
    <span className="forum-search-row-prefixes">
      {prefixes.map((p, i) => {
        const color = colorForSearchPrefix(catalog, p);
        return (
          <span
            key={`${p.name}-${i}`}
            className="forum-search-row-prefix"
            style={{ background: color }}
            title={p.name}
          >
            {p.name}
          </span>
        );
      })}
    </span>
  );
}

function colorForSearchPrefix(
  catalog: Map<number, PrefixMeta>,
  prefix: ForumSearchPrefix,
): string {
  const fromCatalog = resolvePrefixByName(catalog, prefix.name);
  if (fromCatalog && fromCatalog.id !== -1) {
    return prefixPillColor({
      ...fromCatalog,
      cssClass: fromCatalog.cssClass ?? prefix.cssClass,
    });
  }

  const cls = (prefix.cssClass ?? '').toLowerCase();
  const name = prefix.name.toLowerCase();
  if (cls.includes('label--green') || name.includes('complete')) {
    return 'var(--status-success)';
  }
  if (cls.includes('label--orange') || cls.includes('label--yellow') || name.includes('hold')) {
    return 'var(--status-warning)';
  }
  if (cls.includes('label--red') || name.includes('abandon')) {
    return '#9c3a3a';
  }
  if (cls.includes('label--blue') || cls.includes('label--primary') || name === 'vn') {
    return 'var(--status-info)';
  }
  if (cls.includes('pre-renpy') || name.includes("ren'py")) {
    return 'var(--status-purple)';
  }
  if (cls.includes('pre-unity') || name === 'unity') {
    return 'var(--text-faint)';
  }
  if (cls.includes('pre-rpgm') || name === 'rpgm') {
    return 'var(--status-info)';
  }

  return prefixPillColor({
    id: -1,
    name: prefix.name,
    groupId: 0,
    groupName: 'Other',
    cssClass: prefix.cssClass,
  });
}

function IconChevronSmall() {
  return (
    <svg
      className="forum-search-row-chevron"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
    >
      <path d="M9 18l6-6-6-6" />
    </svg>
  );
}
