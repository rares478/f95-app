import { useT } from '../lib/i18n';
import { translateBackendMessage } from '../lib/backendMessage';
import type { BackendError } from '../types';

interface Props {
  error: BackendError | string;
  onDismiss?: () => void;
}

export function ErrorBanner({ error, onDismiss }: Props) {
  const { t } = useT();
  const isBackend = typeof error !== 'string';
  const title = isBackend ? friendlyTitle(error.code, t) : t('common.error');
  const detail = isBackend
    ? translateBackendMessage(error.message, t)
    : translateBackendMessage(error, t);

  return (
    <div
      style={{
        border: '1px solid #b00020',
        background: '#fde7ea',
        color: '#5a0010',
        padding: '0.75rem 1rem',
        borderRadius: 6,
        margin: '0.5rem 0',
        fontSize: 14,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
        <div>
          <strong>{title}</strong>
          {detail && detail !== title && (
            <div style={{ opacity: 0.85, marginTop: 4 }}>{detail}</div>
          )}
        </div>
        {onDismiss && (
          <button
            onClick={onDismiss}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#5a0010',
              cursor: 'pointer',
              fontSize: 18,
              padding: 0,
              lineHeight: 1,
            }}
            aria-label={t('titlebar.close')}
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}

function friendlyTitle(
  code: string,
  t: (key: string, vars?: Record<string, string | number>) => string,
): string {
  const key = `auth.error.${code}`;
  const translated = t(key);
  return translated === key ? t('auth.error.other') : translated;
}
