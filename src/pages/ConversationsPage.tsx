import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as ipc from '../lib/ipc';
import { conversationAppPath } from '../lib/f95ThreadUrls';
import { formatRelativeDate } from '../lib/formatDate';
import { formatIpcError } from '../lib/ipcError';
import { useOffline } from '../contexts/Offline';
import { useT } from '../lib/i18n';
import { Spinner } from '../components/ui/Spinner';
import { UserChip } from '../components/UserChip';
import type { F95ConversationListItem } from '../types/conversations';
import '../styles/conversations.css';

export function ConversationsPage() {
  const { t, locale } = useT();
  const navigate = useNavigate();
  const { isOffline } = useOffline();
  const [items, setItems] = useState<F95ConversationListItem[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (pageNum: number, append: boolean) => {
      if (isOffline) {
        setItems([]);
        setHasMore(false);
        return;
      }
      const result = await ipc.fetchConversationsList(pageNum);
      setItems((prev) => (append ? [...prev, ...result.conversations] : result.conversations));
      setHasMore(result.hasMore);
      setPage(result.page);
    },
    [isOffline],
  );

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await load(1, false);
    } catch (err) {
      setError(formatIpcError(err));
    } finally {
      setLoading(false);
    }
  }, [load]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const loadMore = async () => {
    if (!hasMore || loadingMore || isOffline) return;
    setLoadingMore(true);
    try {
      await load(page + 1, true);
    } catch (err) {
      console.warn('[conversations] load more failed', err);
    } finally {
      setLoadingMore(false);
    }
  };

  const unreadCount = useMemo(() => items.filter((item) => item.isUnread).length, [items]);

  return (
    <div className="conversations-page">
      <header className="conversations-page-header">
        <div>
          <h1 className="conversations-page-title">{t('conversations.title')}</h1>
          {unreadCount > 0 && (
            <p className="conversations-page-subtitle">
              {t('conversations.unreadCount', { count: unreadCount })}
            </p>
          )}
        </div>
        <div className="conversations-page-actions">
          <button
            type="button"
            className="conversations-page-btn conversations-page-btn--primary"
            onClick={() => void reload()}
            disabled={loading}
          >
            {loading ? t('common.loading') : t('common.refresh')}
          </button>
        </div>
      </header>

      {isOffline && (
        <div className="offline-banner" role="status" style={{ marginBottom: 12 }}>
          {t('conversations.offline')}
        </div>
      )}

      {error && <div className="conversations-error">{error}</div>}

      {loading ? (
        <div className="conversations-loading">
          <Spinner />
        </div>
      ) : items.length === 0 ? (
        <div className="conversations-list-panel">
          <div className="conversations-empty">
            <div className="conversations-empty-icon" aria-hidden>
              <IconMailLarge />
            </div>
            <p>{t('conversations.empty')}</p>
          </div>
        </div>
      ) : (
        <>
          <div className="conversations-list-panel">
            <ul className="conversations-list">
              {items.map((item) => (
                <li key={item.conversationId}>
                  <div className="conversations-row-shell">
                    <UserChip
                      userId={item.starterUserId}
                      username={item.starterUsername ?? item.title.slice(0, 1)}
                      avatarUrl={item.avatarUrl}
                      className="conversations-row-user"
                      showName={Boolean(item.starterUsername)}
                      size={40}
                    />
                    <button
                      type="button"
                      className={`conversations-row${item.isUnread ? ' conversations-row--unread' : ''}`}
                      onClick={() => navigate(conversationAppPath(item.conversationPath))}
                    >
                      <div className="conversations-row-content">
                        <div className="conversations-row-title">{item.title}</div>
                        {item.lastMessagePreview && (
                          <div className="conversations-row-preview">{item.lastMessagePreview}</div>
                        )}
                        <div className="conversations-row-footer">
                          {item.recipients.length > 0 && (
                            <span className="conversations-row-recipients">
                              {item.recipients.slice(0, 3).join(', ')}
                              {item.recipients.length > 3 ? '…' : ''}
                            </span>
                          )}
                          {item.lastMessageDate && (
                            <span className="conversations-row-date">
                              {formatRelativeDate(item.lastMessageDate, locale) ?? item.lastMessageDate}
                            </span>
                          )}
                        </div>
                      </div>
                      <IconChevronSmall />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {hasMore && !isOffline && (
            <div className="conversations-load-more">
              <button
                type="button"
                className="conversations-page-btn conversations-page-btn--primary"
                onClick={() => void loadMore()}
                disabled={loadingMore}
              >
                {loadingMore ? t('common.loading') : t('conversations.loadMore')}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function IconChevronSmall() {
  return (
    <svg
      className="conversations-row-chevron"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
    >
      <path d="M9 18l6-6-6-6" />
    </svg>
  );
}

function IconMailLarge() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M4 4h16v16H4z" />
      <path d="M4 7l8 6 8-6" />
    </svg>
  );
}
