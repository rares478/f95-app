import { describe, expect, it } from 'vitest';
import {
  archiveStem,
  buildBundleExtractDest,
  buildJobExtractDest,
  bundleAlreadyAssigned,
  pickBundleLeadJob,
  resolveLibraryGameDir,
  sanitizePathSegment,
  shortJobId,
  shouldAutoExtractDownload,
  withBundleAssignLock,
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

describe('bundleAlreadyAssigned', () => {
  it('is true when any sibling is assigned', () => {
    expect(
      bundleAlreadyAssigned([
        { assignStatus: 'pending' },
        { assignStatus: 'assigned' },
      ]),
    ).toBe(true);
  });

  it('is false when none are assigned', () => {
    expect(
      bundleAlreadyAssigned([
        { assignStatus: 'pending' },
        { assignStatus: 'pending' },
      ]),
    ).toBe(false);
  });
});

describe('withBundleAssignLock', () => {
  it('serializes concurrent work for the same bundleId', async () => {
    const order: number[] = [];
    await Promise.all([
      withBundleAssignLock('b1', async () => {
        order.push(1);
        await new Promise((r) => setTimeout(r, 20));
        order.push(2);
      }),
      withBundleAssignLock('b1', async () => {
        order.push(3);
        order.push(4);
      }),
    ]);
    expect(order).toEqual([1, 2, 3, 4]);
  });

  it('allows different bundleIds to run concurrently', async () => {
    let b2StartedBeforeB1Finished = false;
    let releaseB1!: () => void;
    const b1Gate = new Promise<void>((r) => {
      releaseB1 = r;
    });

    const p1 = withBundleAssignLock('bx', async () => {
      await b1Gate;
    });
    const p2 = withBundleAssignLock('by', async () => {
      b2StartedBeforeB1Finished = true;
      releaseB1();
    });
    await Promise.all([p1, p2]);
    expect(b2StartedBeforeB1Finished).toBe(true);
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
