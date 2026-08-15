import type { RenpyVarNode } from '../types/renpySave';

export function findNode(root: RenpyVarNode | null, path: string): RenpyVarNode | null {
  if (!root) return null;
  if (root.path === path) return root;
  for (const child of root.children ?? []) {
    const hit = findNode(child, path);
    if (hit) return hit;
  }
  return null;
}

export type InventoryKind = 'items' | 'weapons' | 'armors';

export interface InventoryRow {
  path: string;
  id: string;
  name: string;
  count: number;
}

const INVENTORY_ROOT: Record<InventoryKind, string> = {
  items: 'party._items',
  weapons: 'party._weapons',
  armors: 'party._armors',
};

export function extractInventoryRows(tree: RenpyVarNode, kind: InventoryKind): InventoryRow[] {
  const parent = findNode(tree, INVENTORY_ROOT[kind]);
  if (!parent?.children) return [];
  const rows: InventoryRow[] = [];
  for (const child of parent.children) {
    if (!isPrimitiveLeaf(child)) continue;
    const id = leafIndex(child);
    if (id == null) continue;
    const count = typeof child.value === 'number' ? child.value : Number(child.value);
    if (!Number.isFinite(count)) continue;
    rows.push({ path: child.path, id, name: child.name, count });
  }
  return rows;
}

export interface PartyView {
  goldPath: string;
  gold: number | null;
  stepsPath: string;
  steps: number | null;
  actorIds: number[];
}

export function extractPartyView(tree: RenpyVarNode): PartyView {
  const goldPath = 'party._gold';
  const stepsPath = 'party._steps';
  return {
    goldPath,
    gold: numberOrNull(findNode(tree, goldPath)?.value),
    stepsPath,
    steps: numberOrNull(findNode(tree, stepsPath)?.value),
    actorIds: extractActorIds(findNode(tree, 'party._actors')),
  };
}

export interface ActorField {
  path: string;
  key: string;
  value: unknown;
  type: string;
}

export interface ActorCard {
  index: number;
  path: string;
  title: string;
  fields: ActorField[];
}

const ACTOR_SCALAR_KEYS = new Set(['_hp', '_mp', '_level', '_exp', '_name']);

export function extractActorCards(tree: RenpyVarNode): ActorCard[] {
  const data = findNode(tree, 'actors._data');
  if (!data?.children) return [];
  const cards: ActorCard[] = [];
  for (const child of data.children) {
    if (child.type === 'null' || child.value === null) continue;
    if (!child.children) continue;
    const indexStr = leafIndex(child);
    if (indexStr == null) continue;
    const index = Number(indexStr);
    if (!Number.isFinite(index)) continue;

    const fields: ActorField[] = [];
    for (const field of child.children) {
      if (!isPrimitiveLeaf(field)) continue;
      if (!field.editable) continue;
      if (!ACTOR_SCALAR_KEYS.has(field.name) && !isSimilarActorScalar(field)) continue;
      fields.push({
        path: field.path,
        key: field.name,
        value: field.value,
        type: field.type,
      });
    }

    const nameField = fields.find((f) => f.key === '_name');
    const title =
      typeof nameField?.value === 'string' && nameField.value.length > 0
        ? nameField.value
        : `#${index}`;

    cards.push({ index, path: child.path, title, fields });
  }
  return cards;
}

export interface IndexedRow {
  path: string;
  index: string;
  label: string;
  value: unknown;
  type: string;
}

export function extractIndexedRows(
  tree: RenpyVarNode,
  rootPath: 'switches._data' | 'variables._data',
): IndexedRow[] {
  const parent = findNode(tree, rootPath);
  if (!parent?.children) return [];
  const rows: IndexedRow[] = [];
  for (const child of parent.children) {
    if (!isPrimitiveLeaf(child)) continue;
    const index = leafIndex(child);
    if (index == null) continue;
    rows.push({
      path: child.path,
      index,
      label: child.name,
      value: child.value,
      type: child.type,
    });
  }
  return rows;
}

export function filterNonDefaultSwitches(rows: IndexedRow[]): IndexedRow[] {
  return rows.filter((row) => row.value !== false);
}

export function filterNonDefaultVariables(rows: IndexedRow[]): IndexedRow[] {
  return rows.filter((row) => !isDefaultVariableValue(row.value));
}

export function effectiveValue(
  node: RenpyVarNode,
  patches: Map<string, unknown>,
): unknown {
  if (patches.has(node.path)) return patches.get(node.path);
  return node.value;
}

function isPrimitiveLeaf(node: RenpyVarNode): boolean {
  if (node.children && node.children.length > 0) return false;
  return node.type === 'int'
    || node.type === 'float'
    || node.type === 'bool'
    || node.type === 'string'
    || node.type === 'null';
}

function isSimilarActorScalar(node: RenpyVarNode): boolean {
  return node.name.startsWith('_')
    && (node.type === 'int' || node.type === 'float' || node.type === 'bool' || node.type === 'string');
}

function leafIndex(node: RenpyVarNode): string | null {
  const bracket = node.path.match(/\[(\d+)\]$/);
  if (bracket) return bracket[1];
  const dotted = node.path.match(/\.([^.[\]]+)$/);
  if (dotted) return dotted[1];
  if (/^\d+$/.test(node.name)) return node.name;
  return null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function extractActorIds(node: RenpyVarNode | null): number[] {
  if (!node?.children) return [];
  const ids: number[] = [];
  for (const child of node.children) {
    const n = numberOrNull(child.value);
    if (n != null) ids.push(n);
  }
  return ids;
}

function isDefaultVariableValue(value: unknown): boolean {
  if (value === false) return true;
  if (value === 0) return true;
  if (value === '') return true;
  return false;
}
