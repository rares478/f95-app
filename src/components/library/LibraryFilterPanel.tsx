import { useMemo, useState } from 'react';
import { useT } from '../../lib/i18n';
import {
  buildLibraryEngineOptions,
  buildLibraryTagOptions,
  hasActiveLibraryMetaFilter,
  type LibraryMetaFilter,
  type LibraryTagMode,
} from '../../lib/libraryFilters';
import type { LibraryGame } from '../../types/library';

interface Props {
  games: LibraryGame[];
  filter: LibraryMetaFilter;
  onFilterChange: (next: LibraryMetaFilter) => void;
}

const TAG_PREVIEW_LIMIT = 14;

export function LibraryFilterPanel({ games, filter, onFilterChange }: Props) {
  const { t } = useT();
  const [expanded, setExpanded] = useState(false);
  const [tagQuery, setTagQuery] = useState('');

  const engineOptions = useMemo(() => buildLibraryEngineOptions(games), [games]);
  const tagOptions = useMemo(() => buildLibraryTagOptions(games), [games]);

  const visibleEngines = engineOptions.filter((opt) => opt.count > 0);
  const filteredTags = useMemo(() => {
    const q = tagQuery.trim().toLowerCase();
    if (!q) return tagOptions;
    return tagOptions.filter((opt) => opt.name.toLowerCase().includes(q));
  }, [tagOptions, tagQuery]);

  const displayedTags = useMemo(() => {
    if (tagQuery.trim()) return filteredTags.slice(0, 40);
    return filteredTags.slice(0, TAG_PREVIEW_LIMIT);
  }, [filteredTags, tagQuery]);

  const hiddenTagCount = Math.max(0, filteredTags.length - displayedTags.length);
  const hasActive = hasActiveLibraryMetaFilter(filter);
  const canFilter = visibleEngines.length > 0 || tagOptions.length > 0;

  function toggleEngine(name: string) {
    const next = filter.engines.includes(name)
      ? filter.engines.filter((e) => e !== name)
      : [...filter.engines, name];
    onFilterChange({ ...filter, engines: next });
  }

  function toggleTag(name: string) {
    const next = filter.tags.includes(name)
      ? filter.tags.filter((tag) => tag !== name)
      : [...filter.tags, name];
    onFilterChange({ ...filter, tags: next });
  }

  function removeEngine(name: string) {
    onFilterChange({ ...filter, engines: filter.engines.filter((e) => e !== name) });
  }

  function removeTag(name: string) {
    onFilterChange({ ...filter, tags: filter.tags.filter((tag) => tag !== name) });
  }

  function setTagMode(mode: LibraryTagMode) {
    onFilterChange({ ...filter, tagMode: mode });
  }

  function clearAll() {
    onFilterChange({ engines: [], tags: [], tagMode: 'or' });
    setTagQuery('');
    setExpanded(false);
  }

  if (!canFilter) {
    return (
      <p className="library-filter-unavailable">{t('library.filter.tagsUnavailable')}</p>
    );
  }

  return (
    <div className="library-filter-root">
      <div className="library-filter-toolbar">
        <button
          type="button"
          className={`library-filter-toggle${expanded ? ' library-filter-toggle-open' : ''}${
            hasActive ? ' library-filter-toggle-active' : ''
          }`}
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          <span className="library-filter-toggle-icon" aria-hidden>
            ⚙
          </span>
          <span>{t('library.filter.refine')}</span>
          {hasActive && (
            <span className="library-filter-toggle-badge">
              {filter.engines.length + filter.tags.length}
            </span>
          )}
        </button>
        {hasActive && (
          <button type="button" className="library-filter-clear" onClick={clearAll}>
            {t('library.filter.clear')}
          </button>
        )}
      </div>

      {hasActive && (
        <div className="library-filter-active">
          {filter.engines.map((name) => (
            <button
              key={`engine-${name}`}
              type="button"
              className="library-filter-active-chip"
              onClick={() => removeEngine(name)}
              title={t('common.remove')}
            >
              {name}
              <span className="library-filter-active-x" aria-hidden>
                ×
              </span>
            </button>
          ))}
          {filter.tags.map((name) => (
            <button
              key={`tag-${name}`}
              type="button"
              className="library-filter-active-chip"
              onClick={() => removeTag(name)}
              title={t('common.remove')}
            >
              {name}
              <span className="library-filter-active-x" aria-hidden>
                ×
              </span>
            </button>
          ))}
          {filter.tags.length > 1 && (
            <span className="library-filter-active-mode">
              {filter.tagMode === 'and'
                ? t('library.filter.tagModeAnd')
                : t('library.filter.tagModeOr')}
            </span>
          )}
        </div>
      )}

      {expanded && (
        <div className="library-filter-drawer">
          {visibleEngines.length > 0 && (
            <div className="library-filter-block">
              <span className="library-filter-block-label">{t('library.filter.engines')}</span>
              <div className="library-filter-chips">
                {visibleEngines.map((opt) => {
                  const active = filter.engines.includes(opt.name);
                  return (
                    <button
                      key={opt.name}
                      type="button"
                      className={`library-filter-chip${active ? ' library-filter-chip-active' : ''}`}
                      onClick={() => toggleEngine(opt.name)}
                      title={`${opt.name} (${opt.count})`}
                    >
                      {opt.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {tagOptions.length > 0 && (
            <div className="library-filter-block">
              <div className="library-filter-block-head">
                <span className="library-filter-block-label">{t('library.filter.tags')}</span>
                {filter.tags.length > 1 && (
                  <div className="library-filter-tag-mode">
                    <button
                      type="button"
                      className={`library-filter-mode-btn${
                        filter.tagMode === 'or' ? ' library-filter-mode-btn-active' : ''
                      }`}
                      onClick={() => setTagMode('or')}
                    >
                      {t('library.filter.tagModeOr')}
                    </button>
                    <button
                      type="button"
                      className={`library-filter-mode-btn${
                        filter.tagMode === 'and' ? ' library-filter-mode-btn-active' : ''
                      }`}
                      onClick={() => setTagMode('and')}
                    >
                      {t('library.filter.tagModeAnd')}
                    </button>
                  </div>
                )}
              </div>
              <input
                type="search"
                className="library-filter-tag-search"
                value={tagQuery}
                placeholder={t('library.filter.tagSearch')}
                onChange={(e) => setTagQuery(e.target.value)}
              />
              <div className="library-filter-tag-list">
                {displayedTags.map((opt) => {
                  const active = filter.tags.includes(opt.name);
                  return (
                    <button
                      key={opt.name}
                      type="button"
                      className={`library-filter-tag-row${active ? ' library-filter-tag-row-active' : ''}`}
                      onClick={() => toggleTag(opt.name)}
                      title={opt.name}
                    >
                      <span className="library-filter-tag-row-name">{opt.name}</span>
                      <span className="library-filter-tag-row-count">{opt.count}</span>
                    </button>
                  );
                })}
                {displayedTags.length === 0 && (
                  <p className="library-filter-no-tags">{t('library.filter.noTagMatches')}</p>
                )}
              </div>
              {hiddenTagCount > 0 && (
                <p className="library-filter-more-hint">
                  {t('library.filter.tagSearch')} (+{hiddenTagCount})
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
