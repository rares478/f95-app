import { useCallback, useEffect, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import { openUrl } from '@tauri-apps/plugin-opener';
import { GameDescription } from './GameDescription';
import { UserChip } from '../UserChip';
import { threadReviews } from '../../lib/ipc';
import { formatIpcError } from '../../lib/ipcError';
import { formatRelativeDate } from '../../lib/formatDate';
import { useOffline } from '../../contexts/Offline';
import { useT } from '../../lib/i18n';
import type {
  ReviewCard,
  ReviewCurrentGroup,
  ReviewHighlight,
  ReviewOlderFold,
  ReviewScoreLine,
  ReviewSort,
  ReviewStats,
  ThreadReviewsPage,
  ThreadReviewsQuery,
} from '../../types/threadReviews';
import '../../styles/game-reviews.css';

const BODY_CLAMP_LINES = 15;
const SORTS: ReviewSort[] = [
  'latest',
  'helpful',
  'newest',
  'oldest',
  'highest',
  'lowest',
];

interface Props {
  threadId: string;
}

function sanitizeReviewHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ADD_TAGS: ['details', 'summary', 'button'],
    ADD_ATTR: ['target', 'rel', 'loading', 'type', 'hidden'],
  });
}

function reviewsFallbackUrl(threadId: string): string {
  return `https://f95zone.to/threads/${threadId}/reviews/`;
}

