import { describe, expect, it } from 'vitest';

/**
 * Mirror of trayMenu dismiss-arm logic (pure) so we can lock the grace
 * behavior without mounting Tauri windows.
 */
function isDismissArmed(
  menuOpen: boolean,
  dismissArmedAt: number,
  now: number,
): boolean {
  return menuOpen && dismissArmedAt > 0 && now >= dismissArmedAt;
}

describe('tray menu dismiss grace', () => {
  it('blocks dismiss until grace elapses', () => {
    const openAt = 1_000;
    const graceMs = 450;
    const armedAt = openAt + graceMs;
    expect(isDismissArmed(true, armedAt, openAt + 100)).toBe(false);
    expect(isDismissArmed(true, armedAt, openAt + graceMs)).toBe(true);
    expect(isDismissArmed(false, armedAt, openAt + graceMs)).toBe(false);
  });
});
