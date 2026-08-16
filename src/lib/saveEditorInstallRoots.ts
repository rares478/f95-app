import {
  exeDisplayName,
  exeParentDir,
  type LibraryGameExe,
} from './libraryExes';

export type SaveEditorInstallRoot = {
  /** Normalized path key for comparisons. */
  key: string;
  path: string;
  label: string;
};

/** Fold path separators / case for Windows-friendly uniqueness. */
export function normalizeInstallPathKey(path: string): string {
  return path.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
}

/**
 * Unique install folders from registered exes (+ optional game.installPath fallback).
 * Multiple exes in the same folder collapse to one root (first label wins).
 */
export function collectSaveEditorInstallRoots(
  exes: LibraryGameExe[],
  fallbackInstallPath: string | null | undefined,
): SaveEditorInstallRoot[] {
  const roots: SaveEditorInstallRoot[] = [];
  const seen = new Set<string>();

  const push = (path: string, label: string) => {
    const trimmed = path.trim();
    if (!trimmed) return;
    const key = normalizeInstallPathKey(trimmed);
    if (seen.has(key)) return;
    seen.add(key);
    roots.push({ key, path: trimmed, label });
  };

  for (const exe of exes) {
    const path = (exe.installPath?.trim() || exeParentDir(exe.exePath)).trim();
    if (!path) continue;
    push(path, exeDisplayName(exe));
  }

  if (fallbackInstallPath?.trim()) {
    const path = fallbackInstallPath.trim();
    const key = normalizeInstallPathKey(path);
    if (!seen.has(key)) {
      // Prefer showing fallback first when it wasn't covered by exes.
      roots.unshift({
        key,
        path,
        label: path.split(/[/\\]/).filter(Boolean).pop() || path,
      });
    }
  }

  return roots;
}

/** Pick initial root: prefer matching game.installPath, else first. */
export function defaultSaveEditorInstallRoot(
  roots: SaveEditorInstallRoot[],
  preferredPath: string | null | undefined,
): SaveEditorInstallRoot | null {
  if (roots.length === 0) return null;
  if (preferredPath?.trim()) {
    const key = normalizeInstallPathKey(preferredPath.trim());
    const hit = roots.find((r) => r.key === key);
    if (hit) return hit;
  }
  return roots[0] ?? null;
}
