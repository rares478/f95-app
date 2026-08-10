import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import * as ipc from '../lib/ipc';
import { useT } from '../lib/i18n';
import { formatIpcError } from '../lib/ipcError';
import { OfflineGate } from '../components/OfflineGate';
import { ProfileView } from '../components/ProfileView';
import { Spinner } from '../components/ui/Spinner';
import type { ProfileDto } from '../types';

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; profile: ProfileDto };

export function MemberProfilePage() {
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();
  const { t } = useT();
  const [state, setState] = useState<State>({ kind: 'loading' });

  const reload = useCallback(async () => {
    if (!userId) {
      setState({ kind: 'error', message: t('profile.loadFailed') });
      return;
    }
    setState({ kind: 'loading' });
    try {
      const profile = await ipc.getMemberProfile(userId);
      setState({ kind: 'ready', profile });
    } catch (err) {
      setState({
        kind: 'error',
        message: formatIpcError(err) || t('profile.loadFailed'),
      });
    }
  }, [userId, t]);

  useEffect(() => {
    reload();
  }, [reload]);

  return (
    <OfflineGate>
      {state.kind === 'loading' && (
        <div style={centered}>
          <Spinner size="md" />
        </div>
      )}
      {state.kind === 'error' && (
        <div style={errorBox}>
          <p style={{ margin: '0 0 12px' }}>{state.message}</p>
          <button type="button" onClick={() => navigate(-1)} style={backBtn}>
            {t('common.back')}
          </button>
        </div>
      )}
      {state.kind === 'ready' && (
        <ProfileView
          profile={state.profile}
          mode="member"
          onBack={() => navigate(-1)}
        />
      )}
    </OfflineGate>
  );
}

const centered: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'center',
  padding: '48px 24px',
};

const errorBox: React.CSSProperties = {
  maxWidth: 560,
  margin: '24px auto',
  padding: '16px 20px',
  background: 'var(--status-danger-bg)',
  border: '1px solid var(--accent-strong)',
  borderRadius: 4,
  color: 'var(--status-danger-text)',
  fontSize: 13,
};

const backBtn: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--accent)',
  border: '1px solid var(--accent)',
  borderRadius: 3,
  padding: '6px 12px',
  cursor: 'pointer',
  fontSize: 12,
};
