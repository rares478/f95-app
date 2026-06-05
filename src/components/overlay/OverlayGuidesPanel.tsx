import { useT } from '../../lib/i18n';

interface Props {
  enabled: boolean;
}

export function OverlayGuidesPanel({ enabled }: Props) {
  const { t } = useT();

  if (!enabled) {
    return (
      <div className="game-overlay-panel--disabled">{t('overlay.guides.disabled')}</div>
    );
  }

  return (
    <div className="game-overlay-panel-fill">
      <p className="game-overlay-empty">{t('overlay.guides.empty')}</p>
    </div>
  );
}
