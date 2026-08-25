import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useRunningGames } from '../../contexts/RunningGames';
import { useDownloads } from '../../contexts/Downloads';
import { inFlightLibraryStatus } from '../../lib/downloadLibrarySync';
import * as ipc from '../../lib/ipc';
import * as libraries from '../../lib/libraries';
import * as library from '../../lib/library';
import {
  filterGamesInLibrary,
  sortGameUsageRows,
  startLibraryGameSizeLoads,
  toUsageRows,
  withGenerationGuard,
  gameShareOfLibrary,
  type LibraryGameUsageRow,
} from '../../lib/libraryStorage';
import { useT } from '../../lib/i18n';

export interface LibraryGamesUsageProps {
  libraryPath: string;
  libraryId: number;
  /** Folder used bytes for per-game share %; null while calculating. */
  libraryUsedBytes: number | null;
  expanded: boolean;
  cachedRows: LibraryGameUsageRow[] | null;
  onCacheRows: (libraryId: number, rows: LibraryGameUsageRow[] | null) => void;
  onUninstall: (row: LibraryGameUsageRow) => Promise<void>;
  uninstallingThreadId: string | null;
}

export function LibraryGamesUsage({
  libraryPath,
  libraryId,
  libraryUsedBytes,
  expanded,
  cachedRows,
  onCacheRows,
  onUninstall,
  uninstallingThreadId,
}: LibraryGamesUsageProps) {
  const { t } = useT();
  const { running } = useRunningGames();
  const { rows: downloadRows } = useDownloads();
  const [rows, setRows] = useState<LibraryGameUsageRow[] | null>(cachedRows);
  const [loading, setLoading] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const cancelRef = useRef<(() => void) | null>(null);
  const generationRef = useRef(0);
  const rowsRef = useRef<LibraryGameUsageRow[] | null>(cachedRows);
  const cachedRowsRef = useRef(cachedRows);
  const onCacheRowsRef = useRef(onCacheRows);
  const prevCachedRef = useRef(cachedRows);
  cachedRowsRef.current = cachedRows;
  onCacheRowsRef.current = onCacheRows;

  // Detect Task 5-style cache invalidation (non-null → null while expanded).
  // Bump generation + cancel size loads synchronously so in-flight patches cannot
  // resurrect the parent cache before the reload effect runs.
  useEffect(() => {
    const prev = prevCachedRef.current;
    prevCachedRef.current = cachedRows;
    if (expanded && prev != null && cachedRows == null) {
      generationRef.current += 1;
      cancelRef.current?.();
      cancelRef.current = null;
      setReloadToken((n) => n + 1);
    }
  }, [cachedRows, expanded]);

  useEffect(() => {
    if (!expanded) {
      generationRef.current += 1;
      cancelRef.current?.();
      cancelRef.current = null;
      return;
    }

    const gen = ++generationRef.current;

    const applyPatch = withGenerationGuard(
      () => generationRef.current,
      gen,
      (threadId: string, patch: Pick<LibraryGameUsageRow, 'sizeState' | 'usedBytes'>) => {
        const prev = rowsRef.current;
        if (!prev) return;
        const next = sortGameUsageRows(
          prev.map((r) => (r.threadId === threadId ? { ...r, ...patch } : r)),
        );
        rowsRef.current = next;
        setRows(next);
        onCacheRowsRef.current(libraryId, next);
      },
    );

    const startSizes = (usageRows: LibraryGameUsageRow[]) => {
      const pending = usageRows.filter((r) => r.sizeState === 'pending');
      if (pending.length === 0) return;
      cancelRef.current?.();
      cancelRef.current = startLibraryGameSizeLoads(pending, {
        concurrency: 3,
        directorySize: ipc.directorySize,
        onUpdate: applyPatch,
      });
    };

    const cached = cachedRowsRef.current;
    if (cached != null) {
      rowsRef.current = cached;
      setRows(cached);
      setLoading(false);
      startSizes(cached);
      return () => {
        generationRef.current += 1;
        cancelRef.current?.();
        cancelRef.current = null;
      };
    }

    let cancelled = false;
    setLoading(true);
    rowsRef.current = null;
    setRows(null);

    void (async () => {
      try {
        const games = await library.list();
        if (cancelled || generationRef.current !== gen) return;
        const usageRows = toUsageRows(filterGamesInLibrary(games, libraryPath));
        rowsRef.current = usageRows;
        setRows(usageRows);
        onCacheRowsRef.current(libraryId, usageRows);
        setLoading(false);
        startSizes(usageRows);
      } catch (err) {
        console.warn('[settings] failed to load library games usage', err);
        if (cancelled || generationRef.current !== gen) return;
        rowsRef.current = [];
        setRows([]);
        onCacheRowsRef.current(libraryId, []);
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      generationRef.current += 1;
      cancelRef.current?.();
      cancelRef.current = null;
    };
  }, [expanded, libraryId, libraryPath, reloadToken]);

  if (!expanded) return null;

  if (loading || rows == null) {
    return (
      <div className="settings-lib-games">
        <div className="settings-lib-games-loading">{t('common.loading')}</div>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="settings-lib-games">
        <div className="settings-lib-games-empty">{t('settings.libraries.games.empty')}</div>
      </div>
    );
  }

  return (
    <div className="settings-lib-games">
      {rows.map((row) => {
        const inflight = inFlightLibraryStatus(downloadRows, row.threadId);
        const uninstallDisabled =
          uninstallingThreadId === row.threadId ||
          running.has(row.threadId) ||
          row.installStatus === 'downloading' ||
          row.installStatus === 'extracting' ||
          inflight === 'downloading' ||
          inflight === 'extracting';
        const share =
          row.sizeState === 'ready'
            ? gameShareOfLibrary(row.usedBytes, libraryUsedBytes)
            : null;

        return (
          <div key={row.threadId} className="settings-lib-game-block">
            <div className="settings-lib-game-row">
              <Link
                to={`/library/game/${row.threadId}`}
                className="settings-lib-game-title"
                title={row.title}
              >
                {row.title}
              </Link>
              <span
                className={`settings-lib-game-size${
                  row.sizeState === 'pending' ? ' settings-lib-game-size-pending' : ''
                }`}
              >
                {sizeLabel(row, t)}
              </span>
              <span className="settings-lib-game-pct">
                {share != null ? `${Math.round(share)}%` : '—'}
              </span>
              <button
                type="button"
                className="settings-link-btn settings-link-btn-danger"
                disabled={uninstallDisabled}
                onClick={() => void onUninstall(row)}
              >
                {uninstallingThreadId === row.threadId
                  ? t('libdetail.action.uninstalling')
                  : t('libdetail.action.uninstall')}
              </button>
            </div>
            <div className="settings-lib-game-share" aria-hidden>
              <i style={{ width: `${share ?? 0}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function sizeLabel(
  row: LibraryGameUsageRow,
  t: (key: string, vars?: Record<string, string | number>) => string,
): string {
  if (row.sizeState === 'pending') return t('settings.libraries.games.calculating');
  if (row.sizeState === 'unavailable') return t('settings.libraries.games.unavailable');
  return libraries.formatStorageSize(row.usedBytes!);
}
