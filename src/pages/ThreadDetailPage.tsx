import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import DOMPurify from 'dompurify';
import { openUrl } from '@tauri-apps/plugin-opener';
import { GameDescription } from '../components/game/GameDescription';
import {
  GameDetailBackBar,
  GameDetailBtnSecondary,
  GameDetailError,
  GameDetailLoading,
  GameDetailShell,
} from '../components/game/GameDetailLayout';
import { ThreadDiscussion } from '../components/game/ThreadDiscussion';
import { useOffline } from '../contexts/Offline';
import * as ipc from '../lib/ipc';
import { useT } from '../lib/i18n';
import { formatIpcError } from '../lib/ipcError';
import type { GameDetail } from '../types/game';

type ThreadLocationState = {
  forum?: string;
  title?: string;
};

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; data: GameDetail };

/** Not wrapped in OfflineGate: hard-gating remounts this page whenever the
 *  periodic connectivity probe flickers, wiping loaded detail back to loading. */
export function ThreadDetailPage() {
  const { threadId } = useParams<{ threadId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useT();
  const { isOffline } = useOffline();
  const navState = (location.state as ThreadLocationState | null) ?? {};
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    if (!threadId) return;
    let cancelled = false;
    setState({ kind: 'loading' });
    ipc
      .gameDetail(threadId)
      .then((data) => {
        if (cancelled) return;
        setState({ kind: 'ready', data });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({ kind: 'error', message: formatIpcError(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [threadId]);

  if (!threadId) {
    return (
      <GameDetailShell>
        <GameDetailBackBar
          onBack={() => navigate('/search')}
          breadcrumbTo="/search"
          breadcrumbLabel={t('nav.search')}
        />
        <div className="thread-detail-error-wrap">
          <button
            type="button"
            className="forum-search-btn forum-search-btn--primary"
            onClick={() => navigate('/search')}
          >
            {t('threaddetail.error.back')}
          </button>
        </div>
      </GameDetailShell>
    );
  }

  if (state.kind === 'loading') {
    return (
      <GameDetailShell>
        <GameDetailBackBar
          onBack={() => navigate(-1)}
          breadcrumbTo="/search"
          breadcrumbLabel={t('nav.search')}
        />
        {isOffline && (
          <div className="offline-banner thread-detail-offline" role="status">
            {t('threaddetail.offline')}
          </div>
        )}
        <GameDetailLoading />
      </GameDetailShell>
    );
  }

  if (state.kind === 'error') {
    return (
      <GameDetailShell>
        <GameDetailBackBar
          onBack={() => navigate(-1)}
          breadcrumbTo="/search"
          breadcrumbLabel={t('nav.search')}
        />
        {isOffline && (
          <div className="offline-banner thread-detail-offline" role="status">
            {t('threaddetail.offline')}
          </div>
        )}
        <div className="thread-detail-error-wrap">
          <GameDetailError message={state.message} />
          <button
            type="button"
            className="forum-search-btn forum-search-btn--primary"
            onClick={() => navigate('/search')}
          >
            {t('threaddetail.error.back')}
          </button>
        </div>
      </GameDetailShell>
    );
  }

  const g = state.data;
  const title = g.title || navState.title || '';
  const forum = navState.forum?.trim() ?? '';
  const sanitized = DOMPurify.sanitize(g.descriptionHtml, {
    ADD_TAGS: ['details', 'summary', 'button'],
    ADD_ATTR: ['target', 'rel', 'loading', 'type', 'hidden'],
  });

  return (
    <GameDetailShell>
      <GameDetailBackBar
        onBack={() => navigate(-1)}
        breadcrumbTo="/search"
        breadcrumbLabel={t('nav.search')}
      />

      {isOffline && (
        <div className="offline-banner thread-detail-offline" role="status">
          {t('threaddetail.offline')}
        </div>
      )}

      <div className="thread-detail-content">
        <header className="thread-detail-header">
          {forum ? <div className="thread-detail-forum">{forum}</div> : null}
          <h1 className="thread-detail-title">{title}</h1>
          <div className="thread-detail-actions">
            <GameDetailBtnSecondary onClick={() => void openUrl(g.threadUrl)}>
              {t('threaddetail.openOnF95')}
            </GameDetailBtnSecondary>
          </div>
        </header>

        <section className="game-detail-section thread-detail-op">
          <GameDescription
            html={sanitized}
            style={{ fontSize: 13.5, lineHeight: 1.65, wordBreak: 'break-word' }}
          />
        </section>

        <div aria-label={t('threaddetail.discussion')}>
          <ThreadDiscussion threadId={g.threadId} offline={isOffline} />
        </div>
      </div>
    </GameDetailShell>
  );
}
