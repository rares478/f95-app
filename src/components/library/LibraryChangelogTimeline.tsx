import { useMemo, useState, type CSSProperties } from 'react';
import DOMPurify from 'dompurify';
import { GameDescription } from '../game/GameDescription';
import { parseChangelogHtml } from '../../lib/gameChangelog/parseChangelogHtml';
import { matchInstalledVersion } from '../../lib/gameChangelog/matchInstalledVersion';
import { snippetFromHtml } from '../../lib/gameChangelog/snippetFromHtml';
import { useT } from '../../lib/i18n';

const PURIFY = {
  ADD_TAGS: ['details', 'summary', 'button'],
  ADD_ATTR: ['target', 'rel', 'loading', 'type', 'hidden'],
} as const;

const BODY_STYLE: CSSProperties = {
  fontSize: 13.5,
  lineHeight: 1.65,
  wordBreak: 'break-word',
};

/**
 * Steam-style changelog timeline for library game detail.
 * Falls back to a single sanitized blob when parsing is not confident.
 * Highlights the installed version when it fuzzy-matches an entry (no auto-scroll).
 */
export function LibraryChangelogTimeline({
  html,
  currentVersion,
}: {
  html: string;
  currentVersion: string | null;
}) {
  const { t } = useT();
  const parsed = useMemo(() => parseChangelogHtml(html), [html]);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  if (!parsed.ok) {
    return (
      <GameDescription
        html={DOMPurify.sanitize(html, PURIFY)}
        className="libdetail-changelog-body"
        style={BODY_STYLE}
      />
    );
  }

  const installedIdx = matchInstalledVersion(parsed.entries, currentVersion);
  const selected =
    selectedIdx != null ? parsed.entries[selectedIdx] ?? null : null;
  const selectedInstalled =
    selectedIdx != null && selectedIdx === installedIdx;

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
        const snippet = snippetFromHtml(entry.bodyHtml);
        return (
          <button
            key={`${entry.title}-${i}`}
            type="button"
            className={
              installed
                ? 'library-changelog-card library-changelog-card--installed'
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
                <span className="library-changelog-installed">
                  {t('libdetail.changelog.installed')}
                </span>
              ) : null}
            </span>
            {snippet ? (
              <span className="library-changelog-card-snippet">{snippet}</span>
            ) : null}
          </button>
        );
      })}
      {/* Task 3: modal when selected != null */}
      {selected ? null : null}
      {selectedInstalled ? null : null}
    </div>
  );
}
