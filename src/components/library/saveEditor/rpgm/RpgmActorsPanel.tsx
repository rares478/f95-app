import { useMemo } from 'react';
import {
  extractActorCards,
  type ActorCard,
  type ActorField,
} from '../../../../lib/rpgmSaveView';
import { useT } from '../../../../lib/i18n';
import type { RpgmPatchProps } from './RpgmPartyPanel';
import './rpgmEditor.css';

const FIELD_LABELS: Record<string, string> = {
  _hp: 'HP',
  _mp: 'MP',
  _level: 'Level',
  _exp: 'Exp',
  _name: 'Name',
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
  const nameField = card.fields.find((f) => f.key === '_name');
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
}: {
  field: ActorField;
  value: unknown;
  dirty: boolean;
  disabled: boolean;
  onPatch: (path: string, value: unknown) => void;
}) {
  const label = fieldLabel(field.key);

  if (field.type === 'bool') {
    return (
      <label className={`rpgm-field rpgm-field--bool${dirty ? ' rpgm-field--dirty' : ''}`}>
        <span className="save-editor-label">{label}</span>
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
      <label className={`rpgm-field${dirty ? ' rpgm-field--dirty' : ''}`}>
        <span className="save-editor-label">{label}</span>
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
    <label className={`rpgm-field${dirty ? ' rpgm-field--dirty' : ''}`}>
      <span className="save-editor-label">{label}</span>
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
          {cards.map((card) => {
            const title = cardTitle(card, patches);
            return (
              <section key={card.path} className="rpgm-actor-card">
                <h3 className="rpgm-actor-card-title">
                  <span className="rpgm-actor-id">#{card.index}</span>
                  <span className="rpgm-actor-name">{title}</span>
                </h3>
                {card.fields.length === 0 ? (
                  <p className="rpgm-empty">{t('saveEditor.rpgm.actors.noFields')}</p>
                ) : (
                  <div className="rpgm-fields">
                    {card.fields.map((field) => (
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
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
