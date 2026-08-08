import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/plugin-updater', () => ({
  check: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-process', () => ({
  relaunch: vi.fn(),
}));

import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import * as appUpdateSettings from './appUpdateSettings';
import {
  checkForAppUpdate,
  resolveLaunchUpdateAction,
  shouldRunLaunchUpdateCheck,
  shouldStartLoginUpdateCheck,
  tryLoginAutoInstall,
} from './appUpdater';

vi.mock('./appUpdateSettings', () => ({
  getAutoUpdateEnabled: vi.fn(),
}));

describe('shouldRunLaunchUpdateCheck', () => {
  it('skips in dev', () => {
    expect(shouldRunLaunchUpdateCheck({ isDev: true, windowKind: null })).toBe(false);
  });

  it('skips login and overlay windows', () => {
    expect(shouldRunLaunchUpdateCheck({ isDev: false, windowKind: 'login' })).toBe(false);
    expect(shouldRunLaunchUpdateCheck({ isDev: false, windowKind: 'overlay' })).toBe(false);
    expect(shouldRunLaunchUpdateCheck({ isDev: false, windowKind: 'overlay-hint' })).toBe(false);
  });

  it('runs for main shell (null / main)', () => {
    expect(shouldRunLaunchUpdateCheck({ isDev: false, windowKind: null })).toBe(true);
    expect(shouldRunLaunchUpdateCheck({ isDev: false, windowKind: 'main' })).toBe(true);
  });
});

describe('shouldStartLoginUpdateCheck', () => {
  it('skips in dev or offline', () => {
    expect(shouldStartLoginUpdateCheck({ isDev: true, offline: false })).toBe(false);
    expect(shouldStartLoginUpdateCheck({ isDev: false, offline: true })).toBe(false);
  });

  it('runs when online in production', () => {
    expect(shouldStartLoginUpdateCheck({ isDev: false, offline: false })).toBe(true);
  });
});

describe('resolveLaunchUpdateAction', () => {
  it('returns none when no update', () => {
    expect(resolveLaunchUpdateAction({ autoUpdate: true, hasUpdate: false })).toBe('none');
  });

  it('installs when auto on and update exists', () => {
    expect(resolveLaunchUpdateAction({ autoUpdate: true, hasUpdate: true })).toBe('install');
  });

  it('notifies when auto off and update exists', () => {
    expect(resolveLaunchUpdateAction({ autoUpdate: false, hasUpdate: true })).toBe('notify');
  });
});

describe('tryLoginAutoInstall', () => {
  beforeEach(() => {
    vi.mocked(check).mockReset();
    vi.mocked(relaunch).mockReset();
    vi.mocked(appUpdateSettings.getAutoUpdateEnabled).mockReset();
  });

  it('continues when auto-update is off', async () => {
    vi.mocked(appUpdateSettings.getAutoUpdateEnabled).mockResolvedValue(false);
    await expect(
      tryLoginAutoInstall({ isDev: false, offline: false }),
    ).resolves.toBe('continue');
    expect(check).not.toHaveBeenCalled();
  });

  it('installs when auto on and update exists', async () => {
    vi.mocked(appUpdateSettings.getAutoUpdateEnabled).mockResolvedValue(true);
    const downloadAndInstall = vi.fn().mockResolvedValue(undefined);
    const update = { version: '1.2.3', downloadAndInstall };
    vi.mocked(check).mockResolvedValue(update as never);
    const onInstalling = vi.fn();

    await expect(
      tryLoginAutoInstall({ isDev: false, offline: false, onInstalling }),
    ).resolves.toBe('installed');
    expect(onInstalling).toHaveBeenCalledOnce();
    expect(downloadAndInstall).toHaveBeenCalledOnce();
    expect(relaunch).toHaveBeenCalledOnce();
  });

  it('continues when install fails', async () => {
    vi.mocked(appUpdateSettings.getAutoUpdateEnabled).mockResolvedValue(true);
    const downloadAndInstall = vi.fn().mockRejectedValue(new Error('locked'));
    vi.mocked(check).mockResolvedValue({
      version: '1.2.3',
      downloadAndInstall,
    } as never);

    await expect(
      tryLoginAutoInstall({ isDev: false, offline: false }),
    ).resolves.toBe('continue');
    expect(relaunch).not.toHaveBeenCalled();
  });

  it('reuses a pre-started update promise', async () => {
    vi.mocked(appUpdateSettings.getAutoUpdateEnabled).mockResolvedValue(true);
    const downloadAndInstall = vi.fn().mockResolvedValue(undefined);
    const update = { version: '9.9.9', downloadAndInstall };
    const updatePromise = Promise.resolve(update as never);

    await expect(
      tryLoginAutoInstall({
        isDev: false,
        offline: false,
        updatePromise,
      }),
    ).resolves.toBe('installed');
    expect(check).not.toHaveBeenCalled();
  });
});

describe('checkForAppUpdate', () => {
  beforeEach(() => {
    vi.mocked(check).mockReset();
  });

  it('returns null when soft-failing on check error', async () => {
    vi.mocked(check).mockRejectedValue(new Error('network down'));
    await expect(checkForAppUpdate()).resolves.toBeNull();
  });

  it('rethrows when throwOnError is true', async () => {
    const err = new Error('network down');
    vi.mocked(check).mockRejectedValue(err);
    await expect(checkForAppUpdate({ throwOnError: true })).rejects.toBe(err);
  });

  it('returns update when check succeeds', async () => {
    const update = { version: '1.2.3' };
    vi.mocked(check).mockResolvedValue(update as never);
    await expect(checkForAppUpdate()).resolves.toBe(update);
  });
});
