import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  GameDetailActionItem,
  GameDetailActionList,
  GameDetailBtnDanger,
  GameDetailBtnSecondary,
  GameDetailField,
  GameDetailFields,
} from '../game/GameDetailLayout';
import { LibraryExesSection } from './LibraryExesSection';
import {
  defaultLibraryManageSection,
  libraryManageSectionLabelKey,
  libraryManageSectionsFor,
  type LibraryManageSectionId,
} from '../../lib/libraryGameManageNav';
import type { LibraryGameActionsDeps } from '../../lib/libraryGameActions';
import { useT } from '../../lib/i18n';
import { formatPlaytime, type LibraryGame } from '../../types/library';
import type { LibraryGameExe } from '../../lib/libraryExes';
import type { PlaySession } from '../../types/session';

export type LibraryGameManageModalProps = {
  open: boolean;
  game: LibraryGame;
  exes: LibraryGameExe[];
  recentSessions: PlaySession[];
  /** Resolved default/play exe id (`LibraryGameExe.id` is a string). */
  resolvedExeId: string | null;
  isRunning: boolean;
  downloadInFlight: boolean;
  launching: boolean;
  uninstalling: boolean;
  showSaveEditor: boolean;
  isWindows: boolean;
  hasLaunchExe: boolean;
  hasInstallFiles: boolean;
  canUninstall: boolean;
  libraryActionDeps: LibraryGameActionsDeps;
  onClose: () => void;
  onCheckUpdate: () => void | Promise<void>;
  onOpenInstallFolder: () => void;
  onOpenThread: () => void;
  onLocaleEmulatorChange: (enabled: boolean) => void | Promise<void>;
  onMove: () => void;
  onUninstall: () => void | Promise<void>;
  onRemove: () => void | Promise<void>;
  onPlayExe: (exe: LibraryGameExe) => void | Promise<void>;
  onExesChanged: () => void | Promise<void>;
  onAddTag: (tag: string) => void | Promise<void>;
  onRemoveTag: (tag: string) => void | Promise<void>;
};

