import { describe, expect, it } from 'vitest';
import { AUTOSTART_ARG, shouldHideOnAutostartLaunch } from './autostartLaunch';

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
