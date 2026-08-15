import { execute } from './db';
import * as libraries from './libraries';

/** Route downloads into the user's default install library when none was passed. */
export async function resolveDownloadLibraryPath(
  explicit?: string | null,
): Promise<string | null> {
  const trimmed = explicit?.trim();
  if (trimmed) return trimmed;
  return (await libraries.getDefault())?.path ?? null;
}

export async function rememberDownloadLibrary(
  id: number,
  libraryPath: string | null,
): Promise<void> {
  if (!libraryPath?.trim()) return;
  await execute(`UPDATE downloads SET library_path = ? WHERE id = ?`, [
    libraryPath,
    id,
  ]);
}

/** Pick the library folder a download row should resume into. */
export async function libraryPathForDownloadRow(row: {
  libraryPath?: string | null;
  destPath?: string | null;
}): Promise<string | null> {
  if (row.libraryPath?.trim()) return row.libraryPath.trim();
  if (row.destPath) {
    const dir = row.destPath.replace(/[\\/][^\\/]+$/, '');
    const lib = await libraries.findContaining(dir);
    if (lib) return lib.path;
  }
  return resolveDownloadLibraryPath(null);
}
