import { useEffect, useState } from 'react';
import * as ipc from '../lib/ipc';
import { useT } from '../lib/i18n';
import { dialog } from '../lib/dialog';
import { isBackendError, type BackendError, type ProfileDto } from '../types';
import { ErrorBanner } from './ErrorBanner';
import { LoadingState } from './ui/LoadingState';
import { loadProfileCache, saveProfileCache } from '../lib/profileCache';
import { probeOfflineQuick } from '../contexts/Offline';

type Phase =
  | { kind: 'loading' }
  | { kind: 'ready'; profile: ProfileDto; profileStale?: boolean }
  | { kind: 'error'; error: BackendError | string };

interface Props {
  children: (ctx: {
    profile: ProfileDto;
    onLoggedOut: () => void;
    profileStale?: boolean;
  }) => React.ReactNode;
}

/**
 * Bootstraps the main window. The login window already authenticated the
 * user before spawning us, so we just fetch the profile and hand it down.
 * If the session is somehow gone (rare — sidecar crashed between windows)
 * we send the user back to the login window via `restart_to_login`.
 *
 * When offline, falls back to a cached profile from the last online session.
 */
export function MainAppGate({ children }: Props) {
  const { t } = useT();
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const profile = await ipc.getProfile();
        await saveProfileCache(profile);
        if (!cancelled) setPhase({ kind: 'ready', profile });
      } catch (err) {
        if (cancelled) return;
        const offline = await probeOfflineQuick();
        const cached = offline ? await loadProfileCache() : null;
        if (cached) {
          setPhase({ kind: 'ready', profile: cached, profileStale: true });
          return;
        }
        setPhase({
          kind: 'error',
          error: isBackendError(err) ? err : String(err),
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function onLoggedOut() {
    ipc.restartToLogin().catch(async (err) => {
      console.error('[logout] restart_to_login failed', err);
      await dialog.alert(`${t('settings.account.logoutFailed', { error: String(err) })}`, {
        kind: 'error',
      });
    });
  }

  if (phase.kind === 'ready') {
    return (
      <>
        {children({
          profile: phase.profile,
          onLoggedOut,
          profileStale: phase.profileStale,
        })}
      </>
    );
  }

  return (
    <main style={fallbackStyle}>
      {phase.kind === 'loading' && (
        <LoadingState label={t('auth.loading')} variant="page" />
      )}
      {phase.kind === 'error' && (
        <div style={{ maxWidth: 480, margin: '0 auto' }}>
          <ErrorBanner error={phase.error} />
          <button
            type="button"
            onClick={() => void ipc.restartToLogin()}
            style={backToLoginBtn}
          >
            {t('auth.error.dismiss')}
          </button>
        </div>
      )}
    </main>
  );
}

const fallbackStyle: React.CSSProperties = {
  minHeight: '100vh',
  padding: '1.5rem 1rem',
  background: 'var(--bg-base)',
  color: 'var(--text-secondary)',
};

const backToLoginBtn: React.CSSProperties = {
  marginTop: 12,
  padding: '0.5rem 1rem',
  background: 'var(--accent)',
  color: 'var(--accent-text)',
  border: 'none',
  borderRadius: 4,
  cursor: 'pointer',
};
