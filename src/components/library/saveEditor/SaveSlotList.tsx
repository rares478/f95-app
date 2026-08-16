import type { SaveEditorSlot } from './unitySlotUi';
import { isUnitySaveSlot, slotKindLocaleKey, unitySourceLocaleKey } from './unitySlotUi';
import { formatBytes } from '../../../types/download';
import { useT } from '../../../lib/i18n';

export type { SaveEditorSlot } from './unitySlotUi';
export { isUnitySaveSlot } from './unitySlotUi';

interface Props {
  slots: SaveEditorSlot[];
  selectedKey: string | null;
  onSelect: (slot: SaveEditorSlot) => void;
}

function formatMtime(ms: number): string {
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return '—';
  }
}

export function SaveSlotList({ slots, selectedKey, onSelect }: Props) {
  const { t } = useT();

  return (
    <div className="save-editor-col">
      <div className="save-editor-col-head">{t('saveEditor.slots')}</div>
      <div className="save-editor-col-body">
        {slots.map((slot) => {
          const active = slot.key === selectedKey;
          const unity = isUnitySaveSlot(slot);
          const label = unity && slot.displayName ? slot.displayName : slot.key;
          return (
            <button
              key={slot.key}
              type="button"
              className={`save-editor-slot${active ? ' save-editor-slot--active' : ''}`}
              onClick={() => onSelect(slot)}
            >
              <span className="save-editor-slot-key">{label}</span>
              <span className="save-editor-slot-meta">
                {formatMtime(slot.mtimeMs)} · {formatBytes(slot.sizeBytes)}
              </span>
              <span className="save-editor-slot-badges">
                <span className="save-editor-badge">{t(slotKindLocaleKey(slot.kind))}</span>
                {unity && (
                  <span className="save-editor-badge">{t(unitySourceLocaleKey(slot.source))}</span>
                )}
                {unity && slot.encrypted && (
                  <span className="save-editor-badge save-editor-badge--locked">
                    {t('saveEditor.unity.locked')}
                  </span>
                )}
                {!unity && slot.hasScreenshot && (
                  <span className="save-editor-badge">{t('saveEditor.hasScreenshot')}</span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
