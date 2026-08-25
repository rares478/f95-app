import type { LibraryGame } from '../types/library';
import { isPathInsideLibrary } from './libraries';

export type GameUsageSizeState = 'pending' | 'ready' | 'unavailable';

export interface LibraryGameUsageRow {
  threadId: string;
  title: string;
  installPath: string;
  installStatus: LibraryGame['installStatus'];
  sizeState: GameUsageSizeState;
  usedBytes: number | null;
}

export function filterGamesInLibrary(
  games: LibraryGame[],
  libraryPath: string,
): LibraryGame[] {
  return games.filter(
    (g) => g.installPath != null && isPathInsideLibrary(g.installPath, libraryPath),
  );
}

export function toUsageRows(games: LibraryGame[]): LibraryGameUsageRow[] {
  return games.map((g) => ({
    threadId: g.threadId,
    title: g.title,
    installPath: g.installPath!,
    installStatus: g.installStatus,
    sizeState: 'pending' as const,
    usedBytes: null,
  }));
}

export function sortGameUsageRows(rows: LibraryGameUsageRow[]): LibraryGameUsageRow[] {
  return [...rows].sort((a, b) => {
    const rank = (r: LibraryGameUsageRow) =>
      r.sizeState === 'ready' && r.usedBytes != null ? 0 : r.sizeState === 'pending' ? 1 : 2;
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    if (ra === 0) return (b.usedBytes ?? 0) - (a.usedBytes ?? 0);
    return a.title.localeCompare(b.title);
  });
}

/** Drop size patches when the caller's generation no longer matches (e.g. after uninstall reload). */
export function withGenerationGuard<T extends unknown[]>(
  getGeneration: () => number,
  capturedGeneration: number,
  fn: (...args: T) => void,
): (...args: T) => void {
  return (...args: T) => {
    if (getGeneration() !== capturedGeneration) return;
    fn(...args);
  };
}

export function startLibraryGameSizeLoads(
  rows: LibraryGameUsageRow[],
  opts: {
    concurrency?: number;
    directorySize: (path: string) => Promise<{ usedBytes: number; available: boolean }>;
    onUpdate: (threadId: string, patch: Pick<LibraryGameUsageRow, 'sizeState' | 'usedBytes'>) => void;
  },
): () => void {
  let cancelled = false;
  const concurrency = Math.max(1, opts.concurrency ?? 3);
  const queue = [...rows];
  let active = 0;

  const pump = () => {
    while (!cancelled && active < concurrency && queue.length > 0) {
      const row = queue.shift()!;
      active += 1;
      void opts
        .directorySize(row.installPath)
        .then((size) => {
          if (cancelled) return;
          if (size.available) {
            opts.onUpdate(row.threadId, { sizeState: 'ready', usedBytes: size.usedBytes });
          } else {
            opts.onUpdate(row.threadId, { sizeState: 'unavailable', usedBytes: null });
          }
        })
        .catch(() => {
          if (cancelled) return;
          opts.onUpdate(row.threadId, { sizeState: 'unavailable', usedBytes: null });
        })
        .finally(() => {
          active -= 1;
          pump();
        });
    }
  };

  pump();
  return () => {
    cancelled = true;
  };
}

/** Segment bytes for a library/other/free drive meter. */
export interface DriveUsageSegments {
  totalBytes: number;
  freeBytes: number;
  libraryBytes: number;
  otherBytes: number;
  libraryPct: number;
  otherPct: number;
  freePct: number;
}

/**
 * Build drive meter segments. Returns null when total capacity is unknown.
 * `other` is clamped so library + free never exceed total.
 */
export function driveUsageSegments(opts: {
  totalBytes: number | null | undefined;
  freeBytes: number;
  libraryUsedBytes: number | null | undefined;
}): DriveUsageSegments | null {
  const total = opts.totalBytes;
  if (total == null || !(total > 0)) return null;
  const free = Math.max(0, Math.min(opts.freeBytes, total));
  const library = Math.max(0, Math.min(opts.libraryUsedBytes ?? 0, total));
  const other = Math.max(0, total - free - library);
  const pct = (n: number) => (total > 0 ? (n / total) * 100 : 0);
  return {
    totalBytes: total,
    freeBytes: free,
    libraryBytes: library,
    otherBytes: other,
    libraryPct: pct(library),
    otherPct: pct(other),
    freePct: pct(free),
  };
}

/** 0–100 share of a game within the library folder used size. */
export function gameShareOfLibrary(
  gameBytes: number | null | undefined,
  libraryUsedBytes: number | null | undefined,
): number | null {
  if (gameBytes == null || libraryUsedBytes == null || libraryUsedBytes <= 0) return null;
  return Math.max(0, Math.min(100, (gameBytes / libraryUsedBytes) * 100));
}
