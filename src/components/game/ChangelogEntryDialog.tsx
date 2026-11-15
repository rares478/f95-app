import { useEffect, useLayoutEffect, useRef, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import DOMPurify from 'dompurify';
import { GameDescription } from './GameDescription';
import { snippetFromHtml } from '../../lib/gameChangelog/snippetFromHtml';
import type { GameChangelogEntry } from '../../lib/gameChangelog/types';
import { useT } from '../../lib/i18n';

const PURIFY = {
  ADD_TAGS: ['button'],
  ADD_ATTR: ['target', 'rel', 'loading', 'type', 'hidden'],
};

const BODY_STYLE: CSSProperties = {
  fontSize: 13.5,
  lineHeight: 1.65,
  wordBreak: 'break-word',
};

export type ChangelogEntryDialogProps = {
  entries: GameChangelogEntry[];
  selectedIdx: number;
  onSelectIdx: (idx: number | null) => void;
  /** Index shown with the red “Latest” badge; `-1` disables. */
  latestIdx?: number;
  /** Index shown with the “Installed” badge; `-1` disables. */
  installedIdx?: number;
};

/**
 * Version entry modal shared by library timeline and store game-page
 * “full changelog” — title, LATEST/Installed badge, body, NEWER/OLDER.
 */
export function ChangelogEntryDialog({
  entries,
  selectedIdx,
  onSelectIdx,
  latestIdx = -1,
  installedIdx = -1,
}: ChangelogEntryDialogProps) {
  const { t } = useT();
  const dialogBodyRef = useRef<HTMLDivElement>(null);
  const activeRailBtnRef = useRef<HTMLButtonElement>(null);
  const selected = entries[selectedIdx] ?? null;
  const showRail = entries.length > 1;

  useLayoutEffect(() => {
    dialogBodyRef.current?.scrollTo({ top: 0 });
  }, [selectedIdx]);

  useLayoutEffect(() => {
    activeRailBtnRef.current?.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
    });
  }, [selectedIdx]);

  useEffect(() => {
    if (!selected) return;
    const last = entries.length - 1;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onSelectIdx(null);
        return;
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        onSelectIdx(selectedIdx > 0 ? selectedIdx - 1 : selectedIdx);
        return;
      }
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        onSelectIdx(selectedIdx < last ? selectedIdx + 1 : selectedIdx);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, selectedIdx, entries.length, onSelectIdx]);

  if (!selected) return null;

  const badge =
    selectedIdx === installedIdx
      ? ('installed' as const)
      : selectedIdx === latestIdx
        ? ('latest' as const)
        : null;

  // Portal above game-detail stacking (More like this / discovery rails).
  return createPortal(
    <div
      className="app-dialog-overlay"
      role="presentation"
      onClick={() => onSelectIdx(null)}
    >
      <div
        className={
          showRail
            ? 'app-dialog library-changelog-entry-dialog library-changelog-entry-dialog--with-rail'
            : 'app-dialog library-changelog-entry-dialog'
        }
        role="dialog"
        aria-modal="true"
        aria-labelledby="changelog-entry-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="app-dialog-header">
          <div className="app-dialog-header-text">
            <h2 id="changelog-entry-title" className="app-dialog-title">
              {selected.title}
            </h2>
            <div className="library-changelog-entry-dialog-meta">
              {badge === 'installed' ? (
                <p className="library-changelog-entry-dialog-badge">
                  {t('libdetail.changelog.installed')}
                </p>
              ) : badge === 'latest' ? (
                <p className="library-changelog-entry-dialog-badge">
                  {t('libdetail.changelog.latest')}
                </p>
              ) : null}
              {showRail ? (
                <p
                  className="library-changelog-entry-dialog-count"
                  aria-live="polite"
                >
                  {t('libdetail.changelog.position', {
                    current: selectedIdx + 1,
                    total: entries.length,
                  })}
                </p>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            className="app-dialog-close"
            aria-label={t('common.close')}
            onClick={() => onSelectIdx(null)}
          >
            ×
          </button>
        </header>
        <div className="library-changelog-entry-dialog-main">
          {showRail ? (
            <nav
              className="library-changelog-entry-rail"
              aria-label={t('libdetail.section.changelog')}
            >
              {entries.map((entry, i) => {
                const active = i === selectedIdx;
                return (
                  <button
                    key={`${entry.title}-${i}`}
                    ref={active ? activeRailBtnRef : undefined}
                    type="button"
                    className={
                      active
                        ? 'library-changelog-entry-rail-item is-active'
                        : 'library-changelog-entry-rail-item'
                    }
                    aria-current={active ? 'true' : undefined}
                    onClick={() => onSelectIdx(i)}
                  >
                    <span className="library-changelog-entry-rail-dot" aria-hidden />
                    <span className="library-changelog-entry-rail-label">
                      {entry.title}
                    </span>
                  </button>
                );
              })}
            </nav>
          ) : null}
          <div
            ref={dialogBodyRef}
            className="library-changelog-entry-dialog-body"
          >
            {snippetFromHtml(selected.bodyHtml) ? (
              <GameDescription
                html={DOMPurify.sanitize(selected.bodyHtml, PURIFY)}
                className="libdetail-changelog-body"
                style={BODY_STYLE}
              />
            ) : (
              <p className="library-changelog-empty-notes">
                {t('libdetail.changelog.emptyNotes')}
              </p>
            )}
          </div>
        </div>
        {showRail ? (
          <footer className="library-changelog-entry-nav">
            <button
              type="button"
              className="library-changelog-entry-nav-btn"
              disabled={selectedIdx <= 0}
              onClick={() => onSelectIdx(selectedIdx - 1)}
            >
              <span className="library-changelog-entry-nav-dir">
                {t('libdetail.changelog.newer')}
              </span>
              {selectedIdx > 0 ? (
                <span className="library-changelog-entry-nav-title">
                  {entries[selectedIdx - 1]!.title}
                </span>
              ) : null}
            </button>
            <button
              type="button"
              className="library-changelog-entry-nav-btn library-changelog-entry-nav-btn--next"
              disabled={selectedIdx >= entries.length - 1}
              onClick={() => onSelectIdx(selectedIdx + 1)}
            >
              <span className="library-changelog-entry-nav-dir">
                {t('libdetail.changelog.older')}
              </span>
              {selectedIdx < entries.length - 1 ? (
                <span className="library-changelog-entry-nav-title">
                  {entries[selectedIdx + 1]!.title}
                </span>
              ) : null}
            </button>
          </footer>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
