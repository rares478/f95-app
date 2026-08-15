import { useMemo, useState } from 'react';
import type { RenpyVarNode } from '../../../../types/renpySave';
import {
  effectiveValue,
  extractIndexedRows,
  filterNonDefaultSwitches,
  type IndexedRow,
} from '../../../../lib/rpgmSaveView';
import type { RpgmPatchProps } from './RpgmPartyPanel';
import './rpgmEditor.css';

/** Prefer decorated System.json label as-is; numeric-only → `#n`. */
export function displayIndexedLabel(row: Pick<IndexedRow, 'index' | 'label'>): string {
  if (/^\d+$/.test(row.label.trim())) return `#${row.index}`;
  return row.label;
}

function rowNode(row: IndexedRow): RenpyVarNode {
  return {
    path: row.path,
    name: row.label,
    type: row.type,
    value: row.value,
    editable: true,
  };
}

function withEffectiveValues(
  rows: IndexedRow[],
  patches: Map<string, unknown>,
): IndexedRow[] {
  return rows.map((row) => ({
    ...row,
    value: effectiveValue(rowNode(row), patches),
  }));
}

export function RpgmSwitchesPanel({
  tree,
  patches,
  dirtyPaths,
  onPatch,
  disabled = false,
}: RpgmPatchProps) {
  const [hideOff, setHideOff] = useState(false);

  const rows = useMemo(() => extractIndexedRows(tree, 'switches._data'), [tree]);
  const visible = useMemo(() => {
    const effective = withEffectiveValues(rows, patches);
    return hideOff ? filterNonDefaultSwitches(effective) : effective;
  }, [rows, patches, hideOff]);

  return (
    <div className="rpgm-panel">
      <div className="rpgm-toolbar">
        <label className="rpgm-filter-toggle">
          <input
            type="checkbox"
            checked={hideOff}
            disabled={disabled}
            onChange={(e) => setHideOff(e.target.checked)}
          />
          <span>Hide off</span>
        </label>
      </div>

      {visible.length === 0 ? (
        <p className="rpgm-empty">
          {rows.length === 0
            ? 'No switches in this save.'
            : 'No switches match this filter.'}
        </p>
      ) : (
        <div className="rpgm-table-wrap">
          <table className="rpgm-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Id</th>
                <th>On</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const dirty = dirtyPaths.has(row.path);
                const on = row.value === true;
                const label = displayIndexedLabel(row);
                return (
                  <tr key={row.path} className={dirty ? 'rpgm-row--dirty' : undefined}>
                    <td className="rpgm-row-name" title={label}>
                      {label}
                    </td>
                    <td className="rpgm-row-id">{row.index}</td>
                    <td className="rpgm-row-toggle">
                      <input
                        className="rpgm-bool-input"
                        type="checkbox"
                        checked={on}
                        disabled={disabled}
                        aria-label={label}
                        onChange={(e) => onPatch(row.path, e.target.checked)}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
