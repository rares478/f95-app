import { dialog } from '../../lib/dialog';
import * as ipc from '../../lib/ipc';
import * as library from '../../lib/library';
import {
  exeDisplayName,
  exeParentDir,
  type LibraryGameExe,
} from '../../lib/libraryExes';
import { pickExeFor } from '../../lib/libraryGameActions';
import { useT } from '../../lib/i18n';
import type { LibraryGame } from '../../types/library';
import type { LibraryGameActionsDeps } from '../../lib/libraryGameActions';
import '../../styles/library-exes.css';

export type LibraryExesSectionProps = {
  game: LibraryGame;
  exes: LibraryGameExe[];
  resolvedId: string | null;
  onChanged: () => Promise<void>;
  onPlayExe: (exe: LibraryGameExe) => Promise<void>;
  deps: LibraryGameActionsDeps;
  disabled?: boolean;
};

function lastPlayedId(exes: LibraryGameExe[]): string | null {
  const launched = exes.filter((r) => r.lastLaunchedAt);
  if (launched.length === 0) return null;
  return [...launched].sort((a, b) =>
    (b.lastLaunchedAt!).localeCompare(a.lastLaunchedAt!),
  )[0]!.id;
}

export function LibraryExesSection({
  game,
  exes,
  resolvedId,
  onChanged,
  onPlayExe,
  deps,
  disabled = false,
}: LibraryExesSectionProps) {
  const { t } = useT();
  const lastId = lastPlayedId(exes);

  async function onAdd() {
    if (disabled) return;
    await pickExeFor(game, deps);
  }

  async function onPlayRow(row: LibraryGameExe) {
    if (disabled) return;
    await onPlayExe(row);
  }

  async function onOpenFolder(row: LibraryGameExe) {
    const folder = row.installPath || exeParentDir(row.exePath);
    if (!folder) return;
    try {
      await ipc.revealInExplorer(folder);
    } catch (err) {
      console.warn('open exe folder failed', err);
    }
  }

  async function onSetDefault(row: LibraryGameExe) {
    await library.setDefaultExe(row.id);
    await onChanged();
  }

  async function onRename(row: LibraryGameExe) {
    const next = await dialog.prompt(t('libdetail.exe.labelPrompt'), {
      title: t('libdetail.exe.rename'),
      defaultValue: row.label ?? exeDisplayName(row),
    });
    if (next === null) return;
    await library.renameExe(row.id, next);
    await onChanged();
  }

  async function onRemove(row: LibraryGameExe) {
    const name = exeDisplayName(row);
    const ok = await dialog.confirm(t('libdetail.exe.removeConfirm', { name }), {
      title: t('libdetail.exe.removeConfirmTitle'),
      kind: 'warning',
    });
    if (!ok) return;
    await library.removeExe(row.id);
    await onChanged();
  }

  return (
    <div className="library-exes">
      {exes.length === 0 ? (
        <p className="library-exes-empty">{t('libdetail.action.play.hintExe')}</p>
      ) : (
        <ul className="library-exes-list">
          {exes.map((row) => {
            const folder = row.installPath || exeParentDir(row.exePath);
            return (
              <li
                key={row.id}
                className={`library-exes-row${
                  resolvedId === row.id ? ' library-exes-row--active' : ''
                }`}
              >
                <div className="library-exes-row-head">
                  <span className="library-exes-name" title={row.exePath}>
                    {exeDisplayName(row)}
                  </span>
                  {row.isDefault && (
                    <span className="library-exes-badge library-exes-badge--default">
                      {t('libdetail.exe.badgeDefault')}
                    </span>
                  )}
                  {lastId === row.id && (
                    <span className="library-exes-badge library-exes-badge--last">
                      {t('libdetail.exe.badgeLastPlayed')}
                    </span>
                  )}
                </div>
                <p className="library-exes-path" title={folder}>
                  {folder}
                </p>
                <div className="library-exes-actions">
                  <button
                    type="button"
                    className="library-exes-action"
                    disabled={disabled}
                    onClick={() => void onPlayRow(row)}
                  >
                    {t('libdetail.exe.play')}
                  </button>
                  <button
                    type="button"
                    className="library-exes-action"
                    disabled={!folder}
                    onClick={() => void onOpenFolder(row)}
                  >
                    {t('libdetail.exe.openFolder')}
                  </button>
                  <button
                    type="button"
                    className="library-exes-action"
                    disabled={disabled || row.isDefault}
                    onClick={() => void onSetDefault(row)}
                  >
                    {t('libdetail.exe.setDefault')}
                  </button>
                  <button
                    type="button"
                    className="library-exes-action"
                    disabled={disabled}
                    onClick={() => void onRename(row)}
                  >
                    {t('libdetail.exe.rename')}
                  </button>
                  <button
                    type="button"
                    className="library-exes-action library-exes-action--danger"
                    disabled={disabled}
                    onClick={() => void onRemove(row)}
                  >
                    {t('libdetail.exe.remove')}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <button
        type="button"
        className="game-detail-btn game-detail-btn-secondary library-exes-add"
        disabled={disabled}
        onClick={() => void onAdd()}
      >
        {t('libdetail.exe.add')}
      </button>
    </div>
  );
}
