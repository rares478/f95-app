import { useMemo, type CSSProperties } from 'react';
import DOMPurify from 'dompurify';
import { GameDescription } from '../game/GameDescription';
import { parseChangelogHtml } from '../../lib/gameChangelog/parseChangelogHtml';
import { matchInstalledVersion } from '../../lib/gameChangelog/matchInstalledVersion';
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
        return (
          <article
            key={`${entry.title}-${i}`}
            className={
              installed
                ? 'library-changelog-entry library-changelog-entry--installed'
                : 'library-changelog-entry'
            }
          >
            <header className="library-changelog-entry-head">
              <h4 className="library-changelog-entry-title">{entry.title}</h4>
              {installed ? (
                <span className="library-changelog-installed">
                  {t('libdetail.changelog.installed')}
                </span>
              ) : null}
            </header>
            {entry.bodyHtml.trim() ? (
              <GameDescription
                html={DOMPurify.sanitize(entry.bodyHtml, PURIFY)}
                className="library-changelog-entry-body libdetail-changelog-body"
                style={BODY_STYLE}
              />
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
