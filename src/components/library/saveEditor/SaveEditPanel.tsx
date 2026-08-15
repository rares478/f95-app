import type { RenpySaveBackup, RenpyVarNode } from '../../../types/renpySave';
import { formatBytes } from '../../../types/download';
import { useT } from '../../../lib/i18n';

interface Props {
  selected: RenpyVarNode | null;
  draftValue: unknown;
  onDraftChange: (value: unknown) => void;
  dirtyCount: number;
  applying: boolean;
  readOnly: boolean;
  restoreDisabled: boolean;
  applyDisabled: boolean;
  onApply: () => void;
  backups: RenpySaveBackup[];
  restoring: string | null;
  onRestore: (backup: RenpySaveBackup) => void;
}

function formatMtime(ms: number): string {
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return '—';
  }
}

function draftToString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function SaveEditPanel({
  selected,
  draftValue,
  onDraftChange,
  dirtyCount,
  applying,
  readOnly,
  restoreDisabled,
  applyDisabled,
  onApply,
  backups,
  restoring,
  onRestore,
}: Props) {
  const { t } = useT();

  return (
    <div className="save-editor-col">
      <div className="save-editor-col-head">{t('saveEditor.title')}</div>
      <div className="save-editor-col-body save-editor-panel">
        {!selected && (
          <p className="save-editor-empty">{t('saveEditor.pickVar')}</p>
        )}
        {selected && !selected.editable && (
          <p className="save-editor-empty">{t('saveEditor.notEditable')}</p>
        )}
        {selected?.editable && (
          <>
            <div className="save-editor-field">
              <span className="save-editor-label">{t('saveEditor.path')}</span>
              <span className="save-editor-path">{selected.path}</span>
            </div>
            <div className="save-editor-field">
              <span className="save-editor-label">{t('saveEditor.type')}</span>
              <span className="save-editor-path">{selected.type}</span>
            </div>
            <div className="save-editor-field">
              <span className="save-editor-label">{t('saveEditor.value')}</span>
              {selected.type === 'bool' ? (
                <select
                  className="save-editor-select"
                  value={draftValue === true ? 'true' : 'false'}
                  disabled={readOnly}
                  onChange={(e) => onDraftChange(e.target.value === 'true')}
                >
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              ) : (
                <input
                  className="save-editor-input"
                  type={selected.type === 'int' || selected.type === 'float' ? 'number' : 'text'}
                  step={selected.type === 'float' ? 'any' : selected.type === 'int' ? '1' : undefined}
                  value={draftToString(draftValue)}
                  disabled={readOnly}
                  onChange={(e) => {
                    const raw = e.target.value;
                    if (selected.type === 'int') {
                      const n = Number.parseInt(raw, 10);
                      onDraftChange(Number.isFinite(n) ? n : raw);
                    } else if (selected.type === 'float') {
                      const n = Number.parseFloat(raw);
                      onDraftChange(Number.isFinite(n) ? n : raw);
                    } else {
                      onDraftChange(raw);
                    }
                  }}
                />
              )}
            </div>
          </>
        )}

        <div className="save-editor-actions">
          <button
            type="button"
            className="save-editor-apply"
            disabled={applyDisabled || dirtyCount === 0 || applying}
            onClick={onApply}
          >
            {applying ? t('saveEditor.applying') : t('saveEditor.apply')}
          </button>
          {dirtyCount > 0 && (
            <span className="save-editor-dirty">
              {t('saveEditor.dirtyCount', { count: dirtyCount })}
            </span>
          )}
        </div>

        <div className="save-editor-backups">
          <div className="save-editor-backups-title">{t('saveEditor.backups')}</div>
          {backups.length === 0 ? (
            <p className="save-editor-empty-hint">{t('saveEditor.noBackups')}</p>
          ) : (
            <ul className="save-editor-backup-list">
              {backups.map((b) => (
                <li key={b.fileName} className="save-editor-backup">
                  <div className="save-editor-backup-meta">
                    <span className="save-editor-backup-name" title={b.fileName}>
                      {b.fileName}
                    </span>
                    <span className="save-editor-backup-sub">
                      {formatMtime(b.mtimeMs)} · {formatBytes(b.sizeBytes)}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="save-editor-restore"
                    disabled={restoreDisabled || restoring != null}
                    onClick={() => onRestore(b)}
                  >
                    {restoring === b.fileName
                      ? t('saveEditor.restoring')
                      : t('saveEditor.restore')}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
