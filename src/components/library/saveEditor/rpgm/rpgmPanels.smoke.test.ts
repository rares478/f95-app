import { describe, expect, it, vi } from 'vitest';
import type { RenpyVarNode } from '../../../../types/renpySave';
import {
  extractInventoryRows,
  extractPartyView,
} from '../../../../lib/rpgmSaveView';
import { filterInventoryRows } from './RpgmInventoryPanel';

function leaf(
  path: string,
  name: string,
  type: string,
  value: unknown,
  editable = true,
): RenpyVarNode {
  return { path, name, type, value, editable };
}

function group(path: string, name: string, children: RenpyVarNode[]): RenpyVarNode {
  return {
    path,
    name,
    type: path.includes('[') ? 'list' : 'dict',
    editable: false,
    children,
  };
}

function sampleTree(): RenpyVarNode {
  return group('', 'root', [
    group('party', 'party', [
      leaf('party._gold', '_gold', 'int', 250),
      leaf('party._steps', '_steps', 'int', 42),
      group('party._actors', '_actors', [
        leaf('party._actors[0]', '0', 'int', 1),
      ]),
      group('party._items', '_items', [
        leaf('party._items.1', 'Potion (1)', 'int', 3),
        leaf('party._items.9', '9', 'int', 1),
      ]),
      group('party._weapons', '_weapons', [
        leaf('party._weapons.3', 'Sword (3)', 'int', 2),
      ]),
      group('party._armors', '_armors', []),
    ]),
  ]);
}

describe('RPGM panel data wiring', () => {
  it('party panel patches gold and steps via stable paths', () => {
    const party = extractPartyView(sampleTree());
    const onPatch = vi.fn();
    onPatch(party.goldPath, 999);
    onPatch(party.stepsPath, 10);
    expect(onPatch).toHaveBeenCalledWith('party._gold', 999);
    expect(onPatch).toHaveBeenCalledWith('party._steps', 10);
    expect(party.actorIds).toEqual([1]);
  });

  it('inventory rows expose patchable count paths', () => {
    const rows = extractInventoryRows(sampleTree(), 'items');
    const onPatch = vi.fn();
    onPatch(rows[0].path, 12);
    expect(rows[0]).toMatchObject({ path: 'party._items.1', name: 'Potion (1)', count: 3 });
    expect(onPatch).toHaveBeenCalledWith('party._items.1', 12);
  });

  it('filters inventory rows by name or id', () => {
    const rows = extractInventoryRows(sampleTree(), 'items');
    expect(filterInventoryRows(rows, 'potion').map((r) => r.id)).toEqual(['1']);
    expect(filterInventoryRows(rows, '9').map((r) => r.id)).toEqual(['9']);
    expect(filterInventoryRows(rows, '  ').map((r) => r.id)).toEqual(['1', '9']);
  });
});
