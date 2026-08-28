import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import DOMPurify from 'dompurify';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useSearchParams } from 'react-router-dom';
import { ReplyComposer } from '../ReplyComposer';
import { ThreadDiscussionSearch } from './ThreadDiscussionSearch';
import { GameDescription } from './GameDescription';
import { PostAttachments } from '../PostAttachments';
import { UserChip } from '../UserChip';
import {
  appendQuoteToDraft,
  buildQuoteBbcode,
  htmlToPlainText,
} from '../../lib/bbcodeQuote';
import { resolvePost, threadPosts, threadReply } from '../../lib/ipc';
import { formatIpcError } from '../../lib/ipcError';
import { formatRelativeDate } from '../../lib/formatDate';
import { useDiscussionSettings } from '../../contexts/DiscussionSettings';
import { useT } from '../../lib/i18n';
import type { ThreadPost, ThreadPostsPage } from '../../types/threadPosts';
import '../../styles/thread-discussion.css';

const SEEK_PAGE_CAP = 25;
const HIGHLIGHT_MS = 2500;

type FocusStatus = 'idle' | 'seeking' | 'found' | 'missing';

interface Props {
  threadId: string;
  offline?: boolean;
}

function sanitizePostHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ADD_TAGS: ['details', 'summary', 'button'],
    ADD_ATTR: ['target', 'rel', 'loading', 'type', 'hidden'],
  });
}

function postExternalUrl(post: ThreadPost): string {
  return post.permalink ?? `https://f95zone.to/posts/${post.postId}/`;
}

function quotePlainFromPost(postEl: HTMLElement, post: ThreadPost): string {
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
    const range = sel.getRangeAt(0);
    const body = postEl.querySelector('.thread-post-body');
    if (body && body.contains(range.commonAncestorContainer)) {
      return sel.toString();
    }
  }
  return htmlToPlainText(post.html);
}

