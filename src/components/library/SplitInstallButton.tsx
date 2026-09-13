import { useEffect, useId, useRef, useState } from 'react';
import { useT } from '../../lib/i18n';
import '../../styles/library-exes.css';

export type SplitInstallButtonProps = {
  busy: boolean;
  disabled: boolean;
  onInstall: () => void;
  onAddExe: () => void;
  title?: string;
};

/**
 * Install primary with a chevron menu for "Add .exe" — same chrome as
 * {@link SplitPlayButton}'s Install-season pattern.
 */
export function SplitInstallButton({
  busy,
  disabled,
  onInstall,
  onAddExe,
  title,
}: SplitInstallButtonProps) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    function onDocPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('pointerdown', onDocPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDocPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (disabled || busy) setOpen(false);
  }, [disabled, busy]);

  const btnClass = 'game-detail-btn game-detail-btn-primary';

  return (
    <div ref={rootRef} className="split-play">
      <button
        type="button"
        className={`${btnClass} split-play-main`}
        onClick={onInstall}
        disabled={disabled || busy}
        title={title}
      >
        {t('libcard.cta.install')}
      </button>
      <button
        type="button"
        className={`${btnClass} split-play-chevron`}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={menuId}
        aria-label={t('libdetail.action.installMenu')}
        title={t('libdetail.action.installMenu')}
        disabled={disabled || busy}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="split-play-chevron-icon" aria-hidden />
      </button>
      {open && (
        <ul id={menuId} className="split-play-menu" role="menu">
          <li role="none">
            <button
              type="button"
              role="menuitem"
              className="split-play-menu-item"
              disabled={busy}
              onClick={() => {
                setOpen(false);
                onAddExe();
              }}
            >
              {t('libdetail.exe.add')}
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}
