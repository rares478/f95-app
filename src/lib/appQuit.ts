/**
 * Force a full process exit. Closing the main window alone is not enough:
 * hidden tray-menu / overlay windows (and a tray icon) keep Tauri's event
 * loop alive, so the app appears to "close" while still running.
 */
import { TrayIcon } from '@tauri-apps/api/tray';
import { exit } from '@tauri-apps/plugin-process';

const TRAY_ID = 'f95-app-tray';

let quitting = false;

export function isAppQuitting(): boolean {
  return quitting;
}

/**
 * Tear down the tray icon, then exit the process.
 * Do not close the calling webview before `exit` — that can abort the invoke.
 */
export async function quitApp(): Promise<void> {
  if (quitting) return;
  quitting = true;

  try {
    await TrayIcon.removeById(TRAY_ID);
  } catch {
    /* best-effort */
  }

  await exit(0);
}
