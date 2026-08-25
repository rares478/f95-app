import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUTOSTART_ARG,
  reconcileAutostartPreference,
  shouldHideOnAutostartLaunch,
  syncAutostartWithOs,
} from './autostartLaunch';

vi.mock('@tauri-apps/plugin-autostart', () => ({
  enable: vi.fn(),
  disable: vi.fn(),
  isEnabled: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart';

describe('shouldHideOnAutostartLaunch', () => {
  it('returns false when --autostart arg is missing', () => {
    expect(
      shouldHideOnAutostartLaunch([], {
        startHiddenOnAutostart: true,
        trayIconEnabled: true,
      }),
    ).toBe(false);
  });

  it('returns false when arg present but flags are off', () => {
    expect(
      shouldHideOnAutostartLaunch([AUTOSTART_ARG], {
        startHiddenOnAutostart: false,
        trayIconEnabled: false,
      }),
    ).toBe(false);
  });

  it('returns true when arg, start-hidden, and tray are all on', () => {
    expect(
      shouldHideOnAutostartLaunch([AUTOSTART_ARG], {
        startHiddenOnAutostart: true,
        trayIconEnabled: true,
      }),
    ).toBe(true);
  });

  it('returns false when tray is off', () => {
    expect(
      shouldHideOnAutostartLaunch([AUTOSTART_ARG], {
        startHiddenOnAutostart: true,
        trayIconEnabled: false,
      }),
    ).toBe(false);
  });
});

describe('syncAutostartWithOs', () => {
  beforeEach(() => {
    vi.mocked(enable).mockReset();
    vi.mocked(disable).mockReset();
  });

  it('calls enable when turning on', async () => {
    vi.mocked(enable).mockResolvedValue(undefined);
    await syncAutostartWithOs(true);
    expect(enable).toHaveBeenCalledOnce();
    expect(disable).not.toHaveBeenCalled();
  });

  it('calls disable when turning off', async () => {
    vi.mocked(disable).mockResolvedValue(undefined);
    await syncAutostartWithOs(false);
    expect(disable).toHaveBeenCalledOnce();
    expect(enable).not.toHaveBeenCalled();
  });

  it('propagates enable failures', async () => {
    vi.mocked(enable).mockRejectedValue(new Error('denied'));
    await expect(syncAutostartWithOs(true)).rejects.toThrow('denied');
  });
});

describe('reconcileAutostartPreference', () => {
  beforeEach(() => {
    vi.mocked(enable).mockReset();
    vi.mocked(isEnabled).mockReset();
  });

  it('no-ops when preference is off', async () => {
    await reconcileAutostartPreference(false);
    expect(isEnabled).not.toHaveBeenCalled();
    expect(enable).not.toHaveBeenCalled();
  });

  it('re-enables when preference on but OS entry missing', async () => {
    vi.mocked(isEnabled).mockResolvedValue(false);
    vi.mocked(enable).mockResolvedValue(undefined);
    await reconcileAutostartPreference(true);
    expect(enable).toHaveBeenCalledOnce();
  });

  it('skips enable when OS already registered', async () => {
    vi.mocked(isEnabled).mockResolvedValue(true);
    await reconcileAutostartPreference(true);
    expect(enable).not.toHaveBeenCalled();
  });
});
