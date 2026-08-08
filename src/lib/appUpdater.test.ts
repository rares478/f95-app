import { describe, expect, it } from 'vitest';
import {
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
