import { describe, expect, it } from 'vitest';
import type { RenpyVarNode } from '../types/renpySave';
import {
  effectiveValue,
  extractActorCards,
  extractIndexedRows,
  extractInventoryRows,
  extractPartyView,
  filterActorExtraFields,
  filterNonDefaultSwitches,
  filterNonDefaultVariables,
  findNode,
} from './rpgmSaveView';

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
        leaf('party._actors[1]', '1', 'int', 3),
      ]),
      group('party._items', '_items', [
        leaf('party._items.1', 'Potion (1)', 'int', 3),
        leaf('party._items.9', '9', 'int', 1),
      ]),
      group('party._weapons', '_weapons', [
        leaf('party._weapons.3', 'Sword (3)', 'int', 2),
      ]),
      group('party._armors', '_armors', [
        leaf('party._armors.4', 'Shield (4)', 'int', 1),
      ]),
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
        leaf('switches._data.1', 'Intro done (1)', 'bool', true),
        leaf('switches._data.2', '2', 'bool', false),
        leaf('switches._data.3', 'Boss dead (3)', 'bool', false),
      ]),
    ]),
    group('variables', 'variables', [
      group('variables._data', '_data', [
        leaf('variables._data.1', 'Gold multiplier (1)', 'int', 5),
        leaf('variables._data.2', '2', 'int', 0),
        leaf('variables._data.3', '3', 'string', ''),
        leaf('variables._data.4', '4', 'bool', false),
        leaf('variables._data.5', 'Note (5)', 'string', 'hi'),
      ]),
    ]),
  ]);
}

describe('findNode', () => {
  it('returns null for null root or missing path', () => {
    expect(findNode(null, 'party._gold')).toBeNull();
    expect(findNode(sampleTree(), 'missing.path')).toBeNull();
  });

  it('finds a nested leaf by path', () => {
    const node = findNode(sampleTree(), 'party._gold');
    expect(node?.value).toBe(250);
  });
});

describe('extractInventoryRows', () => {
  it('extracts item rows with id, decorated name, count, and path', () => {
    const rows = extractInventoryRows(sampleTree(), 'items');
    expect(rows).toEqual([
      { path: 'party._items.1', id: '1', name: 'Potion (1)', count: 3 },
      { path: 'party._items.9', id: '9', name: '9', count: 1 },
    ]);
  });

  it('extracts weapons and armors by kind', () => {
    expect(extractInventoryRows(sampleTree(), 'weapons')).toEqual([
      { path: 'party._weapons.3', id: '3', name: 'Sword (3)', count: 2 },
    ]);
    expect(extractInventoryRows(sampleTree(), 'armors')).toEqual([
      { path: 'party._armors.4', id: '4', name: 'Shield (4)', count: 1 },
    ]);
  });

  it('returns empty when inventory section is missing', () => {
    const tree = group('', 'root', [group('party', 'party', [])]);
    expect(extractInventoryRows(tree, 'items')).toEqual([]);
  });
});

describe('extractPartyView', () => {
  it('reads gold/steps paths and actor ids', () => {
    expect(extractPartyView(sampleTree())).toEqual({
      goldPath: 'party._gold',
      gold: 250,
      stepsPath: 'party._steps',
      steps: 42,
      actorIds: [1, 3],
    });
  });

  it('uses null gold/steps when missing', () => {
    const tree = group('', 'root', [group('party', 'party', [])]);
    expect(extractPartyView(tree)).toEqual({
      goldPath: 'party._gold',
      gold: null,
      stepsPath: 'party._steps',
      steps: null,
      actorIds: [],
    });
  });
});

describe('extractActorCards', () => {
  it('splits core stats from extra scalars in stable order', () => {
    const cards = extractActorCards(sampleTree());
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      index: 1,
      path: 'actors._data[1]',
      title: 'Natsuki',
    });
    expect(cards[0].coreFields.map((f) => f.key)).toEqual([
      '_name',
      '_hp',
      '_mp',
      '_level',
      '_exp',
    ]);
    expect(cards[0].extraFields).toEqual([]);
    expect(cards[0].coreFields.find((f) => f.key === '_hp')).toEqual({
      path: 'actors._data[1]._hp',
      key: '_hp',
      value: 100,
      type: 'int',
    });
  });

  it('puts non-core _ scalars into extraFields sorted by key', () => {
    const tree = group('', 'root', [
      group('actors', 'actors', [
        group('actors._data', '_data', [
          group('actors._data[1]', '1', [
            leaf('actors._data[1]._name', '_name', 'string', 'Karryn'),
            leaf('actors._data[1]._hp', '_hp', 'int', 100),
            leaf('actors._data[1]._CCMOD_Z', '_CCMOD_Z', 'int', 1),
            leaf('actors._data[1]._CCMOD_A', '_CCMOD_A', 'bool', true),
            leaf('actors._data[1]._tp', '_tp', 'int', 50),
          ]),
        ]),
      ]),
    ]);
    const card = extractActorCards(tree)[0];
    expect(card.coreFields.map((f) => f.key)).toEqual(['_name', '_hp', '_tp']);
    expect(card.extraFields.map((f) => f.key)).toEqual(['_CCMOD_A', '_CCMOD_Z']);
  });

  it('unwraps JsonEx @a arrays under actors._data', () => {
    const tree = group('', 'root', [
      group('actors', 'actors', [
        group('actors._data', '_data', [
          {
            path: 'actors._data.@a',
            name: '@a',
            type: 'list',
            editable: false,
            children: [
              leaf('actors._data.@a[0]', '0', 'null', null, false),
              group('actors._data.@a[1]', '1', [
                leaf('actors._data.@a[1]._name', '_name', 'string', 'Natsuki'),
                leaf('actors._data.@a[1]._hp', '_hp', 'int', 450),
                leaf('actors._data.@a[1]._mp', '_mp', 'int', 90),
                leaf('actors._data.@a[1]._level', '_level', 'int', 1),
              ]),
            ],
          },
          leaf('actors._data.@c', '@c', 'int', 18, false),
        ]),
      ]),
    ]);
    const cards = extractActorCards(tree);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      index: 1,
      path: 'actors._data.@a[1]',
      title: 'Natsuki',
    });
    expect(cards[0].coreFields.find((f) => f.key === '_hp')).toEqual({
      path: 'actors._data.@a[1]._hp',
      key: '_hp',
      value: 450,
      type: 'int',
    });
  });
});

