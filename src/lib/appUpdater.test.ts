import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/plugin-updater', () => ({
  check: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-process', () => ({
  relaunch: vi.fn(),
}));

import { check } from '@tauri-apps/plugin-updater';
import {
  checkForAppUpdate,
  resolveLaunchUpdateAction,
  shouldRunLaunchUpdateCheck,
} from './appUpdater';

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
