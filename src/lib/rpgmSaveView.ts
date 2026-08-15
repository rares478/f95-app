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
  /** Ordered core stats (Name, HP, MP, Level, Exp, optional TP/Nickname). */
  coreFields: ActorField[];
  /** Other editable `_` scalars, sorted by key. */
  extraFields: ActorField[];
}

/** Core actor fields shown in the always-visible row (spec order). */
export const ACTOR_CORE_KEYS = [
  '_name',
  '_hp',
  '_mp',
  '_level',
  '_exp',
  '_tp',
  '_nickname',
] as const;

const ACTOR_CORE_KEY_SET = new Set<string>(ACTOR_CORE_KEYS);

/** Collapse “Other fields” when extras exceed this count. */
export const ACTOR_EXTRAS_COLLAPSE_AT = 8;

export function extractActorCards(tree: RenpyVarNode): ActorCard[] {
  const data = findNode(tree, 'actors._data');
  const entries = collectionEntries(data);
  const cards: ActorCard[] = [];
  for (const child of entries) {
    if (child.type === 'null' || child.value === null) continue;
    if (!child.children) continue;
    const indexStr = leafIndex(child);
    if (indexStr == null) continue;
    const index = Number(indexStr);
    if (!Number.isFinite(index)) continue;

    const byKey = new Map<string, ActorField>();
    for (const field of child.children) {
      if (!isPrimitiveLeaf(field)) continue;
      if (!field.editable) continue;
      if (!ACTOR_CORE_KEY_SET.has(field.name) && !isSimilarActorScalar(field)) continue;
      byKey.set(field.name, {
        path: field.path,
        key: field.name,
        value: field.value,
        type: field.type,
      });
    }

    const coreFields: ActorField[] = [];
    for (const key of ACTOR_CORE_KEYS) {
      const f = byKey.get(key);
      if (f) coreFields.push(f);
    }

    const extraFields = [...byKey.values()]
      .filter((f) => !ACTOR_CORE_KEY_SET.has(f.key))
      .sort((a, b) => a.key.localeCompare(b.key));

    const nameField = coreFields.find((f) => f.key === '_name') ?? byKey.get('_name');
    const title =
      typeof nameField?.value === 'string' && nameField.value.length > 0
        ? nameField.value
        : `#${index}`;

    cards.push({ index, path: child.path, title, coreFields, extraFields });
  }
  return cards;
}

/** Filter extras by key/label; always keep paths in `dirtyPaths`. */
export function filterActorExtraFields(
  fields: ActorField[],
  query: string,
  dirtyPaths?: Set<string>,
): ActorField[] {
  const q = query.trim().toLowerCase();
  if (!q) return fields;
  return fields.filter((f) => {
    if (dirtyPaths?.has(f.path)) return true;
    const label = f.key.startsWith('_') ? f.key.slice(1) : f.key;
    return f.key.toLowerCase().includes(q) || label.toLowerCase().includes(q);
  });
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
  const rows: IndexedRow[] = [];
  for (const child of collectionEntries(parent)) {
    if (child.type === 'null' || child.value === null) continue;
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
  const ids: number[] = [];
  for (const child of collectionEntries(node)) {
    const n = numberOrNull(child.value);
    if (n != null) ids.push(n);
  }
  return ids;
}

/**
 * RPG Maker JsonEx encodes arrays as `{ "@a": [...], "@c": n }`.
 * Plain JSON arrays/objects are returned as-is (minus `@` / `@c` metadata).
 */
export function collectionEntries(node: RenpyVarNode | null | undefined): RenpyVarNode[] {
  if (!node?.children?.length) return [];
  const wrapped = node.children.find((c) => c.name === '@a');
  if (wrapped?.children) return wrapped.children;
  if (node.type === 'list') return node.children;
  return node.children.filter((c) => c.name !== '@' && c.name !== '@c');
}

function isDefaultVariableValue(value: unknown): boolean {
  if (value === false) return true;
  if (value === 0) return true;
  if (value === '') return true;
  return false;
}
