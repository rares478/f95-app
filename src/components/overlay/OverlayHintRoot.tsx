import { useEffect, useState } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { LocaleProvider, useT } from '../../lib/i18n';
import { translateBackendMessage } from '../../lib/backendMessage';
import * as ipc from '../../lib/ipc';
import * as theme from '../../lib/theme';
import '../../styles/overlay-hint.css';

interface OverlayHintPayload {
  title: string;
  hotkey: string;
}

interface OverlayErrorPayload {
  message: string;
}

function OverlayErrorToast({ message }: { message: string }) {
  const { t } = useT();
  const text = translateBackendMessage(message, t);
  return (
    <div className="overlay-hint-toast overlay-hint-toast--error" aria-live="assertive">
      <div className="overlay-hint-icon overlay-hint-icon--error" aria-hidden>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
          <path d="M12 8v5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <circle cx="12" cy="16.5" r="0.9" fill="currentColor" />
        </svg>
      </div>
      <div className="overlay-hint-text">
        <strong className="overlay-hint-title">{t('overlay.error.title')}</strong>
        <span className="overlay-hint-sub overlay-hint-error-msg">{text}</span>
      </div>
    </div>
  );
}

function OverlayHintToast({ payload }: { payload: OverlayHintPayload }) {
  const { t } = useT();
  return (
    <div className="overlay-hint-toast" aria-live="polite">
      <div className="overlay-hint-icon" aria-hidden>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="4" width="18" height="13" rx="2" stroke="currentColor" strokeWidth="1.6" />
          <path d="M8 20h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </div>
      <div className="overlay-hint-text">
        <strong className="overlay-hint-title">{t('overlay.ready.title')}</strong>
        <span className="overlay-hint-game" title={payload.title}>
          {payload.title}
        </span>
        <span className="overlay-hint-sub">
          {t('overlay.ready.hint', { hotkey: payload.hotkey })}
        </span>
      </div>
    </div>
  );
}

export function OverlayHintRoot() {
  const [payload, setPayload] = useState<OverlayHintPayload | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [themeReady, setThemeReady] = useState(false);

  useEffect(() => {
    document.documentElement.classList.add('overlay-hint-window');
    document.body.style.userSelect = 'none';
    void getCurrentWindow()
      .setShadow(false)
      .catch(() => {});
    return () => {
      document.documentElement.classList.remove('overlay-hint-window');
      document.body.style.userSelect = '';
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const unsubs: UnlistenFn[] = [];
    void listen<OverlayHintPayload>('overlay:hint', (e) => {
      if (!cancelled) {
        setErrorMessage(null);
        setPayload(e.payload);
        console.info('[overlay-hint] indicador:', e.payload.title);
      }
    }).then((fn) => unsubs.push(fn));
    void listen<OverlayErrorPayload>('overlay:error', (e) => {
      if (!cancelled) {
        setPayload(null);
        setErrorMessage(e.payload.message);
        console.warn('[overlay-hint] erro:', e.payload.message);
      }
    }).then((fn) => unsubs.push(fn));
    void ipc.overlayGetGameHintPayload().then((stored) => {
      if (!cancelled && stored) setPayload(stored);
    });
    return () => {
      cancelled = true;
      for (const fn of unsubs) fn();
    };
  }, []);

  useEffect(() => {
    void theme.loadSavedTheme().then((savedTheme) => {
      theme.applyTheme(savedTheme);
      setThemeReady(true);
    });
  }, []);

  if (!themeReady && !payload && !errorMessage) return null;

  return (
    <LocaleProvider>
      <div className="overlay-hint-root">
        {errorMessage ? (
          <OverlayErrorToast message={errorMessage} />
        ) : payload ? (
          <OverlayHintToast payload={payload} />
        ) : null}
      </div>
    </LocaleProvider>
  );
}
