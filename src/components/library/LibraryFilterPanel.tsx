import { useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '../../lib/i18n';
import {
  EMPTY_LIBRARY_META_FILTER,
  buildLibraryEngineOptions,
  buildLibraryPrefixOptions,
  buildLibraryStatusOptions,
  buildLibraryTagOptions,
  hasActiveLibraryMetaFilter,
  libraryTagSuggestions,
  type LibraryFilterOption,
  type LibraryMetaFilter,
  type LibraryTagMode,
} from '../../lib/libraryFilters';
import type { LibraryGame } from '../../types/library';

interface Props {
  games: LibraryGame[];
  filter: LibraryMetaFilter;
  onFilterChange: (next: LibraryMetaFilter) => void;
}

export function LibraryFilterPanel({ games, filter, onFilterChange }: Props) {
  const { t } = useT();
  const [expanded, setExpanded] = useState(false);
  const [tagQuery, setTagQuery] = useState('');
  const [tagMenuOpen, setTagMenuOpen] = useState(false);
  const tagPickerRef = useRef<HTMLDivElement>(null);

  const engineOptions = useMemo(() => buildLibraryEngineOptions(games), [games]);
  const statusOptions = useMemo(() => buildLibraryStatusOptions(games), [games]);
  const prefixOptions = useMemo(() => buildLibraryPrefixOptions(games), [games]);
  const tagOptions = useMemo(() => buildLibraryTagOptions(games), [games]);
  const tagSuggestions = useMemo(
    () => libraryTagSuggestions(tagOptions, tagQuery),
    [tagOptions, tagQuery],
  );

  useEffect(() => {
    if (!tagMenuOpen) return;
    function onDocMouseDown(e: MouseEvent) {
      const target = e.target as Node;
      if (tagPickerRef.current?.contains(target)) return;
      setTagMenuOpen(false);
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [tagMenuOpen]);

  const visibleEngines = engineOptions.filter((opt) => opt.count > 0);
  const visibleStatuses = statusOptions.filter((opt) => opt.count > 0);
  const visiblePrefixes = prefixOptions.filter((opt) => opt.count > 0);
  const hasActive = hasActiveLibraryMetaFilter(filter);
  const hasLeftFilters =
    visibleEngines.length > 0 || visibleStatuses.length > 0 || visiblePrefixes.length > 0;
  const canFilter = hasLeftFilters || tagOptions.length > 0;
  const activeCount =
    filter.engines.length + filter.statuses.length + filter.prefixes.length + filter.tags.length;

  function toggleIn(key: 'engines' | 'statuses' | 'prefixes' | 'tags', name: string) {
    const current = filter[key];
    const next = current.includes(name)
      ? current.filter((item) => item !== name)
      : [...current, name];
    onFilterChange({ ...filter, [key]: next });
  }

  function removeIn(key: 'engines' | 'statuses' | 'prefixes' | 'tags', name: string) {
    onFilterChange({ ...filter, [key]: filter[key].filter((item) => item !== name) });
  }

  function setTagMode(mode: LibraryTagMode) {
    onFilterChange({ ...filter, tagMode: mode });
  }

  function clearAll() {
    onFilterChange({ ...EMPTY_LIBRARY_META_FILTER });
    setTagQuery('');
    setTagMenuOpen(false);
    setExpanded(false);
  }

  function pickTag(name: string) {
    if (!filter.tags.includes(name)) {
      onFilterChange({ ...filter, tags: [...filter.tags, name] });
    }
    setTagQuery('');
    setTagMenuOpen(false);
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
            <span className="library-filter-toggle-badge">{activeCount}</span>
          )}
        </button>
        {hasActive && (
          <button type="button" className="library-filter-clear" onClick={clearAll}>
            {t('library.filter.clear')}
          </button>
        )}
      </div>

      {expanded && (
        <div className="library-filter-drawer">
          {hasLeftFilters && (
            <div className="library-filter-stack">
              {visibleEngines.length > 0 && (
                <ChipBlock
                  label={t('library.filter.engines')}
                  options={visibleEngines}
                  selected={filter.engines}
                  onToggle={(name) => toggleIn('engines', name)}
                />
              )}
              {visibleStatuses.length > 0 && (
                <ChipBlock
                  label={t('library.filter.status')}
                  options={visibleStatuses}
                  selected={filter.statuses}
                  onToggle={(name) => toggleIn('statuses', name)}
                />
              )}
              {visiblePrefixes.length > 0 && (
                <ChipBlock
                  label={t('library.filter.prefixes')}
                  options={visiblePrefixes}
                  selected={filter.prefixes}
                  onToggle={(name) => toggleIn('prefixes', name)}
                />
              )}
            </div>
          )}

          {tagOptions.length > 0 && (
            <div className="library-filter-block library-filter-tags">
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
              <div className="library-filter-tag-picker" ref={tagPickerRef}>
                <input
                  type="search"
                  className="library-filter-tag-search"
                  value={tagQuery}
                  placeholder={t('library.filter.tagSearch')}
                  autoComplete="off"
                  aria-expanded={tagMenuOpen}
                  aria-haspopup="listbox"
                  onFocus={() => setTagMenuOpen(true)}
                  onChange={(e) => {
                    setTagQuery(e.target.value);
                    setTagMenuOpen(true);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setTagMenuOpen(false);
                      return;
                    }
                    if (e.key === 'Enter' && tagSuggestions[0]) {
                      e.preventDefault();
                      pickTag(tagSuggestions[0].name);
                    }
                  }}
                />
                {tagMenuOpen && (
                  <ul className="library-filter-tag-menu" role="listbox">
                    {tagSuggestions.length === 0 && (
                      <li className="library-filter-tag-menu-empty">
                        {t('library.filter.noTagMatches')}
                      </li>
                    )}
                    {tagSuggestions.map((opt) => {
                      const active = filter.tags.includes(opt.name);
                      return (
                        <li key={opt.name} role="option" aria-selected={active}>
                          <button
                            type="button"
                            className={`library-filter-tag-option${
                              active ? ' library-filter-tag-option-active' : ''
                            }`}
                            onClick={() => pickTag(opt.name)}
                            title={opt.name}
                          >
                            <span className="library-filter-tag-option-name">{opt.name}</span>
                            <span className="library-filter-tag-option-count">{opt.count}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
              {filter.tags.length > 0 && (
                <div className="library-filter-selected-tags">
                  {filter.tags.map((name) => (
                    <ActiveChip
                      key={`tag-${name}`}
                      name={name}
                      onRemove={() => removeIn('tags', name)}
                      removeLabel={t('common.remove')}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ActiveChip({
  name,
  onRemove,
  removeLabel,
}: {
  name: string;
  onRemove: () => void;
  removeLabel: string;
}) {
  return (
    <button
      type="button"
      className="library-filter-selected-tag"
      onClick={onRemove}
      title={removeLabel}
    >
      {name}
      <span className="library-filter-selected-tag-x" aria-hidden>
        ×
      </span>
    </button>
  );
}

function ChipBlock({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: LibraryFilterOption[];
  selected: string[];
  onToggle: (name: string) => void;
}) {
  return (
    <div className="library-filter-block">
      <span className="library-filter-block-label">{label}</span>
      <div className="library-filter-chips">
        {options.map((opt) => {
          const active = selected.includes(opt.name);
          return (
            <button
              key={opt.name}
              type="button"
              className={`library-filter-chip${active ? ' library-filter-chip-active' : ''}`}
              onClick={() => onToggle(opt.name)}
              title={`${opt.name} (${opt.count})`}
            >
              {opt.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
