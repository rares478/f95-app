import { useState, type ReactElement } from 'react';
import type { RenpyVarNode } from '../../../../types/renpySave';
import { useT } from '../../../../lib/i18n';
import { SaveVarTree } from '../SaveVarTree';
import { RpgmPartyPanel } from './RpgmPartyPanel';
import { RpgmInventoryPanel } from './RpgmInventoryPanel';
import { RpgmActorsPanel } from './RpgmActorsPanel';
import { RpgmSwitchesPanel } from './RpgmSwitchesPanel';
import { RpgmVariablesPanel } from './RpgmVariablesPanel';
import './rpgmEditor.css';

export type RpgmEditorTabId =
  | 'party'
  | 'inventory'
  | 'actors'
  | 'switches'
  | 'variables'
  | 'raw';

/** Default curated tab when an RPGM save loads (not Raw). */
export const DEFAULT_RPGM_TAB: RpgmEditorTabId = 'party';

export const RPGM_EDITOR_TABS: readonly RpgmEditorTabId[] = [
  'party',
  'inventory',
  'actors',
  'switches',
  'variables',
  'raw',
] as const;

const TAB_LOCALE_KEY: Record<RpgmEditorTabId, string> = {
  party: 'saveEditor.rpgm.tab.party',
  inventory: 'saveEditor.rpgm.tab.inventory',
  actors: 'saveEditor.rpgm.tab.actors',
  switches: 'saveEditor.rpgm.tab.switches',
  variables: 'saveEditor.rpgm.tab.variables',
  raw: 'saveEditor.rpgm.tab.raw',
};

export function RpgmEditorTabs(props: {
  tree: RenpyVarNode;
  patches: Map<string, unknown>;
  dirtyPaths: Set<string>;
  onPatch: (path: string, value: unknown) => void;
  search: string;
  onSearch: (q: string) => void;
  selectedPath: string | null;
  onSelectPath: (p: string) => void;
  selectedNode: RenpyVarNode | null;
  draftValue: unknown;
  onDraft: (v: unknown) => void;
  disabled?: boolean;
}) {
  const {
    tree,
    patches,
    dirtyPaths,
    onPatch,
    search,
    onSearch,
    selectedPath,
    onSelectPath,
    disabled = false,
  } = props;
  // selectedNode / draftValue / onDraft are part of the shared Raw contract;
  // Raw editing stays in SaveEditPanel so curated + Raw share one apply surface.
  void props.selectedNode;
  void props.draftValue;
  void props.onDraft;

  const { t } = useT();
  const [tab, setTab] = useState<RpgmEditorTabId>(DEFAULT_RPGM_TAB);

  const patchProps = { tree, patches, dirtyPaths, onPatch, disabled };

  let body: ReactElement;
  switch (tab) {
    case 'inventory':
      body = <RpgmInventoryPanel {...patchProps} />;
      break;
    case 'actors':
      body = <RpgmActorsPanel {...patchProps} />;
      break;
    case 'switches':
      body = <RpgmSwitchesPanel {...patchProps} />;
      break;
    case 'variables':
      body = <RpgmVariablesPanel {...patchProps} />;
      break;
    case 'raw':
      body = (
        <div className="rpgm-raw-host">
          <SaveVarTree
            root={tree}
            search={search}
            onSearchChange={onSearch}
            selectedPath={selectedPath}
            dirtyPaths={dirtyPaths}
            onSelect={(node) => {
              if (!node.editable) return;
              onSelectPath(node.path);
            }}
          />
        </div>
      );
      break;
    case 'party':
    default:
      body = <RpgmPartyPanel {...patchProps} />;
      break;
  }

  return (
    <div className="save-editor-col rpgm-editor">
      <div
        className="rpgm-editor-tabbar"
        role="tablist"
        aria-label={t('saveEditor.rpgm.tabs')}
      >
        {RPGM_EDITOR_TABS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={`rpgm-editor-tab${tab === id ? ' rpgm-editor-tab--active' : ''}`}
            onClick={() => setTab(id)}
          >
            {t(TAB_LOCALE_KEY[id])}
          </button>
        ))}
      </div>
      <div className="save-editor-col-body rpgm-editor-body" role="tabpanel">
        {body}
      </div>
    </div>
  );
}
