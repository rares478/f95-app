import { invoke } from '@tauri-apps/api/core';
import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart';
import type { AppRuntimeSettings } from './appRuntimeSettings';

export const AUTOSTART_ARG = '--autostart';

export function shouldHideOnAutostartLaunch(
  args: string[],
  s: Pick<AppRuntimeSettings, 'startHiddenOnAutostart' | 'trayIconEnabled'>,
): boolean {
  return args.includes(AUTOSTART_ARG) && s.startHiddenOnAutostart && s.trayIconEnabled;
}

/** Process argv from Rust (`std::env::args`). */
export async function readProcessArgs(): Promise<string[]> {
  return invoke<string[]>('cli_args');
}

/** Register or unregister OS login launch. Enable failures propagate for UI. */
export async function syncAutostartWithOs(enabled: boolean): Promise<void> {
  if (enabled) {
    await enable();
  } else {
    await disable();
  }
}

/** Re-enable OS entry if preference is on but the plugin reports off (updater drift). */
export async function reconcileAutostartPreference(enabled: boolean): Promise<void> {
  if (!enabled) return;
  if (!(await isEnabled())) {
    await enable();
  }
}
