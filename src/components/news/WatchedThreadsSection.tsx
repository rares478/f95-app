import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import * as ipc from '../../lib/ipc';
import { useT } from '../../lib/i18n';
import { formatRelativeDate } from '../../lib/formatDate';
import { extractRawMessage } from '../../lib/ipcError';
import { Spinner } from '../ui/Spinner';
import type { WatchedThread } from '../../types/watch';

interface Props {
  isOffline: boolean;
  unreadThreadIds: Set<string>;
  refreshToken?: number;
}

function isLoginRequiredError(err: unknown): boolean {
  const raw = extractRawMessage(err).toLowerCase();
  return raw.includes('not_initialized') || raw.includes('auth.error.not_initialized');
}

export function WatchedThreadsSection({ isOffline, unreadThreadIds, refreshToken }: Props) {
  const { t, locale } = useT();
  const [threads, setThreads] = useState<WatchedThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loginRequired, setLoginRequired] = useState(false);

  const load = useCallback(async () => {
    if (isOffline) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    setLoginRequired(false);
    try {
      const result = await ipc.getWatchedThreads();
      setThreads(result.threads);
    } catch (err) {
      if (isLoginRequiredError(err)) {
        setLoginRequired(true);
        setThreads([]);
      } else {
        setError(extractRawMessage(err));
      }
    } finally {
      setLoading(false);
    }
  }, [isOffline]);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  return (
    <section className="watched-section">
      <h2 className="watched-section-title">{t('watch.news.section')}</h2>

      {isOffline && threads.length === 0 && !loading && (
        <div className="watched-hint">{t('offline.newsBanner')}</div>
      )}

      {loading && (
        <div className="watched-loading">
          <Spinner size="sm" />
          <span>{t('common.loading')}</span>
        </div>
      )}

      {!loading && loginRequired && (
        <div className="watched-hint">{t('watch.error.login')}</div>
      )}

      {!loading && error && (
        <div className="watched-error">
          <span>{t('news.loadFailed', { error })}</span>
          <button type="button" className="watched-retry" onClick={() => void load()}>
            {t('common.retry')}
          </button>
        </div>
      )}

      {!loading && !error && !loginRequired && threads.length === 0 && !isOffline && (
        <div className="watched-empty">
          <p>{t('watch.news.empty')}</p>
          <p className="watched-empty-hint">{t('watch.news.emptyHint')}</p>
        </div>
      )}

      {!loading && !error && !loginRequired && threads.length > 0 && (
        <ul className="watched-list">
          {threads.map((thread) => {
            const hasAlert = unreadThreadIds.has(thread.threadId);
            const relativeDate =
              formatRelativeDate(thread.lastActivityAt, locale) ?? thread.lastActivityAt;
            return (
              <li key={thread.threadId}>
                <Link
                  to={`/store/game/${thread.threadId}`}
                  className={`watched-row${thread.isUnreadOnF95 ? ' watched-row--xf-unread' : ''}`}
                >
                  <div className="watched-row-body">
                    <div className="watched-row-title">{thread.title}</div>
                    <div className="watched-row-meta">
                      {thread.forumName && (
                        <span className="watched-row-forum">{thread.forumName}</span>
                      )}
                      {relativeDate && (
                        <span className="watched-row-date">{relativeDate}</span>
                      )}
                    </div>
                  </div>
                  {hasAlert && <span className="watched-row-badge">{t('watch.news.new')}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
