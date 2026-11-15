import {
  startTransition,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import DOMPurify from 'dompurify';
import { GameDescription } from '../game/GameDescription';
import { parseChangelogHtmlChunked } from '../../lib/gameChangelog/parseChangelogHtml';
import { matchInstalledVersion } from '../../lib/gameChangelog/matchInstalledVersion';
import { snippetFromHtml } from '../../lib/gameChangelog/snippetFromHtml';
import { unwrapChangelogSpoilers } from '../../lib/gameChangelog/unwrapChangelogSpoilers';
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

type Phase = 'parsing' | 'ok' | 'fallback';

/**
 * Steam-style changelog timeline for library game detail.
 * Parses in idle chunks so cards paint as versions are discovered; callers
 * should keep discussion lazy until `onParsed` (full parse finished).
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
  /** Fires after the full parse finishes (ok or fallback). */
  onParsed?: () => void;
}) {
  const { t } = useT();
  const [phase, setPhase] = useState<Phase>('parsing');
  const [flatHtml, setFlatHtml] = useState('');
  const [preambleHtml, setPreambleHtml] = useState('');
  const [entries, setEntries] = useState<GameChangelogEntry[]>([]);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const dialogBodyRef = useRef<HTMLDivElement>(null);
  const onParsedRef = useRef(onParsed);
  onParsedRef.current = onParsed;

  useEffect(() => {
    const ac = new AbortController();
    setPhase('parsing');
    setEntries([]);
    setPreambleHtml('');
    setSelectedIdx(null);

    const flat = unwrapChangelogSpoilers(html);
    setFlatHtml(flat);

    void parseChangelogHtmlChunked(flat, {
      signal: ac.signal,
      segmentsPerChunk: 40,
      onProgress: ({ entries: next }) => {
        startTransition(() => {
          setEntries(next.map((e) => ({ ...e })));
        });
      },
    })
      .then((result) => {
        if (ac.signal.aborted) return;
        if (!result.ok) {
          setPhase('fallback');
          setEntries([]);
          setPreambleHtml('');
          return;
        }
        setPreambleHtml(result.preambleHtml);
        setEntries(result.entries);
        setPhase('ok');
      })
      .catch((err: unknown) => {
        if (ac.signal.aborted) return;
        if (err instanceof Error && err.name === 'AbortError') return;
        setPhase('fallback');
        setEntries([]);
        setPreambleHtml('');
      });

    return () => {
      ac.abort();
    };
  }, [html]);

  useLayoutEffect(() => {
    if (phase === 'parsing') return;
    onParsedRef.current?.();
  }, [phase]);

  useLayoutEffect(() => {
    if (selectedIdx == null) return;
    dialogBodyRef.current?.scrollTo({ top: 0 });
  }, [selectedIdx]);

  useEffect(() => {
    if (selectedIdx == null || phase !== 'ok') return;
    const last = entries.length - 1;
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
  }, [selectedIdx, phase, entries.length]);

  if (phase === 'fallback') {
    return (
      <GameDescription
        html={DOMPurify.sanitize(flatHtml, PURIFY)}
        className="libdetail-changelog-body"
        style={BODY_STYLE}
      />
    );
  }

  const showTimeline = entries.length >= 2;
  if (!showTimeline) {
    return (
      <p className="library-changelog-loading" aria-live="polite">
        {t('libdetail.changelog.loading')}
      </p>
    );
  }

  const installedIdx = isInstalled
    ? matchInstalledVersion(entries, currentVersion)
    : -1;
  const latestIdx = !isInstalled && entries.length > 0 ? 0 : -1;
  const selected =
    selectedIdx != null ? entries[selectedIdx] ?? null : null;
  const selectedBadge =
    selectedIdx != null && selectedIdx === installedIdx
      ? ('installed' as const)
      : selectedIdx != null && selectedIdx === latestIdx
        ? ('latest' as const)
        : null;

  return (
    <div className="library-changelog-timeline">
      {preambleHtml.trim() ? (
        <GameDescription
          html={DOMPurify.sanitize(preambleHtml, PURIFY)}
          className="library-changelog-preamble libdetail-changelog-body"
          style={BODY_STYLE}
        />
      ) : null}
      {entries.map((entry, i) => {
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
      {phase === 'parsing' ? (
        <p className="library-changelog-loading" aria-live="polite">
          {t('libdetail.changelog.loadingMore')}
        </p>
      ) : null}
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
            {selectedIdx != null && entries.length > 1 ? (
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
                      {entries[selectedIdx - 1].title}
                    </span>
                  ) : null}
                </button>
                <button
                  type="button"
                  className="library-changelog-entry-nav-btn library-changelog-entry-nav-btn--next"
                  disabled={selectedIdx >= entries.length - 1}
                  onClick={() => setSelectedIdx(selectedIdx + 1)}
                >
                  <span className="library-changelog-entry-nav-dir">
                    {t('libdetail.changelog.older')}
                  </span>
                  {selectedIdx < entries.length - 1 ? (
                    <span className="library-changelog-entry-nav-title">
                      {entries[selectedIdx + 1].title}
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
