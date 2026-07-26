import { useCallback, useEffect, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import { openUrl } from '@tauri-apps/plugin-opener';
import { GameDescription } from './GameDescription';
import { threadPosts } from '../../lib/ipc';
import { formatIpcError } from '../../lib/ipcError';
import { formatRelativeDate } from '../../lib/formatDate';
import { useT } from '../../lib/i18n';
import type { ThreadPost } from '../../types/threadPosts';
import '../../styles/thread-discussion.css';

const SEEK_PAGE_CAP = 10;
const HIGHLIGHT_MS = 2500;

interface Props {
  threadId: string;
  focusPostId?: string | null;
  offline?: boolean;
}

type FocusStatus = 'idle' | 'seeking' | 'found' | 'missing';

function authorInitial(author: string): string {
  const trimmed = author.trim();
  return trimmed ? trimmed[0]!.toUpperCase() : '?';
}

function sanitizePostHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ADD_TAGS: ['details', 'summary'],
    ADD_ATTR: ['target', 'rel', 'loading'],
  });
}

function postExternalUrl(post: ThreadPost): string {
  return post.permalink ?? `https://f95zone.to/posts/${post.postId}/`;
}

/** Lazy read-only thread replies — fetches when scrolled into view (or immediately for deep-links). */
export function ThreadDiscussion({
  threadId,
  focusPostId = null,
  offline = false,
}: Props) {
  const { t, locale } = useT();
  const sentinelRef = useRef<HTMLDivElement>(null);
  const fetchGen = useRef(0);
  const highlightedFor = useRef<string | null>(null);

  const [visible, setVisible] = useState(() => Boolean(focusPostId));
  const [posts, setPosts] = useState<ThreadPost[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focusStatus, setFocusStatus] = useState<FocusStatus>(() =>
    focusPostId ? 'seeking' : 'idle',
  );

  useEffect(() => {
    fetchGen.current += 1;
    setVisible(Boolean(focusPostId));
    setPosts([]);
    setPage(0);
    setHasMore(false);
    setLoading(false);
    setLoadingMore(false);
    setError(null);
    setFocusStatus(focusPostId ? 'seeking' : 'idle');
    highlightedFor.current = null;
  }, [threadId, focusPostId]);

  useEffect(() => {
    if (offline || visible) return;
    const el = sentinelRef.current;
    if (!el) return;
    const root = document.querySelector('.app-main');
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
        }
      },
      {
        root: root instanceof Element ? root : null,
        rootMargin: '280px 0px',
        threshold: 0,
      },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible, threadId, offline]);

  const appendPage = useCallback(
    async (nextPage: number, kind: 'initial' | 'more') => {
      const gen = fetchGen.current;
      if (kind === 'initial') setLoading(true);
      else setLoadingMore(true);
      setError(null);
      try {
        const result = await threadPosts(threadId, nextPage);
        if (gen !== fetchGen.current) return;
        setPosts((prev) => {
          const seen = new Set(prev.map((p) => p.postId));
          return [...prev, ...result.posts.filter((p) => !seen.has(p.postId))];
        });
        setPage(result.page);
        setHasMore(result.hasMore);
      } catch (err) {
        if (gen !== fetchGen.current) return;
        setError(formatIpcError(err));
      } finally {
        if (gen !== fetchGen.current) return;
        if (kind === 'initial') setLoading(false);
        else setLoadingMore(false);
      }
    },
    [threadId],
  );

  useEffect(() => {
    if (offline || !visible || page > 0 || loading) return;
    void appendPage(1, 'initial');
  }, [offline, visible, page, loading, appendPage]);

  useEffect(() => {
    if (offline || !focusPostId || focusStatus !== 'seeking') return;
    if (loading || loadingMore || page === 0 || error) return;
    if (posts.some((p) => p.postId === focusPostId)) return;
    if (page < SEEK_PAGE_CAP && hasMore) {
      void appendPage(page + 1, 'more');
    } else {
      setFocusStatus('missing');
    }
  }, [
    offline,
    focusPostId,
    focusStatus,
    loading,
    loadingMore,
    page,
    hasMore,
    posts,
    error,
    appendPage,
  ]);

  useEffect(() => {
    if (!focusPostId || focusStatus === 'found') return;
    if (!posts.some((p) => p.postId === focusPostId)) return;
    setFocusStatus('found');
    if (highlightedFor.current === focusPostId) return;
    highlightedFor.current = focusPostId;
    const timer = window.setTimeout(() => {
      const el = document.getElementById(`post-${focusPostId}`);
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('thread-post--highlight');
      window.setTimeout(() => {
        el.classList.remove('thread-post--highlight');
      }, HIGHLIGHT_MS);
    }, 50);
    return () => window.clearTimeout(timer);
  }, [posts, focusPostId, focusStatus]);

  if (offline) {
    return (
      <section className="thread-discussion" aria-label={t('gamedetail.section.discussion')}>
        <h2 className="game-detail-section-title">{t('gamedetail.section.discussion')}</h2>
        <div className="thread-discussion-status thread-discussion-status--muted">
          {t('gamedetail.discussion.offline')}
        </div>
      </section>
    );
  }

  const showBody = visible || Boolean(focusPostId);
  const seeking = focusStatus === 'seeking' && Boolean(focusPostId);

  return (
    <section className="thread-discussion" aria-label={t('gamedetail.section.discussion')}>
      <div ref={sentinelRef} className="thread-discussion-sentinel" aria-hidden />

      {showBody && (
        <>
          <h2 className="game-detail-section-title">{t('gamedetail.section.discussion')}</h2>

          {loading && (
            <div className="thread-discussion-status thread-discussion-status--muted">
              {t('gamedetail.discussion.loading')}
            </div>
          )}

          {error && (
            <div className="thread-discussion-status thread-discussion-status--error">
              {t('gamedetail.discussion.failed', { error })}
            </div>
          )}

          {focusStatus === 'missing' && focusPostId && (
            <div className="thread-discussion-status">
              <span>{t('gamedetail.discussion.postNotFound')}</span>{' '}
              <button
                type="button"
                className="thread-discussion-link-btn"
                onClick={() => void openUrl(`https://f95zone.to/posts/${focusPostId}/`)}
              >
                {t('gamedetail.discussion.openOnF95')}
              </button>
            </div>
          )}

          {!loading && !error && page > 0 && posts.length === 0 && (
            <div className="thread-discussion-status thread-discussion-status--muted">
              {t('gamedetail.discussion.empty')}
            </div>
          )}

          {posts.length > 0 && (
            <ul className="thread-discussion-list">
              {posts.map((post) => (
                <li key={post.postId} id={`post-${post.postId}`} className="thread-post">
                  <div className="thread-post-header">
                    {post.authorAvatarUrl ? (
                      <img
                        src={post.authorAvatarUrl}
                        alt=""
                        className="thread-post-avatar"
                      />
                    ) : (
                      <div className="thread-post-avatar thread-post-avatar--fallback" aria-hidden>
                        {authorInitial(post.author)}
                      </div>
                    )}
                    <div className="thread-post-meta">
                      <span className="thread-post-author">{post.author}</span>
                      <span className="thread-post-date">
                        {formatRelativeDate(post.postedAt, locale) ?? post.postedAt ?? ''}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="thread-discussion-link-btn thread-post-open"
                      onClick={() => void openUrl(postExternalUrl(post))}
                    >
                      {t('gamedetail.discussion.openOnF95')}
                    </button>
                  </div>
                  <GameDescription
                    html={sanitizePostHtml(post.html)}
                    className="thread-post-body"
                  />
                </li>
              ))}
            </ul>
          )}

          {hasMore && !error && page > 0 && (
            <div className="thread-discussion-load-more">
              <button
                type="button"
                className="thread-discussion-load-more-btn"
                disabled={loadingMore || seeking}
                onClick={() => void appendPage(page + 1, 'more')}
              >
                {loadingMore
                  ? t('gamedetail.discussion.loading')
                  : t('gamedetail.discussion.loadMore')}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
