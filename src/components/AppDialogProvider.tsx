import { useCallback, useEffect, useRef, useState } from 'react';
import { getName } from '@tauri-apps/api/app';
import { registerDialogHost, type DialogKind, type DialogRequest } from '../lib/dialog';
import { useT } from '../lib/i18n';

export function AppDialogProvider({ children }: { children: React.ReactNode }) {
  const { t } = useT();
  const [queue, setQueue] = useState<DialogRequest[]>([]);
  const [appTitle, setAppTitle] = useState('F95 App');
  const inputRef = useRef<HTMLInputElement>(null);
  const [promptValue, setPromptValue] = useState('');

  const current = queue[0] ?? null;

  useEffect(() => {
    getName()
      .then(setAppTitle)
      .catch(() => {});
  }, []);

  const dequeue = useCallback(() => {
    setQueue((q) => q.slice(1));
  }, []);

  const enqueue = useCallback((req: DialogRequest) => {
    setQueue((q) => [...q, req]);
    if (req.type === 'prompt') {
      setPromptValue(req.options?.defaultValue ?? '');
    }
  }, []);

  useEffect(() => registerDialogHost(enqueue), [enqueue]);

  useEffect(() => {
    if (current?.type !== 'prompt') return;
    const id = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(id);
  }, [current]);

  useEffect(() => {
    if (!current) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (current.type === 'alert') {
          current.resolve();
          dequeue();
        } else if (current.type === 'confirm') {
          current.resolve(false);
          dequeue();
        } else {
          current.resolve(null);
          dequeue();
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current, dequeue]);

  function finishAlert() {
    if (current?.type !== 'alert') return;
    current.resolve();
    dequeue();
  }

  function finishConfirm(ok: boolean) {
    if (current?.type !== 'confirm') return;
    current.resolve(ok);
    dequeue();
  }

  function finishPrompt(ok: boolean) {
    if (current?.type !== 'prompt') return;
    // OK with empty → '' (callers that require a value still treat falsy as abort).
    // Cancel → null so optional prompts (e.g. exe label) can distinguish clear vs cancel.
    current.resolve(ok ? promptValue.trim() : null);
    dequeue();
  }

  const kind: DialogKind =
    current?.type === 'alert'
      ? (current.options?.kind ?? 'info')
      : current?.type === 'confirm'
        ? (current.options?.kind ?? 'warning')
        : 'info';

  const title =
    (current?.type === 'alert'
      ? current.options?.title
      : current?.type === 'confirm'
        ? current.options?.title
        : current?.type === 'prompt'
          ? current.options?.title
          : undefined) ?? appTitle;

  const message =
    current?.type === 'alert' || current?.type === 'confirm' || current?.type === 'prompt'
      ? current.message
      : '';

  const okLabel = t('common.ok');
  const cancelLabel = t('common.cancel');
  const confirmLabel = t('common.confirm');

  return (
    <>
      {children}
      {current && (
        <div
          className="app-dialog-overlay"
          role="presentation"
          onClick={() => {
            if (current.type === 'alert') finishAlert();
            else if (current.type === 'confirm') finishConfirm(false);
            else finishPrompt(false);
          }}
        >
          <div
            className={`app-dialog app-dialog-${kind}`}
            role={current.type === 'alert' ? 'alertdialog' : 'dialog'}
            aria-modal="true"
            aria-labelledby="app-dialog-title"
            aria-describedby="app-dialog-message"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              if (current.type === 'alert') finishAlert();
              else if (current.type === 'confirm') finishConfirm(true);
              else finishPrompt(true);
            }}
          >
            <header className="app-dialog-header">
              <DialogIcon kind={kind} />
              <div className="app-dialog-header-text">
                <h2 id="app-dialog-title" className="app-dialog-title">
                  {title}
                </h2>
                {current.type === 'prompt' && (
                  <p className="app-dialog-prompt-label">{message}</p>
                )}
              </div>
              <button
                type="button"
                className="app-dialog-close"
                aria-label={cancelLabel}
                onClick={() => {
                  if (current.type === 'alert') finishAlert();
                  else if (current.type === 'confirm') finishConfirm(false);
                  else finishPrompt(false);
                }}
              >
                ×
              </button>
            </header>

            {current.type !== 'prompt' && (
              <p id="app-dialog-message" className="app-dialog-message">
                {message}
              </p>
            )}

            {current.type === 'prompt' && (
              <input
                ref={inputRef}
                type="text"
                className="app-dialog-input"
                value={promptValue}
                placeholder={current.options?.placeholder}
                onChange={(e) => setPromptValue(e.target.value)}
              />
            )}

            <footer className="app-dialog-footer">
              {current.type === 'alert' && (
                <button
                  type="button"
                  className="app-dialog-btn app-dialog-btn-primary"
                  autoFocus
                  onClick={finishAlert}
                >
                  {current.options?.okLabel ?? okLabel}
                </button>
              )}
              {current.type === 'confirm' && (
                <>
                  <button
                    type="button"
                    className="app-dialog-btn"
                    onClick={() => finishConfirm(false)}
                  >
                    {current.options?.cancelLabel ?? cancelLabel}
                  </button>
                  <button
                    type="button"
                    className={`app-dialog-btn app-dialog-btn-primary${
                      kind === 'warning' || kind === 'error' ? ' app-dialog-btn-danger' : ''
                    }`}
                    autoFocus
                    onClick={() => finishConfirm(true)}
                  >
                    {current.options?.confirmLabel ?? confirmLabel}
                  </button>
                </>
              )}
              {current.type === 'prompt' && (
                <>
                  <button type="button" className="app-dialog-btn" onClick={() => finishPrompt(false)}>
                    {current.options?.cancelLabel ?? cancelLabel}
                  </button>
                  <button
                    type="button"
                    className="app-dialog-btn app-dialog-btn-primary"
                    onClick={() => finishPrompt(true)}
                  >
                    {current.options?.confirmLabel ?? confirmLabel}
                  </button>
                </>
              )}
            </footer>
          </div>
        </div>
      )}
    </>
  );
}

function DialogIcon({ kind }: { kind: DialogKind }) {
  return (
    <span className={`app-dialog-icon app-dialog-icon-${kind}`} aria-hidden>
      {kind === 'success' && (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <path
            d="M20 6L9 17l-5-5"
            stroke="currentColor"
            strokeWidth="2.25"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
      {kind === 'warning' && (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <path
            d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
      {kind === 'error' && (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <path
            d="M15 9l-6 6M9 9l6 6M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10Z"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      )}
      {(kind === 'info' || !kind) && (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
          <path d="M12 11v5M12 8h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      )}
    </span>
  );
}
