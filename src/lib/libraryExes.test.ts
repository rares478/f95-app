import { describe, expect, it } from 'vitest';
import {
  exeDisplayName,
  exeFilename,
  exeParentDir,
  normalizeExeLabel,
  resolvePlayExe,
  type LibraryGameExe,
} from './libraryExes';

function row(over: Partial<LibraryGameExe> & Pick<LibraryGameExe, 'id'>): LibraryGameExe {
  return {
    threadId: 't1',
    exePath: 'D:/s1/game.exe',
    installPath: 'D:/s1',
    label: null,
    sortOrder: 0,
    isDefault: false,
    lastLaunchedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

describe('exeParentDir / exeFilename', () => {
  it('handles backslash paths', () => {
    expect(exeParentDir('D:\\games\\S2\\play.exe')).toBe('D:\\games\\S2');
    expect(exeFilename('D:\\games\\S2\\play.exe')).toBe('play.exe');
  });
});

describe('exeDisplayName', () => {
  it('prefers label', () => {
    expect(exeDisplayName({ label: 'Season 2', exePath: 'a/b.exe' })).toBe('Season 2');
  });
  it('falls back to filename', () => {
    expect(exeDisplayName({ label: '  ', exePath: 'a/b.exe' })).toBe('b.exe');
  });
});

describe('normalizeExeLabel', () => {
  it('stores null for blank', () => {
    expect(normalizeExeLabel('  ')).toBeNull();
    expect(normalizeExeLabel('Season 1')).toBe('Season 1');
  });
});

describe('resolvePlayExe', () => {
  it('returns null for empty', () => {
    expect(resolvePlayExe([])).toBeNull();
  });

  it('prefers newest lastLaunchedAt over default', () => {
    const a = row({ id: 'a', isDefault: true, lastLaunchedAt: '2026-01-01T00:00:00.000Z', sortOrder: 0 });
    const b = row({
      id: 'b',
      exePath: 'D:/s2/game.exe',
      installPath: 'D:/s2',
      isDefault: false,
      lastLaunchedAt: '2026-06-01T00:00:00.000Z',
      sortOrder: 1,
    });
    expect(resolvePlayExe([a, b])?.id).toBe('b');
  });

  it('uses default when none launched', () => {
    const a = row({ id: 'a', isDefault: false, sortOrder: 0 });
    const b = row({ id: 'b', isDefault: true, sortOrder: 1, exePath: 'D:/s2/x.exe', installPath: 'D:/s2' });
    expect(resolvePlayExe([a, b])?.id).toBe('b');
  });

  it('falls back to lowest sortOrder', () => {
    const a = row({ id: 'a', sortOrder: 2 });
    const b = row({ id: 'b', sortOrder: 1, exePath: 'D:/s2/x.exe', installPath: 'D:/s2' });
    expect(resolvePlayExe([a, b])?.id).toBe('b');
  });

  it('ties on equal sortOrder via createdAt then id', () => {
    const later = row({
      id: 'z',
      sortOrder: 0,
      createdAt: '2026-02-01T00:00:00.000Z',
      exePath: 'D:/s2/x.exe',
      installPath: 'D:/s2',
    });
    const earlier = row({
      id: 'a',
      sortOrder: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(resolvePlayExe([later, earlier])?.id).toBe('a');

    const sameCreatedB = row({
      id: 'b',
      sortOrder: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      exePath: 'D:/s2/x.exe',
      installPath: 'D:/s2',
    });
    const sameCreatedA = row({
      id: 'a',
      sortOrder: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(resolvePlayExe([sameCreatedB, sameCreatedA])?.id).toBe('a');
  });
});
