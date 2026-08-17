import type { RenpySaveSlot } from '../../../types/renpySave';
import type { UnitySaveSlot } from '../../../types/unitySave';

export type SaveEditorSlot = RenpySaveSlot | UnitySaveSlot;

/** True when the slot carries Unity-specific fields (source / encrypted / displayName). */
export function isUnitySaveSlot(slot: SaveEditorSlot): slot is UnitySaveSlot {
  return (
    typeof (slot as UnitySaveSlot).source === 'string' &&
    typeof (slot as UnitySaveSlot).encrypted === 'boolean' &&
    typeof (slot as UnitySaveSlot).displayName === 'string'
  );
}

export function unitySourceLocaleKey(source: string): string {
  switch (source) {
    case 'localLow':
      return 'saveEditor.unity.source.localLow';
    case 'install':
      return 'saveEditor.unity.source.install';
    case 'registry':
      return 'saveEditor.unity.source.registry';
    case 'extra':
      return 'saveEditor.unity.source.extra';
    default:
      return 'saveEditor.kind.other';
  }
}

export function slotKindLocaleKey(kind: string): string {
  switch (kind) {
    case 'slot':
    case 'auto':
    case 'quick':
    case 'persistent':
    case 'file':
    case 'global':
    case 'config':
    case 'other':
    case 'es3':
    case 'json':
    case 'odin':
    case 'ac':
    case 'xml':
    case 'nrbf':
    case 'vngine':
    case 'mystwood':
      return `saveEditor.kind.${kind}`;
    default:
      return 'saveEditor.kind.other';
  }
}
