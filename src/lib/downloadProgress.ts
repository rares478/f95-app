import type { DownloadProgress } from '../types/download';

/** Merge a byte-progress tick without dropping in-flight extract fields. */
export function applyDownloadProgress(
  prev: DownloadProgress | undefined,
  next: Pick<DownloadProgress, 'id' | 'bytes' | 'total' | 'speedBps'>,
): DownloadProgress {
  return {
    ...prev,
    id: next.id,
    bytes: next.bytes,
    total: next.total,
    speedBps: next.speedBps,
  };
}

/**
 * Snap UI progress to the finished byte count before auto-extract starts.
 * Throttled download ticks can lag the real end; without this the bar never
 * hits 100% before the row flips to extracting.
 */
export function progressAfterDownloadDone(
  prev: DownloadProgress | undefined,
  id: number,
  bytes: number,
): DownloadProgress {
  const priorTotal = prev?.total;
  const total =
    priorTotal != null && priorTotal > 0 ? Math.max(priorTotal, bytes) : bytes;
  return applyDownloadProgress(prev, {
    id,
    bytes,
    total,
    speedBps: 0,
  });
}

/** Ignore stale async reloads when a newer one has already started. */
export function createGenerationGuard() {
  let latest = 0;
  return {
    begin(): number {
      latest += 1;
      return latest;
    },
    isCurrent(token: number): boolean {
      return token === latest;
    },
  };
}