function SignatureBlock({
  postId,
  html,
  autoShow,
}: {
  postId: string;
  html: string;
  autoShow: boolean;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(autoShow);

  useEffect(() => {
    setOpen(autoShow);
  }, [autoShow, postId]);

  return (
    <details
      className="thread-post-signature"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>{t('gamedetail.discussion.signature')}</summary>
      <GameDescription html={sanitizePostHtml(html)} className="thread-post-signature-body" />
    </details>
  );
}

function ThreadPostItem({
  post,
  locale,
  autoShowSignatures,
  onQuote,
}: {
  post: ThreadPost;
  locale: string;
  autoShowSignatures: boolean;
  onQuote: (postEl: HTMLElement, post: ThreadPost) => void;
}) {
  const { t } = useT();
  const liRef = useRef<HTMLLIElement>(null);

  return (
    <li ref={liRef} id={`post-${post.postId}`} className="thread-post">
      <div className="thread-post-header">
        <div className="thread-post-meta">
          <UserChip
            userId={post.authorUserId}
            username={post.author}
            avatarUrl={post.authorAvatarUrl}
            className="thread-post-user"
            size={40}
          />
          <span className="thread-post-date">
            {formatRelativeDate(post.postedAt, locale) ?? post.postedAt ?? ''}
          </span>
        </div>
        <div className="thread-post-actions">
          <button
            type="button"
            className="thread-discussion-link-btn"
            onClick={() => {
              if (!liRef.current) return;
              onQuote(liRef.current, post);
            }}
          >
            {t('gamedetail.discussion.quote')}
          </button>
          <button
            type="button"
            className="thread-discussion-link-btn thread-post-open"
            onClick={() => void openUrl(postExternalUrl(post))}
          >
            {t('gamedetail.discussion.openOnF95')}
          </button>
        </div>
      </div>
      <GameDescription
        html={sanitizePostHtml(post.html)}
        className="thread-post-body"
      />
      <PostAttachments attachments={post.attachments ?? []} />
      {post.signatureHtml ? (
        <SignatureBlock
          postId={post.postId}
          html={post.signatureHtml}
          autoShow={autoShowSignatures}
        />
      ) : null}
    </li>
  );
}

function parsePositiveInt(raw: string | null): number | null {
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 1 ? n : null;
}

/** Compact XF-style page list: 1 … 4 5 6 … 20 */
function buildPageItems(
  current: number,
  total: number,
): Array<number | 'ellipsis'> {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const items: Array<number | 'ellipsis'> = [];
  const push = (n: number | 'ellipsis') => {
    if (items[items.length - 1] !== n) items.push(n);
  };
  push(1);
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  if (start > 2) push('ellipsis');
  for (let p = start; p <= end; p++) push(p);
  if (end < total - 1) push('ellipsis');
  push(total);
  return items;
}

/** Lazy read-only thread replies with F95-style page navigation. */
export function ThreadDiscussion({ threadId, offline = false }: Props) {
  const { t, locale } = useT();
  const { settings: discussionSettings } = useDiscussionSettings();
  const [searchParams, setSearchParams] = useSearchParams();
  const focusPostId = searchParams.get('post');
  const pageParamRaw = searchParams.get('page');
  const wantLatest = pageParamRaw === 'latest';
  const urlPage = wantLatest ? null : parsePositiveInt(pageParamRaw);

  const sentinelRef = useRef<HTMLDivElement>(null);
  const fetchGen = useRef(0);
  const highlightedFor = useRef<string | null>(null);
  const highlightScrollTimer = useRef<number | null>(null);
  const highlightRemoveTimer = useRef<number | null>(null);
  const seekPagesUsed = useRef(0);
  const resolveAttemptedFor = useRef<string | null>(null);

  const [visible, setVisible] = useState(() =>
    Boolean(focusPostId || urlPage || wantLatest),
  );
  const [posts, setPosts] = useState<ThreadPost[]>([]);
  const [page, setPage] = useState(0);
  const [totalPages, setTotalPages] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focusStatus, setFocusStatus] = useState<FocusStatus>(() =>
    focusPostId ? 'seeking' : 'idle',
  );
  const [jumpDraft, setJumpDraft] = useState('');
  const [draft, setDraft] = useState('');
  const [replyError, setReplyError] = useState<string | null>(null);
  const [replyBusy, setReplyBusy] = useState(false);
  const [replyNeedsBrowser, setReplyNeedsBrowser] = useState(false);
  const [writeFocusKey, setWriteFocusKey] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composerRef = useRef<HTMLFormElement>(null);

  const clearHighlightTimers = () => {
    if (highlightScrollTimer.current != null) {
      window.clearTimeout(highlightScrollTimer.current);
      highlightScrollTimer.current = null;
    }
    if (highlightRemoveTimer.current != null) {
      window.clearTimeout(highlightRemoveTimer.current);
      highlightRemoveTimer.current = null;
    }
  };

  const syncPageInUrl = useCallback(
    (nextPage: number) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (nextPage <= 1) next.delete('page');
          else next.set('page', String(nextPage));
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const applyResult = useCallback(
    (result: ThreadPostsPage) => {
      setPosts(result.posts);
      setPage(result.page);
      if (result.totalPages != null) setTotalPages(result.totalPages);
      setHasMore(result.hasMore);
      syncPageInUrl(result.page);
    },
    [syncPageInUrl],
  );

  const goToPage = useCallback(
    async (target: number) => {
      const clamped = Math.max(1, Math.floor(target));
      const gen = fetchGen.current;
      setLoading(true);
      setError(null);
      try {
        const result = await threadPosts(threadId, clamped);
        if (gen !== fetchGen.current) return null;
        applyResult(result);
        return result;
      } catch (err) {
        if (gen !== fetchGen.current) return null;
        setError(formatIpcError(err));
        setFocusStatus((s) => (s === 'seeking' ? 'missing' : s));
        return null;
      } finally {
        if (gen === fetchGen.current) setLoading(false);
      }
    },
    [threadId, applyResult],
  );

  const goToLatest = useCallback(async (opts?: { keepSeeking?: boolean }) => {
    const gen = fetchGen.current;
    setLoading(true);
    setError(null);
    if (!opts?.keepSeeking) {
      setFocusStatus('idle');
      highlightedFor.current = null;
    }
    try {
      const probe = await threadPosts(threadId, 1);
      if (gen !== fetchGen.current) return null;
      const last = probe.totalPages ?? (!probe.hasMore ? 1 : null);
      if (last == null || last <= 1) {
        applyResult(probe);
        return probe;
      }
      const result = await threadPosts(threadId, last);
      if (gen !== fetchGen.current) return null;
      applyResult(result);
      return result;
    } catch (err) {
      if (gen !== fetchGen.current) return null;
      setError(formatIpcError(err));
      if (opts?.keepSeeking) {
        setFocusStatus((s) => (s === 'seeking' ? 'missing' : s));
      }
      return null;
    } finally {
      if (gen === fetchGen.current) setLoading(false);
    }
  }, [threadId, applyResult]);

  // Reset when thread / deep-link post changes.
  useEffect(() => {
    fetchGen.current += 1;
    setVisible(Boolean(focusPostId || urlPage || wantLatest));
    setPosts([]);
    setPage(0);
    setTotalPages(null);
    setHasMore(false);
    setLoading(false);
    setError(null);
    setFocusStatus(focusPostId ? 'seeking' : 'idle');
    highlightedFor.current = null;
    seekPagesUsed.current = 0;
    resolveAttemptedFor.current = null;
    setJumpDraft('');
    setDraft('');
    setReplyError(null);
    setReplyBusy(false);
    setReplyNeedsBrowser(false);
    clearHighlightTimers();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset on thread/post identity
  }, [threadId, focusPostId]);

  // Bare-thread alerts use ?page=latest; re-enter even if already on this game page.
  useEffect(() => {
    if (!wantLatest || offline) return;
    fetchGen.current += 1;
    setVisible(true);
    setPosts([]);
    setPage(0);
    setTotalPages(null);
    setHasMore(false);
    setLoading(false);
    setError(null);
    setFocusStatus('idle');
    highlightedFor.current = null;
    seekPagesUsed.current = 0;
    clearHighlightTimers();
  }, [wantLatest, threadId, offline]);

  useEffect(() => {
    if (offline || visible) return;
    const el = sentinelRef.current;
    if (!el) return;
    const root = document.querySelector('.app-main');
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setVisible(true);
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

  // Initial page load once visible.
  // Post deep-links prefer XF resolvePost (direct page) over walking from the end.
  useEffect(() => {
    if (offline || !visible || page > 0 || loading || error) return;
    if (focusPostId) {
      if (urlPage) {
        void goToPage(urlPage);
        return;
      }
      if (resolveAttemptedFor.current === focusPostId) return;
      resolveAttemptedFor.current = focusPostId;
      void (async () => {
        const gen = fetchGen.current;
        setLoading(true);
        setError(null);
        try {
          const resolved = await resolvePost(focusPostId);
          if (gen !== fetchGen.current) return;
          if (resolved.page != null && resolved.page >= 1) {
            setLoading(false);
            await goToPage(resolved.page);
            return;
          }
        } catch {
          // fall through to end-seek
        }
        if (gen !== fetchGen.current) return;
        setLoading(false);
        void goToLatest({ keepSeeking: true });
      })();
      return;
    }
    if (wantLatest) {
      void goToLatest();
      return;
    }
    void goToPage(urlPage ?? 1);
  }, [
    offline,
    visible,
    page,
    loading,
    error,
    focusPostId,
    urlPage,
    wantLatest,
    goToPage,
    goToLatest,
  ]);

  // Seek across pages for ?post= — walk toward older pages from the end.
  useEffect(() => {
    if (offline || !focusPostId || focusStatus !== 'seeking') return;
    if (loading || page === 0 || error) return;
    if (posts.some((p) => p.postId === focusPostId)) return;

    if (seekPagesUsed.current >= SEEK_PAGE_CAP) {
      setFocusStatus('missing');
      return;
    }

    if (page > 1) {
      seekPagesUsed.current += 1;
      void goToPage(page - 1);
    } else {
      setFocusStatus('missing');
    }
  }, [
    offline,
    focusPostId,
    focusStatus,
    loading,
    page,
    posts,
    error,
    goToPage,
  ]);

  useEffect(() => {
    if (!focusPostId || focusStatus === 'found') return;
    if (!posts.some((p) => p.postId === focusPostId)) return;
    setFocusStatus('found');
  }, [posts, focusPostId, focusStatus]);

  useEffect(() => {
    if (!focusPostId) return;
    if (highlightedFor.current === focusPostId) return;
    if (!posts.some((p) => p.postId === focusPostId)) return;
    highlightedFor.current = focusPostId;
    highlightScrollTimer.current = window.setTimeout(() => {
      highlightScrollTimer.current = null;
      const el = document.getElementById(`post-${focusPostId}`);
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('thread-post--highlight');
      highlightRemoveTimer.current = window.setTimeout(() => {
        highlightRemoveTimer.current = null;
        el.classList.remove('thread-post--highlight');
      }, HIGHLIGHT_MS);
    }, 50);
  }, [posts, focusPostId]);

  useEffect(() => () => clearHighlightTimers(), []);

  const effectiveTotal = totalPages ?? (hasMore ? null : Math.max(page, 1));
  const pageItems = useMemo(() => {
    if (effectiveTotal == null || effectiveTotal < 1 || page < 1) return [];
    return buildPageItems(page, effectiveTotal);
  }, [page, effectiveTotal]);

  const canPrev = page > 1 && !loading;
  const canNext = hasMore && !loading;
  const canLatest =
    !loading && (totalPages == null || totalPages > 1 || hasMore);

  const onJumpSubmit = (e: FormEvent) => {
    e.preventDefault();
    const n = parsePositiveInt(jumpDraft.trim());
    if (!n) return;
    const max = totalPages ?? n;
    const target = Math.min(n, max);
    setFocusStatus('idle');
    highlightedFor.current = null;
    seekPagesUsed.current = SEEK_PAGE_CAP; // stop seek
    void goToPage(target);
  };

  const onReplySubmit = async (e: FormEvent) => {
    e.preventDefault();
    const message = draft.trim();
    if (!message || replyBusy || offline) return;
    setReplyBusy(true);
    setReplyError(null);
    setReplyNeedsBrowser(false);
    try {
      const result = await threadReply(threadId, message);
      setDraft('');
      setReplyError(null);
      if (result.postId) {
        setSearchParams(
          (prev) => {
            const next = new URLSearchParams(prev);
            next.set('post', result.postId!);
            next.delete('page');
            return next;
          },
          { replace: true },
        );
        // focusPostId change resets + seek-from-latest via existing effects
      } else {
        // Drop leftover ?post= so an old highlight cannot stick after goToLatest.
        setSearchParams(
          (prev) => {
            const next = new URLSearchParams(prev);
            next.delete('post');
            return next;
          },
          { replace: true },
        );
        await goToLatest();
      }
    } catch (err) {
      const msg = formatIpcError(err);
      setReplyError(msg);
      // Captcha / challenge → offer browser link
      if (/captcha|challenge/i.test(msg)) setReplyNeedsBrowser(true);
    } finally {
      setReplyBusy(false);
    }
  };

  const navigateTo = (target: number) => {
    setFocusStatus('idle');
    highlightedFor.current = null;
    seekPagesUsed.current = SEEK_PAGE_CAP;
    void goToPage(target);
  };

  const onQuote = (postEl: HTMLElement, post: ThreadPost) => {
    const text = quotePlainFromPost(postEl, post);
    const block = buildQuoteBbcode({
      author: post.author,
      postId: post.postId,
      text,
    });
    if (!block) return;
    setDraft((d) => appendQuoteToDraft(d, block));
    setWriteFocusKey((k) => k + 1);
    textareaRef.current?.focus();
    composerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

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

  const showBody = visible || Boolean(focusPostId) || Boolean(urlPage) || wantLatest;
  const seeking = focusStatus === 'seeking' && Boolean(focusPostId);
  const showPager = page > 0 && (hasMore || page > 1 || (effectiveTotal != null && effectiveTotal > 1));

  return (
    <section className="thread-discussion" aria-label={t('gamedetail.section.discussion')}>
      <div ref={sentinelRef} className="thread-discussion-sentinel" aria-hidden />

      {showBody && (
        <>
          <div className="thread-discussion-header">
            <h2 className="game-detail-section-title">{t('gamedetail.section.discussion')}</h2>
            <button
              type="button"
              className="thread-discussion-latest-btn"
              disabled={!canLatest || seeking}
              onClick={() => void goToLatest()}
            >
              {t('gamedetail.discussion.latest')}
            </button>
          </div>

          <ThreadDiscussionSearch
            key={threadId}
            threadId={threadId}
            onFocusPost={(postId) => {
              if (!postId) {
                void goToPage(1);
                return;
              }
              setSearchParams(
                (prev) => {
                  const next = new URLSearchParams(prev);
                  next.set('post', postId);
                  next.delete('page');
                  return next;
                },
                { replace: true },
              );
            }}
          />

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
                <ThreadPostItem
                  key={post.postId}
                  post={post}
                  locale={locale}
                  autoShowSignatures={discussionSettings.autoShowSignatures}
                  onQuote={onQuote}
                />
              ))}
            </ul>
          )}

          {showPager && (
            <nav className="thread-discussion-pager" aria-label={t('gamedetail.discussion.pagerLabel')}>
              <button
                type="button"
                className="thread-discussion-pager-btn"
                disabled={!canPrev || seeking}
                onClick={() => navigateTo(page - 1)}
              >
                {t('gamedetail.discussion.prev')}
              </button>

              <div className="thread-discussion-pager-pages">
                {pageItems.length > 0 ? (
                  pageItems.map((item, idx) =>
                    item === 'ellipsis' ? (
                      <span key={`e-${idx}`} className="thread-discussion-pager-ellipsis">
                        …
                      </span>
                    ) : (
                      <button
                        key={item}
                        type="button"
                        className={
                          item === page
                            ? 'thread-discussion-pager-page thread-discussion-pager-page--active'
                            : 'thread-discussion-pager-page'
                        }
                        disabled={loading || seeking || item === page}
                        onClick={() => navigateTo(item)}
                      >
                        {item}
                      </button>
                    ),
                  )
                ) : (
                  <span className="thread-discussion-pager-status">
                    {t('gamedetail.discussion.pageOf', {
                      page: String(page),
                      total: effectiveTotal != null ? String(effectiveTotal) : '…',
                    })}
                  </span>
                )}
              </div>

              <button
                type="button"
                className="thread-discussion-pager-btn"
                disabled={!canNext || seeking}
                onClick={() => navigateTo(page + 1)}
              >
                {t('gamedetail.discussion.next')}
              </button>

              <form className="thread-discussion-jump" onSubmit={onJumpSubmit}>
                <label className="thread-discussion-jump-label" htmlFor={`thread-jump-${threadId}`}>
                  {t('gamedetail.discussion.jumpTo')}
                </label>
                <input
                  id={`thread-jump-${threadId}`}
                  className="thread-discussion-jump-input"
                  type="number"
                  min={1}
                  max={totalPages ?? undefined}
                  inputMode="numeric"
                  value={jumpDraft}
                  disabled={loading || seeking}
                  onChange={(e) => setJumpDraft(e.target.value)}
                  placeholder={String(page || 1)}
                />
                <button
                  type="submit"
                  className="thread-discussion-pager-btn"
                  disabled={loading || seeking || !parsePositiveInt(jumpDraft.trim())}
                >
                  {t('gamedetail.discussion.go')}
                </button>
              </form>
            </nav>
          )}

          {visible && !offline && (
            <ReplyComposer
              previewTarget={{ kind: 'thread', threadId }}
              draft={draft}
              onDraftChange={setDraft}
              replyBusy={replyBusy}
              replyError={replyError}
              replyNeedsBrowser={replyNeedsBrowser}
              onSubmit={(e) => void onReplySubmit(e)}
              textareaRef={textareaRef}
              writeFocusKey={writeFocusKey}
              formRef={composerRef}
            />
          )}
        </>
      )}
    </section>
  );
}