function formatScore(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** Map ★ average (1–5) onto the padded plot (keeps 5★ dots inside the frame). */
function monthlyAverageTopPct(average: number): number {
  const clamped = Math.max(1, Math.min(5, average));
  // 8% inset top/bottom so markers at 5★ / 1★ are not clipped.
  return 8 + ((5 - clamped) / 4) * 84;
}

function splitMonthLabel(label: string): { month: string; year: string | null } {
  const parts = label.trim().split(/\s+/);
  if (parts.length >= 2 && /^\d{4}$/.test(parts[parts.length - 1]!)) {
    return {
      month: parts.slice(0, -1).join(' '),
      year: parts[parts.length - 1]!,
    };
  }
  return { month: label, year: null };
}

function PerMonthBars({ rows }: { rows: ReviewStats['perMonth'] }) {
  const { t } = useT();
  const maxCount = Math.max(
    1,
    ...rows.map((r) => Math.max(r.positive, r.negative)),
  );
  const barMaxPx = 56;

  return (
    <div className="game-reviews-per-month">
      <div className="game-reviews-per-month-key">
        <span className="game-reviews-per-month-key-up">
          {t('gamedetail.reviews.perMonthKeyUp')}
        </span>
        <span className="game-reviews-per-month-key-down">
          {t('gamedetail.reviews.perMonthKeyDown')}
        </span>
      </div>
      <div className="game-reviews-per-month-bars" role="group" aria-label="Per month">
        {rows.map((row) => {
          const { month, year } = splitMonthLabel(row.label);
          const upH = Math.round((row.positive / maxCount) * barMaxPx);
          const downH = Math.round((row.negative / maxCount) * barMaxPx);
          const tip = `${row.label}: ${row.positive} positive, ${row.negative} negative, ${row.inBetween} in between`;
          return (
            <span
              key={row.label}
              className="game-reviews-pm"
              tabIndex={0}
              title={tip}
              aria-label={tip}
            >
              <span className="game-reviews-pm-up">
                <span style={{ height: `${upH}px` }} />
              </span>
              <span className="game-reviews-pm-axis" />
              <span className="game-reviews-pm-down">
                <span style={{ height: `${downH}px` }} />
              </span>
              <span className="game-reviews-pm-label" aria-hidden="true">
                <span>{month}</span>
                {year ? <span>{year}</span> : null}
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

function ReviewBody({ html }: { html: string }) {
  const { t } = useT();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [needsClamp, setNeedsClamp] = useState(false);

  useEffect(() => {
    setExpanded(false);
    const el = wrapRef.current;
    if (!el) return;
    const lineHeight = Number.parseFloat(getComputedStyle(el).lineHeight) || 22;
    const limit = lineHeight * BODY_CLAMP_LINES;
    setNeedsClamp(el.scrollHeight > limit + 4);
  }, [html]);

  return (
    <div className="game-review-body-wrap">
      <div
        ref={wrapRef}
        className={
          needsClamp && !expanded
            ? 'game-review-body game-review-body--clamped'
            : 'game-review-body'
        }
        style={
          needsClamp && !expanded
            ? { maxHeight: `calc(1.5em * ${BODY_CLAMP_LINES})` }
            : undefined
        }
      >
        <GameDescription html={sanitizeReviewHtml(html)} className="game-review-body-html" />
      </div>
      {needsClamp && (
        <button
          type="button"
          className="game-reviews-link-btn"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? t('gamedetail.reviews.showLess') : t('gamedetail.reviews.readMore')}
        </button>
      )}
    </div>
  );
}

function ReviewCardItem({
  review,
  locale,
}: {
  review: ReviewCard;
  locale: string;
}) {
  const { t } = useT();
  const dateLabel =
    formatRelativeDate(review.postedAt, locale) ?? review.postedAt ?? '';

  return (
    <li id={`review-${review.reviewId}`} className="game-review-card">
      <div className="game-review-card-aside">
        <UserChip
          userId={review.authorUserId}
          username={review.author}
          avatarUrl={review.authorAvatarUrl}
          className="game-review-user"
          size={40}
        />
        {review.authorRecordLabel ? (
          <div className="game-review-author-record">{review.authorRecordLabel}</div>
        ) : null}
      </div>
      <div className="game-review-card-main">
        <div className="game-review-card-header">
          <div className="game-review-card-meta">
            {review.rating != null && (
              <span className="game-review-rating" title={`${formatScore(review.rating)}/5`}>
                {formatScore(review.rating)}★
              </span>
            )}
            {review.versionLabel ? (
              <span className="game-review-version-pill">{review.versionLabel}</span>
            ) : null}
            {review.isOlderVersion ? (
              <span className="game-review-older-tag">
                {t('gamedetail.reviews.olderVersionTag')}
              </span>
            ) : null}
            {review.platformLabel ? (
              <span className="game-review-platform">{review.platformLabel}</span>
            ) : null}
            {review.modsLabel ? (
              <span className="game-review-mods">{review.modsLabel}</span>
            ) : null}
            {dateLabel ? <span className="game-review-date">{dateLabel}</span> : null}
            {review.edited ? (
              <span className="game-review-edited">{t('gamedetail.reviews.edited')}</span>
            ) : null}
          </div>
          {review.permalink ? (
            <button
              type="button"
              className="game-reviews-link-btn"
              onClick={() => void openUrl(review.permalink!)}
            >
              {t('gamedetail.reviews.openOnF95')}
            </button>
          ) : null}
        </div>

        {review.parts.length > 0 && (
          <ul className="game-review-parts">
            {review.parts.map((p) => (
              <li key={p.label} className="game-review-part">
                <span className="game-review-part-label">{p.label}</span>
                <span className="game-review-part-score">{formatScore(p.score)}</span>
              </li>
            ))}
          </ul>
        )}

        <ReviewBody html={review.bodyHtml} />

        {(review.helpfulYes != null || review.helpfulNo != null) && (
          <div className="game-review-helpful" aria-disabled="true">
            <span className="game-review-helpful-label">{t('gamedetail.reviews.helpful')}</span>
            <span className="game-review-helpful-count">
              {t('gamedetail.reviews.helpfulYes', {
                count: String(review.helpfulYes ?? 0),
              })}
            </span>
            <span className="game-review-helpful-count">
              {t('gamedetail.reviews.helpfulNo', {
                count: String(review.helpfulNo ?? 0),
              })}
            </span>
          </div>
        )}
      </div>
    </li>
  );
}

function ScoreLines({
  lines,
  filters,
  onSelect,
}: {
  lines: ReviewScoreLine[];
  filters: ThreadReviewsPage['filters'];
  onSelect: (line: ReviewScoreLine) => void;
}) {
  if (lines.length === 0) return null;
  return (
    <div className="game-reviews-score-lines" role="group">
      {lines.map((line) => {
        const active =
          line.active ||
          (line.recent && filters.recent) ||
          (!!line.versionId && filters.version === line.versionId);
        return (
          <button
            key={line.key}
            type="button"
            className={
              active
                ? 'game-reviews-score-line game-reviews-score-line--active'
                : 'game-reviews-score-line'
            }
            aria-pressed={active}
            title={line.href ?? undefined}
            onClick={() => onSelect(line)}
          >
            <span>{line.label}</span>
            {line.score != null ? <strong>{formatScore(line.score)} ★</strong> : null}
          </button>
        );
      })}
    </div>
  );
}

function StatsPanel({
  stats,
  filters,
  onStars,
  onMention,
  onScoreLine,
}: {
  stats: ReviewStats;
  filters: ThreadReviewsPage['filters'];
  onStars: (stars: 1 | 2 | 3 | 4 | 5 | undefined) => void;
  onMention: (mention: string | undefined) => void;
  onScoreLine: (line: ReviewScoreLine) => void;
}) {
  const { t } = useT();
  const [showPerMonth, setShowPerMonth] = useState(false);

  return (
    <section className="game-reviews-stats" aria-label={t('gamedetail.section.reviews')}>
      <div className="game-reviews-stats-main">
        <div className="game-reviews-stats-score">
          <span className="game-reviews-average">
            {formatScore(stats.average)}
            <span className="game-reviews-outOf">{t('gamedetail.reviews.outOf5')}</span>
          </span>
          {stats.countLabel ? (
            <span className="game-reviews-count-label">{stats.countLabel}</span>
          ) : stats.count != null ? (
            <span className="game-reviews-count-label">{stats.count}</span>
          ) : null}
          <ScoreLines
            lines={stats.scoreLines ?? []}
            filters={filters}
            onSelect={onScoreLine}
          />
        </div>

        {stats.starBars.length > 0 && (
          <div className="game-reviews-dist">
            <span className="game-reviews-stats-title">{t('gamedetail.reviews.starsTitle')}</span>
            <div className="game-reviews-bars">
              {[...stats.starBars]
                .sort((a, b) => b.stars - a.stars)
                .map((bar) => {
                  const stars = bar.stars as 1 | 2 | 3 | 4 | 5;
                  const active = filters.stars === bar.stars;
                  return (
                    <button
                      key={bar.stars}
                      type="button"
                      className={
                        active
                          ? 'game-reviews-bar game-reviews-bar--active'
                          : 'game-reviews-bar'
                      }
                      title={`${bar.count} (${bar.percent}%)`}
                      aria-pressed={active}
                      onClick={() => onStars(active ? undefined : stars)}
                    >
                      <span className="game-reviews-bar-label">{bar.stars}★</span>
                      <span className="game-reviews-bar-track">
                        <span
                          className="game-reviews-bar-fill"
                          style={{ width: `${Math.max(0, Math.min(100, bar.percent))}%` }}
                        />
                      </span>
                      <span className="game-reviews-bar-value">{bar.count}</span>
                    </button>
                  );
                })}
            </div>
          </div>
        )}

        {stats.parts.length > 0 && (
          <div className="game-reviews-parts-avg">
            <span className="game-reviews-stats-title">{t('gamedetail.reviews.partsTitle')}</span>
            <ul className="game-reviews-parts-list">
              {stats.parts.map((p) => {
                const pct = Math.max(
                  0,
                  Math.min(100, (p.average / 5) * 100),
                );
                return (
                  <li
                    key={p.label}
                    className="game-reviews-parts-item"
                    title={p.countHint ?? undefined}
                  >
                    <span className="game-reviews-parts-item-label">{p.label}</span>
                    <span className="game-reviews-parts-item-track">
                      <span
                        className="game-reviews-parts-item-fill"
                        style={{ width: `${pct}%` }}
                      />
                    </span>
                    <span className="game-reviews-parts-item-avg">
                      {formatScore(p.average)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      {stats.mentions.length > 0 && (
        <div className="game-reviews-mentions">
          <span className="game-reviews-mentions-label">
            {t('gamedetail.reviews.mentionsLabel')}
          </span>
          <div className="game-reviews-pills">
            {stats.mentions.map((m) => {
              const active = filters.mention === m.key;
              return (
                <button
                  key={m.key}
                  type="button"
                  className={
                    active
                      ? 'game-reviews-pill game-reviews-pill--active'
                      : 'game-reviews-pill'
                  }
                  aria-pressed={active}
                  onClick={() => onMention(active ? undefined : m.key)}
                >
                  {m.label}
                  <span className="game-reviews-pill-count">{m.count}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
      {stats.monthlyAverage.length > 0 && (
        <div className="game-reviews-chart">
          <div className="game-reviews-chart-head">
            <span className="game-reviews-stats-title">{t('gamedetail.reviews.chartTitle')}</span>
            {stats.perMonth.length > 0 && (
              <button
                type="button"
                className="game-reviews-link-btn"
                onClick={() => setShowPerMonth((v) => !v)}
              >
                {showPerMonth
                  ? t('gamedetail.reviews.perMonthHide')
                  : t('gamedetail.reviews.perMonthShow')}
              </button>
            )}
          </div>
          <div className="game-reviews-chart-plot" aria-hidden={false}>
            <div className="game-reviews-chart-y">
              <span>5</span>
              <span>4</span>
              <span>3</span>
              <span>2</span>
              <span>1</span>
            </div>
            <div className="game-reviews-chart-area">
              {(stats.releases ?? []).map((rel, idx) => (
                <span
                  key={`release-${idx}-${rel.leftPct}`}
                  className="game-reviews-chart-release"
                  style={{ left: `${rel.leftPct}%` }}
                  title={rel.label}
                  aria-label={rel.label}
                  tabIndex={0}
                >
                  <span className="game-reviews-chart-release-mark" aria-hidden="true" />
                </span>
              ))}
              {stats.monthlyAverage.map((pt) => {
                const left = pt.leftPct + pt.widthPct / 2;
                const top = monthlyAverageTopPct(pt.average);
                return (
                  <span
                    key={pt.label}
                    className="game-reviews-chart-dot"
                    style={{ left: `${left}%`, top: `${top}%` }}
                    title={`${pt.label}: ${formatScore(pt.average)}★ (${pt.reviewCount})`}
                  />
                );
              })}
              {stats.monthlyAverage.length > 1 && (
                <svg className="game-reviews-chart-line" viewBox="0 0 100 100" preserveAspectRatio="none">
                  <polyline
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.25"
                    vectorEffect="non-scaling-stroke"
                    points={stats.monthlyAverage
                      .map((pt) => {
                        const x = pt.leftPct + pt.widthPct / 2;
                        const y = monthlyAverageTopPct(pt.average);
                        return `${x},${y}`;
                      })
                      .join(' ')}
                  />
                </svg>
              )}
            </div>
          </div>
          <div className="game-reviews-chart-key">
            <span className="game-reviews-chart-key-item">
              {t('gamedetail.reviews.chartKeyRelease')}
            </span>
          </div>

          {showPerMonth && stats.perMonth.length > 0 && (
            <PerMonthBars rows={stats.perMonth} />
          )}
        </div>
      )}
    </section>
  );
}

function CurrentGroupHead({ group }: { group: ReviewCurrentGroup }) {
  return (
    <div className="game-reviews-group-head">
      <span className="game-reviews-group-kind">{group.kind}</span>
      {group.name ? <strong className="game-reviews-group-name">{group.name}</strong> : null}
      {group.line ? <span className="game-reviews-group-line">{group.line}</span> : null}
    </div>
  );
}

function OlderFolds({
  folds,
  threadId,
  locale,
  disabled,
  onShowAll,
}: {
  folds: ReviewOlderFold[];
  threadId: string;
  locale: string;
  disabled?: boolean;
  onShowAll: (fold: ReviewOlderFold) => void;
}) {
  const { t } = useT();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [foldReviews, setFoldReviews] = useState<Record<string, ReviewCard[]>>({});
  const [foldLoading, setFoldLoading] = useState<string | null>(null);
  const [foldError, setFoldError] = useState<Record<string, string>>({});
  const fetchGen = useRef(0);

  if (folds.length === 0) return null;

  const toggleFold = async (fold: ReviewOlderFold) => {
    if (!fold.versionId || disabled) return;
    const key = fold.versionId;
    if (expandedId === key) {
      setExpandedId(null);
      return;
    }
    setExpandedId(key);
    if (foldReviews[key]) return;

    const gen = ++fetchGen.current;
    setFoldLoading(key);
    setFoldError((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    try {
      // Match F95 fold: load most-helpful reviews for that version inline.
      const page = await threadReviews(threadId, {
        page: 1,
        version: key,
        sort: 'helpful',
      });
      if (gen !== fetchGen.current) return;
      setFoldReviews((prev) => ({ ...prev, [key]: page.reviews }));
    } catch (err) {
      if (gen !== fetchGen.current) return;
      setFoldError((prev) => ({ ...prev, [key]: formatIpcError(err) }));
    } finally {
      if (gen === fetchGen.current) setFoldLoading(null);
    }
  };

  return (
    <div className="game-reviews-older" id="game-reviews-older">
      <div className="game-reviews-group-head">
        <span className="game-reviews-group-kind">{t('gamedetail.reviews.olderVersions')}</span>
      </div>
      <ul className="game-reviews-folds">
        {folds.map((fold) => {
          const key = fold.versionId ?? `x-${fold.name}`;
          const open = expandedId === fold.versionId;
          const loading = foldLoading === fold.versionId;
          const reviews = fold.versionId ? foldReviews[fold.versionId] : undefined;
          const err = fold.versionId ? foldError[fold.versionId] : undefined;
          return (
            <li key={key} className={open ? 'game-reviews-fold is-open' : 'game-reviews-fold'}>
              <button
                type="button"
                className="game-reviews-fold-row"
                disabled={disabled || !fold.versionId || loading}
                aria-expanded={open}
                onClick={() => void toggleFold(fold)}
              >
                <strong className="game-reviews-fold-name">{fold.name}</strong>
                {fold.dateLabel ? (
                  <span className="game-reviews-fold-date">{fold.dateLabel}</span>
                ) : null}
                {fold.statLabel ? (
                  <span className="game-reviews-fold-stat">{fold.statLabel}</span>
                ) : null}
                <span className="game-reviews-fold-action">
                  {open
                    ? t('gamedetail.reviews.foldHide')
                    : t('gamedetail.reviews.foldShow')}
                </span>
              </button>
              {open && (
                <div className="game-reviews-fold-body">
                  {loading && (
                    <div className="game-reviews-status game-reviews-status--muted">
                      {t('gamedetail.reviews.loading')}
                    </div>
                  )}
                  {err && (
                    <div className="game-reviews-status game-reviews-status--error">{err}</div>
                  )}
                  {!loading && !err && reviews && reviews.length === 0 && (
                    <div className="game-reviews-status game-reviews-status--muted">
                      {t('gamedetail.reviews.empty')}
                    </div>
                  )}
                  {!loading && reviews && reviews.length > 0 && (
                    <ul className="game-reviews-list game-reviews-list--fold">
                      {reviews.map((review) => (
                        <ReviewCardItem
                          key={review.reviewId}
                          review={review}
                          locale={locale}
                        />
                      ))}
                    </ul>
                  )}
                  {!loading && fold.versionId && (
                    <div className="game-reviews-fold-footer">
                      <button
                        type="button"
                        className="game-reviews-fold-all-btn"
                        disabled={disabled}
                        onClick={() => onShowAll(fold)}
                      >
                        {t('gamedetail.reviews.foldShowAll', { version: fold.name })}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Lazy read-only F95 Reviews section for the store game page. */
export function GameReviews({ threadId }: Props) {
  const { t, locale } = useT();
  const { isOffline } = useOffline();
  const sentinelRef = useRef<HTMLDivElement>(null);
  const fetchGen = useRef(0);
  const pendingScrollReviewId = useRef<string | null>(null);

  const [visible, setVisible] = useState(false);
  const [query, setQuery] = useState<ThreadReviewsQuery>({ page: 1 });
  const [data, setData] = useState<ThreadReviewsPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Keep mention pills available after a filtered page omits them. */
  const mentionsCacheRef = useRef<ReviewStats['mentions']>([]);
  /** Keep version options when a filtered page drops fold-only entries (e.g. none). */
  const versionsCacheRef = useRef<ThreadReviewsPage['versions']>([]);
  const queryRef = useRef(query);
  queryRef.current = query;

  useEffect(() => {
    if (data?.stats?.mentions && data.stats.mentions.length > 0) {
      mentionsCacheRef.current = data.stats.mentions;
    }
    if (data?.versions && data.versions.length > 0) {
      const byId = new Map(
        versionsCacheRef.current.filter((v) => v.id).map((v) => [v.id!, v]),
      );
      for (const v of data.versions) {
        if (v.id) byId.set(v.id, v);
      }
      versionsCacheRef.current = [
        ...data.versions.filter((v) => !v.id),
        ...byId.values(),
      ];
    }
  }, [data]);

  const openUrlForSection = data?.reviewsUrl || reviewsFallbackUrl(threadId);

  const load = useCallback(
    async (q: ThreadReviewsQuery) => {
      const gen = ++fetchGen.current;
      setLoading(true);
      setError(null);
      try {
        const result = await threadReviews(threadId, q);
        if (gen !== fetchGen.current) return;
        setData(result);
        // Prefer the requested filters so the toolbar (esp. version select)
        // stays in sync even if the HTML echo is incomplete.
        const synced: ThreadReviewsQuery = {
          page: result.page,
          sort:
            (SORTS.includes(result.sort as ReviewSort)
              ? (result.sort as ReviewSort)
              : q.sort) ?? 'latest',
        };
        const stars = q.stars ?? result.filters.stars ?? undefined;
        if (stars != null) synced.stars = stars as 1 | 2 | 3 | 4 | 5;
        const mention = q.mention ?? result.filters.mention ?? undefined;
        if (mention) synced.mention = mention;
        const version = q.version ?? result.filters.version ?? undefined;
        if (version) synced.version = version;
        if (q.recent || result.filters.recent) synced.recent = true;
        queryRef.current = synced;
        setQuery(synced);
      } catch (err) {
        if (gen !== fetchGen.current) return;
        setError(formatIpcError(err));
      } finally {
        if (gen === fetchGen.current) setLoading(false);
      }
    },
    [threadId],
  );

  const applyQuery = useCallback(
    (patch: Partial<ThreadReviewsQuery>, opts?: { scrollToReviewId?: string | null }) => {
      pendingScrollReviewId.current = opts?.scrollToReviewId ?? null;
      const next: ThreadReviewsQuery = { ...queryRef.current, ...patch };
      if ('stars' in patch && patch.stars == null) delete next.stars;
      if ('mention' in patch && patch.mention == null) delete next.mention;
      if ('version' in patch && patch.version == null) delete next.version;
      if ('recent' in patch && !patch.recent) delete next.recent;
      queryRef.current = next;
      setQuery(next);
      void load(next);
    },
    [load],
  );

  // Reset when thread changes.
  useEffect(() => {
    fetchGen.current += 1;
    setVisible(false);
    const initial: ThreadReviewsQuery = { page: 1 };
    queryRef.current = initial;
    setQuery(initial);
    setData(null);
    setLoading(false);
    setError(null);
    pendingScrollReviewId.current = null;
    mentionsCacheRef.current = [];
    versionsCacheRef.current = [];
  }, [threadId]);

  // Near-viewport lazy gate.
  useEffect(() => {
    if (isOffline || visible) return;
    const el = sentinelRef.current;
    if (!el) return;
    const root = document.querySelector('.app-main');
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setVisible(true);
      },
      {
        root: root instanceof Element ? root : null,
        rootMargin: '200px 0px',
        threshold: 0,
      },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible, threadId, isOffline]);

  // Initial fetch once visible.
  useEffect(() => {
    if (isOffline || !visible || data || loading || error) return;
    void load({ page: 1 });
  }, [isOffline, visible, data, loading, error, load]);

  // Scroll to highlight target after load.
  useEffect(() => {
    const id = pendingScrollReviewId.current;
    if (!id || loading || !data) return;
    if (!data.reviews.some((r) => r.reviewId === id)) {
      pendingScrollReviewId.current = null;
      return;
    }
    const timer = window.setTimeout(() => {
      pendingScrollReviewId.current = null;
      const el = document.getElementById(`review-${id}`);
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('game-review-card--highlight');
      window.setTimeout(() => el.classList.remove('game-review-card--highlight'), 2500);
    }, 50);
    return () => window.clearTimeout(timer);
  }, [data, loading]);

  const onHighlight = (h: ReviewHighlight) => {
    if (h.page != null && h.page >= 1) {
      applyQuery({ page: h.page }, { scrollToReviewId: h.reviewId });
      return;
    }
    if (h.reviewId) {
      pendingScrollReviewId.current = h.reviewId;
      const el = document.getElementById(`review-${h.reviewId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('game-review-card--highlight');
        window.setTimeout(() => el.classList.remove('game-review-card--highlight'), 2500);
        pendingScrollReviewId.current = null;
      }
    } else if (h.href) {
      void openUrl(h.href.startsWith('http') ? h.href : `https://f95zone.to${h.href}`);
    }
  };

  const clearFilters = () => {
    applyQuery({
      page: 1,
      stars: undefined,
      mention: undefined,
      version: undefined,
      recent: undefined,
    });
  };

  const hasActiveFilter = Boolean(
    query.stars || query.mention || query.version || query.recent,
  );

  const activeVersion = query.version ?? data?.filters.version ?? null;
  const versionOptions = (() => {
    const fromData = data?.versions?.length ? data.versions : [];
    const cached = versionsCacheRef.current;
    const byId = new Map<string, (typeof cached)[number]>();
    for (const v of [...cached, ...fromData]) {
      if (v.id) byId.set(v.id, v);
    }
    if (activeVersion && !byId.has(activeVersion)) {
      const foldMatch = data?.olderFolds?.find((f) => f.versionId === activeVersion);
      byId.set(activeVersion, {
        id: activeVersion,
        name: foldMatch?.name ?? activeVersion,
        dateLabel: foldMatch?.dateLabel ?? null,
        statLabel: foldMatch?.statLabel ?? null,
        isCurrent: false,
        selected: true,
      });
    }
    return [...byId.values()];
  })();

  const page = data?.page ?? query.page ?? 1;
  const totalPages = data?.totalPages ?? null;
  const hasMore = data?.hasMore ?? false;
  const canPrev = page > 1 && !loading;
  const canNext = (hasMore || (totalPages != null && page < totalPages)) && !loading;
  const showPager =
    data != null && (hasMore || page > 1 || (totalPages != null && totalPages > 1));
  const activeSort: ReviewSort =
    (data && SORTS.includes(data.sort as ReviewSort) ? (data.sort as ReviewSort) : null) ??
    query.sort ??
    'latest';

  if (isOffline) {
    return (
      <section className="game-reviews" aria-label={t('gamedetail.section.reviews')}>
        <div className="game-reviews-status game-reviews-status--muted">
          {t('gamedetail.reviews.offline')}
        </div>
      </section>
    );
  }

  return (
    <section className="game-reviews" aria-label={t('gamedetail.section.reviews')}>
      <div ref={sentinelRef} className="game-reviews-sentinel" aria-hidden />

      {visible && (
        <>
          <div className="game-reviews-header">
            <button
              type="button"
              className="game-reviews-open-btn"
              onClick={() => void openUrl(openUrlForSection)}
            >
              {t('gamedetail.reviews.openOnF95')}
            </button>
          </div>

          {loading && !data && (
            <div className="game-reviews-status game-reviews-status--muted">
              {t('gamedetail.reviews.loading')}
            </div>
          )}

          {error && (
            <div className="game-reviews-status game-reviews-status--error">
              <span>{t('gamedetail.reviews.failed', { error })}</span>{' '}
              <button
                type="button"
                className="game-reviews-link-btn"
                onClick={() => void openUrl(openUrlForSection)}
              >
                {t('gamedetail.reviews.openOnF95')}
              </button>
            </div>
          )}

          {data?.stats && (
            <StatsPanel
              stats={{
                ...data.stats,
                mentions:
                  data.stats.mentions.length > 0
                    ? data.stats.mentions
                    : mentionsCacheRef.current,
              }}
              filters={{ ...data.filters, mention: query.mention ?? data.filters.mention }}
              onStars={(stars) => applyQuery({ page: 1, stars })}
              onMention={(mention) => applyQuery({ page: 1, mention })}
              onScoreLine={(line) => {
                if (line.recent) {
                  applyQuery({
                    page: 1,
                    recent: true,
                    version: undefined,
                  });
                  return;
                }
                if (line.versionId) {
                  applyQuery({
                    page: 1,
                    version: line.versionId,
                    recent: undefined,
                  });
                  return;
                }
              }}
            />
          )}

          {data?.pendingNote ? (
            <div className="game-reviews-pending" role="note">
              {data.pendingNote}
            </div>
          ) : null}

          {data && data.highlights.length > 0 && (
            <ul className="game-reviews-highlights">
              {data.highlights.map((h, idx) => (
                <li key={`${h.reviewId ?? 'h'}-${idx}`}>
                  <button
                    type="button"
                    className={`game-reviews-highlight game-reviews-highlight--${h.kind}`}
                    onClick={() => onHighlight(h)}
                  >
                    <span
                      className="game-reviews-highlight-snippet"
                      dangerouslySetInnerHTML={{
                        __html: sanitizeReviewHtml(h.snippetHtml),
                      }}
                    />
                    <span className="game-reviews-highlight-meta">
                      {h.author ? <span>{h.author}</span> : null}
                      {h.rating != null ? <span>{formatScore(h.rating)}★</span> : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {data && (
            <div className="game-reviews-toolbar">
              <div className="game-reviews-sort" role="group" aria-label={t('gamedetail.reviews.sortLabel')}>
                <span className="game-reviews-toolbar-label">{t('gamedetail.reviews.sortLabel')}</span>
                {SORTS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={
                      activeSort === s
                        ? 'game-reviews-sort-btn game-reviews-sort-btn--active'
                        : 'game-reviews-sort-btn'
                    }
                    disabled={loading}
                    aria-pressed={activeSort === s}
                    onClick={() => applyQuery({ page: 1, sort: s })}
                  >
                    {t(`gamedetail.reviews.sort.${s}`)}
                  </button>
                ))}
              </div>

              {versionOptions.length > 0 && (
                <label className="game-reviews-version">
                  <span className="game-reviews-toolbar-label">
                    {t('gamedetail.reviews.versionLabel')}
                  </span>
                  <select
                    className="game-reviews-version-select"
                    disabled={loading}
                    value={activeVersion ?? ''}
                    onChange={(e) => {
                      const v = e.target.value;
                      applyQuery({ page: 1, version: v || undefined });
                    }}
                  >
                    <option value="">{t('gamedetail.reviews.versionAll')}</option>
                    {versionOptions.map((v) => (
                      <option key={v.id!} value={v.id!}>
                        {v.name}
                        {v.dateLabel ? ` (${v.dateLabel})` : ''}
                        {v.statLabel ? ` — ${v.statLabel}` : ''}
                        {v.isCurrent ? ' ★' : ''}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {data.rangeLabel ? (
                <span className="game-reviews-range">{data.rangeLabel}</span>
              ) : null}

              {hasActiveFilter && (
                <button
                  type="button"
                  className="game-reviews-link-btn"
                  disabled={loading}
                  onClick={clearFilters}
                >
                  {t('gamedetail.reviews.clearFilter')}
                </button>
              )}
            </div>
          )}

          {loading && data && (
            <div className="game-reviews-status game-reviews-status--muted">
              {t('gamedetail.reviews.loading')}
            </div>
          )}

          {!loading && !error && data && data.reviews.length === 0 && (
            <div className="game-reviews-status game-reviews-status--muted">
              {t('gamedetail.reviews.empty')}
            </div>
          )}

          {data?.currentGroup ? <CurrentGroupHead group={data.currentGroup} /> : null}

          {data && data.reviews.length > 0 && (
            <ul className="game-reviews-list">
              {data.reviews.map((review) => (
                <ReviewCardItem key={review.reviewId} review={review} locale={locale} />
              ))}
            </ul>
          )}

          {data && (data.olderFolds?.length ?? 0) > 0 && (
            <OlderFolds
              folds={data.olderFolds ?? []}
              threadId={threadId}
              locale={locale}
              disabled={loading}
              onShowAll={(fold) => {
                if (!fold.versionId) return;
                applyQuery({
                  page: 1,
                  version: fold.versionId,
                  recent: undefined,
                });
              }}
            />
          )}

          {showPager && (
            <nav className="game-reviews-pager" aria-label={t('gamedetail.reviews.pagerLabel')}>
              <button
                type="button"
                className="game-reviews-pager-btn"
                disabled={!canPrev}
                onClick={() => applyQuery({ page: page - 1 })}
              >
                {t('gamedetail.reviews.prev')}
              </button>
              <span className="game-reviews-pager-status">
                {t('gamedetail.reviews.pageOf', {
                  page: String(page),
                  total: totalPages != null ? String(totalPages) : '…',
                })}
              </span>
              <button
                type="button"
                className="game-reviews-pager-btn"
                disabled={!canNext}
                onClick={() => applyQuery({ page: page + 1 })}
              >
                {t('gamedetail.reviews.next')}
              </button>
            </nav>
          )}
        </>
      )}
    </section>
  );
}
