export type LibraryGameExe = {
  id: string;
  threadId: string;
  exePath: string;
  installPath: string | null;
  label: string | null;
  sortOrder: number;
  isDefault: boolean;
  lastLaunchedAt: string | null;
  createdAt: string;
};

/** Strip final `/` or `\` segment (same rule as today’s `setExe`). */
export function exeParentDir(exePath: string): string {
  const i = Math.max(exePath.lastIndexOf('/'), exePath.lastIndexOf('\\'));
  return i >= 0 ? exePath.slice(0, i) : exePath;
}

/** Final path segment. */
export function exeFilename(exePath: string): string {
  const i = Math.max(exePath.lastIndexOf('/'), exePath.lastIndexOf('\\'));
  return i >= 0 ? exePath.slice(i + 1) : exePath;
}

export function exeDisplayName(row: Pick<LibraryGameExe, 'label' | 'exePath'>): string {
  return row.label?.trim() || exeFilename(row.exePath);
}

export function normalizeExeLabel(label: string | null | undefined): string | null {
  const trimmed = label?.trim();
  return trimmed ? trimmed : null;
}

export function resolvePlayExe(rows: LibraryGameExe[]): LibraryGameExe | null {
  if (rows.length === 0) return null;
  const launched = rows.filter((r) => r.lastLaunchedAt);
  if (launched.length > 0) {
    return [...launched].sort((a, b) =>
      (b.lastLaunchedAt!).localeCompare(a.lastLaunchedAt!),
    )[0]!;
  }
  const def = rows.find((r) => r.isDefault);
  if (def) return def;
  return [...rows].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    const c = a.createdAt.localeCompare(b.createdAt);
    if (c !== 0) return c;
    return a.id.localeCompare(b.id);
  })[0]!;
}
