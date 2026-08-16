import { beforeEach, describe, expect, it, vi } from 'vitest';

const removeById = vi.fn().mockResolvedValue(undefined);
const exit = vi.fn().mockResolvedValue(undefined);

vi.mock('@tauri-apps/api/tray', () => ({
  TrayIcon: { removeById: (...args: unknown[]) => removeById(...args) },
}));

vi.mock('@tauri-apps/plugin-process', () => ({
  exit: (...args: unknown[]) => exit(...args),
}));

describe('quitApp', () => {
  beforeEach(() => {
    vi.resetModules();
    removeById.mockClear().mockResolvedValue(undefined);
    exit.mockClear().mockResolvedValue(undefined);
  });

  it('removes tray then exits the process', async () => {
    const { quitApp, isAppQuitting } = await import('./appQuit');
    expect(isAppQuitting()).toBe(false);
    await quitApp();
    expect(removeById).toHaveBeenCalledWith('f95-app-tray');
    expect(exit).toHaveBeenCalledWith(0);
    expect(isAppQuitting()).toBe(true);
  });

  it('still exits if tray removal fails', async () => {
    removeById.mockRejectedValue(new Error('no tray'));
    const { quitApp } = await import('./appQuit');
    await quitApp();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('is idempotent once quitting has started', async () => {
    const { quitApp } = await import('./appQuit');
    await quitApp();
    await quitApp();
    expect(exit).toHaveBeenCalledTimes(1);
  });
});
