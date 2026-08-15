import { useMemo, useState } from 'react';
import {
  ACTOR_EXTRAS_COLLAPSE_AT,
  extractActorCards,
  filterActorExtraFields,
  type ActorCard,
  type ActorField,
} from '../../../../lib/rpgmSaveView';
import { useT } from '../../../../lib/i18n';
import type { RpgmPatchProps } from './RpgmPartyPanel';
import './rpgmEditor.css';

const FIELD_LABELS: Record<string, string> = {
  _hp: 'HP',
  _mp: 'MP',
  _tp: 'TP',
  _level: 'Level',
  _exp: 'Exp',
  _name: 'Name',
  _nickname: 'Nickname',
};

/** Human label for actor scalar keys (exported for smoke tests). */
export function fieldLabel(key: string): string {
  if (FIELD_LABELS[key]) return FIELD_LABELS[key];
  if (key.startsWith('_') && key.length > 1) {
    const rest = key.slice(1);
    return rest.charAt(0).toUpperCase() + rest.slice(1);
  }
  return key;
}

function patchedValue(field: ActorField, patches: Map<string, unknown>): unknown {
  if (patches.has(field.path)) return patches.get(field.path);
  return field.value;
}

function cardTitle(card: ActorCard, patches: Map<string, unknown>): string {
  const nameField = card.coreFields.find((f) => f.key === '_name');
  if (nameField) {
    const v = patchedValue(nameField, patches);
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return card.title;
}

function parseNumberInput(raw: string, asFloat: boolean): number | null {
  if (raw.trim() === '') return null;
  const n = asFloat ? Number.parseFloat(raw) : Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

function ActorFieldInput({
  field,
  value,
  dirty,
  disabled,
  onPatch,
  layout = 'stack',
}: {
  field: ActorField;
  value: unknown;
  dirty: boolean;
  disabled: boolean;
  onPatch: (path: string, value: unknown) => void;
  layout?: 'stack' | 'row';
}) {
  const label = fieldLabel(field.key);
  const className = [
    'rpgm-field',
    layout === 'row' ? 'rpgm-field--extra' : '',
    field.type === 'bool' ? 'rpgm-field--bool' : '',
    dirty ? 'rpgm-field--dirty' : '',
  ]
    .filter(Boolean)
    .join(' ');

  if (field.type === 'bool') {
    return (
      <label className={className}>
        <span className="save-editor-label rpgm-field-label" title={field.key}>
          {label}
        </span>
        <input
          className="rpgm-bool-input"
          type="checkbox"
          checked={value === true}
          disabled={disabled}
          aria-label={label}
          onChange={(e) => onPatch(field.path, e.target.checked)}
        />
      </label>
    );
  }

  if (field.type === 'string') {
    return (
      <label className={className}>
        <span className="save-editor-label rpgm-field-label" title={field.key}>
          {label}
        </span>
        <input
          className="save-editor-input"
          type="text"
          value={typeof value === 'string' ? value : value == null ? '' : String(value)}
          disabled={disabled}
          aria-label={label}
          onChange={(e) => onPatch(field.path, e.target.value)}
        />
      </label>
    );
  }

  const asFloat = field.type === 'float';
  const num =
    typeof value === 'number' && Number.isFinite(value)
      ? value
      : null;

  return (
    <label className={className}>
      <span className="save-editor-label rpgm-field-label" title={field.key}>
        {label}
      </span>
      <input
        className="save-editor-input"
        type="number"
        step={asFloat ? 'any' : 1}
        value={num ?? ''}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => {
          const n = parseNumberInput(e.target.value, asFloat);
          if (n != null) onPatch(field.path, n);
        }}
      />
    </label>
  );
}

function ActorCardView({
  card,
  patches,
  dirtyPaths,
  disabled,
  onPatch,
}: {
  card: ActorCard;
  patches: Map<string, unknown>;
  dirtyPaths: Set<string>;
  disabled: boolean;
  onPatch: (path: string, value: unknown) => void;
}) {
  const { t } = useT();
  const title = cardTitle(card, patches);
  const extraCount = card.extraFields.length;
  const collapseByDefault = extraCount > ACTOR_EXTRAS_COLLAPSE_AT;

  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(!collapseByDefault);

  const showExtrasBody = expanded || query.trim().length > 0;
  const visibleExtras = useMemo(
    () => filterActorExtraFields(card.extraFields, query, dirtyPaths),
    [card.extraFields, query, dirtyPaths],
  );

  const hasAnyFields = card.coreFields.length > 0 || extraCount > 0;

  return (
    <section className="rpgm-actor-card">
      <h3 className="rpgm-actor-card-title">
        <span className="rpgm-actor-id">#{card.index}</span>
        <span className="rpgm-actor-name">{title}</span>
      </h3>

      {!hasAnyFields ? (
        <p className="rpgm-empty">{t('saveEditor.rpgm.actors.noFields')}</p>
      ) : (
        <>
          {card.coreFields.length > 0 && (
            <div className="rpgm-fields rpgm-fields--core">
              {card.coreFields.map((field) => (
                <ActorFieldInput
                  key={field.path}
                  field={field}
                  value={patchedValue(field, patches)}
                  dirty={dirtyPaths.has(field.path)}
                  disabled={disabled}
                  onPatch={onPatch}
                />
              ))}
            </div>
          )}

          {extraCount > 0 && (
            <div className="rpgm-actor-extras">
              <div className="rpgm-actor-extras-toolbar">
                <button
                  type="button"
                  className="rpgm-actor-extras-toggle"
                  aria-expanded={showExtrasBody}
                  onClick={() => setExpanded((v) => !v)}
                >
                  {showExtrasBody
                    ? t('saveEditor.rpgm.actors.hideExtras')
                    : t('saveEditor.rpgm.actors.showExtras')}
                  <span className="rpgm-actor-extras-count">
                    {t('saveEditor.rpgm.actors.otherFields', { count: extraCount })}
                  </span>
                </button>
                {showExtrasBody && (
                  <input
                    className="save-editor-search rpgm-search"
                    type="search"
                    placeholder={t('saveEditor.rpgm.actors.searchExtras')}
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      if (e.target.value.trim()) setExpanded(true);
                    }}
                  />
                )}
              </div>

              {showExtrasBody && (
                visibleExtras.length === 0 ? (
                  <p className="rpgm-empty">{t('saveEditor.rpgm.actors.noExtraMatches')}</p>
                ) : (
                  <div className="rpgm-fields rpgm-fields--extras">
                    {visibleExtras.map((field) => (
                      <ActorFieldInput
                        key={field.path}
                        field={field}
                        value={patchedValue(field, patches)}
                        dirty={dirtyPaths.has(field.path)}
                        disabled={disabled}
                        onPatch={onPatch}
                        layout="row"
                      />
                    ))}
                  </div>
                )
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

export function RpgmActorsPanel({
  tree,
  patches,
  dirtyPaths,
  onPatch,
  disabled = false,
}: RpgmPatchProps) {
  const { t } = useT();
  const cards = useMemo(() => extractActorCards(tree), [tree]);

  return (
    <div className="rpgm-panel">
      {cards.length === 0 ? (
        <p className="rpgm-empty">{t('saveEditor.rpgm.actors.empty')}</p>
      ) : (
        <div className="rpgm-actor-cards">
          {cards.map((card) => (
            <ActorCardView
              key={card.path}
              card={card}
              patches={patches}
              dirtyPaths={dirtyPaths}
              disabled={disabled}
              onPatch={onPatch}
            />
          ))}
        </div>
      )}
    </div>
  );
}
