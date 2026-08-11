import * as library from './library';
import type { DownloadRow, DownloadState } from '../types/download';
import type { InstallStatus, LibraryGame } from '../types/library';

/** Download states that should show in-flight UI in the library. */
export const IN_FLIGHT_DOWNLOAD_STATES = new Set<DownloadState>([
  'pending',
  'resolving',
  'awaiting_choice',
  'downloading',
  'extracting',
  'needs_browser',
]);

/** Hosts that cannot finish a guest/ad download in-app — show a No API key hint. */
export const HOSTS_NEEDING_API_KEY = new Set(['datanodes']);

export type LibraryInFlightStatus = 'downloading' | 'extracting' | 'needs_attention';

/** Map live download rows to a library install status override, if any. */
export function inFlightLibraryStatus(
  rows: DownloadRow[],
  threadId: string,
): LibraryInFlightStatus | null {
  let hasNeedsBrowser = false;
  let hasDownloading = false;
  for (const row of rows) {
    if (row.threadId !== threadId || !IN_FLIGHT_DOWNLOAD_STATES.has(row.state)) {
      continue;
    }
    if (row.state === 'extracting') {
      return 'extracting';
    }
    if (row.state === 'needs_browser') {
      hasNeedsBrowser = true;
    } else {
      hasDownloading = true;
    }
  }
  if (hasNeedsBrowser) return 'needs_attention';
  if (hasDownloading) return 'downloading';
  return null;
}

export function hostNeedsApiKeyHint(host: string): boolean {
  return HOSTS_NEEDING_API_KEY.has(host.trim().toLowerCase());
}

/** Rows that never started transferring bytes — user can switch host. */
export function canChangeDownloadProvider(row: DownloadRow): boolean {
  if (row.state === 'needs_browser') return true;
  if (row.state === 'failed' && (row.bytesDone ?? 0) <= 0) return true;
  return false;
}

/** Keep library.install_status aligned with active download rows. */
export async function syncLibraryFromDownloads(rows: DownloadRow[]): Promise<void> {
  const wantByThread = new Map<string, InstallStatus>();
  for (const row of rows) {
    if (!IN_FLIGHT_DOWNLOAD_STATES.has(row.state)) continue;
    const want: InstallStatus =
      row.state === 'extracting' ? 'extracting' : 'downloading';
    const prev = wantByThread.get(row.threadId);
    if (prev !== 'extracting') {
      wantByThread.set(row.threadId, want);
    }
  }

  await Promise.all(
    [...wantByThread.entries()].map(async ([threadId, want]) => {
      try {
        const game = await library.get(threadId);
        if (!game || game.installStatus === want) return;
        await library.setStatus(threadId, want);
      } catch {
        /* row may have been removed */
      }
    }),
  );

  // Clear sticky in-flight / error statuses when nothing is transferring for
  // that thread (e.g. user removed a needs_browser DataNodes row).
  try {
    const stuck = [
      ...(await library.list({ status: 'downloading' })),
      ...(await library.list({ status: 'extracting' })),
      ...(await library.list({ status: 'error' })),
    ];
    await Promise.all(
      stuck.map(async (game) => {
        if (wantByThread.has(game.threadId)) return;
        const next = recoverStatusAfterDownloadFailure(game);
        if (next !== game.installStatus) {
          await library.setStatus(game.threadId, next);
        }
      }),
    );
  } catch {
    /* ignore */
  }
}

export function recoverStatusAfterDownloadFailure(game: {
  installPath: string | null;
  exePath: string | null;
  availableVersion: string | null;
}): InstallStatus {
  if (game.installPath || game.exePath) {
    return game.availableVersion?.trim() ? 'update_available' : 'installed';
  }
  return 'not_installed';
}

/** True when a failed install should offer Install again (no playable files yet). */
export function canRetryInstallFromError(game: LibraryGame): boolean {
  return (
    game.installStatus === 'error' &&
    game.category === 'games' &&
    !game.installPath &&
    !game.exePath
  );
}
