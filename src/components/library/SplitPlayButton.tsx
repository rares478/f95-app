import { useEffect, useId, useRef, useState } from 'react';
import { exeDisplayName, type LibraryGameExe } from '../../lib/libraryExes';
import { useT } from '../../lib/i18n';
import '../../styles/library-exes.css';

export type SplitPlayButtonProps = {
  launching: boolean;
  disabled: boolean;
  resolved: LibraryGameExe | null;
  others: LibraryGameExe[];
  onPlay: () => void;
  onPlayExe: (exe: LibraryGameExe) => void;
  variant?: 'primary' | 'secondary';
  title?: string;
};

export function SplitPlayButton({
  launching,
  disabled,
  resolved: _resolved,
  others,
  onPlay,
  onPlayExe,
  variant = 'primary',
  title,
}: SplitPlayButtonProps) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const showChevron = others.length > 0;

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
    if (disabled || launching) setOpen(false);
  }, [disabled, launching]);

  const btnClass =
    variant === 'secondary'
      ? 'game-detail-btn game-detail-btn-secondary'
      : 'game-detail-btn game-detail-btn-primary';

  return (
    <div
      ref={rootRef}
      className={`split-play${showChevron ? '' : ' split-play--solo'}${
        variant === 'secondary' ? ' split-play--secondary' : ''
      }`}
    >
      <button
        type="button"
        className={`${btnClass} split-play-main`}
        onClick={onPlay}
        disabled={disabled || launching}
        title={title}
      >
        {launching ? t('libdetail.action.launching') : t('libdetail.action.play')}
      </button>
      {showChevron && (
        <>
          <button
            type="button"
            className={`${btnClass} split-play-chevron`}
            aria-expanded={open}
            aria-haspopup="menu"
            aria-controls={menuId}
            aria-label={t('libdetail.action.playMenu')}
            title={t('libdetail.action.playMenu')}
            disabled={disabled || launching}
            onClick={() => setOpen((v) => !v)}
          >
            <span className="split-play-chevron-icon" aria-hidden />
          </button>
          {open && (
            <ul id={menuId} className="split-play-menu" role="menu">
              {others.map((exe) => (
                <li key={exe.id} role="none">
                  <button
                    type="button"
                    role="menuitem"
                    className="split-play-menu-item"
                    disabled={launching}
                    onClick={() => {
                      setOpen(false);
                      onPlayExe(exe);
                    }}
                  >
                    {exeDisplayName(exe)}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
