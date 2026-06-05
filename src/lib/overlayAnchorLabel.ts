import type { OverlayAnchorStatus } from '../types/overlay';

type TranslateFn = (key: string, vars?: Record<string, string | number>) => string;

function formatRect(
  rect: { x: number; y: number; width: number; height: number } | null,
): string | null {
  if (!rect) return null;
  return `${rect.width}×${rect.height} @ (${rect.x}, ${rect.y})`;
}

/** Human-readable anchor line for settings / diagnostics. */
export function formatOverlayAnchorStatus(status: OverlayAnchorStatus, t: TranslateFn): string {
  if (!status.pid) {
    return status.message ?? t('settings.experimental.noGameRunning');
  }
  const rect = formatRect(status.gameRect);
  if (!status.attached) {
    const base = status.message ?? t('overlay.anchorPending');
    return rect ? `${base} — ${rect}` : base;
  }
  let label: string;
  switch (status.attachMode) {
    case 'monitor_fallback':
      label = t('overlay.anchoredExclusive');
      break;
    case 'topmost_on_game':
      label = t('overlay.anchoredBorderless');
      break;
    case 'owned_window':
      label = t('overlay.anchored');
      break;
    default:
      label = t('overlay.anchored');
  }
  return rect ? `${label} (PID ${status.pid}, ${rect})` : `${label} (PID ${status.pid})`;
}
