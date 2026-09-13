import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import DOMPurify from 'dompurify';
import { GameDescription } from '../game/GameDescription';
import { parseChangelogHtml } from '../../lib/gameChangelog/parseChangelogHtml';
import { matchInstalledVersion } from '../../lib/gameChangelog/matchInstalledVersion';
import { snippetFromHtml } from '../../lib/gameChangelog/snippetFromHtml';
import { unwrapChangelogSpoilers } from '../../lib/gameChangelog/unwrapChangelogSpoilers';
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

/**
 * Steam-style changelog timeline for library game detail.
 * Falls back to a single sanitized blob when parsing is not confident.
 * Installed games: highlight the matched version with an Installed chip.
 * Not installed: highlight the newest entry as Latest (no Installed label).
 */
export function LibraryChangelogTimeline({
  html,
  currentVersion,
  isInstalled,
  onParsed,
}: {
  html: string;
  currentVersion: string | null;
  isInstalled: boolean;
  /** Fires after parse + layout so callers can defer below-fold fetches. */
  onParsed?: () => void;
}) {
  const { t } = useT();
  const flatHtml = useMemo(() => unwrapChangelogSpoilers(html), [html]);
  const parsed = useMemo(() => parseChangelogHtml(flatHtml), [flatHtml]);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const dialogBodyRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    onParsed?.();
  }, [parsed, onParsed]);

  useLayoutEffect(() => {
    if (selectedIdx == null) return;
    dialogBodyRef.current?.scrollTo({ top: 0 });
  }, [selectedIdx]);

  useEffect(() => {
    if (selectedIdx == null || !parsed.ok) return;
    const last = parsed.entries.length - 1;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        setSelectedIdx(null);
        return;
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIdx((i) => (i != null && i > 0 ? i - 1 : i));
        return;
      }
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIdx((i) => (i != null && i < last ? i + 1 : i));
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedIdx, parsed]);

  if (!parsed.ok) {
    return (
      <GameDescription
        html={DOMPurify.sanitize(flatHtml, PURIFY)}
        className="libdetail-changelog-body"
        style={BODY_STYLE}
      />
    );
  }

  const installedIdx = isInstalled
    ? matchInstalledVersion(parsed.entries, currentVersion)
    : -1;
  const latestIdx = !isInstalled && parsed.entries.length > 0 ? 0 : -1;
  const selected =
    selectedIdx != null ? parsed.entries[selectedIdx] ?? null : null;
  const selectedBadge =
    selectedIdx != null && selectedIdx === installedIdx
      ? ('installed' as const)
      : selectedIdx != null && selectedIdx === latestIdx
        ? ('latest' as const)
        : null;

  return (
    <div className="library-changelog-timeline">
      {parsed.preambleHtml.trim() ? (
        <GameDescription
          html={DOMPurify.sanitize(parsed.preambleHtml, PURIFY)}
          className="library-changelog-preamble libdetail-changelog-body"
          style={BODY_STYLE}
        />
      ) : null}
      {parsed.entries.map((entry, i) => {
        const installed = i === installedIdx;
        const latest = i === latestIdx;
        const featured = installed || latest;
        const snippet = snippetFromHtml(entry.bodyHtml);
        const emptyNotes = !snippet;
        return (
          <button
            key={`${entry.title}-${i}`}
            type="button"
            className={
              featured
                ? 'library-changelog-card library-changelog-card--featured'
                : 'library-changelog-card'
            }
            onClick={() => setSelectedIdx(i)}
          >
            <span className="library-changelog-card-label">
              {t('libdetail.changelog.updateLabel')}
            </span>
            <span className="library-changelog-card-title-row">
              <span className="library-changelog-card-title">{entry.title}</span>
              {installed ? (
                <span className="library-changelog-badge">
                  {t('libdetail.changelog.installed')}
                </span>
              ) : latest ? (
                <span className="library-changelog-badge">
                  {t('libdetail.changelog.latest')}
                </span>
              ) : null}
            </span>
            <span
              className={
                emptyNotes
                  ? 'library-changelog-card-snippet library-changelog-card-snippet--empty'
                  : 'library-changelog-card-snippet'
              }
            >
              {emptyNotes ? t('libdetail.changelog.emptyNotes') : snippet}
            </span>
          </button>
        );
      })}
      {selected ? (
        <div
          className="app-dialog-overlay"
          role="presentation"
          onClick={() => setSelectedIdx(null)}
        >
          <div
            className="app-dialog library-changelog-entry-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="library-changelog-entry-title"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="app-dialog-header">
              <div className="app-dialog-header-text">
                <h2
                  id="library-changelog-entry-title"
                  className="app-dialog-title"
                >
                  {selected.title}
                </h2>
                {selectedBadge === 'installed' ? (
                  <p className="library-changelog-entry-dialog-badge">
                    {t('libdetail.changelog.installed')}
                  </p>
                ) : selectedBadge === 'latest' ? (
                  <p className="library-changelog-entry-dialog-badge">
                    {t('libdetail.changelog.latest')}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                className="app-dialog-close"
                aria-label={t('common.close')}
                onClick={() => setSelectedIdx(null)}
              >
                ×
              </button>
            </header>
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
            {selectedIdx != null && parsed.entries.length > 1 ? (
              <footer className="library-changelog-entry-nav">
                <button
                  type="button"
                  className="library-changelog-entry-nav-btn"
                  disabled={selectedIdx <= 0}
                  onClick={() => setSelectedIdx(selectedIdx - 1)}
                >
                  <span className="library-changelog-entry-nav-dir">
                    {t('libdetail.changelog.newer')}
                  </span>
                  {selectedIdx > 0 ? (
                    <span className="library-changelog-entry-nav-title">
                      {parsed.entries[selectedIdx - 1].title}
                    </span>
                  ) : null}
                </button>
                <button
                  type="button"
                  className="library-changelog-entry-nav-btn library-changelog-entry-nav-btn--next"
                  disabled={selectedIdx >= parsed.entries.length - 1}
                  onClick={() => setSelectedIdx(selectedIdx + 1)}
                >
                  <span className="library-changelog-entry-nav-dir">
                    {t('libdetail.changelog.older')}
                  </span>
                  {selectedIdx < parsed.entries.length - 1 ? (
                    <span className="library-changelog-entry-nav-title">
                      {parsed.entries[selectedIdx + 1].title}
                    </span>
                  ) : null}
                </button>
              </footer>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
