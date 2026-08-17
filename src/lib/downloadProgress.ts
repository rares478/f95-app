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
