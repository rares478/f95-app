import { parseSamCategory } from '../constants/samCategories';
import { execute, query } from './db';
import {
  exeParentDir,
  normalizeExeLabel,
  resolvePlayExe,
  type LibraryGameExe,
} from './libraryExes';
import { markThreadInLibrary, markThreadNotInLibrary } from './libraryMembership';
import type {
  InstallStatus,
  LibraryFilter,
  LibraryGame,
  LibrarySort,
} from '../types/library';
import type { GameDownload } from '../types/game';
import type { SamCategory } from '../types/sam';

export type { LibraryGameExe } from './libraryExes';
export {
  exeDisplayName,
  exeFilename,
  exeParentDir,
  normalizeExeLabel,
  resolvePlayExe,
} from './libraryExes';

interface ExeDbRow {
  id: string;
  thread_id: string;
  exe_path: string;
  install_path: string | null;
  label: string | null;
  sort_order: number;
  is_default: number;
  last_launched_at: string | null;
  created_at: string;
}

function rowToExe(r: ExeDbRow): LibraryGameExe {
  return {
    id: r.id,
    threadId: r.thread_id,
    exePath: r.exe_path,
    installPath: r.install_path,
    label: r.label,
    sortOrder: r.sort_order,
    isDefault: r.is_default === 1,
    lastLaunchedAt: r.last_launched_at,
    createdAt: r.created_at,
  };
}

interface DbRow {
  thread_id: string;
  category?: string;
  title: string;
  thread_url: string;
  thumbnail_url: string | null;
  current_version: string | null;
  available_version: string | null;
  install_status: string;
  install_path: string | null;
  exe_path: string | null;
  added_at: string;
  last_played_at: string | null;
  total_playtime_seconds: number;
  custom_tags_json: string | null;
  notes: string | null;
  download_links_json?: string | null;
  download_links_version?: string | null;
  download_links_fetched_at?: string | null;
}

function parseDownloadLinksJson(raw: string | null | undefined): GameDownload[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (x): x is GameDownload =>
        x &&
        typeof x === 'object' &&
        typeof x.host === 'string' &&
        typeof x.url === 'string' &&
        typeof x.text === 'string' &&
        (x.group === null || typeof x.group === 'string' || x.group === undefined),
    ).map((x) => ({
      host: x.host,
      url: x.url,
      text: x.text,
      group: x.group ?? null,
    }));
  } catch {
    return [];
  }
}

function rowToGame(r: DbRow): LibraryGame {
  let customTags: string[] = [];
  if (r.custom_tags_json) {
    try {
      const parsed = JSON.parse(r.custom_tags_json);
      if (Array.isArray(parsed)) customTags = parsed.filter((x) => typeof x === 'string');
    } catch {
      // ignore
    }
  }
  return {
    threadId: r.thread_id,
    category: parseSamCategory(r.category),
    title: r.title,
    threadUrl: r.thread_url,
    thumbnailUrl: r.thumbnail_url,
    currentVersion: r.current_version,
    availableVersion: r.available_version,
    installStatus: (r.install_status as InstallStatus) ?? 'not_installed',
    installPath: r.install_path,
    exePath: r.exe_path,
    addedAt: r.added_at,
    lastPlayedAt: r.last_played_at,
    totalPlaytimeSeconds: r.total_playtime_seconds ?? 0,
    customTags,
    notes: r.notes ?? '',
    downloadLinks: parseDownloadLinksJson(r.download_links_json),
    downloadLinksVersion: r.download_links_version ?? null,
    downloadLinksFetchedAt: r.download_links_fetched_at ?? null,
  };
}

export interface AddInput {
  threadId: string;
  category?: SamCategory;
  title: string;
  threadUrl: string;
  thumbnailUrl: string | null;
  currentVersion: string | null;
}

