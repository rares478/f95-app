import { describe, expect, it } from 'vitest';
import { applyDownloadProgress, createGenerationGuard } from './downloadProgress';

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
