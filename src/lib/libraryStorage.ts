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
