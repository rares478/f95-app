import { translateBackendMessage } from '../../lib/backendMessage';
import { useT } from '../../lib/i18n';
import type { OverlayAnchorStatus } from '../../types/overlay';

interface Props {
  anchor: OverlayAnchorStatus | null;
}

type StatusKind = 'ok' | 'pending' | 'warn' | 'error';

function resolveStatus(anchor: OverlayAnchorStatus | null): { kind: StatusKind; label: string; detail?: string } {
  if (!anchor) {
    return { kind: 'pending', label: 'overlay.anchorPending' };
  }
  if (anchor.attached) {
    if (anchor.attachMode === 'monitor_fallback') {
      return {
        kind: 'warn',
        label: 'overlay.anchoredExclusive',
        detail: 'overlay.exclusiveHint',
      };
    }
    if (anchor.attachMode === 'topmost_on_game') {
      return { kind: 'ok', label: 'overlay.anchoredBorderless' };
    }
    return { kind: 'ok', label: 'overlay.anchored' };
  }
  if (anchor.message) {
    return { kind: 'error', label: 'overlay.anchorFailed', detail: anchor.message };
  }
  return { kind: 'pending', label: 'overlay.anchorPending' };
}

export function OverlayAnchorBadge({ anchor }: Props) {
  const { t } = useT();
  const { kind, label, detail } = resolveStatus(anchor);
  const title = detail ? translateBackendMessage(detail, t) : undefined;

  return (
    <span className={`game-overlay-status game-overlay-status--${kind}`} title={title}>
      <span className="game-overlay-status-dot" aria-hidden />
      <span className="game-overlay-status-label">{t(label)}</span>
    </span>
  );
}
