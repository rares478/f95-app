import { describe, expect, it } from 'vitest';
import { normalizeSaveExtraRootPath, saveExtraRootPathKey } from './saveExtraRoots';

describe('saveExtraRoots', () => {
  it('normalizes separators and trailing slash', () => {
    expect(normalizeSaveExtraRootPath('E:/Games/Saves/')).toBe('E:\\Games\\Saves');
    expect(normalizeSaveExtraRootPath('  D:\\Foo\\Bar  ')).toBe('D:\\Foo\\Bar');
  });

  it('keys are case-insensitive on Windows-style paths', () => {
    expect(saveExtraRootPathKey('E:\\Games\\Saves')).toBe(
      saveExtraRootPathKey('e:/games/saves/'),
    );
  });
});
