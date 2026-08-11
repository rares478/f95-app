import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { appLog } from './appLog';
import { getAutoUpdateEnabled } from './appUpdateSettings';

function sanitizeErr(err: unknown): string {
  const s = err instanceof Error ? err.message : String(err);
  return s.replace(/\s+/g, ' ').trim().slice(0, 200);
}

export type LaunchUpdateAction = 'install' | 'notify' | 'none';

export function getAppWindowKind(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get('window');
}

export function shouldRunLaunchUpdateCheck(opts: {
  isDev: boolean;
  windowKind: string | null;
}): boolean {
  if (opts.isDev) return false;
  const kind = opts.windowKind;
  if (kind === 'login' || kind === 'overlay' || kind === 'overlay-hint') return false;
  return true;
}

/** Start an update check during login loading (overlaps F95 session work). */
export function shouldStartLoginUpdateCheck(opts: {
  isDev: boolean;
  offline: boolean;
}): boolean {
  return !opts.isDev && !opts.offline;
}

export function resolveLaunchUpdateAction(opts: {
  autoUpdate: boolean;
  hasUpdate: boolean;
}): LaunchUpdateAction {
  if (!opts.hasUpdate) return 'none';
  return opts.autoUpdate ? 'install' : 'notify';
}

export async function checkForAppUpdate(opts?: {
  /** When true, rethrow check failures (manual Settings check). Launch flow keeps soft-fail. */
  throwOnError?: boolean;
}): Promise<Update | null> {
  await appLog('INFO', 'updater', 'check start');
  try {
    const update = await check();
    if (!update) {
      await appLog('INFO', 'updater', 'check: up to date');
      return null;
    }
    await appLog('INFO', 'updater', `check: update available version=${update.version}`);
    return update;
  } catch (err) {
    await appLog('WARN', 'updater', `check failed: ${sanitizeErr(err)}`);
    console.warn('[appUpdater] check failed', err);
    if (opts?.throwOnError) throw err;
    return null;
  }
}

export async function installAppUpdate(
  update: Update,
  onEvent?: Parameters<Update['downloadAndInstall']>[0],
): Promise<void> {
  await appLog('INFO', 'updater', `install start version=${update.version}`);
  await update.downloadAndInstall(onEvent);
  await appLog('INFO', 'updater', 'install ok, relaunching');
  await relaunch();
}

/**
 * Login-window gate: when auto-update is on and an update exists, install
 * here and skip opening the main shell. Soft-fails to `continue` on errors
 * so login can still proceed.
 */
export async function tryLoginAutoInstall(opts: {
  isDev: boolean;
  offline: boolean;
  /** Pre-started check overlapping session/login work; otherwise checks now. */
  updatePromise?: Promise<Update | null> | null;
  onInstalling?: () => void;
}): Promise<'installed' | 'continue'> {
  if (!shouldStartLoginUpdateCheck({
    isDev: opts.isDev,
    offline: opts.offline,
  })) {
    await appLog(
      'INFO',
      'updater',
      opts.isDev ? 'check skipped: dev' : 'check skipped: offline',
    );
    return 'continue';
  }

  const autoUpdate = await getAutoUpdateEnabled();
  if (!autoUpdate) {
    await appLog('INFO', 'updater', 'check skipped: auto-update off');
    return 'continue';
  }

  const update = await (opts.updatePromise ?? checkForAppUpdate());
  if (!update) return 'continue';

  opts.onInstalling?.();
  try {
    await installAppUpdate(update);
    return 'installed';
  } catch (err) {
    await appLog('ERROR', 'updater', `install failed: ${sanitizeErr(err)}`);
    console.warn('[appUpdater] login auto-install failed', err);
    return 'continue';
  }
}

export async function runLaunchUpdateFlow(): Promise<{
  action: LaunchUpdateAction;
  update: Update | null;
}> {
  const autoUpdate = await getAutoUpdateEnabled();
  const update = await checkForAppUpdate();
  const action = resolveLaunchUpdateAction({
    autoUpdate,
    hasUpdate: !!update,
  });
  return { action, update };
}
