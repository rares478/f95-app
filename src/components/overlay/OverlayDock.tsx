import { useT } from '../../lib/i18n';
import type { OverlayAnchorStatus, OverlayContext } from '../../types/overlay';
import { OverlayAnchorBadge } from './OverlayAnchorBadge';
import { OverlayTabIcon } from './overlayIcons';
import { OVERLAY_TAB_ORDER, OVERLAY_WIP_TABS, type OverlayTab } from './overlayTypes';

interface RunningOption {
  threadId: string;
  title: string;
}

interface Props {
  context: OverlayContext | null;
  anchor: OverlayAnchorStatus | null;
  running: RunningOption[];
  threadId: string;
  features: Record<OverlayTab, boolean>;
  openPanels: ReadonlySet<OverlayTab>;
  onTogglePanel: (tab: OverlayTab) => void;
  onSelectGame: (threadId: string) => void;
  onCloseOverlay: () => void;
}

const TAB_LABEL_KEYS: Record<OverlayTab, string> = {
  notes: 'overlay.tab.notes',
  guides: 'overlay.tab.guides',
  browser: 'overlay.tab.browser',
  achievements: 'overlay.tab.achievements',
};

export function OverlayDock({
  context,
  anchor,
  running,
  threadId,
  features,
  openPanels,
  onTogglePanel,
  onSelectGame,
  onCloseOverlay,
}: Props) {
  const { t } = useT();

  return (
    <aside className="game-overlay-dock" aria-label={t('overlay.tabsLabel')}>
      <div className="game-overlay-dock-game">
        {context?.thumbnailUrl ? (
          <img className="game-overlay-dock-thumb" src={context.thumbnailUrl} alt="" />
        ) : (
          <div className="game-overlay-dock-thumb game-overlay-dock-thumb--placeholder" aria-hidden>
            <OverlayTabIcon tab="notes" size={18} />
          </div>
        )}
        <span className="game-overlay-dock-title" title={context?.title}>
          {context?.title ?? 'F95 App'}
        </span>
      </div>

      <nav className="game-overlay-dock-nav">
        {OVERLAY_TAB_ORDER.map((tab) => {
          const enabled = features[tab];
          const isOpen = openPanels.has(tab);
          return (
            <button
              key={tab}
              type="button"
              className={`game-overlay-dock-btn${isOpen ? ' game-overlay-dock-btn--active' : ''}`}
              onClick={() => enabled && onTogglePanel(tab)}
              disabled={!enabled}
              title={t(TAB_LABEL_KEYS[tab])}
              aria-label={t(TAB_LABEL_KEYS[tab])}
              aria-pressed={isOpen}
            >
              <OverlayTabIcon tab={tab} size={18} />
              {OVERLAY_WIP_TABS.has(tab) && enabled && (
                <span className="game-overlay-dock-wip" aria-hidden />
              )}
            </button>
          );
        })}
      </nav>

      <div className="game-overlay-dock-footer">
        {running.length > 1 && (
          <select
            className="game-overlay-dock-select"
            value={threadId}
            onChange={(e) => onSelectGame(e.target.value)}
            aria-label={t('overlay.selectGame')}
          >
            {running.map((r) => (
              <option key={r.threadId} value={r.threadId}>
                {r.title}
              </option>
            ))}
          </select>
        )}
        <OverlayAnchorBadge anchor={anchor} />
        <button
          type="button"
          className="game-overlay-dock-close"
          onClick={onCloseOverlay}
          title={t('overlay.close')}
        >
          {t('overlay.close')}
        </button>
      </div>
    </aside>
  );
}
