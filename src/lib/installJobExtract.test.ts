import { describe, expect, it } from 'vitest';
import {
  archiveStem,
  buildJobExtractDest,
  resolveLibraryGameDir,
  sanitizePathSegment,
  shortJobId,
} from './installJobExtract';

describe('sanitizePathSegment', () => {
  it('replaces illegal path chars', () => {
    expect(sanitizePathSegment('Win/Linux: S1?')).toBe('Win_Linux_ S1_');
  });

  it('falls back when empty after trim', () => {
    expect(sanitizePathSegment('...')).toBe('download');
    expect(sanitizePathSegment('')).toBe('download');
  });
});

describe('archiveStem', () => {
  it('strips archive extension from cleaned basename', () => {
    expect(archiveStem('D:/lib/123/Game v1.0.zip')).toBe('Game v1.0');
    expect(archiveStem('D:\\lib\\123\\pack.7z')).toBe('pack');
  });
});

describe('resolveLibraryGameDir', () => {
  it('uses archive parent when no install path', () => {
    expect(resolveLibraryGameDir('D:/lib/123/a.zip', null)).toBe('D:/lib/123');
  });

  it('uses archive parent when install is under the thread folder', () => {
    expect(
      resolveLibraryGameDir('D:/lib/123/a.zip', 'D:/lib/123/old-extract'),
    ).toBe('D:/lib/123');
    expect(resolveLibraryGameDir('D:/lib/123/a.zip', 'D:/lib/123')).toBe(
      'D:/lib/123',
    );
  });

  it('uses parent of install when install is outside the archive tree', () => {
    expect(
      resolveLibraryGameDir('E:/dl/123/a.zip', 'D:/Games/MyGame/Season1'),
    ).toBe('D:/Games/MyGame');
  });
});

describe('buildJobExtractDest', () => {
  it('builds sectionLabel-stem under library game dir', () => {
    expect(
      buildJobExtractDest({
        archivePath: 'D:/lib/99/Game.zip',
        sectionLabel: 'Win/Linux',
        jobId: 'abcdef12-3456-7890-abcd-ef1234567890',
        jobCount: 1,
      }),
    ).toBe('D:/lib/99/Win_Linux-Game');
  });

  it('appends short job id when plan has multiple jobs', () => {
    expect(
      buildJobExtractDest({
        archivePath: 'D:/lib/99/Game.zip',
        sectionLabel: 'Win/Linux',
        jobId: 'abcdef12-3456-7890-abcd-ef1234567890',
        jobCount: 2,
      }),
    ).toBe('D:/lib/99/Win_Linux-Game-abcdef12');
  });

  it('appends short job id when primary path is taken', () => {
    expect(
      buildJobExtractDest({
        archivePath: 'D:/lib/99/Game.zip',
        sectionLabel: 'Patches',
        jobId: '11111111-2222-3333-4444-555555555555',
        jobCount: 1,
        takenPaths: ['D:/lib/99/Patches-Game'],
      }),
    ).toBe('D:/lib/99/Patches-Game-11111111');
  });
});

describe('shortJobId', () => {
  it('returns first 8 hex chars without dashes', () => {
    expect(shortJobId('abcdef12-3456-7890-abcd-ef1234567890')).toBe('abcdef12');
  });
});
