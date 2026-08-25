import { describe, expect, it } from 'vitest';
import { applyStartHiddenToggle, applyTrayToggle } from './autostartCoupling';

const base = {
  autoUpdateEnabled: true,
  trayIconEnabled: false,
  autostartEnabled: false,
  startHiddenOnAutostart: false,
};

describe('applyStartHiddenToggle', () => {
  it('enabling start-hidden turns tray on', () => {
    expect(applyStartHiddenToggle(base, true)).toEqual({
      startHiddenOnAutostart: true,
      trayIconEnabled: true,
    });
  });

  it('disabling start-hidden only clears that flag', () => {
    expect(
      applyStartHiddenToggle({ ...base, trayIconEnabled: true, startHiddenOnAutostart: true }, false),
    ).toEqual({ startHiddenOnAutostart: false });
  });
});

describe('applyTrayToggle', () => {
  it('disabling tray clears start-hidden', () => {
    expect(
      applyTrayToggle({ ...base, trayIconEnabled: true, startHiddenOnAutostart: true }, false),
    ).toEqual({ trayIconEnabled: false, startHiddenOnAutostart: false });
  });

  it('enabling tray does not force start-hidden', () => {
    expect(applyTrayToggle(base, true)).toEqual({ trayIconEnabled: true });
  });
});
