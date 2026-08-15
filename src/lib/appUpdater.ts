import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { appLog } from './appLog';
import { getAutoUpdateEnabled } from './appUpdateSettings';
import * as dialog from './dialog';
import type { TFunction } from './i18n';

function sanitizeErr(err: unknown): string {
  const s = err instanceof Error ? err.message : String(err);
  return s.replace(/\s+/g, ' ').trim().slice(0, 200);
}

export type LaunchUpdateAction = 'install' | 'notify' | 'none';

export type UpdateProgress =
  | { phase: 'checking' }
  | { phase: 'available'; version: string; notes: string | null }
  | { phase: 'downloading'; downloaded: number; total: number | null }
  | { phase: 'installing' }
  | { phase: 'idle' }
  | { phase: 'error'; message: string };

let checking = false;

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
  /** Fires before awaiting the check so UI is not stuck on "Loading session…". */
  onChecking?: () => void;
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

  opts.onChecking?.();
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

/**
 * Silent boot check on the main window. Prompts only when an update exists
 * and auto-update is enabled.
 */
export async function runStartupUpdateCheck(t: TFunction): Promise<void> {
  if (checking) return;
  if (!(await getAutoUpdateEnabled())) return;
  checking = true;
  try {
    const update = await checkForAppUpdate();
    if (!update) return;
    const notes = (update.body ?? '').trim();
    const message = notes
      ? `${t('settings.updates.available', { version: update.version })}\n\n${notes.slice(0, 800)}`
      : t('settings.updates.available', { version: update.version });
    const ok = await dialog.confirm(message, {
      title: t('settings.updates.section'),
      kind: 'info',
    });
    if (!ok) return;
    await installAppUpdate(update);
  } catch (err) {
    await appLog('WARN', 'updater', `startup check failed: ${sanitizeErr(err)}`);
    console.warn('[appUpdater] startup check failed', err);
  } finally {
    checking = false;
  }
}

/**
 * Manual update check from the tray or version info modal.
 */
export async function checkForAppUpdateInteractive(
  t: TFunction,
  onProgress?: (p: UpdateProgress) => void,
): Promise<'up-to-date' | 'updated' | 'dismissed' | 'error'> {
  if (checking) return 'dismissed';
  checking = true;
  onProgress?.({ phase: 'checking' });
  try {
    const update = await checkForAppUpdate({ throwOnError: true });
    if (!update) {
      onProgress?.({ phase: 'idle' });
      await dialog.alert(t('settings.updates.uptodate'), {
        title: t('settings.updates.section'),
        kind: 'info',
      });
      return 'up-to-date';
    }
    onProgress?.({
      phase: 'available',
      version: update.version,
      notes: update.body ?? null,
    });
    const notes = (update.body ?? '').trim();
    const message = notes
      ? `${t('settings.updates.available', { version: update.version })}\n\n${notes.slice(0, 800)}`
      : t('settings.updates.available', { version: update.version });
    const ok = await dialog.confirm(message, {
      title: t('settings.updates.section'),
      kind: 'info',
    });
    if (!ok) {
      onProgress?.({ phase: 'idle' });
      return 'dismissed';
    }
    onProgress?.({ phase: 'downloading', downloaded: 0, total: null });
    let downloaded = 0;
    let total: number | null = null;
    await update.downloadAndInstall((event) => {
      switch (event.event) {
        case 'Started':
          total = event.data.contentLength ?? null;
          onProgress?.({ phase: 'downloading', downloaded: 0, total });
          break;
        case 'Progress':
          downloaded += event.data.chunkLength;
          onProgress?.({ phase: 'downloading', downloaded, total });
          break;
        case 'Finished':
          onProgress?.({ phase: 'installing' });
          break;
      }
    });
    await dialog.alert(t('settings.updates.installing'), {
      title: t('settings.updates.section'),
      kind: 'info',
    });
    await relaunch();
    return 'updated';
  } catch (err) {
    const message = sanitizeErr(err);
    onProgress?.({ phase: 'error', message });
    await dialog.alert(t('settings.updates.failed', { error: message }), {
      title: t('settings.updates.section'),
      kind: 'error',
    });
    return 'error';
  } finally {
    checking = false;
    onProgress?.({ phase: 'idle' });
  }
}
