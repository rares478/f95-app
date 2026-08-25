import { describe, expect, it } from 'vitest';
import { applyDownloadProgress, createGenerationGuard, progressAfterDownloadDone } from './downloadProgress';

describe('applyDownloadProgress', () => {
  it('keeps extract fields when a download tick arrives', () => {
    const merged = applyDownloadProgress(
      {
        id: 9,
        bytes: 100,
        total: 200,
        speedBps: 10,
        extractPercent: 42,
        extractEtaSecs: 12,
        extractSpeedBps: 5,
      },
      { id: 9, bytes: 150, total: 200, speedBps: 20 },
    );
    expect(merged).toEqual({
      id: 9,
      bytes: 150,
      total: 200,
      speedBps: 20,
      extractPercent: 42,
      extractEtaSecs: 12,
      extractSpeedBps: 5,
    });
  });
});

describe('progressAfterDownloadDone', () => {
  it('snaps bytes to completion and clears speed before extract', () => {
    const merged = progressAfterDownloadDone(
      {
        id: 3,
        bytes: 990,
        total: 1000,
        speedBps: 50_000,
        extractPercent: undefined,
      },
      3,
      1000,
    );
    expect(merged).toEqual({
      id: 3,
      bytes: 1000,
      total: 1000,
      speedBps: 0,
      extractPercent: undefined,
    });
  });

  it('raises a missing or short total so the bar can hit 100%', () => {
    expect(progressAfterDownloadDone({ id: 1, bytes: 50, total: 80, speedBps: 1 }, 1, 100)).toEqual({
      id: 1,
      bytes: 100,
      total: 100,
      speedBps: 0,
    });
    expect(progressAfterDownloadDone(undefined, 2, 50)).toEqual({
      id: 2,
      bytes: 50,
      total: 50,
      speedBps: 0,
    });
  });
});

describe('createGenerationGuard', () => {
  it('rejects a begin() that was superseded by a later begin()', () => {
    const guard = createGenerationGuard();
    const first = guard.begin();
    expect(guard.isCurrent(first)).toBe(true);
    const second = guard.begin();
    expect(guard.isCurrent(first)).toBe(false);
    expect(guard.isCurrent(second)).toBe(true);
  });
});