export async function add(input: AddInput): Promise<void> {
  // current_version is FIRST-WRITE-WINS — once we know what version a game was
  // installed at, subsequent add() calls (e.g. when the user clicks "Baixar"
  // for an update) MUST NOT clobber it. The version only advances via
  // applyVersion() after a successful extract.
  const category = input.category ?? 'games';
  await execute(
    `INSERT INTO library_games (
       thread_id, category, title, thread_url, thumbnail_url, current_version,
       install_status, added_at
     ) VALUES (?, ?, ?, ?, ?, ?, 'not_installed', datetime('now'))
     ON CONFLICT(thread_id) DO UPDATE SET
       title = excluded.title,
       thread_url = excluded.thread_url,
       thumbnail_url = COALESCE(excluded.thumbnail_url, library_games.thumbnail_url),
       current_version = COALESCE(library_games.current_version, excluded.current_version),
       category = COALESCE(library_games.category, excluded.category)`,
    [
      input.threadId,
      category,
      input.title,
      input.threadUrl,
      input.thumbnailUrl,
      input.currentVersion,
    ],
  );
  markThreadInLibrary(input.threadId);
}

/**
 * Record that F95Zone is advertising a newer version than what we have
 * installed. If the game was previously `installed`, flip status to
 * `update_available` so cards highlight it. Passing `null` clears any
 * previously stored "newer version" notice.
 */
/** True when the library row has a newer F95 version stored than what we track as installed. */
export function hasPendingUpdate(game: LibraryGame): boolean {
  const next = game.availableVersion?.trim();
  if (!next) return false;
  const cur = game.currentVersion?.trim();
  if (!cur) return true;
  return next.toLowerCase() !== cur.toLowerCase();
}

export async function listPendingUpdates(filter: LibraryFilter = {}): Promise<LibraryGame[]> {
  const games = await list(filter);
  return games.filter(hasPendingUpdate);
}

export async function setAvailableVersion(
  threadId: string,
  version: string | null,
): Promise<void> {
  if (version) {
    await execute(
      `UPDATE library_games
          SET available_version = ?,
              install_status = CASE
                WHEN install_status IN ('downloading', 'extracting') THEN install_status
                WHEN install_path IS NOT NULL OR exe_path IS NOT NULL
                  OR install_status IN ('installed', 'update_available', 'error')
                  THEN 'update_available'
                ELSE install_status
              END
          WHERE thread_id = ?`,
      [version, threadId],
    );
  } else {
    await execute(
      `UPDATE library_games
          SET available_version = NULL,
              install_status = CASE
                WHEN install_status = 'update_available' THEN 'installed'
                ELSE install_status
              END
          WHERE thread_id = ?`,
      [threadId],
    );
  }
}

/**
 * Apply a version after a successful (re)install. Sets current_version,
 * clears available_version, and (if the row was flagged `update_available`)
 * flips it back to `installed`. Called by useDownloads.runExtraction.
 */
export async function applyVersion(
  threadId: string,
  version: string,
): Promise<void> {
  await execute(
    `UPDATE library_games
        SET current_version = ?,
            available_version = NULL,
            install_status = CASE
              WHEN install_status = 'update_available' THEN 'installed'
              ELSE install_status
            END
        WHERE thread_id = ?`,
    [version, threadId],
  );
}

export async function remove(threadId: string): Promise<void> {
  await execute(`DELETE FROM library_games WHERE thread_id = ?`, [threadId]);
  markThreadNotInLibrary(threadId);
}

export async function get(threadId: string): Promise<LibraryGame | null> {
  const rows = await query<DbRow>(
    `SELECT * FROM library_games WHERE thread_id = ?`,
    [threadId],
  );
  return rows[0] ? rowToGame(rows[0]) : null;
}

export async function isInLibrary(threadId: string): Promise<boolean> {
  const rows = await query<{ n: number }>(
    `SELECT COUNT(*) AS n FROM library_games WHERE thread_id = ?`,
    [threadId],
  );
  return (rows[0]?.n ?? 0) > 0;
}

