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
import type { LibraryGameExe } from './libraryExes';

type ExeDbRow = {
  id: string;
  thread_id: string;
  exe_path: string;
  install_path: string | null;
  label: string | null;
  sort_order: number;
  is_default: number;
  last_launched_at: string | null;
  created_at: string;
};

function toDbRow(r: LibraryGameExe): ExeDbRow {
  return {
    id: r.id,
    thread_id: r.threadId,
    exe_path: r.exePath,
    install_path: r.installPath,
    label: r.label,
    sort_order: r.sortOrder,
    is_default: r.isDefault ? 1 : 0,
    last_launched_at: r.lastLaunchedAt,
    created_at: r.createdAt,
  };
}

describe('library multi-exe façade', () => {
  beforeEach(() => {
    execute.mockReset();
    query.mockReset();
    execute.mockResolvedValue({ rowsAffected: 1 });
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(
      '11111111-1111-1111-1111-111111111111' as `${string}-${string}-${string}-${string}-${string}`,
    );
  });

  it('setExe with empty list inserts default child and updates game cache', async () => {
    const inserted: ExeDbRow = {
      id: '11111111-1111-1111-1111-111111111111',
      thread_id: 't1',
      exe_path: 'D:/s1/game.exe',
      install_path: 'D:/s1',
      label: null,
      sort_order: 0,
      is_default: 1,
      last_launched_at: null,
      created_at: '2026-07-26T00:00:00.000Z',
    };

    // listExes (empty) → addExe listExes (empty) → sync listExes → addExe return listExes
    query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([inserted])
      .mockResolvedValueOnce([inserted]);

    await library.setExe('t1', 'D:/s1/game.exe');

    const insertCall = execute.mock.calls.find((c) =>
      String(c[0]).includes('INSERT INTO library_game_exes'),
    );
    expect(insertCall).toBeTruthy();
    expect(insertCall![1]).toEqual([
      '11111111-1111-1111-1111-111111111111',
      't1',
      'D:/s1/game.exe',
      'D:/s1',
      null,
      0,
      1,
    ]);

    const gameUpdate = execute.mock.calls.find(
      (c) =>
        String(c[0]).includes('UPDATE library_games') &&
        String(c[0]).includes('exe_path') &&
        String(c[0]).includes("install_status = 'installed'"),
    );
    expect(gameUpdate).toBeTruthy();
    expect(gameUpdate![1]).toEqual(['D:/s1/game.exe', 'D:/s1', 't1']);

    expect(
      execute.mock.calls.some((c) => String(c[0]).includes('DELETE FROM library_game_exes')),
    ).toBe(false);
  });

  it('setExe with existing rows updates resolved row path without deleting siblings', async () => {
    const a: LibraryGameExe = {
      id: 'a',
      threadId: 't1',
      exePath: 'D:/s1/game.exe',
      installPath: 'D:/s1',
      label: 'Season 1',
      sortOrder: 0,
      isDefault: true,
      lastLaunchedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    const b: LibraryGameExe = {
      id: 'b',
      threadId: 't1',
      exePath: 'D:/s2/game.exe',
      installPath: 'D:/s2',
      label: 'Season 2',
      sortOrder: 1,
      isDefault: false,
      lastLaunchedAt: '2026-06-01T00:00:00.000Z',
      createdAt: '2026-02-01T00:00:00.000Z',
    };
    const rows = [toDbRow(a), toDbRow(b)];
    const updatedB = {
      ...toDbRow(b),
      exe_path: 'D:/s2/new.exe',
      install_path: 'D:/s2',
    };

    // listExes → after child UPDATE, sync listExes
    query.mockResolvedValueOnce(rows).mockResolvedValueOnce([toDbRow(a), updatedB]);

    await library.setExe('t1', 'D:/s2/new.exe');

    const childUpdate = execute.mock.calls.find(
      (c) =>
        String(c[0]).includes('UPDATE library_game_exes') &&
        String(c[0]).includes('exe_path'),
    );
    expect(childUpdate).toBeTruthy();
    // last-launched (b) is resolved, not default (a)
    expect(childUpdate![1]).toEqual(['D:/s2/new.exe', 'D:/s2', 'b']);

    expect(
      execute.mock.calls.some((c) => String(c[0]).includes('DELETE FROM library_game_exes')),
    ).toBe(false);
    expect(
      execute.mock.calls.some((c) => String(c[0]).includes('INSERT INTO library_game_exes')),
    ).toBe(false);

    const gameUpdate = execute.mock.calls.find(
      (c) =>
        String(c[0]).includes('UPDATE library_games') &&
        String(c[0]).includes("install_status = 'installed'"),
    );
    expect(gameUpdate![1]).toEqual(['D:/s2/new.exe', 'D:/s2', 't1']);
  });

  it('setExe rejects path colliding with a sibling (DUPLICATE_EXE_PATH)', async () => {
    const a: LibraryGameExe = {
      id: 'a',
      threadId: 't1',
      exePath: 'D:/s1/game.exe',
      installPath: 'D:/s1',
      label: 'Season 1',
      sortOrder: 0,
      isDefault: true,
      lastLaunchedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    const b: LibraryGameExe = {
      id: 'b',
      threadId: 't1',
      exePath: 'D:/s2/game.exe',
      installPath: 'D:/s2',
      label: 'Season 2',
      sortOrder: 1,
      isDefault: false,
      lastLaunchedAt: '2026-06-01T00:00:00.000Z',
      createdAt: '2026-02-01T00:00:00.000Z',
    };

    // listExes only — must not UPDATE after duplicate check
    query.mockResolvedValueOnce([toDbRow(a), toDbRow(b)]);

    await expect(library.setExe('t1', 'D:/s1/game.exe')).rejects.toThrow(
      'DUPLICATE_EXE_PATH',
    );

    expect(
      execute.mock.calls.some(
        (c) =>
          String(c[0]).includes('UPDATE library_game_exes') &&
          String(c[0]).includes('exe_path'),
      ),
    ).toBe(false);
  });

  it('clearExe deletes children and clears game fields', async () => {
    await library.clearExe('t1');

    const deleteCall = execute.mock.calls.find((c) =>
      String(c[0]).includes('DELETE FROM library_game_exes'),
    );
    expect(deleteCall).toBeTruthy();
    expect(deleteCall![1]).toEqual(['t1']);

    const clearGame = execute.mock.calls.find(
      (c) =>
        String(c[0]).includes('UPDATE library_games') &&
        String(c[0]).includes("install_status = 'not_installed'"),
    );
    expect(clearGame).toBeTruthy();
    expect(clearGame![1]).toEqual(['t1']);
  });
});