describe('filterActorExtraFields', () => {
  it('filters by key and keeps dirty paths', () => {
    const fields = [
      { path: 'a._CCMOD_A', key: '_CCMOD_A', value: 1, type: 'int' },
      { path: 'a._CCMOD_Z', key: '_CCMOD_Z', value: 2, type: 'int' },
      { path: 'a._foo', key: '_foo', value: 3, type: 'int' },
    ];
    expect(filterActorExtraFields(fields, 'ccmod_a').map((f) => f.key)).toEqual(['_CCMOD_A']);
    expect(
      filterActorExtraFields(fields, 'nope', new Set(['a._foo'])).map((f) => f.key),
    ).toEqual(['_foo']);
  });
});

describe('JsonEx collection unwrap', () => {
  it('reads party._actors and switches from @a wrappers', () => {
    const tree = group('', 'root', [
      group('party', 'party', [
        leaf('party._gold', '_gold', 'int', 10),
        leaf('party._steps', '_steps', 'int', 1),
        group('party._actors', '_actors', [
          {
            path: 'party._actors.@a',
            name: '@a',
            type: 'list',
            editable: false,
            children: [
              leaf('party._actors.@a[0]', '0', 'int', 1),
              leaf('party._actors.@a[1]', '1', 'int', 2),
            ],
          },
          leaf('party._actors.@c', '@c', 'int', 5, false),
        ]),
      ]),
      group('switches', 'switches', [
        group('switches._data', '_data', [
          {
            path: 'switches._data.@a',
            name: '@a',
            type: 'list',
            editable: false,
            children: [
              leaf('switches._data.@a[0]', '0', 'null', null, false),
              leaf('switches._data.@a[1]', 'Intro done (1)', 'bool', true),
              leaf('switches._data.@a[2]', '2', 'bool', false),
            ],
          },
          leaf('switches._data.@c', '@c', 'int', 9, false),
        ]),
      ]),
    ]);

    expect(extractPartyView(tree).actorIds).toEqual([1, 2]);
    expect(extractIndexedRows(tree, 'switches._data')).toEqual([
      {
        path: 'switches._data.@a[1]',
        index: '1',
        label: 'Intro done (1)',
        value: true,
        type: 'bool',
      },
      {
        path: 'switches._data.@a[2]',
        index: '2',
        label: '2',
        value: false,
        type: 'bool',
      },
    ]);
  });
});

describe('extractIndexedRows', () => {
  it('uses decorated switch names as labels', () => {
    const rows = extractIndexedRows(sampleTree(), 'switches._data');
    expect(rows).toEqual([
      {
        path: 'switches._data.1',
        index: '1',
        label: 'Intro done (1)',
        value: true,
        type: 'bool',
      },
      {
        path: 'switches._data.2',
        index: '2',
        label: '2',
        value: false,
        type: 'bool',
      },
      {
        path: 'switches._data.3',
        index: '3',
        label: 'Boss dead (3)',
        value: false,
        type: 'bool',
      },
    ]);
  });

  it('passes through Name (1) decorated labels as-is', () => {
    const tree = group('', 'root', [
      group('switches', 'switches', [
        group('switches._data', '_data', [
          leaf('switches._data.1', 'Name (1)', 'bool', true),
        ]),
      ]),
    ]);
    expect(extractIndexedRows(tree, 'switches._data')[0].label).toBe('Name (1)');
  });

  it('extracts variable rows including decorated labels', () => {
    const rows = extractIndexedRows(sampleTree(), 'variables._data');
    expect(rows.find((r) => r.index === '1')).toEqual({
      path: 'variables._data.1',
      index: '1',
      label: 'Gold multiplier (1)',
      value: 5,
      type: 'int',
    });
  });

  it('supports array-style indexed paths', () => {
    const tree = group('', 'root', [
      group('switches', 'switches', [
        group('switches._data', '_data', [
          leaf('switches._data[1]', 'Intro done (1)', 'bool', true),
        ]),
      ]),
    ]);
    expect(extractIndexedRows(tree, 'switches._data')).toEqual([
      {
        path: 'switches._data[1]',
        index: '1',
        label: 'Intro done (1)',
        value: true,
        type: 'bool',
      },
    ]);
  });
});

describe('filterNonDefaultSwitches / filterNonDefaultVariables', () => {
  it('hides default false switches', () => {
    const rows = extractIndexedRows(sampleTree(), 'switches._data');
    expect(filterNonDefaultSwitches(rows).map((r) => r.index)).toEqual(['1']);
  });

  it('hides default 0 / empty / false variables', () => {
    const rows = extractIndexedRows(sampleTree(), 'variables._data');
    expect(filterNonDefaultVariables(rows).map((r) => r.index)).toEqual(['1', '5']);
  });
});

describe('effectiveValue', () => {
  it('prefers patch value when present', () => {
    const node = leaf('party._gold', '_gold', 'int', 250);
    const patches = new Map<string, unknown>([['party._gold', 999]]);
    expect(effectiveValue(node, patches)).toBe(999);
    expect(effectiveValue(node, new Map())).toBe(250);
  });
});
