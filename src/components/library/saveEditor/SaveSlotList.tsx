import type { LibrarySaveExtraRoot } from '../../../lib/library';
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
  extraRoots: LibrarySaveExtraRoot[];
  onAddFolder: () => void;
  onRemoveFolder: (id: string) => void;
  busy?: boolean;
  loading?: boolean;
  emptyHint?: string | null;
}

function folderLabel(path: string): string {
  const parts = path.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function slotLabel(slot: SaveEditorSlot): string {
  if (isUnitySaveSlot(slot) && slot.displayName) return slot.displayName;
  if (!isUnitySaveSlot(slot) && slot.displayName) return slot.displayName;
  return slot.key;
}

function slotSource(slot: SaveEditorSlot): string | null {
  if (isUnitySaveSlot(slot)) return slot.source;
  return slot.source ?? null;
}

export function SaveSlotList({
  slots,
  selectedKey,
  onSelect,
  extraRoots,
  onAddFolder,
  onRemoveFolder,
  busy = false,
  loading = false,
  emptyHint = null,
}: Props) {
  const { t } = useT();

  return (
    <div className="save-editor-col">
      <div className="save-editor-col-head">
        <span>{t('saveEditor.slots')}</span>
        <button
          type="button"
          className="save-editor-add-folder"
          disabled={busy}
          onClick={onAddFolder}
        >
          {t('saveEditor.extraFolder.add')}
        </button>
      </div>
      {extraRoots.length > 0 && (
        <div className="save-editor-extra-roots">
          {extraRoots.map((root) => (
            <div key={root.id} className="save-editor-extra-chip" title={root.path}>
              <span className="save-editor-extra-chip-label">{folderLabel(root.path)}</span>
              <button
                type="button"
                className="save-editor-extra-chip-remove"
                disabled={busy}
                aria-label={t('saveEditor.extraFolder.remove')}
                onClick={() => onRemoveFolder(root.id)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="save-editor-col-body">
        {loading && slots.length === 0 ? (
          <div className="save-editor-empty save-editor-empty--slots">
            <p>{t('saveEditor.loadingSlots')}</p>
          </div>
        ) : slots.length === 0 ? (
          <div className="save-editor-empty save-editor-empty--slots">
            <p>{t('saveEditor.empty')}</p>
            {emptyHint ? <p className="save-editor-empty-hint">{emptyHint}</p> : null}
          </div>
        ) : (
          <>
            {loading && (
              <div className="save-editor-slots-loading" aria-live="polite">
                {t('saveEditor.loadingSlots')}
              </div>
            )}
            {slots.map((slot) => {
              const active = slot.key === selectedKey;
              const unity = isUnitySaveSlot(slot);
              const source = slotSource(slot);
              return (
                <button
                  key={slot.key}
                  type="button"
                  className={`save-editor-slot${active ? ' save-editor-slot--active' : ''}`}
                  onClick={() => onSelect(slot)}
                  disabled={loading}
                >
                  <span className="save-editor-slot-key">{slotLabel(slot)}</span>
                  <span className="save-editor-slot-meta">
                    {formatMtime(slot.mtimeMs)} · {formatBytes(slot.sizeBytes)}
                  </span>
                  <span className="save-editor-slot-badges">
                    <span className="save-editor-badge">{t(slotKindLocaleKey(slot.kind))}</span>
                    {source && (
                      <span className="save-editor-badge">{t(unitySourceLocaleKey(source))}</span>
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
          </>
        )}
      </div>
    </div>
  );
}

function formatMtime(ms: number): string {
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return '—';
  }
}
