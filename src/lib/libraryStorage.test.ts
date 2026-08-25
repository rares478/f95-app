import { describe, expect, it } from 'vitest';
import { isPathInsideLibrary } from './libraries';
import {
  filterGamesInLibrary,
  sortGameUsageRows,
  startLibraryGameSizeLoads,
  toUsageRows,
  type LibraryGameUsageRow,
} from './libraryStorage';
import type { LibraryGame } from '../types/library';

describe('isPathInsideLibrary', () => {
  it('accepts direct child and nested paths', () => {
    expect(isPathInsideLibrary('D:\\Games\\Foo', 'D:\\Games')).toBe(true);
    expect(isPathInsideLibrary('D:\\Games\\Foo\\bar', 'D:\\Games')).toBe(true);
  });

  it('accepts exact library root', () => {
    expect(isPathInsideLibrary('D:\\Games', 'D:\\Games')).toBe(true);
  });

  it('rejects siblings and prefix false-friends', () => {
    expect(isPathInsideLibrary('D:\\GamesOther\\Foo', 'D:\\Games')).toBe(false);
    expect(isPathInsideLibrary('D:\\Other\\Foo', 'D:\\Games')).toBe(false);
  });

  it('normalizes trailing separators', () => {
    expect(isPathInsideLibrary('D:\\Games\\Foo\\', 'D:\\Games\\')).toBe(true);
  });
});

function game(partial: Partial<LibraryGame> & Pick<LibraryGame, 'threadId' | 'title'>): LibraryGame {
  return {
    category: 'games',
    threadUrl: '',
    thumbnailUrl: null,
    currentVersion: null,
    availableVersion: null,
    installStatus: 'installed',
    installPath: null,
    exePath: null,
    addedAt: '',
    lastPlayedAt: null,
    totalPlaytimeSeconds: 0,
    customTags: [],
    storeTags: [],
    notes: '',
    downloadLinks: [],
    downloadLinksVersion: null,
    downloadLinksFetchedAt: null,
    ...partial,
  };
}

describe('filterGamesInLibrary', () => {
  it('keeps only games with installPath under the library', () => {
    const games = [
      game({ threadId: '1', title: 'In', installPath: 'D:\\Lib\\A' }),
      game({ threadId: '2', title: 'Out', installPath: 'E:\\Other\\B' }),
      game({ threadId: '3', title: 'None', installPath: null }),
    ];
    expect(filterGamesInLibrary(games, 'D:\\Lib').map((g) => g.threadId)).toEqual(['1']);
  });
});

describe('sortGameUsageRows', () => {
  it('sorts ready sizes descending and keeps pending/unavailable last', () => {
    const rows: LibraryGameUsageRow[] = [
      { threadId: 'a', title: 'a', installPath: 'x', installStatus: 'installed', sizeState: 'ready', usedBytes: 10 },
      { threadId: 'b', title: 'b', installPath: 'y', installStatus: 'installed', sizeState: 'pending', usedBytes: null },
      { threadId: 'c', title: 'c', installPath: 'z', installStatus: 'installed', sizeState: 'ready', usedBytes: 30 },
      { threadId: 'd', title: 'd', installPath: 'w', installStatus: 'installed', sizeState: 'unavailable', usedBytes: null },
    ];
    expect(sortGameUsageRows(rows).map((r) => r.threadId)).toEqual(['c', 'a', 'b', 'd']);
  });
});

describe('startLibraryGameSizeLoads', () => {
  it('reports sizes and respects cancel', async () => {
    const rows = toUsageRows([
      game({ threadId: '1', title: 'A', installPath: 'D:\\Lib\\A' }),
      game({ threadId: '2', title: 'B', installPath: 'D:\\Lib\\B' }),
    ]);
    const updates: string[] = [];
    let resolveFirst!: (v: { usedBytes: number; available: boolean }) => void;
    const first = new Promise<{ usedBytes: number; available: boolean }>((r) => {
      resolveFirst = r;
    });
    const directorySize = async (path: string) => {
      if (path.endsWith('A')) return first;
      return { usedBytes: 5, available: true };
    };
    const cancel = startLibraryGameSizeLoads(rows, {
      concurrency: 1,
      directorySize,
      onUpdate: (threadId, patch) => {
        updates.push(`${threadId}:${patch.sizeState}:${patch.usedBytes}`);
      },
    });
    cancel();
    resolveFirst({ usedBytes: 99, available: true });
    await Promise.resolve();
    await Promise.resolve();
    expect(updates.every((u) => !u.startsWith('1:ready'))).toBe(true);
  });
});
