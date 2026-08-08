import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { getAutoUpdateEnabled } from './appUpdateSettings';

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
  try {
    const update = await check();
    return update ?? null;
  } catch (err) {
    console.warn('[appUpdater] check failed', err);
    if (opts?.throwOnError) throw err;
    return null;
  }
}

export async function installAppUpdate(
  update: Update,
  onEvent?: Parameters<Update['downloadAndInstall']>[0],
): Promise<void> {
  await update.downloadAndInstall(onEvent);
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
    return 'continue';
  }

  const autoUpdate = await getAutoUpdateEnabled();
  if (!autoUpdate) return 'continue';

  const update = await (opts.updatePromise ?? checkForAppUpdate());
  if (!update) return 'continue';

  opts.onInstalling?.();
  try {
    await installAppUpdate(update);
    return 'installed';
  } catch (err) {
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
