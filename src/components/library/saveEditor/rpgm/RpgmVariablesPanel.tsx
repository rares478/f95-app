import { useMemo, useState } from 'react';
import type { RenpyVarNode } from '../../../../types/renpySave';
import {
  effectiveValue,
  extractIndexedRows,
  filterNonDefaultVariables,
  type IndexedRow,
} from '../../../../lib/rpgmSaveView';
import { useT } from '../../../../lib/i18n';
import type { RpgmPatchProps } from './RpgmPartyPanel';
import { displayIndexedLabel } from './RpgmSwitchesPanel';
import './rpgmEditor.css';

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

function parseNumberInput(raw: string, asFloat: boolean): number | null {
  if (raw.trim() === '') return null;
  const n = asFloat ? Number.parseFloat(raw) : Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

function VariableValueInput({
  row,
  value,
  disabled,
  onPatch,
}: {
  row: IndexedRow;
  value: unknown;
  disabled: boolean;
  onPatch: (path: string, value: unknown) => void;
}) {
  const label = displayIndexedLabel(row);

  if (row.type === 'bool') {
    return (
      <input
        className="rpgm-bool-input"
        type="checkbox"
        checked={value === true}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => onPatch(row.path, e.target.checked)}
      />
    );
  }

  if (row.type === 'string') {
    return (
      <input
        className="save-editor-input rpgm-var-input"
        type="text"
        value={typeof value === 'string' ? value : value == null ? '' : String(value)}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => onPatch(row.path, e.target.value)}
      />
    );
  }

  const asFloat = row.type === 'float';
  const num = typeof value === 'number' && Number.isFinite(value) ? value : null;

  return (
    <input
      className="rpgm-count-input"
      type="number"
      step={asFloat ? 'any' : 1}
      value={num ?? ''}
      disabled={disabled}
      aria-label={label}
      onChange={(e) => {
        const n = parseNumberInput(e.target.value, asFloat);
        if (n != null) onPatch(row.path, n);
      }}
    />
  );
}

export function RpgmVariablesPanel({
  tree,
  patches,
  dirtyPaths,
  onPatch,
  disabled = false,
}: RpgmPatchProps) {
  const { t } = useT();
  const [hideDefaults, setHideDefaults] = useState(false);

  const rows = useMemo(() => extractIndexedRows(tree, 'variables._data'), [tree]);
  const visible = useMemo(() => {
    const effective = withEffectiveValues(rows, patches);
    return hideDefaults ? filterNonDefaultVariables(effective) : effective;
  }, [rows, patches, hideDefaults]);

  return (
    <div className="rpgm-panel">
      <div className="rpgm-toolbar">
        <label className="rpgm-filter-toggle">
          <input
            type="checkbox"
            checked={hideDefaults}
            disabled={disabled}
            onChange={(e) => setHideDefaults(e.target.checked)}
          />
          <span>{t('saveEditor.rpgm.variables.hideDefaults')}</span>
        </label>
      </div>

      {visible.length === 0 ? (
        <p className="rpgm-empty">
          {rows.length === 0
            ? t('saveEditor.rpgm.variables.empty')
            : t('saveEditor.rpgm.variables.noMatches')}
        </p>
      ) : (
        <div className="rpgm-table-wrap">
          <table className="rpgm-table">
            <thead>
              <tr>
                <th>{t('saveEditor.rpgm.variables.col.name')}</th>
                <th>{t('saveEditor.rpgm.variables.col.id')}</th>
                <th>{t('saveEditor.rpgm.variables.col.value')}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const dirty = dirtyPaths.has(row.path);
                const label = displayIndexedLabel(row);
                return (
                  <tr key={row.path} className={dirty ? 'rpgm-row--dirty' : undefined}>
                    <td className="rpgm-row-name" title={label}>
                      {label}
                    </td>
                    <td className="rpgm-row-id">{row.index}</td>
                    <td className="rpgm-row-value">
                      <VariableValueInput
                        row={row}
                        value={row.value}
                        disabled={disabled}
                        onPatch={onPatch}
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
