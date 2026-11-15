import {
  startTransition,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import DOMPurify from 'dompurify';
import { ChangelogEntryDialog } from '../game/ChangelogEntryDialog';
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
      {selectedIdx != null ? (
        <ChangelogEntryDialog
          entries={entries}
          selectedIdx={selectedIdx}
          onSelectIdx={setSelectedIdx}
          latestIdx={latestIdx}
          installedIdx={installedIdx}
        />
      ) : null}
    </div>
  );
}
