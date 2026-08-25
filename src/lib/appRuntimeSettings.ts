/**
 * Desktop runtime preferences: auto-update, system tray, and autostart.
 */
import * as settings from './settings';

export interface AppRuntimeSettings {
  autoUpdateEnabled: boolean;
  trayIconEnabled: boolean;
  autostartEnabled: boolean;
  startHiddenOnAutostart: boolean;
}

const DEFAULTS: AppRuntimeSettings = {
  autoUpdateEnabled: true,
  trayIconEnabled: true,
  autostartEnabled: false,
  startHiddenOnAutostart: false,
};

const listeners = new Set<(s: AppRuntimeSettings) => void>();
let cached: AppRuntimeSettings | null = null;

function notify() {
  if (!cached) return;
  for (const fn of listeners) fn(cached);
}

export async function loadAppRuntimeSettings(): Promise<AppRuntimeSettings> {
  const [autoUpdateEnabled, trayIconEnabled, autostartEnabled, startHiddenOnAutostart] =
    await Promise.all([
      settings.getBool(settings.KEY_AUTO_UPDATE_ENABLED, DEFAULTS.autoUpdateEnabled),
      settings.getBool(settings.KEY_TRAY_ICON_ENABLED, DEFAULTS.trayIconEnabled),
      settings.getBool(settings.KEY_AUTOSTART_ENABLED, DEFAULTS.autostartEnabled),
      settings.getBool(settings.KEY_START_HIDDEN_ON_AUTOSTART, DEFAULTS.startHiddenOnAutostart),
    ]);
  cached = { autoUpdateEnabled, trayIconEnabled, autostartEnabled, startHiddenOnAutostart };
  return cached;
}

export function getAppRuntimeSettings(): AppRuntimeSettings {
  return cached ?? DEFAULTS;
}

export function subscribeAppRuntimeSettings(
  fn: (s: AppRuntimeSettings) => void,
): () => void {
  listeners.add(fn);
  fn(getAppRuntimeSettings());
  return () => {
    listeners.delete(fn);
  };
}

export async function saveAppRuntimeSettings(
  patch: Partial<AppRuntimeSettings>,
): Promise<AppRuntimeSettings> {
  const current = cached ?? (await loadAppRuntimeSettings());
  const next: AppRuntimeSettings = { ...current, ...patch };
  cached = next;
  await Promise.all([
    settings.setBool(settings.KEY_AUTO_UPDATE_ENABLED, next.autoUpdateEnabled),
    settings.setBool(settings.KEY_TRAY_ICON_ENABLED, next.trayIconEnabled),
    settings.setBool(settings.KEY_AUTOSTART_ENABLED, next.autostartEnabled),
    settings.setBool(settings.KEY_START_HIDDEN_ON_AUTOSTART, next.startHiddenOnAutostart),
  ]);
  notify();
  return next;
}
