import type { CSSProperties, MouseEvent, ReactNode } from 'react';
import type { OverlayDisplayMode } from '../../lib/experimentalSettings';

interface Props {
  displayMode: OverlayDisplayMode;
  backdropOpacity: number;
  header: ReactNode;
  tabs: ReactNode;
  panel: ReactNode;
  footer?: ReactNode;
  onBackdropClick?: () => void;
}

export function OverlayShell({
  displayMode,
  backdropOpacity,
  header,
  tabs,
  panel,
  footer,
  onBackdropClick,
}: Props) {
  const isFullscreen = displayMode === 'fullscreen';

  const handleShellClick = (e: MouseEvent<HTMLDivElement>) => {
    if (!isFullscreen || !onBackdropClick) return;
    if (e.target === e.currentTarget) onBackdropClick();
  };

  return (
    <div
      className={`game-overlay-shell game-overlay-shell--${displayMode}${isFullscreen ? ' game-overlay-shell--enter' : ''}`}
      style={
        isFullscreen
          ? ({ '--overlay-backdrop-opacity': String(backdropOpacity) } as CSSProperties)
          : undefined
      }
      onClick={handleShellClick}
    >
      <div className="game-overlay-content" onClick={(e) => e.stopPropagation()}>
        {header}
        <div className="game-overlay-body">
          {tabs}
          <div className="game-overlay-panel-wrap">{panel}</div>
        </div>
        {footer}
      </div>
    </div>
  );
}
