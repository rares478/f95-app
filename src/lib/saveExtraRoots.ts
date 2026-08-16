/** Normalize absolute folder paths for extra-root uniqueness (Windows-friendly). */
export function normalizeSaveExtraRootPath(path: string): string {
  return path.trim().replace(/\//g, '\\').replace(/\\+$/, '');
}

export function saveExtraRootPathKey(path: string): string {
  return normalizeSaveExtraRootPath(path).toLowerCase();
}
