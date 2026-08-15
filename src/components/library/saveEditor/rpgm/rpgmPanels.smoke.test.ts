import { describe, expect, it, vi } from 'vitest';
import type { RenpyVarNode } from '../../../../types/renpySave';
import {
  extractActorCards,
  extractIndexedRows,
  extractInventoryRows,
  extractPartyView,
  filterNonDefaultSwitches,
  filterNonDefaultVariables,
} from '../../../../lib/rpgmSaveView';
import { filterInventoryRows } from './RpgmInventoryPanel';
import { fieldLabel } from './RpgmActorsPanel';
import { displayIndexedLabel } from './RpgmSwitchesPanel';

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
    group('actors', 'actors', [
      group('actors._data', '_data', [
        leaf('actors._data[0]', '0', 'null', null, false),
        group('actors._data[1]', '1', [
          leaf('actors._data[1]._name', '_name', 'string', 'Natsuki'),
          leaf('actors._data[1]._hp', '_hp', 'int', 100),
          leaf('actors._data[1]._mp', '_mp', 'int', 50),
          leaf('actors._data[1]._level', '_level', 'int', 5),
          leaf('actors._data[1]._exp', '_exp', 'int', 1200),
          group('actors._data[1]._equips', '_equips', [
            leaf('actors._data[1]._equips[0]', '0', 'int', 1),
          ]),
        ]),
      ]),
    ]),
    group('switches', 'switches', [
      group('switches._data', '_data', [
        leaf('switches._data.1', 'Name (1)', 'bool', true),
        leaf('switches._data.2', '2', 'bool', false),
      ]),
    ]),
    group('variables', 'variables', [
      group('variables._data', '_data', [
        leaf('variables._data.1', 'Score (1)', 'int', 10),
        leaf('variables._data.2', '2', 'int', 0),
        leaf('variables._data.3', 'Flag (3)', 'bool', true),
        leaf('variables._data.4', 'Note (4)', 'string', 'hi'),
      ]),
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

  it('actor cards expose patchable core field paths', () => {
    const cards = extractActorCards(sampleTree());
    expect(cards).toHaveLength(1);
    expect(cards[0].title).toBe('Natsuki');
    const hp = cards[0].coreFields.find((f) => f.key === '_hp');
    expect(hp?.path).toBe('actors._data[1]._hp');
    const onPatch = vi.fn();
    onPatch(hp!.path, 999);
    expect(onPatch).toHaveBeenCalledWith('actors._data[1]._hp', 999);
    expect(fieldLabel('_hp')).toBe('HP');
    expect(fieldLabel('_name')).toBe('Name');
  });

  it('passes through Name (1) switch labels and patches toggles', () => {
    const rows = extractIndexedRows(sampleTree(), 'switches._data');
    expect(rows[0].label).toBe('Name (1)');
    expect(displayIndexedLabel(rows[0])).toBe('Name (1)');
    expect(displayIndexedLabel(rows[1])).toBe('#2');
    expect(filterNonDefaultSwitches(rows).map((r) => r.index)).toEqual(['1']);
    const onPatch = vi.fn();
    onPatch(rows[0].path, false);
    expect(onPatch).toHaveBeenCalledWith('switches._data.1', false);
  });

  it('variable rows expose typed patch paths and hide defaults', () => {
    const rows = extractIndexedRows(sampleTree(), 'variables._data');
    expect(filterNonDefaultVariables(rows).map((r) => r.index)).toEqual(['1', '3', '4']);
    expect(displayIndexedLabel(rows[0])).toBe('Score (1)');
    const onPatch = vi.fn();
    onPatch(rows[0].path, 99);
    onPatch(rows[3].path, 'bye');
    expect(onPatch).toHaveBeenCalledWith('variables._data.1', 99);
    expect(onPatch).toHaveBeenCalledWith('variables._data.4', 'bye');
  });
});
