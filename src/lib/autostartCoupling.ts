import type { AppRuntimeSettings } from './appRuntimeSettings';

export function applyStartHiddenToggle(
  _current: AppRuntimeSettings,
  enabled: boolean,
): Partial<AppRuntimeSettings> {
  if (enabled) {
    return { startHiddenOnAutostart: true, trayIconEnabled: true };
  }
  return { startHiddenOnAutostart: false };
}

export function applyTrayToggle(
  _current: AppRuntimeSettings,
  enabled: boolean,
): Partial<AppRuntimeSettings> {
  if (!enabled) {
    return { trayIconEnabled: false, startHiddenOnAutostart: false };
  }
  return { trayIconEnabled: true };
}
