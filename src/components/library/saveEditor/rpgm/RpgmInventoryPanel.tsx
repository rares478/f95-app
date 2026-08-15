import { useMemo, useState } from 'react';
import {
  extractInventoryRows,
  type InventoryKind,
  type InventoryRow,
} from '../../../../lib/rpgmSaveView';
import type { RpgmPatchProps } from './RpgmPartyPanel';
import './rpgmEditor.css';

const KINDS: { kind: InventoryKind; label: string }[] = [
  { kind: 'items', label: 'Items' },
  { kind: 'weapons', label: 'Weapons' },
  { kind: 'armors', label: 'Armors' },
];

/** Case-insensitive name/id filter for inventory rows (exported for smoke tests). */
export function filterInventoryRows(rows: InventoryRow[], query: string): InventoryRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter(
    (row) => row.name.toLowerCase().includes(q) || row.id.toLowerCase().includes(q),
  );
}

function rowCount(row: InventoryRow, patches: Map<string, unknown>): number {
  if (patches.has(row.path)) {
    const v = patches.get(row.path);
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return row.count;
}

function parseCount(raw: string): number | null {
  if (raw.trim() === '') return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

export function RpgmInventoryPanel({
  tree,
  patches,
  dirtyPaths,
  onPatch,
  disabled = false,
}: RpgmPatchProps) {
  const [kind, setKind] = useState<InventoryKind>('items');
  const [search, setSearch] = useState('');

  const rows = useMemo(() => extractInventoryRows(tree, kind), [tree, kind]);
  const visible = useMemo(() => filterInventoryRows(rows, search), [rows, search]);

  return (
    <div className="rpgm-panel">
      <div className="rpgm-toolbar">
        <div className="rpgm-kind-tabs" role="tablist" aria-label="Inventory kind">
          {KINDS.map((tab) => (
            <button
              key={tab.kind}
              type="button"
              role="tab"
              aria-selected={kind === tab.kind}
              className={`rpgm-kind-tab${kind === tab.kind ? ' rpgm-kind-tab--active' : ''}`}
              disabled={disabled}
              onClick={() => setKind(tab.kind)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <input
          className="save-editor-search rpgm-search"
          type="search"
          placeholder="Search by name or id…"
          value={search}
          disabled={disabled}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {visible.length === 0 ? (
        <p className="rpgm-empty">
          {rows.length === 0 ? 'No entries in this inventory.' : 'No matches for this search.'}
        </p>
      ) : (
        <div className="rpgm-table-wrap">
          <table className="rpgm-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Id</th>
                <th>Count</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const dirty = dirtyPaths.has(row.path);
                const count = rowCount(row, patches);
                return (
                  <tr key={row.path} className={dirty ? 'rpgm-row--dirty' : undefined}>
                    <td className="rpgm-row-name" title={row.name}>
                      {row.name}
                    </td>
                    <td className="rpgm-row-id">{row.id}</td>
                    <td className="rpgm-row-count">
                      <input
                        className="rpgm-count-input"
                        type="number"
                        step={1}
                        min={0}
                        value={count}
                        disabled={disabled}
                        aria-label={`Count for ${row.name}`}
                        onChange={(e) => {
                          const n = parseCount(e.target.value);
                          if (n != null) onPatch(row.path, n);
                        }}
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