export function LibraryGameManageModal(
  props: LibraryGameManageModalProps,
): React.ReactElement | null {
  const { t } = useT();
  const { open, game, onClose } = props;
  const sections = libraryManageSectionsFor(game.category);
  const [section, setSection] = useState<LibraryManageSectionId>(() =>
    defaultLibraryManageSection(game.category),
  );
  const [tagDraft, setTagDraft] = useState('');

  useEffect(() => {
    if (!open) return;
    setSection(defaultLibraryManageSection(game.category));
    setTagDraft('');
  }, [open, game.category, game.threadId]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!sections.includes(section)) {
      setSection(sections[0] ?? 'general');
    }
  }, [sections, section]);

  if (!open) return null;

  async function submitTag() {
    const tag = tagDraft.trim();
    if (!tag) return;
    await props.onAddTag(tag);
    setTagDraft('');
  }

  return createPortal(
    <div className="app-dialog-overlay" role="presentation" onClick={onClose}>
      <div
        className="app-dialog library-manage-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t('libdetail.manage.title', { title: game.title })}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="app-dialog-header">
          <div className="app-dialog-header-text">
            <h2 className="app-dialog-title">
              {t('libdetail.manage.title', { title: game.title })}
            </h2>
          </div>
          <button
            type="button"
            className="app-dialog-close"
            aria-label={t('common.close')}
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div className="library-manage-body">
          <nav
            className="library-manage-nav settings-nav"
            aria-label={t('libdetail.action.manage')}
          >
            {sections.map((id) => (
              <button
                key={id}
                type="button"
                className={`settings-nav-item${
                  section === id ? ' settings-nav-item-active' : ''
                }`}
                onClick={() => setSection(id)}
              >
                {t(libraryManageSectionLabelKey(id))}
              </button>
            ))}
          </nav>
          <div className="library-manage-panel">
            {section === 'general' && <GeneralPanel {...props} />}
            {section === 'files' && <FilesPanel {...props} />}
            {section === 'sessions' && (
              <SessionsPanel
                recentSessions={props.recentSessions}
                isRunning={props.isRunning}
              />
            )}
            {section === 'tags' && (
              <TagsPanel
                game={game}
                tagDraft={tagDraft}
                setTagDraft={setTagDraft}
                onSubmitTag={() => void submitTag()}
                onRemoveTag={(tag) => void props.onRemoveTag(tag)}
              />
            )}
            {section === 'tools' && <ToolsPanel {...props} />}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function GeneralPanel({
  game,
  isWindows,
  hasLaunchExe,
  onCheckUpdate,
  onLocaleEmulatorChange,
  onOpenThread,
}: LibraryGameManageModalProps) {
  const { t } = useT();
  return (
    <>
      <h3 className="game-detail-section-title">{t('libdetail.manage.nav.general')}</h3>
      <GameDetailFields>
        <GameDetailField
          label={t('libdetail.location.version')}
          value={game.currentVersion ?? '—'}
        />
        {game.availableVersion && game.availableVersion !== game.currentVersion && (
          <GameDetailField
            label={t('libdetail.location.available')}
            value={game.availableVersion}
          />
        )}
      </GameDetailFields>

      <div style={{ marginTop: 14 }}>
        <GameDetailBtnSecondary onClick={() => void onCheckUpdate()}>
          {t('libdetail.action.checkUpdate')}
        </GameDetailBtnSecondary>
      </div>

      {isWindows && (
        <div className="game-detail-locale-emulator" style={{ marginTop: 16 }}>
          <label className="settings-check-row">
            <input
              type="checkbox"
              checked={game.localeEmulatorEnabled}
              disabled={!hasLaunchExe}
              onChange={(e) => void onLocaleEmulatorChange(e.target.checked)}
            />
            <span>{t('localeEmulator.toggle')}</span>
          </label>
          <p className="settings-card-hint">
            {!hasLaunchExe
              ? t('localeEmulator.disabledNoExe')
              : t('localeEmulator.hint')}
          </p>
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <GameDetailActionList>
          <GameDetailActionItem onClick={onOpenThread}>
            {t('libdetail.action.openThread')}
          </GameDetailActionItem>
        </GameDetailActionList>
      </div>
    </>
  );
}

function FilesPanel({
  game,
  exes,
  resolvedExeId,
  downloadInFlight,
  isRunning,
  launching,
  uninstalling,
  hasInstallFiles,
  canUninstall,
  libraryActionDeps,
  onOpenInstallFolder,
  onExesChanged,
  onPlayExe,
  onMove,
  onUninstall,
}: LibraryGameManageModalProps) {
  const { t } = useT();
  return (
    <>
      <h3 className="game-detail-section-title">{t('libdetail.manage.nav.files')}</h3>
      <GameDetailFields>
        <GameDetailField
          label={t('libdetail.location.folder')}
          value={game.installPath ?? '—'}
          actionLabel={game.installPath ? t('common.open') : undefined}
          onAction={onOpenInstallFolder}
        />
      </GameDetailFields>

      <div style={{ marginTop: 14 }}>
        <h3
          className="game-detail-section-title"
          style={{ marginTop: 0, marginBottom: 10, borderBottom: 'none', paddingBottom: 0 }}
        >
          {t('libdetail.exe.section')}
        </h3>
        <LibraryExesSection
          game={game}
          exes={exes}
          resolvedId={resolvedExeId}
          onChanged={async () => {
            await onExesChanged();
          }}
          onPlayExe={async (exe) => {
            await onPlayExe(exe);
          }}
          deps={libraryActionDeps}
          disabled={downloadInFlight || isRunning || launching}
        />
      </div>

      {game.installPath && (
        <div style={{ marginTop: 14 }}>
          <GameDetailActionList>
            <GameDetailActionItem
              disabled={isRunning}
              title={
                isRunning
                  ? t('libdetail.action.move.disabledTitle')
                  : t('libdetail.action.move.title')
              }
              onClick={onMove}
            >
              {t('libdetail.action.move')}
            </GameDetailActionItem>
          </GameDetailActionList>
        </div>
      )}

      {hasInstallFiles && (
        <div className="game-detail-uninstall-block">
          <p className="game-detail-uninstall-hint">{t('libdetail.uninstall.hint')}</p>
          <GameDetailBtnDanger
            onClick={() => void onUninstall()}
            disabled={!canUninstall || uninstalling}
            title={
              isRunning
                ? t('libdetail.uninstall.notRunning')
                : game.installStatus === 'downloading' ||
                    game.installStatus === 'extracting' ||
                    downloadInFlight
                  ? t('libdetail.uninstall.waitDownload')
                  : t('libdetail.action.uninstall.title')
            }
          >
            {uninstalling
              ? t('libdetail.action.uninstalling')
              : t('libdetail.action.uninstall')}
          </GameDetailBtnDanger>
        </div>
      )}
    </>
  );
}

function SessionsPanel({
  recentSessions,
  isRunning,
}: {
  recentSessions: PlaySession[];
  isRunning: boolean;
}) {
  const { t } = useT();
  return (
    <>
      <h3 className="game-detail-section-title">{t('libdetail.manage.nav.sessions')}</h3>
      {recentSessions.length === 0 ? (
        <div className="game-detail-empty-hint">{t('libdetail.sessions.empty')}</div>
      ) : (
        <ul className="game-detail-session-list">
          {recentSessions.map((s) => (
            <li key={s.id} className="game-detail-session-row">
              <span className="game-detail-session-when">
                {new Date(s.startedAt).toLocaleString()}
              </span>
              <span className="game-detail-session-dur">
                {s.endedAt
                  ? formatPlaytime(s.durationSeconds ?? 0)
                  : isRunning
                    ? t('libdetail.sessions.running')
                    : t('libdetail.sessions.interrupted')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function TagsPanel({
  game,
  tagDraft,
  setTagDraft,
  onSubmitTag,
  onRemoveTag,
}: {
  game: LibraryGame;
  tagDraft: string;
  setTagDraft: (v: string) => void;
  onSubmitTag: () => void;
  onRemoveTag: (tag: string) => void;
}) {
  const { t } = useT();
  return (
    <>
      <h3 className="game-detail-section-title">{t('libdetail.manage.nav.tags')}</h3>
      <div className="game-detail-tags">
        {game.customTags.length === 0 && (
          <span className="game-detail-empty-hint">{t('libdetail.tags.empty')}</span>
        )}
        {game.customTags.map((tag) => (
          <span key={tag} className="game-detail-custom-tag">
            {tag}
            <button
              type="button"
              onClick={() => onRemoveTag(tag)}
              className="game-detail-tag-remove"
              aria-label={t('common.remove')}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="game-detail-tag-input-row">
        <input
          type="text"
          value={tagDraft}
          onChange={(e) => setTagDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSubmitTag();
          }}
          placeholder={t('libdetail.tags.input')}
          className="game-detail-tag-input"
        />
        <button type="button" onClick={onSubmitTag} className="game-detail-tag-add">
          {t('common.add')}
        </button>
      </div>
    </>
  );
}

function ToolsPanel({
  game,
  showSaveEditor,
  onRemove,
}: LibraryGameManageModalProps) {
  const { t } = useT();
  return (
    <>
      <h3 className="game-detail-section-title">{t('libdetail.manage.nav.tools')}</h3>
      <GameDetailActionList>
        {showSaveEditor && (
          <GameDetailActionItem to={`/library/game/${game.threadId}/saves`}>
            {t('libdetail.action.saveEditor')}
          </GameDetailActionItem>
        )}
        <GameDetailActionItem onClick={() => void onRemove()} danger>
          {t('libdetail.action.removeFromLibrary')}
        </GameDetailActionItem>
      </GameDetailActionList>
    </>
  );
}