export async function list(filter: LibraryFilter = {}): Promise<LibraryGame[]> {
  const where: string[] = [];
  const args: unknown[] = [];
  if (filter.category) {
    where.push(`category = ?`);
    args.push(filter.category);
  }
  if (filter.status && filter.status !== 'all') {
    where.push(`install_status = ?`);
    args.push(filter.status);
  }
  if (filter.search) {
    where.push(`(LOWER(title) LIKE ? OR LOWER(notes) LIKE ?)`);
    const needle = `%${filter.search.toLowerCase()}%`;
    args.push(needle, needle);
  }
  const orderBy = sortClause(filter.sort ?? 'added');
  const sql =
    `SELECT * FROM library_games` +
    (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
    ` ORDER BY ${orderBy}`;
  const rows = await query<DbRow>(sql, args);
  return rows.map(rowToGame);
}

function sortClause(s: LibrarySort): string {
  switch (s) {
    case 'title':
      return `LOWER(title) ASC`;
    case 'last_played':
      // SQLite has no NULLS LAST; "x IS NULL" sorts 0 before 1 so put nulls last.
      return `(last_played_at IS NULL), last_played_at DESC, added_at DESC`;
    case 'playtime':
      return `total_playtime_seconds DESC, added_at DESC`;
    case 'added':
    default:
      return `added_at DESC`;
  }
}

export async function listExes(threadId: string): Promise<LibraryGameExe[]> {
  const rows = await query<ExeDbRow>(
    `SELECT * FROM library_game_exes
      WHERE thread_id = ?
      ORDER BY sort_order ASC, created_at ASC, id ASC`,
    [threadId],
  );
  return rows.map(rowToExe);
}

export async function syncGameExeCache(threadId: string): Promise<void> {
  const rows = await listExes(threadId);
  const resolved = resolvePlayExe(rows);
  if (!resolved) {
    await execute(
      `UPDATE library_games
          SET exe_path = NULL, install_path = NULL, install_status = 'not_installed'
          WHERE thread_id = ?`,
      [threadId],
    );
    return;
  }
  await execute(
    `UPDATE library_games
        SET exe_path = ?, install_path = ?, install_status = 'installed'
        WHERE thread_id = ?`,
    [resolved.exePath, resolved.installPath, threadId],
  );
}

export async function addExe(
  threadId: string,
  exePath: string,
  label?: string | null,
): Promise<LibraryGameExe> {
  const existing = await listExes(threadId);
  if (existing.some((r) => r.exePath === exePath)) {
    throw new Error('DUPLICATE_EXE_PATH');
  }

  const id = crypto.randomUUID();
  const installPath = exeParentDir(exePath) || null;
  const isFirst = existing.length === 0;
  const sortOrder = isFirst
    ? 0
    : Math.max(...existing.map((r) => r.sortOrder)) + 1;
  const isDefault = isFirst ? 1 : 0;
  const normalizedLabel = normalizeExeLabel(label);

  try {
    await execute(
      `INSERT INTO library_game_exes (
         id, thread_id, exe_path, install_path, label, sort_order, is_default, last_launched_at, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, datetime('now'))`,
      [id, threadId, exePath, installPath, normalizedLabel, sortOrder, isDefault],
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/UNIQUE|unique/i.test(msg)) {
      throw new Error('DUPLICATE_EXE_PATH');
    }
    throw err;
  }

  await syncGameExeCache(threadId);

  const rows = await listExes(threadId);
  const added = rows.find((r) => r.id === id);
  if (!added) {
    throw new Error('Failed to add exe');
  }
  return added;
}

export async function renameExe(id: string, label: string | null): Promise<void> {
  await execute(`UPDATE library_game_exes SET label = ? WHERE id = ?`, [
    normalizeExeLabel(label),
    id,
  ]);
}

export async function removeExe(id: string): Promise<void> {
  const rows = await query<ExeDbRow>(
    `SELECT * FROM library_game_exes WHERE id = ?`,
    [id],
  );
  const row = rows[0];
  if (!row) return;

  const threadId = row.thread_id;
  const wasDefault = row.is_default === 1;

  await execute(`DELETE FROM library_game_exes WHERE id = ?`, [id]);

  if (wasDefault) {
    const remaining = await listExes(threadId);
    if (remaining.length > 0) {
      await execute(`UPDATE library_game_exes SET is_default = 1 WHERE id = ?`, [
        remaining[0]!.id,
      ]);
    }
  }

  await syncGameExeCache(threadId);
}

export async function setDefaultExe(id: string): Promise<void> {
  const rows = await query<ExeDbRow>(
    `SELECT * FROM library_game_exes WHERE id = ?`,
    [id],
  );
  const row = rows[0];
  if (!row) return;

  await execute(
    `UPDATE library_game_exes SET is_default = 0 WHERE thread_id = ?`,
    [row.thread_id],
  );
  await execute(`UPDATE library_game_exes SET is_default = 1 WHERE id = ?`, [id]);
  await syncGameExeCache(row.thread_id);
}

export async function markExeLaunched(id: string): Promise<void> {
  const rows = await query<ExeDbRow>(
    `SELECT * FROM library_game_exes WHERE id = ?`,
    [id],
  );
  const row = rows[0];
  if (!row) return;

  await execute(
    `UPDATE library_game_exes SET last_launched_at = datetime('now') WHERE id = ?`,
    [id],
  );
  await syncGameExeCache(row.thread_id);
}

/**
 * Compatibility path for install/download flows. Empty list → add default
 * child; otherwise update the currently resolved play row (siblings kept).
 */
export async function setExe(threadId: string, exePath: string): Promise<void> {
  const rows = await listExes(threadId);
  if (rows.length === 0) {
    await addExe(threadId, exePath);
    return;
  }
  const resolved = resolvePlayExe(rows);
  if (!resolved) {
    await addExe(threadId, exePath);
    return;
  }
  const installPath = exeParentDir(exePath) || null;
  await execute(
    `UPDATE library_game_exes
        SET exe_path = ?, install_path = ?
        WHERE id = ?`,
    [exePath, installPath, resolved.id],
  );
  await syncGameExeCache(threadId);
}

export async function setStatus(threadId: string, status: InstallStatus): Promise<void> {
  await execute(
    `UPDATE library_games SET install_status = ? WHERE thread_id = ?`,
    [status, threadId],
  );
}

export async function setInstallPath(
  threadId: string,
  installPath: string,
): Promise<void> {
  await execute(
    `UPDATE library_games SET install_path = ? WHERE thread_id = ?`,
    [installPath, threadId],
  );
}

export async function clearExe(threadId: string): Promise<void> {
  await execute(`DELETE FROM library_game_exes WHERE thread_id = ?`, [threadId]);
  await execute(
    `UPDATE library_games
        SET exe_path = NULL, install_path = NULL, install_status = 'not_installed'
        WHERE thread_id = ?`,
    [threadId],
  );
}

export async function setNotes(threadId: string, notes: string): Promise<void> {
  await execute(
    `UPDATE library_games SET notes = ? WHERE thread_id = ?`,
    [notes, threadId],
  );
}

export async function setCustomTags(
  threadId: string,
  tags: string[],
): Promise<void> {
  const json = JSON.stringify(tags);
  await execute(
    `UPDATE library_games SET custom_tags_json = ? WHERE thread_id = ?`,
    [json, threadId],
  );
}

export async function setDownloadLinks(
  threadId: string,
  links: GameDownload[],
  version: string | null,
): Promise<void> {
  await execute(
    `UPDATE library_games
        SET download_links_json = ?,
            download_links_version = ?,
            download_links_fetched_at = datetime('now')
      WHERE thread_id = ?`,
    [JSON.stringify(links), version, threadId],
  );
}

/**
 * Add `seconds` to the running total of playtime and stamp `last_played_at`
 * to now. Called after a session ends.
 */
export async function bumpPlaytime(
  threadId: string,
  seconds: number,
): Promise<void> {
  if (seconds <= 0) {
    // Still update last_played so the card moves to the top of "last played".
    await execute(
      `UPDATE library_games SET last_played_at = datetime('now') WHERE thread_id = ?`,
      [threadId],
    );
    return;
  }
  await execute(
    `UPDATE library_games
        SET total_playtime_seconds = total_playtime_seconds + ?,
            last_played_at = datetime('now')
        WHERE thread_id = ?`,
    [seconds, threadId],
  );
}

export async function stats(category?: SamCategory): Promise<{ total: number; installed: number }> {
  const where = category ? ` WHERE category = ?` : '';
  const args = category ? [category] : [];
  const rows = await query<{ total: number; installed: number }>(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN install_status IN ('installed', 'update_available') THEN 1 ELSE 0 END) AS installed
       FROM library_games${where}`,
    args,
  );
  return {
    total: rows[0]?.total ?? 0,
    installed: rows[0]?.installed ?? 0,
  };
}

/** Mark installed without requiring an exe (comics, animations, assets). */
export async function markInstalled(threadId: string, installPath: string): Promise<void> {
  await execute(
    `UPDATE library_games
        SET install_path = ?, install_status = 'installed', exe_path = NULL
        WHERE thread_id = ?`,
    [installPath, threadId],
  );
}
