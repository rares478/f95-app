import { describe, expect, it } from 'vitest';
import { fileBackedSaveCount } from './libraryGameSaves';

describe('fileBackedSaveCount', () => {
  it('counts all slots for renpy/rpgm/wolf', () => {
    expect(fileBackedSaveCount('renpy', [{}, {}])).toBe(2);
    expect(fileBackedSaveCount('rpgm', [{ source: 'extra' }])).toBe(1);
    expect(fileBackedSaveCount('wolf', [])).toBe(0);
  });

  it('skips Unity registry slots', () => {
    expect(
      fileBackedSaveCount('unity', [
        { source: 'install' },
        { source: 'registry' },
        { source: 'localLow' },
      ]),
    ).toBe(2);
  });
});
