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
  type LibraryGameUsageRow,
} from '../../lib/libraryStorage';
import { useT } from '../../lib/i18n';

export interface LibraryGamesUsageProps {
  libraryPath: string;
  libraryId: number;
  expanded: boolean;
  cachedRows: LibraryGameUsageRow[] | null;
  onCacheRows: (libraryId: number, rows: LibraryGameUsageRow[] | null) => void;
  onUninstall: (row: LibraryGameUsageRow) => Promise<void>;
  uninstallingThreadId: string | null;
}

export function LibraryGamesUsage({
  libraryPath,
  libraryId,
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
  const cachedRowsRef = useRef(cachedRows);
  const onCacheRowsRef = useRef(onCacheRows);
  const prevCachedRef = useRef(cachedRows);
  cachedRowsRef.current = cachedRows;
  onCacheRowsRef.current = onCacheRows;

  // Detect Task 5-style cache invalidation (non-null → null while expanded).
  useEffect(() => {
    const prev = prevCachedRef.current;
    prevCachedRef.current = cachedRows;
    if (expanded && prev != null && cachedRows == null) {
      setReloadToken((n) => n + 1);
    }
  }, [cachedRows, expanded]);

  useEffect(() => {
    if (!expanded) {
      cancelRef.current?.();
      cancelRef.current = null;
      return;
    }

    const applyPatch = (threadId: string, patch: Pick<LibraryGameUsageRow, 'sizeState' | 'usedBytes'>) => {
      setRows((prev) => {
        if (!prev) return prev;
        const next = sortGameUsageRows(
          prev.map((r) => (r.threadId === threadId ? { ...r, ...patch } : r)),
        );
        onCacheRowsRef.current(libraryId, next);
        return next;
      });
    };

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
      setRows(cached);
      setLoading(false);
      startSizes(cached);
      return () => {
        cancelRef.current?.();
        cancelRef.current = null;
      };
    }

    let cancelled = false;
    setLoading(true);
    setRows(null);

    void (async () => {
      try {
        const games = await library.list();
        if (cancelled) return;
        const usageRows = toUsageRows(filterGamesInLibrary(games, libraryPath));
        setRows(usageRows);
        onCacheRowsRef.current(libraryId, usageRows);
        setLoading(false);
        startSizes(usageRows);
      } catch (err) {
        console.warn('[settings] failed to load library games usage', err);
        if (cancelled) return;
        setRows([]);
        onCacheRowsRef.current(libraryId, []);
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
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

        return (
          <div key={row.threadId} className="settings-lib-game-row">
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
