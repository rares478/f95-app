import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execute, query } = vi.hoisted(() => ({
  execute: vi.fn(),
  query: vi.fn(),
}));

vi.mock('./db', () => ({
  execute: (...args: unknown[]) => execute(...args),
  query: (...args: unknown[]) => query(...args),
}));

import * as library from './library';

describe('locale emulator library column', () => {
  beforeEach(() => {
    execute.mockReset();
    query.mockReset();
    execute.mockResolvedValue({ rowsAffected: 1 });
  });

  it('updateLocaleEmulatorEnabled writes 1/0', async () => {
    await library.updateLocaleEmulatorEnabled('t1', true);
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('locale_emulator_enabled'),
      [1, 't1'],
    );

    await library.updateLocaleEmulatorEnabled('t1', false);
    expect(execute).toHaveBeenLastCalledWith(
      expect.stringContaining('locale_emulator_enabled'),
      [0, 't1'],
    );
  });

  it('get maps locale_emulator_enabled to boolean', async () => {
    query.mockResolvedValueOnce([
      {
        thread_id: 't1',
        category: 'games',
        title: 'Test',
        thread_url: 'https://example.com',
        thumbnail_url: null,
        current_version: '1.0',
        available_version: null,
        install_status: 'installed',
        install_path: 'D:/g',
        exe_path: 'D:/g/game.exe',
        added_at: '2026-01-01',
        last_played_at: null,
        total_playtime_seconds: 0,
        custom_tags_json: null,
        store_tags_json: null,
        notes: '',
        download_links_json: null,
        download_links_version: null,
        download_links_fetched_at: null,
        locale_emulator_enabled: 1,
      },
    ]);

    const game = await library.get('t1');
    expect(game?.localeEmulatorEnabled).toBe(true);
  });
});
