import { useEffect, useState } from 'react';
import type { Update } from '@tauri-apps/plugin-updater';
import {
  getAppWindowKind,
  installAppUpdate,
  runLaunchUpdateFlow,
  shouldRunLaunchUpdateCheck,
} from '../lib/appUpdater';
import { dialog } from '../lib/dialog';
import { formatIpcError } from '../lib/ipcError';
import { useT } from '../lib/i18n';
import { Spinner } from './ui/Spinner';
import { AppUpdateBanner } from './AppUpdateBanner';

/**
 * Main-shell launch update check. Auto-installs when enabled; otherwise shows
 * a dismissible banner with Update now. Mount only from AppShell.
 */
export function AppUpdateBootstrap() {
  const { t } = useT();
  const [pending, setPending] = useState<Update | null>(null);
  const [installing, setInstalling] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (
      !shouldRunLaunchUpdateCheck({
        isDev: import.meta.env.DEV,
        windowKind: getAppWindowKind(),
      })
    ) {
      return;
    }

    let cancelled = false;

    (async () => {
      const { action, update } = await runLaunchUpdateFlow();
      if (cancelled || !update) return;

      if (action === 'install') {
        setInstalling(true);
        try {
          await installAppUpdate(update);
        } catch (err) {
          if (!cancelled) {
            setPending(update);
            setInstalling(false);
            await dialog.alert(
              t('settings.updates.installFailed', { error: formatIpcError(err) }),
              { kind: 'error' },
            );
          }
        }
      } else if (action === 'notify') {
        setPending(update);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const onUpdateNow = () => {
    if (!pending || busy) return;
    setBusy(true);
    setInstalling(true);
    void (async () => {
      try {
        await installAppUpdate(pending);
      } catch (err) {
        setInstalling(false);
        setBusy(false);
        await dialog.alert(
          t('settings.updates.installFailed', { error: formatIpcError(err) }),
          { kind: 'error' },
        );
      }
    })();
  };

  const onDismiss = () => {
    if (busy) return;
    setPending(null);
  };

  return (
    <>
      {installing && (
        <div style={overlayStyle} role="status" aria-live="polite">
          <div style={overlayCardStyle}>
            <Spinner size="md" />
            <span style={overlayTextStyle}>{t('appUpdate.status.updating')}</span>
          </div>
        </div>
      )}
      {pending && !installing && (
        <div style={bannerHostStyle}>
          <AppUpdateBanner
            version={pending.version}
            busy={busy}
            onUpdateNow={onUpdateNow}
            onDismiss={onDismiss}
          />
        </div>
      )}
    </>
  );
}

const bannerHostStyle: React.CSSProperties = {
  position: 'fixed',
  top: 32, // below custom title bar
  left: 0,
  right: 0,
  zIndex: 1400,
};

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 2000,
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'center',
  paddingTop: 48,
  background: 'color-mix(in srgb, var(--bg-base) 55%, transparent)',
};

const overlayCardStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 10,
  padding: '10px 16px',
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  boxShadow: '0 8px 24px rgba(0, 0, 0, 0.45)',
};

const overlayTextStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--text-primary)',
};
