/**
 * Steam-style install libraries.
 *
 * The user can register N folders (e.g. `D:\F95Games`, `E:\backup`). Exactly
 * one row is `is_default` at all times — that's where downloads land when the
 * user has only one library or doesn't pick one in the modal. The default is
 * also pre-selected in the picker UI.
 *
 * On first launch, `ensureSeeded()` inserts the legacy
 * `<app_local_data>/downloads` path as the default so existing rows in
 * `library_games`/`downloads` keep working without migration scripts.
 */
import { execute, query } from './db';
import * as ipc from './ipc';
import type { InstallLibrary, InstallLibraryWithDisk } from '../types/install-library';

interface DbRow {
  id: number;
  label: string;
  path: string;
  is_default: number;
  created_at: string;
}

function rowToLib(r: DbRow): InstallLibrary {
  return {
    id: r.id,
    label: r.label,
    path: r.path,
    isDefault: r.is_default === 1,
    addedAt: r.created_at,
  };
}

let seedAttempted = false;

/**
 * Insert the legacy default downloads dir as the first library row, but only
 * if the table is empty. Runs once per session via the module-level flag; safe
 * to call from every entry point that needs `list()`.
 */
export async function ensureSeeded(): Promise<void> {
  if (seedAttempted) return;
  seedAttempted = true;
  const existing = await query<{ n: number }>(
    `SELECT COUNT(*) AS n FROM install_libraries`,
  );
  if ((existing[0]?.n ?? 0) > 0) return;
  let defaultPath: string;
  try {
    defaultPath = await ipc.defaultDownloadsPath();
  } catch (err) {
    console.warn('[libraries] failed to resolve default downloads path', err);
    return;
  }
  await execute(
    `INSERT INTO install_libraries (label, path, is_default) VALUES (?, ?, 1)`,
    ['Padrão', defaultPath],
  );
}

export async function list(): Promise<InstallLibrary[]> {
  await ensureSeeded();
  const rows = await query<DbRow>(
    `SELECT * FROM install_libraries ORDER BY is_default DESC, created_at ASC`,
  );
  return rows.map(rowToLib);
}

/** Same as `list()` but enriches each row with live disk-info. */
export async function listWithDisk(): Promise<InstallLibraryWithDisk[]> {
  const libs = await list();
  const enriched = await Promise.all(
    libs.map(async (lib) => {
      try {
        const disk = await ipc.diskInfo(lib.path);
        return { ...lib, disk };
      } catch (err) {
        console.warn(`[libraries] disk info failed for ${lib.path}`, err);
        return { ...lib, disk: { freeBytes: 0, available: false } };
      }
    }),
  );
  return enriched;
}

export async function get(id: number): Promise<InstallLibrary | null> {
  const rows = await query<DbRow>(
    `SELECT * FROM install_libraries WHERE id = ?`,
    [id],
  );
  return rows[0] ? rowToLib(rows[0]) : null;
}

export async function getDefault(): Promise<InstallLibrary | null> {
  await ensureSeeded();
  const rows = await query<DbRow>(
    `SELECT * FROM install_libraries WHERE is_default = 1 LIMIT 1`,
  );
  return rows[0] ? rowToLib(rows[0]) : null;
}

/** Add a new library. Throws if the path is already registered. */
export async function add(args: { label: string; path: string }): Promise<InstallLibrary> {
  const path = normalizePath(args.path);
  if (!path) throw new Error('caminho inválido');
  const label = args.label.trim() || deriveLabelFromPath(path);
  const res = await execute(
    `INSERT INTO install_libraries (label, path, is_default) VALUES (?, ?, 0)`,
    [label, path],
  );
  const id = res.lastInsertId;
  if (id == null || id <= 0) {
    throw new Error('falha ao inserir biblioteca');
  }
  const created = await get(id);
  if (!created) throw new Error('linha desapareceu após insert');
  return created;
}

/** Make `id` the default library. Clears the flag on the previous default. */
export async function setDefault(id: number): Promise<void> {
  // SQLite has no atomic UPDATE...WHERE...UPDATE, so do it in two statements.
  // Race-wise this is fine because the user clicks "Definir padrão" serially.
  await execute(`UPDATE install_libraries SET is_default = 0 WHERE is_default = 1`);
  await execute(`UPDATE install_libraries SET is_default = 1 WHERE id = ?`, [id]);
}

/**
 * Remove a library. Refuses to remove the last remaining row OR the default
 * (caller must `setDefault(other)` first). Does NOT touch files on disk —
 * games already installed under that path stay there, the user can keep
 * playing them; only newer installs won't be routed there anymore.
 */
export async function remove(id: number): Promise<void> {
  const all = await list();
  if (all.length <= 1) {
    throw new Error('não dá pra remover a última biblioteca');
  }
  const target = all.find((l) => l.id === id);
  if (!target) return;
  if (target.isDefault) {
    throw new Error('defina outra como padrão antes de remover essa');
  }
  await execute(`DELETE FROM install_libraries WHERE id = ?`, [id]);
}

export async function setLabel(id: number, label: string): Promise<void> {
  await execute(
    `UPDATE install_libraries SET label = ? WHERE id = ?`,
    [label.trim(), id],
  );
}

/**
 * Find the library whose path is an ancestor of `installPath`. Used to figure
 * out which library a given install belongs to (e.g. to scope a delete).
 * Returns null when the install is outside every registered library — typical
 * for a game the user added manually and pointed at via "Localizar exe".
 */
export async function findContaining(
  installPath: string,
): Promise<InstallLibrary | null> {
  const libs = await list();
  const target = normalizePath(installPath);
  for (const lib of libs) {
    const root = normalizePath(lib.path);
    if (target.startsWith(root + pathSep(root)) || target === root) {
      return lib;
    }
  }
  return null;
}

/** All registered library paths — for passing as `safeRoots` to backend. */
export async function allPaths(): Promise<string[]> {
  const libs = await list();
  return libs.map((l) => l.path);
}

// ---- helpers ---------------------------------------------------------------

function normalizePath(p: string): string {
  // Collapse trailing slashes; preserve OS-native separators because the
  // backend on Windows reads `C:\...` and on Linux `/...`. We don't try to
  // canonicalize across OSes — the backend's std::fs::canonicalize will.
  return p.trim().replace(/[/\\]+$/, '');
}

function pathSep(p: string): string {
  return p.includes('\\') ? '\\' : '/';
}

function deriveLabelFromPath(p: string): string {
  const trimmed = p.replace(/[/\\]+$/, '');
  const tail = trimmed.split(/[\\/]/).pop() ?? trimmed;
  return tail || trimmed;
}

/** Pretty-printer for disk free space ("203.4 GB free"). */
export function formatFreeSpace(bytes: number): string {
  if (!bytes || bytes < 0) return '—';
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 100) return `${gb.toFixed(0)} GB`;
  if (gb >= 10) return `${gb.toFixed(1)} GB`;
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(0)} MB`;
}
