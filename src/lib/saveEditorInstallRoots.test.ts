import { describe, expect, it } from 'vitest';
import type { LibraryGameExe } from './libraryExes';
import {
  collectSaveEditorInstallRoots,
  defaultSaveEditorInstallRoot,
  normalizeInstallPathKey,
} from './saveEditorInstallRoots';

function exe(over: Partial<LibraryGameExe> & Pick<LibraryGameExe, 'id' | 'exePath'>): LibraryGameExe {
  return {
    threadId: 't1',
    installPath: null,
    label: null,
    sortOrder: 0,
    isDefault: false,
    lastLaunchedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

describe('saveEditorInstallRoots', () => {
  it('normalizes separators and trailing slash', () => {
    expect(normalizeInstallPathKey('E:/Games/Foo/')).toBe('e:\\games\\foo');
    expect(normalizeInstallPathKey('E:\\Games\\Foo')).toBe('e:\\games\\foo');
  });

  it('collects unique roots from multi-season exes', () => {
    const roots = collectSaveEditorInstallRoots(
      [
        exe({
          id: 'a',
          exePath: 'E:/Taffy/Redux/game.exe',
          installPath: 'E:/Taffy/Redux',
          label: 'Season 1 Redux',
        }),
        exe({
          id: 'b',
          exePath: 'E:/Taffy/S14/TT/game.exe',
          installPath: 'E:/Taffy/S14/TT',
          label: 'Season 1-4',
        }),
        exe({
          id: 'c',
          exePath: 'E:/Taffy/Redux/other.exe',
          installPath: 'E:\\Taffy\\Redux',
          label: 'Redux alt',
        }),
      ],
      'E:/Taffy/Redux',
    );

    expect(roots).toHaveLength(2);
    expect(roots.map((r) => r.label)).toEqual(['Season 1 Redux', 'Season 1-4']);
  });

  it('falls back to game.installPath when no exes', () => {
    const roots = collectSaveEditorInstallRoots([], 'D:/OnlyInstall');
    expect(roots).toEqual([
      {
        key: 'd:\\onlyinstall',
        path: 'D:/OnlyInstall',
        label: 'OnlyInstall',
      },
    ]);
  });

  it('defaults to preferred install when present', () => {
    const roots = collectSaveEditorInstallRoots(
      [
        exe({
          id: 'a',
          exePath: 'E:/A/a.exe',
          installPath: 'E:/A',
          label: 'A',
        }),
        exe({
          id: 'b',
          exePath: 'E:/B/b.exe',
          installPath: 'E:/B',
          label: 'B',
        }),
      ],
      null,
    );
    expect(defaultSaveEditorInstallRoot(roots, 'E:/B')?.label).toBe('B');
    expect(defaultSaveEditorInstallRoot(roots, null)?.label).toBe('A');
  });
});
