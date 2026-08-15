import { useMemo } from 'react';
import type { RenpyVarNode } from '../../../../types/renpySave';
import { extractActorCards, extractPartyView } from '../../../../lib/rpgmSaveView';
import './rpgmEditor.css';

export type RpgmPatchProps = {
  tree: RenpyVarNode;
  patches: Map<string, unknown>;
  dirtyPaths: Set<string>;
  onPatch: (path: string, value: unknown) => void;
  disabled?: boolean;
};

function patchedNumber(
  path: string,
  base: number | null,
  patches: Map<string, unknown>,
): number | null {
  if (patches.has(path)) {
    const v = patches.get(path);
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  }
  return base;
}

function parseIntInput(raw: string): number | null {
  if (raw.trim() === '') return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

export function RpgmPartyPanel({
  tree,
  patches,
  dirtyPaths,
  onPatch,
  disabled = false,
}: RpgmPatchProps) {
  const party = useMemo(() => extractPartyView(tree), [tree]);
  const actorCards = useMemo(() => extractActorCards(tree), [tree]);
  const nameById = useMemo(() => {
    const map = new Map<number, string>();
    for (const card of actorCards) {
      map.set(card.index, card.title);
    }
    return map;
  }, [actorCards]);

  const gold = patchedNumber(party.goldPath, party.gold, patches);
  const steps = patchedNumber(party.stepsPath, party.steps, patches);

  return (
    <div className="rpgm-panel">
      <section className="rpgm-section">
        <h3 className="rpgm-section-title">Party</h3>
        <div className="rpgm-fields">
          <label
            className={`rpgm-field${dirtyPaths.has(party.goldPath) ? ' rpgm-field--dirty' : ''}`}
          >
            <span className="save-editor-label">Gold</span>
            <input
              className="save-editor-input"
              type="number"
              step={1}
              value={gold ?? ''}
              disabled={disabled}
              onChange={(e) => {
                const n = parseIntInput(e.target.value);
                if (n != null) onPatch(party.goldPath, n);
              }}
            />
          </label>
          <label
            className={`rpgm-field${dirtyPaths.has(party.stepsPath) ? ' rpgm-field--dirty' : ''}`}
          >
            <span className="save-editor-label">Steps</span>
            <input
              className="save-editor-input"
              type="number"
              step={1}
              value={steps ?? ''}
              disabled={disabled}
              onChange={(e) => {
                const n = parseIntInput(e.target.value);
                if (n != null) onPatch(party.stepsPath, n);
              }}
            />
          </label>
        </div>
      </section>

      <section className="rpgm-section">
        <h3 className="rpgm-section-title">Members</h3>
        {party.actorIds.length === 0 ? (
          <p className="rpgm-empty">No party members in this save.</p>
        ) : (
          <ul className="rpgm-actor-list">
            {party.actorIds.map((id, i) => {
              const name = nameById.get(id);
              return (
                <li key={`${id}-${i}`} className="rpgm-actor-item">
                  <span className="rpgm-actor-id">#{id}</span>
                  <span className="rpgm-actor-name">{name ?? `Actor ${id}`}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
