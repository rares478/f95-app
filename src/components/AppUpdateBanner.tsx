import { useT } from '../lib/i18n';

interface Props {
  version: string;
  busy: boolean;
  onUpdateNow: () => void;
  onDismiss: () => void;
}

/** Compact bar under the title bar: update available + Update now / Not now. */
export function AppUpdateBanner({ version, busy, onUpdateNow, onDismiss }: Props) {
  const { t } = useT();

  return (
    <div style={barStyle} role="status" className="app-update-banner">
      <div style={textColStyle}>
        <strong style={titleStyle}>{t('appUpdate.banner.title')}</strong>
        <span style={bodyStyle}>{t('appUpdate.banner.body', { version })}</span>
      </div>
      <div style={actionsStyle}>
        <button
          type="button"
          style={busy ? { ...primaryBtnStyle, ...disabledBtnStyle } : primaryBtnStyle}
          disabled={busy}
          onClick={onUpdateNow}
        >
          {t('appUpdate.banner.updateNow')}
        </button>
        <button
          type="button"
          style={busy ? { ...secondaryBtnStyle, ...disabledBtnStyle } : secondaryBtnStyle}
          disabled={busy}
          onClick={onDismiss}
        >
          {t('appUpdate.banner.dismiss')}
        </button>
      </div>
    </div>
  );
}

const barStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  flexWrap: 'wrap',
  padding: '8px 16px',
  background: 'var(--bg-elevated)',
  borderBottom: '1px solid var(--border)',
  flexShrink: 0,
  zIndex: 20,
};

const textColStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  minWidth: 0,
};

const titleStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--text-primary)',
};

const bodyStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--text-muted)',
};

const actionsStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexShrink: 0,
};

const primaryBtnStyle: React.CSSProperties = {
  padding: '6px 12px',
  fontSize: 12,
  fontWeight: 700,
  background: 'var(--accent)',
  color: 'var(--accent-text)',
  border: 'none',
  borderRadius: 3,
  cursor: 'pointer',
};

const secondaryBtnStyle: React.CSSProperties = {
  padding: '6px 12px',
  fontSize: 12,
  fontWeight: 500,
  background: 'transparent',
  color: 'var(--text-secondary)',
  border: '1px solid var(--border-strong)',
  borderRadius: 3,
  cursor: 'pointer',
};

const disabledBtnStyle: React.CSSProperties = {
  opacity: 0.6,
  cursor: 'wait',
};
