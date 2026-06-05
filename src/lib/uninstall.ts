import * as ipc from './ipc';
import * as library from './library';
import * as libraries from './libraries';

export interface UninstallResult {
  /** At least one on-disk path was removed (or was already gone). */
  deleted: boolean;
  /** Paths the backend refused (outside registered install libraries). */
  skippedPaths: string[];
}

/**
 * Remove a game's installed files from disk and reset its install state in the
 * library. Keeps the library row (title, notes, playtime, etc.).
 *
 * Only deletes the folder that contains the executable (extracted install).
 * Downloaded archives in the thread folder are left intact — remove those from
 * the Downloads page instead.
 */
export async function uninstallGame(threadId: string): Promise<UninstallResult> {
  const game = await library.get(threadId);
  if (!game) {
    throw new Error('game not in library');
  }

  const safeRoots = await libraries.allPaths();
  const skippedPaths: string[] = [];
  let deleted = false;

  const target = resolveDeleteTarget(
    threadId,
    game.installPath,
    game.exePath,
    safeRoots,
  );

  if (target) {
    try {
      const ok = await ipc.deleteInstallDir({ path: target, safeRoots });
      if (ok) {
        deleted = true;
      } else {
        skippedPaths.push(target);
      }
    } catch (err) {
      console.warn('[uninstall] delete failed', target, err);
      skippedPaths.push(target);
    }
  }

  await library.clearExe(threadId);

  return { deleted, skippedPaths };
}

function resolveDeleteTarget(
  threadId: string,
  installPath: string | null,
  exePath: string | null,
  safeRoots: string[],
): string | null {
  const anchorPath = exePath ?? installPath;
  if (!anchorPath) return null;

  const normAnchor = normalizePath(anchorPath).toLowerCase();

  for (const root of safeRoots) {
    const threadDir = normalizePath(joinPath(root, threadId));
    const normThread = threadDir.toLowerCase();

    if (normAnchor === normThread) {
      // Only the zip lives here — nothing extracted to remove.
      return null;
    }

    const underThread =
      normAnchor.startsWith(`${normThread}/`) ||
      normAnchor.startsWith(`${normThread}\\`);

    if (!underThread) continue;

    // Remove the whole extracted folder (direct child of `{library}/{threadId}`),
    // not just the exe's parent. Nested layouts like `…/GameName/Win64/game.exe`
    // would otherwise leave an empty `GameName` shell behind.
    const extractRoot = extractRootUnderThread(threadDir, anchorPath);
    if (extractRoot) return extractRoot;
  }

  if (exePath) {
    const exeDir = normalizePath(exePath.replace(/[/\\][^/\\]+$/, ''));
    if (exeDir && isUnderAnySafeRoot(exeDir, safeRoots)) return exeDir;
  }

  if (installPath && isUnderAnySafeRoot(installPath, safeRoots)) {
    return normalizePath(installPath);
  }

  return null;
}

/** First-level folder under `{library}/{threadId}` that holds the install. */
function extractRootUnderThread(threadDir: string, anchorPath: string): string | null {
  const normThread = normalizePath(threadDir);
  const normAnchor = normalizePath(anchorPath);

  let rel = normAnchor.slice(normThread.length);
  if (rel.startsWith('/') || rel.startsWith('\\')) {
    rel = rel.slice(1);
  }
  if (!rel) return null;

  const firstSegment = rel.split(/[/\\]/)[0];
  if (!firstSegment) return null;

  return joinPath(normThread, firstSegment);
}

function isUnderAnySafeRoot(path: string, safeRoots: string[]): boolean {
  const normPath = normalizePath(path).toLowerCase();
  for (const root of safeRoots) {
    const normRoot = normalizePath(root).toLowerCase();
    if (
      normPath === normRoot ||
      normPath.startsWith(`${normRoot}/`) ||
      normPath.startsWith(`${normRoot}\\`)
    ) {
      return true;
    }
  }
  return false;
}

function normalizePath(p: string): string {
  return p.trim().replace(/[/\\]+$/, '');
}

function joinPath(root: string, part: string): string {
  const sep = root.includes('\\') ? '\\' : '/';
  return `${root.replace(/[/\\]+$/, '')}${sep}${part}`;
}
