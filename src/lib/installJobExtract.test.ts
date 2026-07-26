import { describe, expect, it } from 'vitest';
import {
  archiveStem,
  buildBundleExtractDest,
  buildJobExtractDest,
  pickBundleLeadJob,
  resolveLibraryGameDir,
  sanitizePathSegment,
  shortJobId,
  shouldAutoExtractDownload,
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

describe('buildBundleExtractDest', () => {
  it('uses sanitize(sectionLabel) under library game dir without job/stem suffix', () => {
    expect(
      buildBundleExtractDest({
        archivePath: 'D:/lib/99/Game.part1.rar',
        sectionLabel: 'Season 1-2 · Win/Linux · Splits',
        jobId: 'abcdef12-3456-7890-abcd-ef1234567890',
      }),
    ).toBe('D:/lib/99/Season 1-2 · Win_Linux · Splits');
  });

  it('reuses an existing sibling extractPath', () => {
    expect(
      buildBundleExtractDest({
        archivePath: 'D:/lib/99/Game.part2.rar',
        sectionLabel: 'Season 1-2 · Win/Linux · Splits',
        jobId: '11111111-2222-3333-4444-555555555555',
        siblingExtractPaths: [null, 'D:/lib/99/Season 1-2 · Win_Linux · Splits'],
      }),
    ).toBe('D:/lib/99/Season 1-2 · Win_Linux · Splits');
  });

  it('uses parent of install path when install is outside archive tree', () => {
    expect(
      buildBundleExtractDest({
        archivePath: 'E:/dl/99/a.part1.rar',
        sectionLabel: 'Splits',
        jobId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        installPath: 'D:/Games/MyGame/old',
      }),
    ).toBe('D:/Games/MyGame/Splits');
  });
});

describe('pickBundleLeadJob', () => {
  it('returns the lowest sortOrder job (then id)', () => {
    expect(
      pickBundleLeadJob([
        { id: 'j2', sortOrder: 2 },
        { id: 'j1', sortOrder: 1 },
        { id: 'j0', sortOrder: 0 },
      ])?.id,
    ).toBe('j0');
  });

  it('returns null for empty list', () => {
    expect(pickBundleLeadJob([])).toBeNull();
  });
});

describe('shouldAutoExtractDownload', () => {
  it('allows extract when there is no linked job', () => {
    expect(shouldAutoExtractDownload({ job: null })).toBe(true);
    expect(shouldAutoExtractDownload({ job: undefined })).toBe(true);
  });

  it('allows extract for pending job without extractPath', () => {
    expect(
      shouldAutoExtractDownload({
        job: { extractPath: null, assignStatus: 'pending' },
      }),
    ).toBe(true);
  });

  it('skips when extractPath is already set (including pending assign)', () => {
    expect(
      shouldAutoExtractDownload({
        job: { extractPath: 'D:/lib/99/Win_Linux-Game', assignStatus: 'pending' },
      }),
    ).toBe(false);
  });

  it('skips when assignStatus is terminal', () => {
    for (const assignStatus of ['assigned', 'skipped', 'failed'] as const) {
      expect(
        shouldAutoExtractDownload({
          job: { extractPath: null, assignStatus },
        }),
      ).toBe(false);
    }
  });
});
