import { Link } from 'react-router-dom';
import { useOffline, type OfflineReason } from '../contexts/Offline';
import { useT } from '../lib/i18n';

interface Props {
  children: React.ReactNode;
  /** When true, render children with an offline banner instead of blocking. */
  allowReadOnly?: boolean;
}

function reasonHintKey(reason: OfflineReason): string {
  if (reason === 'manual') return 'offline.hintManual';
  if (reason === 'f95') return 'offline.hintF95';
  return 'offline.hint';
}

export function OfflineGate({ children, allowReadOnly = false }: Props) {
  const { t } = useT();
  const { isOffline, offlineReason, refreshConnectivity, probing } = useOffline();

  if (!isOffline) return <>{children}</>;

  if (allowReadOnly) {
    return (
      <>
        <div className="offline-banner" role="status">
          <span>{t('offline.bannerReadOnly')}</span>
          <button
            type="button"
            className="offline-banner-retry"
            disabled={probing}
            onClick={() => void refreshConnectivity()}
          >
            {probing ? t('offline.retrying') : t('offline.retry')}
          </button>
        </div>
        {children}
      </>
    );
  }

  return (
    <div className="offline-gate">
      <div className="offline-gate-card">
        <OfflineIcon />
        <h2 className="offline-gate-title">{t('offline.title')}</h2>
        <p className="offline-gate-hint">{t(reasonHintKey(offlineReason))}</p>
        <div className="offline-gate-actions">
          <button
            type="button"
            className="offline-gate-btn-primary"
            disabled={probing}
            onClick={() => void refreshConnectivity()}
          >
            {probing ? t('offline.retrying') : t('offline.retry')}
          </button>
          <Link to="/library" className="offline-gate-btn-secondary">
            {t('offline.goLibrary')}
          </Link>
        </div>
      </div>
    </div>
  );
}

function OfflineIcon() {
  return (
    <svg
      className="offline-gate-icon"
      width="48"
      height="48"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden
    >
      <path d="M1 1l22 22M16.72 11.06A10.94 10.94 0 0 1 19 12.55M5 5a11 11 0 0 0 0 14M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01" />
    </svg>
  );
}
