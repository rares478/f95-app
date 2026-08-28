import { loadStoredPrefixGroups } from '../../lib/prefixCatalogStorage';
import { useT } from '../../lib/i18n';
import type { ForumSearchNodeOption } from '../../types/forumSearch';
import {
  formatForumNodeOptionLabel,
  type ForumSearchAdvancedSnapshot,
} from '../../lib/forumSearchUi';
import type { SamPrefixGroup } from '../../types/sam';

type Props = {
  value: ForumSearchAdvancedSnapshot;
  onChange: (next: ForumSearchAdvancedSnapshot) => void;
  forums: ForumSearchNodeOption[];
  disabled?: boolean;
};

function toggleId(list: number[], id: number): number[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

function PrefixMultiSelect({
  groups,
  selected,
  onChange,
  disabled,
}: {
  groups: SamPrefixGroup[];
  selected: number[];
  onChange: (ids: number[]) => void;
  disabled?: boolean;
}) {
  const { t } = useT();

  if (groups.length === 0) {
    return (
      <p className="forum-search-advanced-hint">{t('search.advanced.prefixesEmpty')}</p>
    );
  }

  return (
    <select
      className="forum-search-advanced-multiselect"
      multiple
      size={7}
      value={selected.map(String)}
      disabled={disabled}
      onChange={(e) => {
        const ids = Array.from(e.target.selectedOptions)
          .map((o) => parseInt(o.value, 10))
          .filter((n) => Number.isFinite(n) && n > 0);
        onChange(ids);
      }}
    >
      {groups.map((group) => (
        <optgroup key={group.id} label={group.name}>
          {group.prefixes.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

export function ForumSearchAdvancedForm({
  value,
  onChange,
  forums,
  disabled,
}: Props) {
  const { t } = useT();
  const patch = (partial: Partial<ForumSearchAdvancedSnapshot>) =>
    onChange({ ...value, ...partial });

  const prefixGroups = loadStoredPrefixGroups();

  return (
    <div className="forum-search-advanced">
      <label className="forum-search-field forum-search-field--block">
        <span>{t('search.advanced.postedBy')}</span>
        <input
          type="text"
          className="forum-search-input"
          value={value.postedBy}
          onChange={(e) => patch({ postedBy: e.target.value })}
          placeholder={t('search.advanced.postedByPlaceholder')}
          disabled={disabled}
          autoComplete="off"
        />
        <span className="forum-search-advanced-hint">{t('search.advanced.postedByHint')}</span>
      </label>

      <div className="forum-search-advanced-row">
        <label className="forum-search-field forum-search-field--block">
          <span>{t('search.advanced.newerThan')}</span>
          <input
            type="date"
            className="forum-search-input"
            value={value.dateNewerThan}
            onChange={(e) => patch({ dateNewerThan: e.target.value })}
            disabled={disabled}
          />
        </label>
        <label className="forum-search-field forum-search-field--block">
          <span>{t('search.advanced.olderThan')}</span>
          <input
            type="date"
            className="forum-search-input"
            value={value.dateOlderThan}
            onChange={(e) => patch({ dateOlderThan: e.target.value })}
            disabled={disabled}
          />
        </label>
      </div>

      <div className="forum-search-advanced-row">
        <label className="forum-search-field forum-search-field--block">
          <span>{t('search.advanced.tags')}</span>
          <input
            type="text"
            className="forum-search-input"
            value={value.tags}
            onChange={(e) => patch({ tags: e.target.value })}
            disabled={disabled}
            autoComplete="off"
          />
        </label>
        <label className="forum-search-field forum-search-field--block">
          <span>{t('search.advanced.withoutTags')}</span>
          <input
            type="text"
            className="forum-search-input"
            value={value.withoutTags}
            onChange={(e) => patch({ withoutTags: e.target.value })}
            disabled={disabled}
            autoComplete="off"
          />
        </label>
      </div>

      <label className="forum-search-field forum-search-field--block forum-search-field--narrow">
        <span>{t('search.advanced.minReplies')}</span>
        <input
          type="number"
          className="forum-search-input"
          min={0}
          step={1}
          value={value.minReplyCount || ''}
          onChange={(e) => {
            const n = parseInt(e.target.value, 10);
            patch({ minReplyCount: Number.isFinite(n) && n > 0 ? n : 0 });
          }}
          disabled={disabled}
        />
      </label>

      <div className="forum-search-advanced-row forum-search-advanced-row--split">
        <div className="forum-search-advanced-col">
          <span className="forum-search-advanced-label">{t('search.advanced.prefixes')}</span>
          <PrefixMultiSelect
            groups={prefixGroups}
            selected={value.prefixIds}
            onChange={(prefixIds) => patch({ prefixIds })}
            disabled={disabled}
          />
        </div>
        <div className="forum-search-advanced-col">
          <span className="forum-search-advanced-label">{t('search.advanced.forums')}</span>
          {forums.length === 0 ? (
            <p className="forum-search-advanced-hint">{t('search.advanced.forumsEmpty')}</p>
          ) : (
            <select
              className="forum-search-advanced-multiselect"
              multiple
              size={7}
              value={value.forumNodeIds.map(String)}
              disabled={disabled}
              onChange={(e) => {
                const ids = Array.from(e.target.selectedOptions)
                  .map((o) => parseInt(o.value, 10))
                  .filter((n) => Number.isFinite(n) && n > 0);
                patch({ forumNodeIds: ids });
              }}
            >
              {forums.map((f) => (
                <option key={f.id} value={f.id}>
                  {formatForumNodeOptionLabel(f)}
                </option>
              ))}
            </select>
          )}
          <label className="forum-search-check forum-search-check--spaced">
            <input
              type="checkbox"
              checked={value.searchSubforums}
              onChange={(e) => patch({ searchSubforums: e.target.checked })}
              disabled={disabled || value.forumNodeIds.length === 0}
            />
            {t('search.advanced.subforums')}
          </label>
        </div>
      </div>
    </div>
  );
}

/** Toggle helper exported for tests. */
export { toggleId };
