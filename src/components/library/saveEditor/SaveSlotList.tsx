import type { RenpySaveSlot } from '../../../types/renpySave';
import { formatBytes } from '../../../types/download';
import { useT } from '../../../lib/i18n';

interface Props {
  slots: RenpySaveSlot[];
  selectedKey: string | null;
  onSelect: (slot: RenpySaveSlot) => void;
}

function kindKey(kind: string): string {
  switch (kind) {
    case 'slot':
    case 'auto':
    case 'quick':
    case 'persistent':
    case 'file':
    case 'global':
    case 'config':
    case 'other':
      return `saveEditor.kind.${kind}`;
    default:
      return 'saveEditor.kind.other';
  }
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
          return (
            <button
              key={slot.key}
              type="button"
              className={`save-editor-slot${active ? ' save-editor-slot--active' : ''}`}
              onClick={() => onSelect(slot)}
            >
              <span className="save-editor-slot-key">{slot.key}</span>
              <span className="save-editor-slot-meta">
                {formatMtime(slot.mtimeMs)} · {formatBytes(slot.sizeBytes)}
              </span>
              <span className="save-editor-slot-badges">
                <span className="save-editor-badge">{t(kindKey(slot.kind))}</span>
                {slot.hasScreenshot && (
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
