import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import DOMPurify from 'dompurify';
import { Link, useParams } from 'react-router-dom';
import * as ipc from '../lib/ipc';
import { formatRelativeDate } from '../lib/formatDate';
import { formatIpcError } from '../lib/ipcError';
import { useOffline } from '../contexts/Offline';
import { useT } from '../lib/i18n';
import { ReplyComposer } from '../components/ReplyComposer';
import { GameDescription } from '../components/game/GameDescription';
import { PostAttachments } from '../components/PostAttachments';
import { UserChip } from '../components/UserChip';
import { Spinner } from '../components/ui/Spinner';
import { OfflineGate } from '../components/OfflineGate';
import type { ConversationMessage, F95ConversationDetail } from '../types/conversations';
import '../styles/conversations.css';

function sanitizeMessageHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ADD_TAGS: ['details', 'summary', 'button'],
    ADD_ATTR: ['target', 'rel', 'loading', 'type', 'hidden'],
  });
}

export function ConversationPage() {
  const { t, locale } = useT();
  const { conversationPath: encodedPath } = useParams<{ conversationPath: string }>();
  const conversationPath = encodedPath ? decodeURIComponent(encodedPath) : '';
  const { isOffline } = useOffline();

  const [detail, setDetail] = useState<F95ConversationDetail | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [replyBusy, setReplyBusy] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [replyNeedsBrowser, setReplyNeedsBrowser] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadPage = useCallback(
    async (pageNum: number, append: boolean, prepend = false) => {
      if (!conversationPath || isOffline) return null;
      const result = await ipc.fetchConversation(conversationPath, pageNum);
      setDetail((prev) => {
        if (!append || !prev) return result;
        return {
          ...result,
          messages: prepend
            ? [...result.messages, ...prev.messages]
            : [...prev.messages, ...result.messages],
        };
      });
      setPage(result.page);
      return result;
    },
    [conversationPath, isOffline],
  );

  const reload = useCallback(async () => {
    if (!conversationPath) return;
    setLoading(true);
    setError(null);
    try {
      await loadPage(1, false);
    } catch (err) {
      setError(formatIpcError(err));
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [conversationPath, loadPage]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!loading && detail) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [loading, detail?.conversationId, detail?.messages.length]);

  const loadMore = async () => {
    if (!detail || page <= 1 || loadingMore || isOffline) return;
    setLoadingMore(true);
    try {
      await loadPage(page - 1, true, true);
    } catch (err) {
      console.warn('[conversation] load older failed', err);
    } finally {
      setLoadingMore(false);
    }
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!conversationPath || !draft.trim() || replyBusy || isOffline) return;
    setReplyBusy(true);
    setReplyError(null);
    setReplyNeedsBrowser(false);
    try {
      await ipc.conversationReply(conversationPath, draft.trim());
      setDraft('');
      await reload();
    } catch (err) {
      const msg = formatIpcError(err);
      setReplyError(msg);
      if (/captcha|browser/i.test(msg)) setReplyNeedsBrowser(true);
    } finally {
      setReplyBusy(false);
    }
  };

  if (!conversationPath) {
    return (
      <div className="conversations-page">
        <div className="conversations-error">{t('conversations.invalid')}</div>
      </div>
    );
  }

  return (
    <OfflineGate>
      <div className="conversation-detail-page">
        <header className="conversation-detail-header">
          <Link to="/conversations" className="conversation-back-link">
            {t('conversations.back')}
          </Link>
          <div className="conversation-detail-heading">
            <h1 className="conversation-detail-title">
              {detail?.title ?? t('conversations.loadingTitle')}
            </h1>
            {detail && detail.recipients.length > 0 && (
              <p className="conversation-detail-recipients">
                {t('conversations.with', { names: detail.recipients.join(', ') })}
              </p>
            )}
          </div>
          <button
            type="button"
            className="conversations-page-btn conversations-page-btn--primary"
            onClick={() => void reload()}
            disabled={loading}
          >
            {loading ? t('common.loading') : t('common.refresh')}
          </button>
        </header>

        {error && <div className="conversations-error">{error}</div>}

        {loading ? (
          <div className="conversations-loading">
            <Spinner />
          </div>
        ) : detail ? (
          <>
            {page > 1 && (
              <div className="conversation-load-older">
                <button
                  type="button"
                  className="conversations-page-btn"
                  onClick={() => void loadMore()}
                  disabled={loadingMore}
                >
                  {loadingMore ? t('common.loading') : t('conversations.loadOlder')}
                </button>
              </div>
            )}

            <ul className="conversation-messages">
              {detail.messages.map((message) => (
                <ConversationMessageItem key={message.messageId} message={message} locale={locale} />
              ))}
            </ul>
            <div ref={bottomRef} />

            <ReplyComposer
              previewTarget={{ kind: 'conversation', conversationPath }}
              openOnF95Url={detail.url}
              draft={draft}
              onDraftChange={setDraft}
              replyBusy={replyBusy}
              replyError={replyError}
              replyNeedsBrowser={replyNeedsBrowser}
              onSubmit={(e) => void onSubmit(e)}
              disabled={isOffline}
            />
          </>
        ) : null}
      </div>
    </OfflineGate>
  );
}

function ConversationMessageItem({
  message,
  locale,
}: {
  message: ConversationMessage;
  locale: string;
}) {
  return (
    <li id={`message-${message.messageId}`} className="conversation-message">
      <div className="conversation-message-header">
        <UserChip
          userId={message.authorUserId}
          username={message.author}
          avatarUrl={message.authorAvatarUrl}
          size={36}
        />
        {message.postedAt && (
          <time className="conversation-message-date">
            {formatRelativeDate(message.postedAt, locale) ?? message.postedAt}
          </time>
        )}
      </div>
      <GameDescription
        html={sanitizeMessageHtml(message.html)}
        className="conversation-message-body"
      />
      {message.attachments.length > 0 && (
        <PostAttachments attachments={message.attachments} />
      )}
    </li>
  );
}
