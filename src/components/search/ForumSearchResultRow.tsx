import { useT } from '../../lib/i18n';
import type { ForumSearchHit } from '../../types/forumSearch';

interface Props {
  hit: ForumSearchHit;
  onOpen: () => void;
}

export function ForumSearchResultRow({ hit, onOpen }: Props) {
  const { t } = useT();
  const canOpen = Boolean(hit.threadId);
  const meta = [hit.forum, hit.author, hit.dateLabel].filter(Boolean).join(' · ');

  return (
    <li>
      <button
        type="button"
        className={`forum-search-row${!canOpen ? ' forum-search-row--disabled' : ''}`}
        onClick={() => {
          if (!canOpen) return;
          onOpen();
        }}
        disabled={!canOpen}
      >
        <div className="forum-search-row-content">
          <div className="forum-search-row-title">
            {hit.title || t('search.result.untitled')}
          </div>
          {meta && <div className="forum-search-row-meta">{meta}</div>}
          {hit.snippet && <div className="forum-search-row-snippet">{hit.snippet}</div>}
        </div>
        {canOpen && <IconChevronSmall />}
      </button>
    </li>
  );
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
