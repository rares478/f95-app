import { useEffect, useMemo, useState } from 'react';
import type { RenpyVarNode } from '../../../types/renpySave';
import { useT } from '../../../lib/i18n';

interface Props {
  root: RenpyVarNode | null;
  search: string;
  onSearchChange: (value: string) => void;
  selectedPath: string | null;
  dirtyPaths: Set<string>;
  onSelect: (node: RenpyVarNode) => void;
}

function formatInlineValue(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value === 'string') {
    const short = value.length > 40 ? `${value.slice(0, 37)}…` : value;
    return JSON.stringify(short);
  }
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function nodeMatches(node: RenpyVarNode, q: string): boolean {
  if (!q) return true;
  return (
    node.path.toLowerCase().includes(q) ||
    node.name.toLowerCase().includes(q)
  );
}

/** Keep nodes that match the query or have a matching descendant. */
function filterTree(node: RenpyVarNode, q: string): RenpyVarNode | null {
  if (!q) return node;
  const kids = (node.children ?? [])
    .map((c) => filterTree(c, q))
    .filter((c): c is RenpyVarNode => c != null);
  if (nodeMatches(node, q) || kids.length > 0) {
    return { ...node, children: kids.length ? kids : node.children };
  }
  return null;
}

function TreeNodeView({
  node,
  depth,
  selectedPath,
  dirtyPaths,
  forceOpen,
  collapseVersion,
  onSelect,
}: {
  node: RenpyVarNode;
  depth: number;
  selectedPath: string | null;
  dirtyPaths: Set<string>;
  forceOpen: boolean;
  collapseVersion: number;
  onSelect: (node: RenpyVarNode) => void;
}) {
  const hasChildren = (node.children?.length ?? 0) > 0;
  const [open, setOpen] = useState(depth < 2 || forceOpen);

  // Search expands matches initially; user can still collapse afterward.
  useEffect(() => {
    if (forceOpen) setOpen(true);
  }, [forceOpen, node.path]);

  useEffect(() => {
    if (collapseVersion > 0) setOpen(false);
  }, [collapseVersion]);

  const expanded = open;
  const active = selectedPath === node.path;
  const dirty = dirtyPaths.has(node.path);
  const clickable = node.editable || hasChildren;

  const toggleOpen = () => setOpen((v) => !v);

  return (
    <li className="save-editor-tree-item">
      <div
        role={clickable ? 'button' : undefined}
        tabIndex={clickable ? 0 : undefined}
        className={[
          'save-editor-tree-row',
          clickable ? 'save-editor-tree-row--clickable' : '',
          active ? 'save-editor-tree-row--active' : '',
          dirty ? 'save-editor-tree-row--dirty' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        style={{ paddingLeft: 6 + depth * 10 }}
        onClick={() => {
          if (hasChildren) toggleOpen();
          else if (node.editable) onSelect(node);
        }}
        onKeyDown={(e) => {
          if (!clickable) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (hasChildren) toggleOpen();
            else if (node.editable) onSelect(node);
          }
        }}
      >
        {hasChildren ? (
          <button
            type="button"
            className="save-editor-tree-toggle"
            aria-expanded={expanded}
            onClick={(e) => {
              e.stopPropagation();
              toggleOpen();
            }}
          >
            {expanded ? '▾' : '▸'}
          </button>
        ) : (
          <span className="save-editor-tree-toggle save-editor-tree-toggle--spacer" />
        )}
        <span className="save-editor-tree-name">{node.name}</span>
        {!hasChildren && node.value !== undefined && (
          <span className="save-editor-tree-value">{formatInlineValue(node.value)}</span>
        )}
        <span className="save-editor-tree-type">{node.type}</span>
      </div>
      {hasChildren && expanded && (
        <ul className="save-editor-tree-children">
          {node.children!.map((child) => (
            <TreeNodeView
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              dirtyPaths={dirtyPaths}
              forceOpen={forceOpen}
              collapseVersion={collapseVersion}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export function SaveVarTree({
  root,
  search,
  onSearchChange,
  selectedPath,
  dirtyPaths,
  onSelect,
}: Props) {
  const { t } = useT();
  const [collapseVersion, setCollapseVersion] = useState(0);
  const q = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!root) return null;
    return filterTree(root, q);
  }, [root, q]);

  return (
    <div className="save-editor-col">
      <div className="save-editor-col-head save-editor-col-head--tree">
        <input
          className="save-editor-search"
          type="search"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={t('saveEditor.search')}
          aria-label={t('saveEditor.search')}
        />
        <button
          type="button"
          className="save-editor-collapse-all"
          disabled={!filtered}
          onClick={() => setCollapseVersion((v) => v + 1)}
        >
          {t('saveEditor.collapseAll')}
        </button>
      </div>
      <div className="save-editor-col-body">
        {!root && (
          <p className="save-editor-empty">{t('saveEditor.pickSlot')}</p>
        )}
        {root && !filtered && (
          <p className="save-editor-empty">{t('saveEditor.noMatches')}</p>
        )}
        {filtered && (
          <ul className="save-editor-tree">
            <TreeNodeView
              node={filtered}
              depth={0}
              selectedPath={selectedPath}
              dirtyPaths={dirtyPaths}
              forceOpen={Boolean(q)}
              collapseVersion={collapseVersion}
              onSelect={onSelect}
            />
          </ul>
        )}
      </div>
    </div>
  );
}
